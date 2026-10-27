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
const note: Correction = {
  id: 'note-1',
  submission_id: submission.id,
  author_name: 'Mia Beispiel',
  body: 'Bitte das genaue Datum ergänzen.',
  created_at: '2026-10-22T10:00:00Z',
  resolved: false,
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
    if (path === '/me') return Response.json({ user: student, csrf_token: 'csrf' });
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

  it('shows an existing one-off photo contribution and prevents another create from a direct URL', async () => {
    const existing: Submission = {
      ...submission,
      id: 'oneoff-photo-submission',
      category_id: photo.id,
      title: 'Unser Gruppenfoto',
      status: 'accepted',
    };
    const { fetchMock } = installApi([], existing, [photo]);
    renderPortal(`/beitraege/neu?kategorie=${photo.id}`, student, 'schueler');

    const savedLink = await screen.findByRole('link', { name: 'Zum gespeicherten Beitrag' });
    expect(savedLink).toHaveAttribute('href', `/beitraege/${existing.id}`);
    expect(screen.queryByPlaceholderText('Gib deinem Beitrag einen Namen')).toBeNull();
    expect(screen.queryByRole('button', { name: /Beitrag einreichen/ })).toBeNull();
    expect(
      fetchMock.mock.calls.some(([input, init]) => String(input).endsWith('/submissions') && init?.method === 'POST'),
    ).toBe(false);

    fireEvent.click(savedLink);
    expect(await screen.findByRole('heading', { name: existing.title })).toBeInTheDocument();
  });

  it.each([true, false])('locks new submissions to the linked collection (repeatable: %s)', async (repeatable) => {
    const selected: Category = { ...category, repeatable };
    const { writes } = installApi([], submission, [ideas, selected, photo, person], []);
    renderPortal(`/beitraege/neu?kategorie=${selected.id}`, student, 'schueler');

    const title = await screen.findByLabelText('Titel');
    expect(screen.getByRole('heading', { name: `Beitrag für „${selected.name}“` })).toBeInTheDocument();
    expect(screen.queryByLabelText('Sammlung')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.change(title, { target: { value: 'Unser Ausflug' } });
    fireEvent.submit(title.closest('form')!);

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({ path: '/submissions', method: 'POST', body: { category_id: selected.id } });
  });

  it('keeps the current one-off category and offers only unfilled submission targets while editing', async () => {
    const current: Category = { ...category, repeatable: false };
    const occupiedPhoto: Submission = {
      ...submission,
      id: 'occupied-photo',
      category_id: photo.id,
    };
    installApi([], submission, [current, ideas, photo, person], [submission, occupiedPhoto]);
    renderPortal(`/beitraege/${submission.id}`, student, 'schueler');

    fireEvent.click(await screen.findByRole('button', { name: /Bearbeiten/ }));
    const select = await screen.findByLabelText('Sammlung');
    expect(Array.from((select as HTMLSelectElement).options).map((option) => option.textContent)).toEqual([
      'Erinnerungen',
      'Ideen',
    ]);
  });

  it('keeps a pending original editable after collection close and only offers open move targets', async () => {
    const closedCurrent: Category = { ...category, status: 'closed' };
    const openTarget: Category = { ...ideas, status: 'open' };
    const closedTarget: Category = { ...ideas, id: 'closed-ideas', name: 'Beendete Ideen', status: 'closed' };
    installApi([], submission, [closedCurrent, openTarget, closedTarget]);
    renderPortal(`/beitraege/${submission.id}`, student, 'schueler');

    fireEvent.click(await screen.findByRole('button', { name: /Bearbeiten/ }));
    const select = await screen.findByLabelText('Sammlung');
    expect(Array.from((select as HTMLSelectElement).options).map((option) => option.textContent)).toEqual([
      'Erinnerungen',
      'Ideen',
    ]);
    expect(screen.getByLabelText(/Foto hinzufügen/)).toBeInTheDocument();
  });

  it('includes one-off photos in the editorial contribution reader', async () => {
    const photoItem: Submission = { ...submission, id: 'photo-submission', category_id: photo.id };
    installApi([], photoItem, [category, photo]);
    renderPortal('/redaktion', manager);

    expect(await screen.findByText(photoItem.title)).toBeInTheDocument();
    expect(await screen.findAllByRole('option', { name: 'Fotos' })).toHaveLength(2);
  });
});

function renderPortal(path: string, user: Me['user'], view: View = 'redaktion') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const me: Me = { user, csrf_token: 'csrf' };
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

describe('Redaktion contribution reading', () => {
  it('lists every status by default, exports all contributions, and links to its own detail route', async () => {
    const { fetchMock } = installApi();
    renderPortal('/redaktion', manager);

    const status = screen.getByLabelText('Status') as HTMLSelectElement;
    expect(status.value).toBe('');
    expect(screen.getByLabelText('Umfang')).toHaveValue('all');
    expect(screen.getByLabelText('Suchen')).toHaveAttribute('maxlength', '200');
    expect(await screen.findByText(submission.title)).toBeInTheDocument();

    const listCall = fetchMock.mock.calls.find(([input]) => {
      const url = new URL(String(input), window.location.origin);
      return url.pathname === '/api/v1/submissions' && url.searchParams.has('status');
    });
    expect(listCall).toBeDefined();
    expect(new URL(String(listCall?.[0]), window.location.origin).searchParams.get('status')).toBe('');
    expect(screen.getByRole('link', { name: new RegExp(submission.title) })).toHaveAttribute(
      'href',
      `/redaktion/beitraege/${submission.id}`,
    );

    fireEvent.change(screen.getAllByLabelText('Sammlung')[0], { target: { value: category.id } });
    expect(await screen.findByRole('link', { name: /ZIP herunterladen/ })).toHaveAttribute(
      'href',
      `/api/v1/categories/${category.id}/export?status=all`,
    );
  });

  it.each(['manager', 'admin'] as const)(
    'keeps a %s’s own pending contribution read-only in Redaktion with optional annotations',
    async (role) => {
      const owner = { ...manager, role };
      const ownedSubmission = {
        ...submission,
        author_id: manager.id,
        author_name: manager.name,
        status: 'pending' as const,
      };
      const { writes } = installApi([], ownedSubmission);
      renderPortal('/redaktion', owner);

      fireEvent.click(await screen.findByRole('link', { name: new RegExp(submission.title) }));
      expect(await screen.findByRole('heading', { name: 'Beitragsdetails' })).toBeInTheDocument();
      expect(screen.getAllByText(submission.body).length).toBeGreaterThan(0);
      expect(screen.getByRole('img', { name: 'klassenfahrt.jpg' })).toBeInTheDocument();
      expect(
        screen
          .getAllByRole('link', { name: /klassenfahrt.jpg/ })
          .every((link) => link.getAttribute('href') === submission.attachments[0].url),
      ).toBe(true);
      expect(screen.getByText('Version 1')).toBeInTheDocument();

      expect(screen.queryByRole('button', { name: /Bearbeiten/ })).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Foto hinzufügen/)).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Datei entfernen/ })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /annehmen|ablehnen|erneut zur prüfung öffnen/i }),
      ).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/Korrekturwunsch an die Redaktion/)).not.toBeInTheDocument();

      const annotation = screen.getByPlaceholderText('Optionale Anmerkung zu diesem Beitrag');
      expect(annotation).toHaveAttribute('maxlength', '10000');
      fireEvent.change(annotation, {
        target: { value: 'Bitte Quelle zum Datum ergänzen.' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Anmerkung speichern' }));
      await waitFor(() =>
        expect(writes).toContainEqual({
          path: `/submissions/${submission.id}/corrections`,
          method: 'POST',
          body: { body: 'Bitte Quelle zum Datum ergänzen.' },
        }),
      );
      expect(await screen.findByText('Bitte Quelle zum Datum ergänzen.')).toBeInTheDocument();
      expect(writes.some((write) => write.path.endsWith('/status') || write.path.endsWith('/attachments'))).toBe(false);
    },
  );

  it('keeps unassigned readers read-only and shows existing notes without an author request form', async () => {
    installApi([note]);
    renderPortal(`/redaktion/beitraege/${submission.id}`, { ...manager, category_ids: [] }, 'schueler');

    expect(await screen.findByText(note.body)).toBeInTheDocument();
    expect(screen.getByText(/Du hast Leserechte/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Optionale Anmerkung zu diesem Beitrag')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Was soll korrigiert werden?')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Bearbeiten/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Zur Sammlung/ })).toHaveAttribute('href', `/sammlungen/${category.id}`);
  });

  it('keeps the student author edit and withdrawal actions while removing editorial status actions', async () => {
    installApi([note]);
    renderPortal(`/beitraege/${submission.id}`, student, 'schueler');

    expect(await screen.findByText(note.body)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bearbeiten/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/Foto hinzufügen/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Beitrag zurückziehen' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /annehmen|ablehnen|erneut zur prüfung öffnen/i }),
    ).not.toBeInTheDocument();
  });

  it('does not expose the new text and photo form in Redaktion mode', async () => {
    installApi();
    renderPortal('/beitraege/neu', manager, 'redaktion');

    expect(await screen.findByRole('heading', { name: 'Beiträge' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Was soll die Redaktion dazu wissen?')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Beitrag einreichen/ })).not.toBeInTheDocument();
  });
});
