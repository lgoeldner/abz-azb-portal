import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
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
    if (url === '/me') return Response.json({ user, csrf_token: 'csrf' });
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
  it('shows Alle ansehen for a poll-only student and opens the submitted ballot', async () => {
    mount('/', {
      submissionData: [],
      ballotData: [ballot('only-entry', 'words', 'Unser Jahrgang in drei Worten', 'words', 4)],
    });
    const own = await screen.findByRole('region', { name: 'Deine Beiträge' });
    const allLink = await within(own).findByRole('link', { name: /Alle ansehen/ });
    expect(within(own).getByText('Unser Jahrgang in drei Worten')).toBeInTheDocument();
    fireEvent.click(allLink);
    expect(await screen.findByRole('heading', { level: 1, name: 'Meine Beiträge' })).toBeInTheDocument();
    expect(within(screen.getByRole('main')).getByText('Unser Jahrgang in drei Worten')).toBeInTheDocument();
  });

  it('shows the newest ten combined rows on home, groups photos before limiting, and opens the full list', async () => {
    mount('/');
    const own = await screen.findByRole('region', { name: 'Deine Beiträge' });
    const list = await within(own).findByRole('list');
    const rows = within(list).getAllByRole('listitem');

    expect(rows).toHaveLength(10);
    expect(rows[0]).toHaveTextContent('Unser Jahrgang in drei Worten');
    expect(rows[1]).toHaveTextContent('Fotoalbum');
    expect(rows[1]).toHaveTextContent('3 Fotos');
    expect(rows[2]).toHaveTextContent('Geschichte s9');
    expect(rows[5]).toHaveTextContent('Unser Jahrgang in drei Worten');
    expect(rows.every((row) => !row.textContent?.includes('Geschichte someone-else'))).toBe(true);
    expect(screen.queryByText('Erledigte Sammlungen')).toBeNull();

    fireEvent.click(within(own).getByRole('link', { name: /Alle ansehen/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Meine Beiträge' })).toBeInTheDocument();
    const allRows = within(screen.getByRole('main')).getByRole('list');
    expect(within(allRows).getAllByRole('listitem')).toHaveLength(14);
    expect(within(allRows).getByText('Vorschläge fürs Motto')).toBeInTheDocument();
    expect(within(allRows).getByText('Wahl zum Jahrgangsrat')).toBeInTheDocument();
    expect(within(allRows).getAllByText('Unser Jahrgang in drei Worten')).toHaveLength(2);
    expect(within(allRows).getAllByText('Wortwolke')).toHaveLength(2);
    expect(within(allRows).getByText('Personenwahl')).toBeInTheDocument();
    expect(within(allRows).getByText('Vorschlagswahl')).toBeInTheDocument();
    expect(within(allRows).queryByText('Geschichte someone-else')).toBeNull();
    expect(within(allRows).getAllByText('Abgestimmt')).toHaveLength(4);
    expect(within(allRows).getByText('Vorschläge fürs Motto').closest('a')).toBeNull();
    expect(within(allRows).getByText('Wahl zum Jahrgangsrat').closest('a')).toHaveAttribute(
      'href',
      '/sammlungen/people',
    );
  });

  it('searches poll names and photo metadata, with a separate Abgestimmt filter for ballot entries', async () => {
    mount('/beitraege');
    const list = await screen.findByRole('list');
    const status = screen.getByLabelText('Status');
    fireEvent.change(status, { target: { value: 'voted' } });
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    expect(within(list).getByText('Wahl zum Jahrgangsrat')).toBeInTheDocument();
    expect(within(list).getByText('Vorschläge fürs Motto')).toBeInTheDocument();
    expect(within(list).getAllByText('Wortwolke')).toHaveLength(2);
    expect(within(list).queryByText('Geschichte s9')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Beitrag oder Sammlung finden …'), {
      target: { value: 'Unser Jahrgang in drei Worten' },
    });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getAllByText('Unser Jahrgang in drei Worten')).toHaveLength(2);

    fireEvent.change(status, { target: { value: '' } });
    fireEvent.change(screen.getByPlaceholderText('Beitrag oder Sammlung finden …'), {
      target: { value: 'Bühne' },
    });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(within(list).getByText('Fotoalbum')).toBeInTheDocument();
  });

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

  it('shows loading and failure for ballot data instead of a misleading empty state', async () => {
    mount('/beitraege', { ballotState: 'pending', ballotData: [] });
    expect(await screen.findByRole('status')).toHaveTextContent('Einen Moment');
  });

  it('shows ballot API failures on home and the full list', async () => {
    mount('/beitraege', { ballotState: 'error', ballotData: [] });
    expect(await screen.findByRole('alert')).toHaveTextContent('Stimmen sind gerade nicht verfügbar.');
    expect(screen.queryByText(/Noch keine Beiträge/)).toBeNull();
  });

  it('keeps the home contribution history in an error state when ballot data fails', async () => {
    mount('/', { ballotState: 'error', ballotData: [] });
    const own = await screen.findByRole('region', { name: 'Deine Beiträge' });
    expect(await within(own).findByRole('alert')).toHaveTextContent('Stimmen sind gerade nicht verfügbar.');
    expect(within(own).queryByText(/Die erste Geschichte wartet/)).toBeNull();
  });
});
