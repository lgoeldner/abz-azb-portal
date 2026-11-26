import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

const student = {
  id: 'student-1',
  name: 'Mia Beispiel',
  role: 'student',
  admitted: true,
  cohort_member: true,
  category_ids: [],
};
const day = (n: number) => new Date(Date.UTC(2026, 0, n)).toISOString();
const category = (id: string, name: string, kind: string, status = 'open') => ({
  id,
  name,
  description: '',
  kind,
  repeatable: kind === 'photo' || kind === 'memory',
  ongoing: true,
  closes_at: null,
  status,
  allow_self_vote: false,
  options: [
    { id: `${id}-a`, label: 'Auswahl A' },
    { id: `${id}-b`, label: 'Auswahl B' },
  ],
  my_option_id: null,
  my_option_ids: [],
  all_people: false,
  max_choices: 1,
  version: 1,
  created_at: day(1),
  opened_at: day(1),
  ballot_count: null,
  participation: null,
});
const attachment = (id: string, filename: string, caption: string) => ({
  id,
  filename,
  caption,
  mime_type: 'image/jpeg',
  size_bytes: 20,
  url: `/attachments/${id}`,
  preview_url: `/attachments/${id}/preview`,
});
const submission = (
  id: string,
  category_id: string,
  updated_day: number,
  attachments: ReturnType<typeof attachment>[] = [],
  author_id = student.id,
) => ({
  id,
  category_id,
  author_id,
  author_name: 'Mia Beispiel',
  title: `Geschichte ${id}`,
  body: `Text ${id}`,
  context: '',
  status: 'pending',
  version: 1,
  created_at: day(1),
  updated_at: day(updated_day),
  attachments,
});
const ballot = (
  id: string,
  category_id: string,
  category_name: string,
  category_kind: 'person' | 'proposal' | 'words',
  created_day: number,
  category_status: 'draft' | 'open' | 'closed' = 'closed',
) => ({
  id,
  category_id,
  category_name,
  category_kind,
  category_status,
  created_at: day(created_day),
});

const categories = [
  category('memories', 'Erinnerungen', 'memory'),
  category('photos', 'Fotoalbum', 'photo'),
  category('words', 'Unser Jahrgang in drei Worten', 'words', 'closed'),
  category('people', 'Wahl zum Jahrgangsrat', 'person', 'closed'),
  category('proposal', 'Vorschläge fürs Motto', 'proposal', 'closed'),
];
const submissions = [
  submission('s1', 'memories', 1),
  submission('s2', 'memories', 2),
  submission('s3', 'memories', 3),
  submission('s4', 'memories', 4),
  submission('s5', 'memories', 5),
  submission('s6', 'memories', 6),
  submission('s7', 'memories', 7),
  submission('s8', 'memories', 8),
  submission('s9', 'memories', 9),
  submission('photo-old', 'photos', 1, [attachment('photo-1', 'party.jpg', 'Auf der Feier')]),
  submission('photo-new', 'photos', 12, [
    attachment('photo-2', 'stage.jpg', 'Auf der Bühne'),
    attachment('photo-3', 'crowd.jpg', 'Die ganze Stufe'),
  ]),
  submission('someone-else', 'memories', 15, [], 'other-student'),
];
const myBallots = [
  ballot('shared-key', 'words', 'Unser Jahrgang in drei Worten', 'words', 14),
  ballot('repeat-entry', 'words', 'Unser Jahrgang in drei Worten', 'words', 7),
  ballot('shared-key', 'people', 'Wahl zum Jahrgangsrat', 'person', 3),
  ballot('proposal-entry', 'proposal', 'Vorschläge fürs Motto', 'proposal', 2, 'draft'),
];

function mount(
  path: string,
  options: {
    ballotState?: 'ok' | 'error' | 'pending';
    ballotData?: unknown[];
    user?: typeof student;
    submissionData?: unknown[];
  } = {},
) {
  const { ballotState = 'ok', ballotData = myBallots, user = student, submissionData = submissions } = options;
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input).replace('/api/v1', '');
    if (url === '/me') return Response.json({ user, consent_required: false, csrf_token: 'csrf' });
    if (url === '/categories') return Response.json(categories);
    if (url === '/submissions') return Response.json(submissionData);
    if (url === '/me/ballots') {
      if (ballotState === 'pending') return new Promise<Response>(() => {});
      if (ballotState === 'error')
        return Response.json({ error: { message: 'Stimmen sind gerade nicht verfügbar.' } }, { status: 503 });
      return Response.json(ballotData);
    }
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return fetchMock;
}

describe('student contributions and ballot history', () => {
  it('keeps editors in Schüler view restricted to their own contributions', async () => {
    localStorage.setItem('view', 'schueler');
    const manager = { ...student, id: 'manager-1', role: 'manager' };
    mount('/beitraege', {
      user: manager,
      submissionData: submissions.map((item) =>
        item.author_id === student.id ? { ...item, author_id: manager.id } : item,
      ),
    });
    const list = await screen.findByRole('list');
    expect(within(list).getByText('Geschichte s9')).toBeInTheDocument();
    expect(within(list).queryByText('Geschichte someone-else')).toBeNull();
  });
});
