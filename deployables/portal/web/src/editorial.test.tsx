import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Category, Correction, Me, Revision, Submission } from './api';
import { ContributionDetail, Editorial, NewContribution } from './pages';
import { Session, WorkspaceView, type View } from './ui';

const student: Me['user'] = {
  id: 'student-1',
  name: 'Mia Beispiel',
  role: 'student',
  admitted: true,
  cohort_member: true,
  category_ids: [],
  created_at: '2026-09-01T00:00:00Z',
};
const manager: Me['user'] = {
  ...student,
  id: 'manager-1',
  name: 'Sam Redaktion',
  role: 'manager',
  category_ids: ['memory'],
};
const category: Category = {
  id: 'memory',
  name: 'Erinnerungen',
  description: 'Was bleibt',
  kind: 'memory',
  repeatable: true,
  ongoing: true,
  closes_at: null,
  status: 'open',
  allow_self_vote: false,
  options: [],
  my_option_id: null,
  my_option_ids: [],
  all_people: false,
  max_choices: 1,
  version: 1,
  created_at: '2026-10-01T00:00:00Z',
  opened_at: null,
  ballot_count: null,
  participation: null,
};
const submission: Submission = {
  id: 'submission-1',
  category_id: category.id,
  author_id: student.id,
  author_name: student.name,
  title: 'Die letzte Klassenfahrt',
  body: 'Wir erinnern uns an die lange Busfahrt.',
  context: 'Im Mai 2026',
  status: 'pending',
  version: 2,
  created_at: '2026-10-20T10:00:00Z',
  updated_at: '2026-10-21T10:00:00Z',
  attachments: [
    {
      id: 'photo-1',
      filename: 'klassenfahrt.jpg',
      caption: '',
      mime_type: 'image/jpeg',
      size_bytes: 2048,
      url: '/api/v1/attachments/photo-1',
      preview_url: '/api/v1/attachments/photo-1/preview',
    },
  ],
};
const revision: Revision = {
  attachments: [],
  id: 'revision-1',
  version: 1,
  actor_name: student.name,
  title: 'Die letzte Klassenfahrt',
  body: 'Wir erinnern uns an die lange Busfahrt.',
  context: '',
  status: 'pending',
  created_at: '2026-10-20T10:00:00Z',
};

function installApi(
  initialCorrections: Correction[] = [],
  item: Submission = submission,
  collections: Category[] = [category],
  allSubmissions: Submission[] = [item],
) {
  const corrections = [...initialCorrections];
  const writes: { path: string; method: string; body?: unknown }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.origin);
    const path = url.pathname.replace('/api/v1', '');
    const method = init?.method ?? 'GET';
    if (path === '/me') return Response.json({ user: student, consent_required: false, csrf_token: 'csrf' });
    if (path === '/categories') return Response.json(collections);
    if (path === '/submissions' && method === 'GET') return Response.json(allSubmissions);
    if (path === '/submissions' && method === 'POST') {
      writes.push({ path, method, body: JSON.parse(String(init?.body)) });
      return Response.json(item, { status: 201 });
    }
    if (path === `/submissions/${item.id}`) return Response.json(item);
    if (path === `/submissions/${item.id}/revisions`) return Response.json([revision]);
    if (path === `/submissions/${item.id}/corrections` && method === 'GET') {
      return Response.json(corrections);
    }
    if (path === `/submissions/${item.id}/corrections` && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { body: string };
      writes.push({ path, method, body });
      const created: Correction = {
        id: `note-${corrections.length + 1}`,
        submission_id: item.id,
        author_name: manager.name,
        body: body.body,
        created_at: '2026-10-23T10:00:00Z',
        resolved: false,
      };
      corrections.push(created);
      return Response.json(created, { status: 201 });
    }
    if (method !== 'GET') {
      writes.push({ path, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    }
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, writes };
}

describe('submission collections independent of repeatability', () => {
  const photo: Category = { ...category, id: 'photo', name: 'Fotos', kind: 'photo', repeatable: false };
  const ideas: Category = { ...category, id: 'ideas', name: 'Ideen', kind: 'idea', repeatable: true };
  const person: Category = { ...category, id: 'person', name: 'Personenwahl', kind: 'person', repeatable: false };

  it.each([true, false])('locks new submissions to the linked collection (repeatable: %s)', async (repeatable) => {
    const selected: Category = { ...category, repeatable };
    const { writes } = installApi([], submission, [ideas, selected, photo, person], []);
    renderPortal(`/beitraege/neu?kategorie=${selected.id}`, student, 'schueler');

    const title = await screen.findByLabelText('Titel');
    expect(screen.getByRole('heading', { name: `Beitrag für „${selected.name}“` })).toBeInTheDocument();
    expect(screen.queryByLabelText('Abstimmung')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.change(title, { target: { value: 'Unser Ausflug' } });
    fireEvent.submit(title.closest('form')!);

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ path: '/submissions', method: 'POST', body: { category_id: selected.id } });
  });
});

function renderPortal(path: string, user: Me['user'], view: View = 'redaktion') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const me: Me = { user, consent_required: false, csrf_token: 'csrf' };
  const workspaceView: [View, (next: View) => void] = [view, vi.fn()];
  return render(
    <QueryClientProvider client={client}>
      <Session.Provider value={me}>
        <WorkspaceView.Provider value={workspaceView}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/redaktion" element={<Editorial />} />
              <Route path="/redaktion/beitraege/:id" element={<ContributionDetail />} />
              <Route path="/beitraege/neu" element={<NewContribution />} />
              <Route path="/beitraege/:id" element={<ContributionDetail />} />
            </Routes>
          </MemoryRouter>
        </WorkspaceView.Provider>
      </Session.Provider>
    </QueryClientProvider>,
  );
}
