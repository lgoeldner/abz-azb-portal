import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Attachment, Category, Me, Revision, Submission } from './api';
import { ContributionDetail, NewContribution } from './pages';
import { Sammlungen, SammlungDetail } from './sammlungen';
import { Session, WorkspaceView, type View } from './ui';

const student: Me['user'] = {
  id: 'student-photo',
  name: 'Mia Foto',
  role: 'student',
  admitted: true,
  cohort_member: true,
  category_ids: [],
  created_at: '2026-09-01T00:00:00Z',
};
const manager: Me['user'] = { ...student, id: 'manager-photo', role: 'manager' };

function photoCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 'photos',
    name: 'Jahrgangsmomente',
    description: 'Unser Abschlussjahr',
    kind: 'photo',
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
    opened_at: '2026-10-02T00:00:00Z',
    ballot_count: null,
    participation: null,
    ...overrides,
  };
}

function attachment(id: string, caption = ''): Attachment {
  return {
    id,
    filename: `${id}.jpg`,
    caption,
    mime_type: 'image/jpeg',
    size_bytes: 2048,
    url: `/api/v1/attachments/${id}`,
    preview_url: `/api/v1/attachments/${id}/preview`,
  };
}

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: 'submission-photo',
    category_id: 'photos',
    author_id: student.id,
    author_name: student.name,
    title: 'Hofpause im Oktober',
    body: '',
    context: '',
    status: 'pending',
    version: 2,
    created_at: '2026-10-20T10:00:00Z',
    updated_at: '2026-10-21T10:00:00Z',
    attachments: [attachment('photo-one')],
    ...overrides,
  };
}

function revision(overrides: Partial<Revision> = {}): Revision {
  return {
    id: 'revision-one',
    version: 1,
    actor_name: student.name,
    title: 'Hofpause im Oktober',
    body: '',
    context: '',
    status: 'pending',
    created_at: '2026-10-20T10:00:00Z',
    attachments: [attachment('photo-one', 'Vorheriger Bildtext')],
    ...overrides,
  };
}

function renderRoutes(path: string, user: Me['user'], view: View, routes: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const me: Me = { user, csrf_token: 'csrf' };
  const workspaceView: [View, (next: View) => void] = [view, vi.fn()];
  return render(
    <QueryClientProvider client={client}>
      <Session.Provider value={me}>
        <WorkspaceView.Provider value={workspaceView}>
          <MemoryRouter initialEntries={[path]}>{routes}</MemoryRouter>
        </WorkspaceView.Provider>
      </Session.Provider>
    </QueryClientProvider>,
  );
}

describe('photo contributions', () => {
  it('requires at least one photo before creating a photo contribution', async () => {
    const calls: { path: string; method: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), window.location.origin);
        calls.push({ path: `${url.pathname}${url.search}`, method: init?.method ?? 'GET' });
        if (url.pathname.endsWith('/categories')) return Response.json([photoCategory()]);
        if (url.pathname.endsWith('/submissions')) return Response.json([]);
        return Response.json([]);
      }),
    );

    const result = renderRoutes(
      '/beitraege/neu?kategorie=photos',
      student,
      'schueler',
      <Routes>
        <Route path="/beitraege/neu" element={<NewContribution />} />
      </Routes>,
    );
    await screen.findByRole('heading', { name: 'Fotos für „Jahrgangsmomente“' });
    fireEvent.submit(result.container.querySelector('form')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('Bitte wähle mindestens ein Foto aus.');
    expect(calls.some((call) => call.path.endsWith('/submissions') && call.method === 'POST')).toBe(false);
  });

  it('creates the first photo atomically and retries remaining uploads without duplicating the entry', async () => {
    const calls: { path: string; method: string; body: BodyInit | null | undefined }[] = [];
    let uploads = 0;
    let created = submission({ attachments: [] });
    const firstFile = new File(['one'], 'hofpause.jpg', { type: 'image/jpeg' });
    const secondFile = new File(['two'], 'sonnenuntergang.png', { type: 'image/png' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), window.location.origin);
        const path = url.pathname.replace('/api/v1', '');
        const method = init?.method ?? 'GET';
        if (path === '/categories') return Response.json([photoCategory()]);
        if (path === '/submissions' && method === 'GET') return Response.json([]);
        if (path === '/submissions' && method === 'POST') {
          calls.push({ path, method, body: init?.body });
          const body = init?.body as FormData;
          created = submission({
            title: firstFile.name,
            version: 1,
            attachments: [attachment('photo-first', String(body.get('caption') ?? ''))],
          });
          return Response.json(created, { status: 201 });
        }
        if (path === `/submissions/${created.id}/attachments` && method === 'POST') {
          calls.push({ path, method, body: init?.body });
          uploads += 1;
          if (uploads === 1) {
            return Response.json({ error: { message: 'Upload nicht abgeschlossen.' } }, { status: 500 });
          }
          const body = init?.body as FormData;
          created = {
            ...created,
            version: created.version + 1,
            attachments: [...created.attachments, attachment('photo-second', String(body.get('caption') ?? ''))],
          };
          return Response.json(created);
        }
        return Response.json([]);
      }),
    );

    renderRoutes(
      '/beitraege/neu?kategorie=photos',
      student,
      'schueler',
      <Routes>
        <Route path="/beitraege/neu" element={<NewContribution />} />
        <Route path="/beitraege/:id" element={<p>Fotoeintrag geöffnet</p>} />
      </Routes>,
    );
    const input = await screen.findByLabelText(/Mindestens ein Foto/);
    fireEvent.change(input, { target: { files: [firstFile, secondFile] } });
    const captions = screen.getAllByLabelText('Bildtext optional');
    fireEvent.change(captions[0], { target: { value: 'Im Hof nach der sechsten Stunde' } });
    fireEvent.change(captions[1], { target: { value: 'Licht über dem Schulhof' } });
    fireEvent.submit(input.closest('form')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('Upload nicht abgeschlossen.');
    expect(screen.getByRole('button', { name: /Weitere Fotos hochladen/ })).toBeInTheDocument();
    const createCall = calls.find((call) => call.path === '/submissions')!;
    expect(createCall.body).toBeInstanceOf(FormData);
    const createBody = createCall.body as FormData;
    expect((createBody.get('file') as File).name).toBe(firstFile.name);
    expect(createBody.get('caption')).toBe('Im Hof nach der sechsten Stunde');
    expect(createBody.get('title')).toBeNull();
    expect(createBody.get('body')).toBeNull();
    expect(createBody.get('context')).toBeNull();
    const appendBody = calls.find((call) => call.path.endsWith('/attachments'))?.body as FormData;
    expect((appendBody.get('file') as File).name).toBe(secondFile.name);
    expect(appendBody.get('caption')).toBe('Licht über dem Schulhof');

    fireEvent.click(screen.getByRole('button', { name: /Weitere Fotos hochladen/ }));
    expect(await screen.findByText('Fotoeintrag geöffnet')).toBeInTheDocument();
    expect(calls.filter((call) => call.path === '/submissions' && call.method === 'POST')).toHaveLength(1);
    expect(calls.filter((call) => call.path.endsWith('/attachments') && call.method === 'POST')).toHaveLength(2);
  });

  it.each([false, true])(
    'preserves caption drafts and history when another tab changed the version: %s',
    async (conflictFirst) => {
      const photo = photoCategory();
      const initial = submission({ attachments: [attachment('photo-one')] });
      const history = revision();
      const writes: { path: string; method: string; body?: unknown }[] = [];
      let current = initial;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(String(input), window.location.origin);
          const path = url.pathname.replace('/api/v1', '');
          const method = init?.method ?? 'GET';
          if (path === '/categories') return Response.json([photo]);
          if (path === '/submissions' && method === 'GET') return Response.json([current]);
          if (path === `/submissions/${current.id}` && method === 'GET') return Response.json(current);
          if (path === `/submissions/${current.id}/revisions`) return Response.json([history]);
          if (path === `/submissions/${current.id}/corrections`) return Response.json([]);
          if (path.startsWith(`/submissions/${current.id}/attachments/`) && method === 'PATCH') {
            const body = JSON.parse(String(init?.body)) as { version: number; caption: string };
            writes.push({ path, method, body });
            if (conflictFirst && writes.length === 1) {
              current = { ...current, version: current.version + 1 };
              return Response.json(
                { error: { code: 'conflict', message: 'Der Beitrag wurde inzwischen geändert.' } },
                { status: 409 },
              );
            }
            current = {
              ...current,
              version: current.version + 1,
              attachments: current.attachments.map((item) =>
                item.id === 'photo-one' ? { ...item, caption: body.caption } : item,
              ),
            };
            return Response.json(current);
          }
          return Response.json([]);
        }),
      );

      renderRoutes(
        `/beitraege/${initial.id}`,
        student,
        'schueler',
        <Routes>
          <Route path="/beitraege/:id" element={<ContributionDetail />} />
        </Routes>,
      );
      expect(await screen.findByRole('heading', { name: /^Deine Fotos/ })).toBeInTheDocument();
      expect(screen.queryByText('Kein Text hinzugefügt.')).toBeNull();
      expect(screen.queryByRole('button', { name: /Bearbeiten/ })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Foto entfernen' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Bildtext ergänzen' }));
      fireEvent.change(screen.getByLabelText('Bildtext'), { target: { value: 'Unser letzter warmer Oktobertag' } });
      fireEvent.submit(screen.getByLabelText('Bildtext').closest('form')!);

      await waitFor(() => expect(writes).toHaveLength(1));
      if (conflictFirst) {
        await screen.findByRole('alert');
        expect(screen.getByLabelText('Bildtext')).toHaveValue('Unser letzter warmer Oktobertag');
        fireEvent.click(screen.getByRole('button', { name: 'Bildtext speichern' }));
      }
      expect(await screen.findByText('Unser letzter warmer Oktobertag', { selector: 'p' })).toBeInTheDocument();
      expect(writes).toHaveLength(conflictFirst ? 2 : 1);
      expect(writes.at(-1)).toEqual({
        path: `/submissions/${initial.id}/attachments/photo-one`,
        method: 'PATCH',
        body: { version: initial.version + (conflictFirst ? 1 : 0), caption: 'Unser letzter warmer Oktobertag' },
      });
      fireEvent.click(screen.getByText('Version 1'));
      expect(screen.getByText(/Vorheriger Bildtext/)).toBeInTheDocument();
    },
  );

  it('shows captions read-only to editorial readers', async () => {
    const photo = photoCategory();
    const item = submission({ attachments: [attachment('photo-one', 'Alle haben gelacht.')] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), window.location.origin);
        const path = url.pathname.replace('/api/v1', '');
        if (path === '/categories') return Response.json([photo]);
        if (path === '/submissions' || path === `/submissions/${item.id}/revisions`) return Response.json([]);
        if (path === `/submissions/${item.id}`) return Response.json(item);
        if (path === `/submissions/${item.id}/corrections`) return Response.json([]);
        return Response.json([]);
      }),
    );

    renderRoutes(
      `/redaktion/beitraege/${item.id}`,
      manager,
      'redaktion',
      <Routes>
        <Route path="/redaktion/beitraege/:id" element={<ContributionDetail />} />
      </Routes>,
    );

    expect(await screen.findByText('Alle haben gelacht.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Bildtext/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Foto entfernen' })).toBeNull();
  });

  it('shows only the student’s own photos while editorial collection readers see all', async () => {
    const photo = photoCategory();
    const own = submission({
      id: 'own-photo',
      title: 'Mias Bild',
      attachments: [attachment('own-image', 'Mias Moment')],
    });
    const other = submission({
      id: 'other-photo',
      author_id: 'student-other',
      author_name: 'Noah Beispiel',
      title: 'Noahs Bild',
      attachments: [attachment('other-image', 'Noahs Moment')],
    });
    const legacy = submission({
      id: 'legacy-photo',
      title: 'Voriger Eintrag',
      attachments: [],
      body: 'Ein älterer Textbeitrag.',
    });
    const all = [own, other, legacy];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), window.location.origin);
        if (url.pathname.endsWith('/categories')) return Response.json([photo]);
        if (url.pathname.endsWith('/submissions')) return Response.json(all);
        return Response.json([]);
      }),
    );

    renderRoutes(
      `/sammlungen/${photo.id}`,
      student,
      'schueler',
      <Routes>
        <Route path="/sammlungen" element={<Sammlungen />} />
        <Route path="/sammlungen/:id" element={<SammlungDetail />} />
      </Routes>,
    );
    expect(await screen.findByRole('img', { name: 'Mias Moment' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Noahs Moment' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Mias Moment öffnen' })).toHaveAttribute('href', '/beitraege/own-photo');
    expect(screen.getByRole('link', { name: 'Foto ergänzen' })).toHaveAttribute('href', '/beitraege/legacy-photo');
    cleanup();

    renderRoutes(
      `/sammlungen/${photo.id}`,
      manager,
      'redaktion',
      <Routes>
        <Route path="/sammlungen" element={<Sammlungen />} />
        <Route path="/sammlungen/:id" element={<SammlungDetail />} />
      </Routes>,
    );
    expect(await screen.findByRole('img', { name: 'Mias Moment' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Noahs Moment' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Voriger Eintrag/ })).toHaveAttribute(
      'href',
      '/redaktion/beitraege/legacy-photo',
    );
    expect(screen.getByRole('link', { name: 'Noahs Moment öffnen' })).toHaveAttribute(
      'href',
      '/redaktion/beitraege/other-photo',
    );
  });
});
