import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

const user = {
  id: 'student-1',
  name: 'Mia Beispiel',
  role: 'student',
  admitted: true,
  cohort_member: true,
  category_ids: [],
};
const repeatable = ['idea', 'quote', 'memory', 'photo'];
// A complete Sammlung as the API returns it; extra properties can override defaults independently by kind.
const sammlung = (id: string, name: string, kind: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  description: '',
  kind,
  repeatable: repeatable.includes(kind),
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
  ...extra,
});
const category = sammlung('memory', 'Erinnerungen', 'memory', { description: 'Was bleibt' });

it('starts provider login without fetching identities from the portal', async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL) =>
    Response.json({ error: { code: 'unauthorized', message: 'Bitte anmelden.' } }, { status: 401 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  expect(await screen.findByRole('link', { name: /Mit Schulkonto anmelden/ })).toHaveAttribute('href', '/auth/login');
  expect(fetchMock.mock.calls.every((call) => String(call[0]) === '/api/v1/me')).toBe(true);
});

describe('contribution submission', () => {
  it('keeps entered fields visible when the server rejects a stale submission', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/me')) return Response.json({ user, csrf_token: 'csrf' });
      if (url.endsWith('/api/v1/categories')) return Response.json([category]);
      if (url === '/api/v1/submissions' && init?.method === 'POST')
        return Response.json({ error: { code: 'stale_version', message: 'Bitte erneut prüfen.' } }, { status: 409 });
      return Response.json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/beitraege/neu?kategorie=memory']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const title = await screen.findByPlaceholderText('Gib deinem Beitrag einen Namen');
    fireEvent.change(title, { target: { value: 'Die letzte Freistunde' } });
    fireEvent.change(screen.getByPlaceholderText('Was soll die Redaktion dazu wissen?'), {
      target: { value: 'Wir waren alle dabei.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Beitrag einreichen/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Eine neuere Version liegt vor.'));
    expect(title).toHaveValue('Die letzte Freistunde');
    expect(screen.getByDisplayValue('Wir waren alle dabei.')).toBeInTheDocument();
  });

  it('blocks new contributions for a closed collection', async () => {
    const closed = sammlung('closed-photo', 'Fotos', 'photo', { repeatable: false, status: 'closed' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/me')) return Response.json({ user, csrf_token: 'csrf' });
      if (url.endsWith('/api/v1/categories')) return Response.json([closed]);
      if (url === '/api/v1/submissions' && init?.method === 'POST') return Response.json({});
      return Response.json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/beitraege/neu?kategorie=closed-photo']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText('Neue Beiträge können nur in offenen Sammlungen eingereicht werden.'),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Gib deinem Beitrag einen Namen')).toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('rejects an unsupported file before creating a contribution and preserves the form', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/me')) return Response.json({ user, csrf_token: 'csrf' });
      if (url.endsWith('/api/v1/categories')) return Response.json([category]);
      return Response.json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/beitraege/neu?kategorie=memory']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const title = await screen.findByPlaceholderText('Gib deinem Beitrag einen Namen');
    fireEvent.change(title, { target: { value: 'Die letzte Freistunde' } });
    fireEvent.change(screen.getByLabelText(/höchstens 10 Bilder/), {
      target: { files: [new File(['PDF test'], 'notizen.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Beitrag einreichen/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Bitte wähle nur JPEG-, PNG- oder WebP-Bilder aus.'),
    );
    expect(
      fetchMock.mock.calls.some(([url, init]) => String(url) === '/api/v1/submissions' && init?.method === 'POST'),
    ).toBe(false);
    expect(title).toHaveValue('Die letzte Freistunde');
  });

  it('lets a student replace a rejected photo and retry without creating another contribution', async () => {
    const submission = {
      id: 'new-submission',
      category_id: 'photo',
      author_id: user.id,
      author_name: user.name,
      title: 'Das letzte Schulfest',
      body: 'Wir waren alle dabei.',
      context: '',
      status: 'pending',
      version: 1,
      created_at: '2026-10-23T12:00:00Z',
      updated_at: '2026-10-23T12:00:00Z',
      attachments: [],
    };
    const photoCategory = sammlung('photo', 'Fotos', 'photo', {
      repeatable: false,
      ongoing: false,
      closes_at: '2027-01-01T00:00:00Z',
    });
    let created = false;
    let uploadCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/me')) return Response.json({ user, csrf_token: 'csrf' });
      if (url.endsWith('/api/v1/categories')) return Response.json([photoCategory]);
      if (url === '/api/v1/submissions' && init?.method === 'POST') {
        created = true;
        return Response.json(submission, { status: 201 });
      }
      if (url === '/api/v1/submissions') return Response.json(created ? [submission] : []);
      if (url === '/api/v1/submissions/new-submission/attachments' && init?.method === 'POST') {
        uploadCount += 1;
        if (uploadCount === 1)
          return Response.json(
            { error: { code: 'invalid_image', message: 'Das Foto ist ungültig.' } },
            { status: 400 },
          );
        return Response.json({ ...submission, version: 2 });
      }
      if (url === '/api/v1/submissions/new-submission') return Response.json({ ...submission, version: 2 });
      if (url.endsWith('/revisions') || url.endsWith('/corrections')) return Response.json([]);
      return Response.json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/beitraege/neu?kategorie=photo']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const title = await screen.findByPlaceholderText('Gib deinem Beitrag einen Namen');
    fireEvent.change(title, { target: { value: submission.title } });
    fireEvent.change(screen.getByPlaceholderText('Was soll die Redaktion dazu wissen?'), {
      target: { value: submission.body },
    });
    const photoPicker = screen.getByLabelText(/höchstens 10 Bilder/);
    fireEvent.change(photoPicker, { target: { files: [new File(['bad'], 'bad.jpg', { type: 'image/jpeg' })] } });
    fireEvent.click(screen.getByRole('button', { name: /Beitrag einreichen/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Das Foto ist ungültig.'));
    expect(screen.getByRole('button', { name: 'Ohne weitere Fotos fortfahren' })).toBeInTheDocument();
    expect(photoPicker).toBeEnabled();
    fireEvent.change(photoPicker, {
      target: { files: [new File(['replacement'], 'replacement.jpg', { type: 'image/jpeg' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Fotos erneut hochladen/ }));

    await screen.findByRole('heading', { name: submission.title });
    expect(
      fetchMock.mock.calls.filter(([url, init]) => String(url) === '/api/v1/submissions' && init?.method === 'POST'),
    ).toHaveLength(1);
    expect(uploadCount).toBe(2);
  });
});

describe('verwaltung', () => {
  const admin = {
    id: 'admin-1',
    name: 'Test Admin',
    role: 'admin',
    admitted: true,
    cohort_member: true,
    category_ids: [],
  };
  const guest = {
    id: 'guest-1',
    name: 'Gast Gerda',
    role: 'student',
    admitted: true,
    cohort_member: false,
    category_ids: [],
  };
  const waiting = {
    id: 'wait-1',
    name: 'Warte Willi',
    role: 'student',
    admitted: false,
    cohort_member: true,
    category_ids: [],
  };
  const editor = {
    id: 'mgr-1',
    name: 'Sam Redaktion',
    role: 'manager',
    admitted: true,
    cohort_member: true,
    category_ids: ['memory'],
  };
  const everyone = [admin, guest, waiting, editor];
  type Call = { url: string; method: string; body: Record<string, unknown> | undefined };
  function mount(
    path: string,
    me: Record<string, unknown> = admin,
    onWrite: (c: Call) => Response | undefined = () => undefined,
    people: () => unknown[] = () => everyone,
    categories: unknown[] = [category],
  ) {
    const calls: Call[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input).replace('/api/v1', '');
        const method = init?.method ?? 'GET';
        if (url === '/me') return Response.json({ user: me, csrf_token: 'csrf' });
        if (method !== 'GET') {
          const c = { url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined };
          calls.push(c);
          return onWrite(c) ?? Response.json({ id: 'new-cat' });
        }
        if (url === '/admin/users') return Response.json(people());
        if (url === '/categories') return Response.json(categories);
        if (url === '/admin/status')
          return Response.json({ backup_last_success: null, backup_stale: false, upload_bytes: 0 });
        return Response.json([]);
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return calls;
  }
  const openMenu = async (name: string) =>
    fireEvent.click(await screen.findByRole('button', { name: `Aktionen für ${name}` }));

  it('redirects /admin to the people page', async () => {
    mount('/admin');
    expect(await screen.findByRole('heading', { level: 1, name: 'Personen' })).toBeInTheDocument();
  });

  it.each(['personen', 'sammlungen', 'protokoll'])('keeps non-admins away from /verwaltung/%s', async (page) => {
    mount(`/verwaltung/${page}`, editor);
    expect(await screen.findByRole('heading', { level: 1, name: 'Redaktion' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: /Personen|Sammlungen|Aktivitätsprotokoll/ })).toBeNull();
  });

  it.each(['personen', 'sammlungen', 'protokoll'])('opens /verwaltung/%s in the editorial workspace', async (page) => {
    localStorage.clear();
    localStorage.setItem('view', 'schueler');
    mount(`/verwaltung/${page}`);

    const aside = await screen.findByRole('complementary');
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(document.querySelector('[data-workspace="redaktion"]')).toBeInTheDocument();
    expect(within(aside).getByRole('button', { name: 'Redaktion' })).toHaveAttribute('aria-pressed', 'true');
    expect(localStorage.getItem('view')).toBe('redaktion');
  });

  it('shows the collapsible Verwaltung group only to admins and remembers it', async () => {
    localStorage.clear();
    mount('/');
    const toggle = await screen.findByRole('button', { name: 'Verwaltung' });
    expect(document.querySelector('aside a[href="/verwaltung/sammlungen"]')).toBeNull();
    expect(within(screen.getByRole('complementary')).getByRole('link', { name: 'Alle Sammlungen' })).toHaveAttribute(
      'href',
      '/sammlungen',
    );
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const aside = screen.getByRole('complementary');
    expect(within(aside).getByRole('link', { name: 'Aktivitätsprotokoll' })).toHaveAttribute(
      'href',
      '/verwaltung/protokoll',
    );
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(aside).queryByRole('link', { name: 'Personen' })).toBeNull();
    expect(localStorage.getItem('verwaltung')).toBe('zu');
    localStorage.clear();
  });

  it('filters people with the quick filter chips', async () => {
    mount('/verwaltung/personen');
    await screen.findByText('Gast Gerda');
    expect(screen.getByRole('button', { name: /^Alle/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: /^Wartet auf Freigabe/ }));
    expect(screen.getByText('Warte Willi')).toBeInTheDocument();
    expect(screen.queryByText('Gast Gerda')).toBeNull();
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Personen filtern' })).getByRole('button', { name: /^Redaktion/ }),
    );
    expect(screen.getByText('Sam Redaktion')).toBeInTheDocument();
    expect(screen.queryByText('Warte Willi')).toBeNull();
  });

  it('promotes a guest by changing only cohort_member', async () => {
    const calls = mount('/verwaltung/personen');
    fireEvent.click(await screen.findByRole('button', { name: 'Zum Jahrgangsmitglied machen: Gast Gerda' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      url: '/admin/users/guest-1',
      method: 'PATCH',
      body: { name: 'Gast Gerda', role: 'student', admitted: true, cohort_member: true, category_ids: [] },
    });
  });

  it('keeps grants another admin added after the list loaded when changing a role', async () => {
    let server = everyone;
    const calls = mount('/verwaltung/personen', admin, undefined, () => server);
    await openMenu('Sam Redaktion');
    server = everyone.map((u) => (u.id === editor.id ? { ...editor, category_ids: ['memory', 'quotes'] } : u));
    fireEvent.click(screen.getByRole('menuitem', { name: /Rolle ändern/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Administration' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Bestätigen' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({
      name: 'Sam Redaktion',
      role: 'admin',
      admitted: true,
      cohort_member: true,
      category_ids: ['memory', 'quotes'],
    });
  });

  it('admits a waiting person with one click', async () => {
    const calls = mount('/verwaltung/personen');
    fireEvent.click(await screen.findByRole('button', { name: 'Zugang freigeben: Warte Willi' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({
      name: 'Warte Willi',
      role: 'student',
      admitted: true,
      cohort_member: true,
      category_ids: [],
    });
  });

  it('changes a role only after confirmation', async () => {
    const calls = mount('/verwaltung/personen');
    await openMenu('Gast Gerda');
    fireEvent.click(screen.getByRole('menuitem', { name: /Rolle ändern/ }));
    expect(screen.getByRole('menuitemradio', { name: 'Jahrgang' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Redaktion' }));
    const dialog = await screen.findByRole('dialog', { name: 'Gast Gerda wird zu Redaktion?' });
    expect(calls).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls).toHaveLength(0);

    await openMenu('Gast Gerda');
    fireEvent.click(screen.getByRole('menuitem', { name: /Rolle ändern/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Redaktion' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Bestätigen' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      url: '/admin/users/guest-1',
      method: 'PATCH',
      body: { name: 'Gast Gerda', role: 'manager', admitted: true, cohort_member: false, category_ids: [] },
    });
  });

  it('deletes only after confirmation and shows the server error in the dialog', async () => {
    const calls = mount('/verwaltung/personen', admin, () =>
      Response.json({ error: { code: 'has_content', message: 'Die Person hat bereits Beiträge.' } }, { status: 409 }),
    );
    await openMenu('Gast Gerda');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Löschen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Gast Gerda löschen?' });
    expect(calls).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(calls).toEqual([{ url: '/admin/users/guest-1', method: 'DELETE', body: undefined }]));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Die Person hat bereits Beiträge.');
  });

  it('blocks access only after confirmation and never offers it for the own account', async () => {
    const calls = mount('/verwaltung/personen');
    await openMenu('Test Admin');
    expect(screen.queryByRole('menuitem', { name: 'Zugang sperren' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    await openMenu('Sam Redaktion');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Zugang sperren' }));
    const dialog = await screen.findByRole('dialog', { name: 'Zugang von Sam Redaktion sperren?' });
    expect(calls).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sperren' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      url: '/admin/users/mgr-1',
      method: 'PATCH',
      body: { name: 'Sam Redaktion', role: 'manager', admitted: false, cohort_member: true, category_ids: ['memory'] },
    });
  });

  it('moves keyboard focus into the row menu and back to its trigger', async () => {
    mount('/verwaltung/personen');
    await openMenu('Gast Gerda');
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    expect(items[items.length - 1]).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Aktionen für Gast Gerda' })).toHaveFocus();
  });

  it('closes the row menu on Escape and outside click', async () => {
    mount('/verwaltung/personen');
    await openMenu('Gast Gerda');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    await openMenu('Gast Gerda');
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps the old /verwaltung/rubriken bookmark working', async () => {
    mount('/verwaltung/' + 'rubriken');
    expect(await screen.findByRole('heading', { level: 1, name: 'Sammlungen' })).toBeInTheDocument();
  });

  it('lets an admin assign a single-answer Sammlung to a manager and saves it as a draft definition', async () => {
    const calls = mount('/sammlungen');
    fireEvent.click(await screen.findByRole('button', { name: /Neue Sammlung/ }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Motto' } });
    fireEvent.change(screen.getByLabelText('Klasse'), { target: { value: 'proposal' } });
    for (const option of ['A', 'B']) {
      fireEvent.change(screen.getByLabelText('Antwortoption hinzufügen'), { target: { value: option } });
      fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    }
    fireEvent.click(await screen.findByLabelText('Sam Redaktion'));
    fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0].body).toMatchObject({
      kind: 'proposal',
      repeatable: false,
      ongoing: true,
      closes_at: null,
      options: [{ label: 'A' }, { label: 'B' }],
    });
    expect(calls[1].body).toMatchObject({ role: 'manager', category_ids: ['memory', 'new-cat'] });
  });

  it('grants a new category to a manager with the full user payload', async () => {
    const calls = mount('/sammlungen');
    fireEvent.click(await screen.findByRole('button', { name: /Neue Sammlung/ }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Neu' } });
    fireEvent.click(await screen.findByLabelText('Sam Redaktion'));
    fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]).toMatchObject({ url: '/categories', method: 'POST' });
    expect(calls[1]).toEqual({
      url: '/admin/users/mgr-1',
      method: 'PATCH',
      body: {
        name: 'Sam Redaktion',
        role: 'manager',
        admitted: true,
        cohort_member: true,
        category_ids: ['memory', 'new-cat'],
      },
    });
  });

  it('does not carry unsaved grant changes over to another Sammlung', async () => {
    const quotes = sammlung('quotes', 'Zitate', 'quote');
    const photos = sammlung('photos', 'Fotos', 'photo');
    const calls = mount('/sammlungen/quotes', admin, undefined, undefined, [category, quotes, photos]);
    fireEvent.click(await screen.findByRole('button', { name: 'Sammlung bearbeiten' }));
    fireEvent.click(await screen.findByLabelText('Sam Redaktion'));
    expect(screen.getByLabelText('Sam Redaktion')).toBeChecked();
    fireEvent.click(within(screen.getByRole('complementary')).getByRole('link', { name: /Fotos/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sammlung bearbeiten' }));
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Fotos'));
    expect(screen.getByLabelText('Sam Redaktion')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/categories/photos')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sammlung speichern' })).toBeNull());
    expect(calls.filter((c) => c.url.startsWith('/admin/users'))).toEqual([]);
  });

  it('merges grants into the current server state and retries a failed save without a second Sammlung', async () => {
    let server = { ...editor, category_ids: ['memory'] };
    let failGrant = true;
    const calls = mount(
      '/sammlungen',
      admin,
      (c) => {
        if (c.url === '/admin/users/mgr-1') {
          if (failGrant) {
            failGrant = false;
            return Response.json(
              { error: { code: 'unavailable', message: 'Kurz nicht erreichbar.' } },
              { status: 503 },
            );
          }
          server = { ...server, ...(c.body as object) };
        }
        return undefined;
      },
      () => [admin, server],
    );
    fireEvent.click(await screen.findByRole('button', { name: /Neue Sammlung/ }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Neu' } });
    fireEvent.click(await screen.findByLabelText('Sam Redaktion'));
    // Another admin grants a further Sammlung while this form is open.
    server = { ...server, category_ids: ['memory', 'quotes'] };
    fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));
    expect(await screen.findByText('Kurz nicht erreichbar.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));
    await waitFor(() => expect(server.category_ids).toEqual(['memory', 'quotes', 'new-cat']));
    expect(calls.filter((c) => c.url === '/categories' && c.method === 'POST')).toHaveLength(1);
  });

  it.each(['open', 'closed'])(
    'lets admins change grants on a %s ballot without changing its definition',
    async (status) => {
      const ballot = sammlung('ballot', 'Motto', 'proposal', { status });
      const calls = mount('/sammlungen/ballot', admin, undefined, undefined, [ballot]);
      fireEvent.click(await screen.findByRole('button', { name: 'Berechtigungen bearbeiten' }));
      expect(screen.queryByLabelText('Name')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Definition bearbeiten' })).toBeNull();
      fireEvent.click(await screen.findByLabelText('Sam Redaktion'));
      fireEvent.click(screen.getByRole('button', { name: 'Berechtigungen speichern' }));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]).toMatchObject({
        url: '/admin/users/mgr-1',
        method: 'PATCH',
        body: { category_ids: ['memory', 'ballot'] },
      });
    },
  );
});

describe('navigation by view', () => {
  const now = Date.now();
  const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();
  const fixed = [category, sammlung('quotes', 'Zitate', 'quote', { description: 'Sprüche' })];
  const poll = (id: string, name: string, extra: Record<string, unknown> = {}) =>
    sammlung(id, name, 'proposal', {
      description: 'Beschreibung',
      options: [
        { id: `${id}-a`, label: 'A' },
        { id: `${id}-b`, label: 'B' },
      ],
      created_at: iso(10),
      opened_at: iso(3),
      ...extra,
    });
  const submission = (id: string, categoryId: string, authorId: string, status = 'pending') => ({
    id,
    category_id: categoryId,
    author_id: authorId,
    author_name: 'Wer',
    title: `Beitrag ${id}`,
    body: 'x',
    context: '',
    status,
    version: 1,
    created_at: iso(1),
    updated_at: iso(1),
    attachments: [],
  });
  function mount(
    who: Record<string, unknown>,
    data: { polls: unknown[]; submissions: unknown[] | 'error' | 'pending' },
  ) {
    localStorage.clear();
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/api/v1/me')) return Response.json({ user: who, csrf_token: 'csrf' });
      if (url.endsWith('/api/v1/categories')) return Response.json([...fixed, ...data.polls]);
      if (url.endsWith('/api/v1/submissions')) {
        if (data.submissions === 'pending') return new Promise<Response>(() => {});
        if (data.submissions === 'error')
          return Response.json({ error: { message: 'Beiträge fehlen.' } }, { status: 500 });
        return Response.json(data.submissions);
      }
      return Response.json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return urls;
  }

  it('shows ballots first and only never-submitted submission collections, while keeping finished ballots accessible', async () => {
    const urls = mount(user, {
      polls: [
        poll('p-open', 'Abimotto', { opened_at: iso(3) }),
        poll('p-newer', 'Lehrerzitat', { opened_at: iso(1) }),
        poll('p-voted', 'Mottowoche', { my_option_id: 'p-voted-a', my_option_ids: ['p-voted-a'] }),
        poll('p-closed', 'Altlast', { status: 'closed' }),
        poll('p-draft', 'Geheimer Entwurf', { status: 'draft', opened_at: null }),
      ],
      submissions: [
        submission('s1', 'memory', user.id),
        submission('s2', 'memory', user.id),
        submission('s3', 'memory', 'someone-else'),
      ],
    });
    const aside = await screen.findByRole('complementary');
    const open = await within(aside).findByRole('list', { name: 'Offen' });
    const links = within(open).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual([
      expect.stringContaining('Lehrerzitat'),
      expect.stringContaining('Abimotto'),
    ]);
    expect(links[0]).toHaveAttribute('href', '/sammlungen/p-newer');

    const submissions = within(aside).getByRole('group', { name: 'Beiträge' });
    expect(within(submissions).queryByRole('link', { name: /Erinnerungen/ })).toBeNull();
    const category = within(submissions).getByRole('link', { name: /Zitate/ });
    expect(category).toHaveAttribute('href', '/sammlungen/quotes');
    expect(within(submissions).queryByRole('link', { name: /Abimotto/ })).toBeNull();
    expect(category).toHaveTextContent('Noch nichts eingereicht');
    expect(within(aside).getByRole('link', { name: /Zitate/ })).toHaveTextContent('Noch nichts eingereicht');
    expect(open.compareDocumentPosition(category) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const voted = within(aside).getByRole('link', { name: /Mottowoche/ });
    const closed = within(aside).getByRole('link', { name: /Altlast/ });
    expect(voted.closest('details')).not.toBeNull();
    expect(closed.closest('details')).not.toBeNull();
    expect(open).not.toContainElement(voted);
    expect(
      within(aside)
        .getByRole('link', { name: /Abimotto/ })
        .closest('details'),
    ).toBeNull();
    expect(within(aside).queryByText('Geheimer Entwurf')).toBeNull();
    expect(within(aside).getByText(/Erledigt \(2\)/)).toBeInTheDocument();

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Hey Mia. 3 Sammlungen warten.');
    const main = screen.getByRole('main');
    const voting = within(main).getByRole('region', { name: 'Jetzt dran' });
    const submissionQueue = within(main).getByRole('region', { name: 'Fortlaufend' });
    expect(voting.compareDocumentPosition(submissionQueue) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(submissionQueue).getByRole('link', { name: /Zitate/ })).toHaveAttribute(
      'href',
      '/beitraege/neu?kategorie=quotes',
    );
    expect(within(submissionQueue).queryByRole('heading', { name: 'Erinnerungen' })).toBeNull();
    expect(within(voting).queryByRole('link', { name: /Beitragen/ })).toBeNull();
    fireEvent.click(within(voting).getByRole('button', { name: 'Nächste Sammlung' }));
    expect(within(voting).getByRole('heading', { name: 'Abimotto' })).toBeInTheDocument();
    expect(within(voting).getByRole('button', { name: 'Nächste Sammlung' })).toBeDisabled();

    expect(screen.queryByRole('button', { name: 'Schüler' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Redaktion' })).toBeNull();
    expect(urls.some((url) => url.includes('/results') || url.includes('/audit'))).toBe(false);
  });

  it.each(['pending', 'accepted', 'rejected', 'withdrawn'])(
    'hides a repeatable collection after any own submission (%s), but ignores other authors',
    async (status) => {
      mount(user, {
        polls: [],
        submissions: [submission('own', 'memory', user.id, status), submission('other', 'quotes', 'someone-else')],
      });
      await screen.findByRole('heading', { name: 'Zitate' });
      const main = screen.getByRole('main');
      expect(within(main).queryByRole('heading', { name: 'Erinnerungen' })).toBeNull();
      expect(within(main).getByRole('link', { name: /Beitragen/ })).toHaveAttribute(
        'href',
        '/beitraege/neu?kategorie=quotes',
      );
      expect(within(main).getByText('Beitrag own')).toBeInTheDocument();
      expect(within(screen.getByRole('complementary')).getByRole('link', { name: 'Alle Sammlungen' })).toHaveAttribute(
        'href',
        '/sammlungen',
      );
    },
  );

  it.each(['error', 'pending'] as const)(
    'does not offer repeatable cards when submission history is %s',
    async (state) => {
      mount(user, { polls: [], submissions: state });
      await screen.findByRole('heading', { name: 'Jetzt dran' });
      const main = screen.getByRole('main');
      expect(within(main).queryByRole('link', { name: /Beitragen/ })).toBeNull();
      if (state === 'error') await within(main).findAllByRole('alert');
      else expect(within(main).getAllByRole('status').length).toBeGreaterThan(0);
    },
  );

  it('queues ballots and a one-off photo in their kind-based workflows', async () => {
    mount(user, {
      polls: [
        sammlung('proposal-repeatable', 'Motto', 'proposal', {
          repeatable: true,
          options: [{ id: 'motto-choice', label: 'Gemeinsam' }],
        }),
        sammlung('person-repeatable', 'Personenwahl', 'person', {
          repeatable: true,
          options: [{ id: 'person-choice', label: 'Ada Beispiel', user_id: 'other-student' }],
        }),
        sammlung('photo-once', 'Ein Jahrgangsfoto', 'photo', {
          repeatable: false,
          ongoing: false,
          closes_at: '2027-01-01T00:00:00Z',
        }),
      ],
      submissions: [],
    });

    const ballots = await screen.findByRole('region', { name: 'Sammlungen, die auf dich warten' });
    expect(await within(ballots).findByRole('button', { name: 'Gemeinsam' })).toBeInTheDocument();
    fireEvent.click(within(ballots).getByRole('button', { name: 'Nächste Sammlung' }));
    expect(await within(ballots).findByRole('button', { name: 'Ada Beispiel' })).toBeInTheDocument();
    fireEvent.click(within(ballots).getByRole('button', { name: 'Nächste Sammlung' }));
    const photoLink = await within(ballots).findByRole('link', { name: /Beitragen/ });
    expect(photoLink).toHaveAttribute('href', '/beitraege/neu?kategorie=photo-once');
    expect(within(ballots).queryByRole('button', { name: /Stimme speichern/ })).toBeNull();
    expect(within(ballots).queryByRole('button', { name: /Personen auswählen/ })).toBeNull();
  });

  it('treats multi-selection ballots as submitted even without the legacy single-option field', async () => {
    mount(user, {
      polls: [poll('multi', 'Mehrfachwahl', { my_option_ids: ['multi-a'], my_option_id: null })],
      submissions: [],
    });
    const aside = await screen.findByRole('complementary');
    const voted = await within(aside).findByRole('link', { name: /Mehrfachwahl/ });
    expect(voted.closest('details')).not.toBeNull();
    const main = screen.getByRole('main');
    expect(within(main).queryByRole('heading', { name: 'Mehrfachwahl' })).toBeNull();
  });

  it('keeps a voted open repeatable ballot available for another submission', async () => {
    mount(user, {
      polls: [
        poll('repeatable-vote', 'Motto erneut wählen', {
          repeatable: true,
          my_option_id: 'repeatable-vote-a',
          my_option_ids: ['repeatable-vote-a'],
        }),
      ],
      submissions: [],
    });

    const aside = await screen.findByRole('complementary');
    expect(await within(aside).findByRole('link', { name: /Motto erneut wählen/ })).toBeInTheDocument();
    expect(within(aside).getByText('Erledigt (0)')).toBeInTheDocument();
    const ballots = await screen.findByRole('region', { name: 'Sammlungen, die auf dich warten' });
    expect(await within(ballots).findByRole('button', { name: 'Erneut abstimmen' })).toBeEnabled();
  });

  it.each([
    ['manager', 'Sam Redaktion'],
    ['admin', 'Alex Admin'],
  ])('lets a %s switch between the editorial and the student home', async (role, name) => {
    const who = { id: `${role}-1`, name, role, admitted: true, cohort_member: false, category_ids: ['memory'] };
    mount(who, {
      polls: [
        poll('p-open', 'Abimotto', { ballot_count: 34 }),
        poll('p-draft', 'Entwurf', { status: 'draft', opened_at: null, ballot_count: 0 }),
      ],
      submissions: [
        submission('s1', 'memory', 'a'),
        submission('s2', 'memory', 'b'),
        submission('s3', 'memory', 'c', 'accepted'),
        submission('s4', 'quotes', 'd'),
      ],
    });
    const aside = await screen.findByRole('complementary');
    const editorSwitch = await within(aside).findByRole('button', { name: 'Redaktion' });
    expect(editorSwitch).toHaveAttribute('aria-pressed', 'true');
    expect(within(aside).getByRole('button', { name: 'Schüler' })).toHaveAttribute('aria-pressed', 'false');
    expect(within(aside).queryByRole('button', { name: 'Verwaltung' }) !== null).toBe(role === 'admin');

    const main = screen.getByRole('main');
    expect(await within(main).findByRole('heading', { level: 1, name: 'Redaktion' })).toBeInTheDocument();
    if (role === 'admin') expect(within(main).getByRole('region', { name: 'Personen' })).toBeInTheDocument();
    else {
      expect(await within(main).findByRole('region', { name: 'Gesammelte Beiträge' })).toHaveTextContent('3');
      expect(within(main).queryByRole('link', { name: /Abimotto/ })).toBeNull();
      const tiles = within(within(main).getByRole('region', { name: 'Sammlungen' }));
      expect(tiles.getByRole('link', { name: /Erinnerungen/ })).toHaveTextContent(/3\s*Beiträge/);
      expect(tiles.getByRole('link', { name: /Zitate/ })).toHaveTextContent(/0\s*Beiträge/);
    }
    expect(within(aside).getByRole('link', { name: /Abimotto/ })).toHaveTextContent('34 Stimmen');
    expect(within(aside).getByRole('link', { name: /Erinnerungen/ })).toHaveTextContent('3 Beiträge');
    expect(
      within(within(aside).getByRole('group', { name: 'Beiträge' })).getByRole('link', { name: /Erinnerungen/ }),
    ).toHaveAttribute('href', '/sammlungen/memory');
    expect(within(aside).getByRole('link', { name: 'Neue Sammlung' })).toHaveAttribute('href', '/sammlungen?neu');

    fireEvent.click(within(aside).getByRole('button', { name: 'Schüler' }));
    expect(await screen.findByRole('heading', { level: 1, name: /^Hey / })).toHaveTextContent(
      `Hey ${name.split(' ')[0]}.`,
    );
    expect(within(aside).getByRole('button', { name: 'Schüler' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(aside).getByRole('list', { name: 'Offen' })).toBeInTheDocument();
    expect(within(aside).queryByRole('link', { name: 'Neue Sammlung' })).toBeNull();
    expect(within(aside).queryByRole('button', { name: 'Verwaltung' })).toBeNull();
  });
});

describe('admin home', () => {
  const dashboardPoll = (
    id: string,
    name: string,
    ballot_count: number,
    participation: { voted: number; eligible: number } | null,
    kind = 'proposal',
  ) =>
    sammlung(id, name, kind, {
      ballot_count: kind === 'memory' ? null : ballot_count,
      participation: kind === 'memory' ? null : participation,
      opened_at: '2026-10-01T00:00:00Z',
      options: [{ id: `${id}-a`, label: 'A' }],
    });
  function mountDashboard(categories: unknown[], users: unknown[] | 'error' | 'pending' = []) {
    localStorage.clear();
    const admin = { ...user, id: 'dashboard-admin', role: 'admin' };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/v1/me')) return Response.json({ user: admin, csrf_token: 'csrf' });
        if (url.endsWith('/api/v1/admin/users')) {
          if (users === 'pending') return new Promise<Response>(() => {});
          if (users === 'error') return Response.json({ error: { message: 'Nicht verfügbar.' } }, { status: 503 });
          return Response.json(users);
        }
        if (url.endsWith('/api/v1/categories')) return Response.json(categories);
        return Response.json([]);
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('uses the participation aggregate for ballots and leaves repeatable collections without a metric', async () => {
    mountDashboard(
      [
        dashboardPoll('zero', 'Keine Stimmen', 34, { voted: 0, eligible: 3 }),
        dashboardPoll('partial', 'Ein Drittel', 34, { voted: 1, eligible: 3 }),
        dashboardPoll('full', 'Alle Stimmen', 0, { voted: 3, eligible: 3 }),
        dashboardPoll('repeatable', 'Erinnerungen', 0, null, 'memory'),
      ],
      [],
    );

    const latest = await screen.findByRole('region', { name: 'Neueste Sammlungen' });
    await within(latest).findByRole('link', { name: /Keine Stimmen/ });
    const zero = within(latest).getByRole('progressbar', { name: 'Wahlbeteiligung: Keine Stimmen' });
    const partial = within(latest).getByRole('progressbar', { name: 'Wahlbeteiligung: Ein Drittel' });
    const full = within(latest).getByRole('progressbar', { name: 'Wahlbeteiligung: Alle Stimmen' });
    expect(zero).toHaveAttribute('aria-valuemin', '0');
    expect(zero).toHaveAttribute('aria-valuemax', '100');
    expect(zero).toHaveAttribute('aria-valuenow', '0');
    expect(zero).toHaveAttribute('aria-valuetext', '0 von 3 Personen abgestimmt (0 %)');
    expect(within(latest).getByText('0 von 3')).toBeInTheDocument();
    expect(within(latest).getAllByText('abgestimmt')).toHaveLength(3);
    expect(zero.firstElementChild).toHaveStyle({ width: '0%', backgroundColor: 'rgb(209, 213, 219)' });
    expect(partial).toHaveAttribute('aria-valuenow', String((1 / 3) * 100));
    expect(partial.firstElementChild).toHaveStyle({ width: `${(1 / 3) * 100}%` });
    expect(within(latest).getByText('33%')).toBeInTheDocument();
    expect(full).toHaveAttribute('aria-valuenow', '100');
    expect(full.firstElementChild).toHaveStyle({ width: '100%', backgroundColor: 'rgb(22, 101, 52)' });
    expect(within(latest).getByRole('link', { name: /Keine Stimmen/ })).toHaveAttribute('href', '/sammlungen/zero');
    expect(within(latest).getByRole('link', { name: /Keine Stimmen/ })).toHaveTextContent('Offen');
    const repeatable = within(latest).getByRole('link', { name: /Erinnerungen/ });
    expect(repeatable).toHaveAttribute('href', '/sammlungen/repeatable');
    expect(within(repeatable).queryByRole('progressbar')).toBeNull();
    expect(repeatable).not.toHaveTextContent('abgestimmt');
  });

  it('reports zero percent when there are no eligible people', async () => {
    mountDashboard([dashboardPoll('empty', 'Noch niemand', 0, { voted: 0, eligible: 0 })]);
    const bar = await screen.findByRole('progressbar', { name: 'Wahlbeteiligung: Noch niemand' });
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(bar).toHaveAttribute('aria-valuetext', '0 von 0 Personen abgestimmt (0 %)');
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('clamps participation to 100 percent when votes exceed eligible people', async () => {
    mountDashboard([dashboardPoll('over', 'Mehr Stimmen', 5, { voted: 5, eligible: 1 })]);
    const bar = await screen.findByRole('progressbar', { name: 'Wahlbeteiligung: Mehr Stimmen' });
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(bar.firstElementChild).toHaveStyle({ width: '100%', backgroundColor: 'rgb(22, 101, 52)' });
  });

  it.each(['pending', 'error'] as const)('shows the API participation aggregate while users are %s', async (state) => {
    mountDashboard([dashboardPoll('waiting', 'Noch ohne Daten', 8, { voted: 1, eligible: 2 })], state);
    const latest = await screen.findByRole('region', { name: 'Neueste Sammlungen' });
    const bar = await within(latest).findByRole('progressbar', { name: 'Wahlbeteiligung: Noch ohne Daten' });
    expect(bar).toHaveAttribute('aria-valuenow', String((1 / 2) * 100));
    expect(within(latest).getByText('50%')).toBeInTheDocument();
  });

  it('does not display a zero metric when the API has no participation aggregate', async () => {
    mountDashboard([dashboardPoll('unknown', 'Noch keine Auswertung', 7, null)]);
    const latest = await screen.findByRole('region', { name: 'Neueste Sammlungen' });
    expect(await within(latest).findByRole('link', { name: /Noch keine Auswertung/ })).toBeInTheDocument();
    expect(within(latest).queryByRole('progressbar')).toBeNull();
    expect(within(latest).queryByText(/\d+%/)).toBeNull();
  });

  it('shows counts, the three newest people awaiting admission, the latest Sammlungen and one widget per class', async () => {
    localStorage.clear();
    const admin = {
      id: 'admin-1',
      name: 'Test Admin',
      role: 'admin',
      admitted: true,
      cohort_member: false,
      category_ids: [],
    };
    const day = (n: number) => new Date(Date.UTC(2026, 9, n)).toISOString();
    // Signup days are shuffled against the name order; s6 is admitted and must not appear.
    const people = [
      admin,
      ...[
        [1, 3],
        [2, 7],
        [3, 1],
        [4, 5],
        [5, 2],
        [6, 9],
      ].map(([i, d]) => ({ ...user, id: `s${i}`, name: `Schüler ${i}`, admitted: i === 6, created_at: day(d) })),
    ];
    const ballot = (id: string, kind: string, status: string, n: number) =>
      sammlung(id, `Titel ${id}`, kind, {
        status,
        created_at: day(n),
        opened_at: day(n),
        ballot_count: 0,
        options: [{ id: `${id}-a`, label: 'A' }],
      });
    const all = [
      sammlung('memory', 'Erinnerungen', 'memory', { created_at: day(1) }),
      sammlung('quotes', 'Zitate', 'quote', { created_at: day(6) }),
      ballot('p1', 'proposal', 'open', 1),
      ballot('p2', 'proposal', 'closed', 2),
      ballot('p3', 'person', 'open', 3),
      ballot('p4', 'person', 'open', 4),
      ballot('p5', 'proposal', 'open', 5),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/api/v1/me')) return Response.json({ user: admin, csrf_token: 'csrf' });
        if (url.endsWith('/api/v1/admin/users')) return Response.json(people);
        if (url.endsWith('/api/v1/categories')) return Response.json(all);
        if (url.endsWith('/api/v1/submissions'))
          return Response.json([
            { category_id: 'memory' },
            { category_id: 'memory' },
            { category_id: 'memory' },
            { category_id: 'quotes' },
          ]);
        return Response.json([]);
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const people$ = await screen.findByRole('region', { name: 'Personen' });
    await waitFor(() => expect(within(people$).getByText('Angemeldet').previousElementSibling).toHaveTextContent('7'));
    expect(within(people$).getByText(/auf Freigabe/).previousElementSibling).toHaveTextContent('5');
    const waiting = within(within(people$).getByRole('list', { name: 'Warten auf Freigabe' })).getAllByRole('listitem');
    expect(waiting.map((li) => li.textContent)).toEqual([
      expect.stringContaining('Schüler 2'),
      expect.stringContaining('Schüler 4'),
      expect.stringContaining('Schüler 1'),
    ]);
    expect(within(people$).getByText('und 2 weitere')).toBeInTheDocument();
    expect(within(people$).getByRole('link', { name: /Zugänge verwalten/ })).toHaveAttribute(
      'href',
      '/verwaltung/personen',
    );

    const latest = screen.getByRole('region', { name: 'Neueste Sammlungen' });
    await waitFor(() => expect(within(latest).getAllByRole('listitem')).toHaveLength(4));
    const links = within(latest)
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href')?.startsWith('/sammlungen/'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/sammlungen/quotes',
      '/sammlungen/p5',
      '/sammlungen/p4',
      '/sammlungen/p3',
    ]);

    const widgets = screen.getByRole('region', { name: 'Sammlungen' });
    const tile = (name: string) => within(widgets).getByText(name).closest('a')!;
    await waitFor(() => expect(tile('Erinnerungen')).toHaveTextContent('1 Sammlung'));
    expect(within(widgets).getAllByRole('listitem')).toHaveLength(6);
    expect(tile('Erinnerungen')).toHaveTextContent('3 Beiträge');
    expect(tile('Erinnerungen')).toHaveAttribute('href', '/sammlungen?klasse=memory');
    expect(tile('Zitate')).toHaveTextContent('1 Sammlung');
    expect(tile('Zitate')).toHaveTextContent('1 Beitrag');
    expect(tile('Ideen')).toHaveTextContent('0 Sammlungen');
    expect(tile('Ideen')).toHaveTextContent('0 Beiträge');
    expect(tile('Fotos')).toHaveTextContent('0 Sammlungen');
    expect(tile('Vorschlagswahl')).toHaveTextContent('3 Sammlungen');
    expect(tile('Vorschlagswahl')).toHaveTextContent('2 offen 1 beendet');
    expect(tile('Vorschlagswahl')).not.toHaveTextContent('Beitr');
    expect(tile('Personenwahl')).toHaveTextContent('2 Sammlungen');
    expect(tile('Personenwahl')).toHaveTextContent('2 offen 0 beendet');
    expect(tile('Personenwahl')).toHaveAttribute('href', '/sammlungen?klasse=person');
  });
});

describe('editor home', () => {
  const polls = [
    sammlung('closed', 'Abgeschlossene Wahl', 'person', { status: 'closed' }),
    sammlung('draft', 'Geplante Wahl', 'proposal', { status: 'draft' }),
    sammlung('open', 'Laufende Wahl', 'proposal', { participation: { voted: 2, eligible: 4 } }),
    sammlung('open-2', 'Weitere Wahl', 'person'),
    sammlung('open-3', 'Dritte Wahl', 'proposal'),
  ];
  const categories = [
    category,
    ...polls,
    sammlung('other-poll', 'Fremde Wahl', 'proposal'),
    sammlung('other-memory', 'Fremde Erinnerungen', 'memory'),
  ];
  const contribution = (id: string, category_id: string, day: number) => ({
    id,
    category_id,
    author_id: 'other-author',
    author_name: 'Andere Person',
    title: `Geschichte ${id}`,
    body: '',
    context: '',
    status: 'pending',
    version: 1,
    attachments: [],
    created_at: new Date(Date.UTC(2026, 9, day)).toISOString(),
    updated_at: new Date(Date.UTC(2026, 9, day)).toISOString(),
  });
  const submissions = [
    contribution('old', 'memory', 1),
    contribution('new', 'memory', 4),
    contribution('middle', 'memory', 3),
    contribution('earlier', 'memory', 2),
    contribution('unassigned', 'other-memory', 5),
  ];
  function mountEditor(
    grants = ['memory', ...polls.map((p) => p.id)],
    state: { categories?: 'pending' | 'error'; submissions?: 'pending' | 'error'; view?: string } = {},
  ) {
    localStorage.clear();
    if (state.view) localStorage.setItem('view', state.view);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input).replace('/api/v1', '');
      if (path === '/me')
        return Response.json({ user: { ...user, role: 'manager', category_ids: grants }, csrf_token: 'csrf' });
      const endpoint = path === '/categories' ? 'categories' : path === '/submissions' ? 'submissions' : null;
      if (endpoint) {
        if (state[endpoint] === 'pending') return new Promise<Response>(() => {});
        if (state[endpoint] === 'error')
          return Response.json({ error: { message: 'Nicht verfügbar.' } }, { status: 503 });
        return Response.json(endpoint === 'categories' ? categories : submissions);
      }
      return Response.json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return fetchMock;
  }

  it('shows every writable poll across lifecycle states and counts only assigned collections', async () => {
    const fetchMock = mountEditor();
    const assigned = await screen.findByRole('region', { name: 'Deine Sammlungen' });
    await within(assigned).findByRole('link', { name: /Laufende Wahl/ });
    const links = within(assigned)
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href')?.startsWith('/sammlungen/'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/sammlungen/open',
      '/sammlungen/open-2',
      '/sammlungen/open-3',
      '/sammlungen/draft',
      '/sammlungen/closed',
    ]);
    expect(within(assigned).queryByText('Fremde Wahl')).toBeNull();
    expect(within(assigned).queryByText('Erinnerungen')).toBeNull();
    expect(within(assigned).getByRole('progressbar', { name: 'Wahlbeteiligung: Laufende Wahl' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    );
    const tiles = within(screen.getByRole('region', { name: 'Sammlungen' }));
    expect(tiles.getAllByRole('listitem')).toHaveLength(6);
    expect(tiles.getByRole('link', { name: /Erinnerungen/ })).toHaveTextContent('1 Sammlung');
    expect(tiles.getByRole('link', { name: /Erinnerungen/ })).toHaveTextContent('4 Beiträge');
    expect(tiles.getByRole('link', { name: /Vorschlagswahl/ })).toHaveTextContent('3 Sammlungen');
    const collected = screen.getByRole('region', { name: 'Gesammelte Beiträge' });
    await waitFor(() => expect(within(collected).getAllByRole('listitem')).toHaveLength(3));
    const stories = within(collected)
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href')?.startsWith('/redaktion/beitraege/'));
    expect(stories.map((a) => a.getAttribute('href'))).toEqual([
      '/redaktion/beitraege/new',
      '/redaktion/beitraege/middle',
      '/redaktion/beitraege/earlier',
    ]);
    expect(within(collected).queryByText('Geschichte unassigned')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Personen' })).toBeNull();
    expect(document.querySelector('a[href^="/verwaltung/"]')).toBeNull();
    expect(fetchMock.mock.calls.some(([path]) => String(path).includes('/admin/'))).toBe(false);
  });

  it('shows assignment empty states while keeping all readable collections accessible', async () => {
    mountEditor([]);
    const assigned = await screen.findByRole('region', { name: 'Deine Sammlungen' });
    await waitFor(() => expect(within(assigned).queryByRole('list')).toBeNull());
    expect(await within(assigned).findByRole('link', { name: /Neue Sammlung/ })).toHaveAttribute(
      'href',
      '/sammlungen?neu',
    );
    expect(within(assigned).queryByRole('progressbar')).toBeNull();
    const collected = screen.getByRole('region', { name: 'Gesammelte Beiträge' });
    expect(within(collected).queryByRole('list')).toBeNull();
    const tiles = screen.getByRole('region', { name: 'Sammlungen' });
    for (const tile of within(tiles).getAllByRole('listitem')) expect(tile).toHaveTextContent('0 Sammlungen');
    expect(within(screen.getByRole('complementary')).getByRole('link', { name: 'Alle Sammlungen' })).toHaveAttribute(
      'href',
      '/sammlungen',
    );
  });

  it.each(['categories', 'submissions'] as const)(
    'keeps %s failures visible instead of showing a collected total of zero',
    async (endpoint) => {
      mountEditor(undefined, { [endpoint]: 'error' });
      const collected = await screen.findByRole('region', { name: 'Gesammelte Beiträge' });
      expect(await within(collected).findByRole('alert')).toHaveTextContent('Nicht verfügbar.');
      expect(within(collected).queryByText('0')).toBeNull();
    },
  );

  it.each(['categories', 'submissions'] as const)(
    'waits for %s before showing collected contribution totals',
    async (endpoint) => {
      mountEditor(undefined, { [endpoint]: 'pending' });
      const collected = await screen.findByRole('region', { name: 'Gesammelte Beiträge' });
      expect(within(collected).queryByRole('list')).toBeNull();
      expect(within(collected).queryByText('0')).toBeNull();
    },
  );

  it('keeps the personal student dashboard when a manager selects Schüler mode', async () => {
    const fetchMock = mountEditor(undefined, { view: 'schueler' });
    await screen.findByRole('heading', { level: 1, name: /Hey Mia/ });
    expect(screen.queryByRole('region', { name: 'Deine Sammlungen' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Jetzt dran' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([path]) => String(path).includes('/admin/'))).toBe(false);
    localStorage.clear();
  });
});

describe('sammlungen', () => {
  const admin = {
    id: 'admin-1',
    name: 'Test Admin',
    role: 'admin',
    admitted: true,
    cohort_member: true,
    category_ids: [],
  };
  const manager = {
    id: 'mgr-1',
    name: 'Sam Redaktion',
    role: 'manager',
    admitted: true,
    cohort_member: true,
    category_ids: [],
  };
  const motto = sammlung('motto', 'Abimotto', 'proposal', {
    status: 'open',
    ongoing: false,
    options: [
      { id: 'o1', label: 'Eins' },
      { id: 'o2', label: 'Zwei' },
    ],
    opened_at: '2026-10-02T00:00:00Z',
  });
  const old = sammlung('alt', 'Altlast', 'person', {
    status: 'closed',
    ongoing: false,
    options: [
      { id: 'x', label: 'X' },
      { id: 'y', label: 'Y' },
    ],
  });
  const draft = sammlung('entwurf', 'Geheimer Entwurf', 'proposal', {
    status: 'draft',
    ongoing: false,
    options: [
      { id: 'd1', label: 'D1' },
      { id: 'd2', label: 'D2' },
    ],
  });
  const quotes = sammlung('quotes', 'Zitate', 'quote', { description: 'Sprüche' });
  const all = [category, quotes, motto, old, draft];
  type Call = { url: string; method: string; body: Record<string, unknown> | undefined };
  function mount(path: string, me: Record<string, unknown> = user, list: unknown[] = all, initialView?: string) {
    localStorage.clear();
    if (initialView) localStorage.setItem('view', initialView);
    const calls: Call[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input).replace('/api/v1', '');
        const method = init?.method ?? 'GET';
        if (url === '/me') return Response.json({ user: me, csrf_token: 'csrf' });
        if (method !== 'GET') {
          const c = { url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined };
          calls.push(c);
          return Response.json({ ...(c.body ?? {}), id: 'new-cat', version: 2, option_id: c.body?.option_id });
        }
        if (url === '/categories')
          return Response.json(
            list.filter((c) => me.role !== 'student' || (c as { status: string }).status !== 'draft'),
          );
        if (url === '/roster')
          return Response.json([
            { id: 'u1', name: 'Anna' },
            { id: 'u2', name: 'Ben' },
          ]);
        if (url.startsWith('/submissions'))
          return Response.json([
            {
              id: 's1',
              category_id: 'memory',
              author_id: me.id,
              author_name: 'Wer',
              title: 'Mein Beitrag',
              body: '',
              context: '',
              status: 'pending',
              version: 1,
              created_at: '2026-10-01T00:00:00Z',
              updated_at: '2026-10-01T00:00:00Z',
              attachments: [],
            },
          ]);
        return Response.json([]);
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return calls;
  }

  it('lists repeatable Sammlungen in their own section and single-answer ones grouped by status', async () => {
    mount('/sammlungen');
    await screen.findByRole('heading', { level: 1, name: 'Sammlungen' });
    const main = screen.getByRole('main');
    expect(await within(main).findByRole('heading', { level: 1, name: 'Sammlungen' })).toBeInTheDocument();
    const section = (name: string) => within(main).getByRole('region', { name });
    const fortlaufend = await waitFor(() => section('Fortlaufend'));
    expect(within(fortlaufend).getByRole('link', { name: /Erinnerungen/ })).toHaveAttribute(
      'href',
      '/sammlungen/memory',
    );
    expect(within(fortlaufend).getByRole('link', { name: /Zitate/ })).toHaveTextContent('Beitragen');
    expect(within(fortlaufend).queryByText('Abimotto')).toBeNull();
    expect(within(section('Offen')).getByRole('link', { name: /Abimotto/ })).toHaveTextContent('Abstimmen');
    expect(within(section('Beendet')).getByRole('link', { name: /Altlast/ })).toHaveTextContent('Ansehen');
    expect(within(main).queryByRole('region', { name: 'Verborgen' })).toBeNull();
    expect(within(main).queryByText('Geheimer Entwurf')).toBeNull();
    expect(within(main).queryByRole('button', { name: /Neue Sammlung/ })).toBeNull();
  });

  it('shows drafts and the create button to managers', async () => {
    mount('/sammlungen', manager);
    await screen.findByRole('heading', { level: 1, name: 'Sammlungen' });
    const main = screen.getByRole('main');
    expect(await within(main).findByRole('region', { name: 'Verborgen' })).toHaveTextContent('Geheimer Entwurf');
    expect(within(main).getByRole('button', { name: /Neue Sammlung/ })).toBeInTheDocument();
  });

  it('filters the list by class with ?klasse=', async () => {
    mount('/sammlungen?klasse=quote');
    await screen.findByRole('heading', { level: 1, name: 'Sammlungen' });
    const main = screen.getByRole('main');
    expect(await within(main).findByRole('link', { name: /Zitate/ })).toBeInTheDocument();
    expect(within(main).queryByText('Abimotto')).toBeNull();
    expect(within(main).queryByRole('region', { name: 'Offen' })).toBeNull();
    expect(within(main).getByRole('link', { name: 'Zitate' })).toHaveAttribute('aria-current', 'true');
  });

  it.each(['/abstimmungen', '/abstimmungen?klasse=person'])(
    'redirects the old list route %s to /sammlungen',
    async (path) => {
      mount(path);
      await screen.findByRole('heading', { level: 1, name: 'Sammlungen' });
      const main = screen.getByRole('main');
      expect(await within(main).findByRole('heading', { level: 1, name: 'Sammlungen' })).toBeInTheDocument();
      expect(
        await within(main).findByRole('region', { name: path.includes('klasse') ? 'Beendet' : 'Offen' }),
      ).toBeInTheDocument();
    },
  );

  it('redirects the old detail route /abstimmungen/:id to /sammlungen/:id', async () => {
    mount('/abstimmungen/motto');
    expect(await screen.findByRole('heading', { level: 1, name: 'Abstimmen' })).toBeInTheDocument();
    expect(within(screen.getByRole('article')).getByText('Vorschlagswahl')).toBeInTheDocument();
  });

  it('renders the submission flow for a repeatable Sammlung', async () => {
    mount('/sammlungen/memory');
    expect(await screen.findByRole('heading', { level: 1, name: 'Erinnerungen' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Beitrag einreichen/ })).toHaveAttribute(
      'href',
      '/beitraege/neu?kategorie=memory',
    );
    expect(await screen.findByRole('link', { name: /Mein Beitrag/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Stimme/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Beiträge prüfen' })).toBeNull();
  });

  it('opens a read-only collection list for editors with all-status export', async () => {
    mount('/sammlungen/memory', manager);
    expect(await screen.findByRole('heading', { name: 'Gesammelte Beiträge' })).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(await within(main).findByRole('link', { name: /Mein Beitrag/ })).toHaveAttribute(
      'href',
      '/redaktion/beitraege/s1',
    );
    expect(within(main).getByRole('link', { name: /Alle Beiträge als ZIP/ })).toHaveAttribute(
      'href',
      '/api/v1/categories/memory/export?status=all',
    );
    expect(within(main).queryByRole('link', { name: /Beitrag einreichen/ })).toBeNull();
    expect(within(main).queryByRole('button', { name: 'Sammlung bearbeiten' })).toBeNull();
  });

  it('keeps Redaktion active when following a collection from a direct editorial link', async () => {
    mount('/redaktion', manager, all, 'schueler');
    await screen.findByRole('heading', { level: 1, name: 'Beiträge' });
    const aside = screen.getByRole('complementary', { name: 'Seitenleiste' });
    fireEvent.click(within(aside).getByRole('link', { name: /Erinnerungen/ }));
    expect(await screen.findByRole('heading', { name: 'Gesammelte Beiträge' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Beitrag einreichen/ })).toBeNull();
  });

  it('edits repeatable collection definitions in the shared collection view', async () => {
    const calls = mount('/sammlungen/memory', admin);
    fireEvent.click(await screen.findByRole('button', { name: 'Sammlung bearbeiten' }));
    expect(
      within(screen.getByLabelText('Klasse'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Ideen', 'Zitate', 'Erinnerungen', 'Fotos']);
    fireEvent.change(screen.getByLabelText('Klasse'), { target: { value: 'photo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      url: '/categories/memory',
      method: 'PATCH',
      body: { version: 1, kind: 'photo', options: [] },
    });
  });

  it('renders the ballot flow for a single-answer Sammlung and saves the vote', async () => {
    const calls = mount('/sammlungen/motto');
    expect(await screen.findByRole('heading', { level: 1, name: 'Abstimmen' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Zwei' }));
    fireEvent.click(screen.getByRole('button', { name: /Stimme speichern/ }));
    await waitFor(() =>
      expect(calls).toEqual([{ url: '/categories/motto/ballot', method: 'PUT', body: { option_ids: ['o2'] } }]),
    );
    expect(screen.queryByRole('button', { name: /Beiträge prüfen/ })).toBeNull();
  });

  it('opens a draft with the current version', async () => {
    const calls = mount('/sammlungen/entwurf', { ...manager, category_ids: ['entwurf'] });
    fireEvent.click(await screen.findByRole('button', { name: 'Sammlung öffnen' }));
    await waitFor(() =>
      expect(calls).toEqual([
        { url: '/categories/entwurf/status', method: 'POST', body: { version: 1, status: 'open' } },
      ]),
    );
  });

  it('offers managers all six classes and creates a choice poll', async () => {
    const calls = mount('/sammlungen?neu', manager);
    const klasse = await screen.findByLabelText('Klasse');
    expect(
      within(klasse)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Ideen', 'Zitate', 'Erinnerungen', 'Fotos', 'Personenwahl', 'Vorschlagswahl']);
    fireEvent.change(klasse, { target: { value: 'proposal' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Neues Motto' } });
    for (const option of ['A', 'B']) {
      fireEvent.change(screen.getByLabelText('Antwortoption hinzufügen'), { target: { value: option } });
      fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    }
    fireEvent.click(screen.getByLabelText(/eigene Person/));
    fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      url: '/categories',
      method: 'POST',
      body: {
        name: 'Neues Motto',
        description: '',
        kind: 'proposal',
        repeatable: false,
        ongoing: true,
        closes_at: null,
        all_people: false,
        max_choices: 1,
        allow_self_vote: true,
        options: [{ label: 'A' }, { label: 'B' }],
      },
    });
  });

  it.each(['idea', 'quote', 'memory', 'photo'])(
    'lets managers create a %s collection without admin controls',
    async (kind) => {
      const calls = mount('/sammlungen?neu', manager);
      fireEvent.change(await screen.findByLabelText('Klasse'), { target: { value: kind } });
      expect(screen.queryByText('Wer darf bearbeiten')).toBeNull();
      expect(screen.queryByLabelText('Antwortoption hinzufügen')).toBeNull();
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Neue Sammlung' } });
      fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));
      await waitFor(() => expect(calls).toHaveLength(1));
      expect(calls[0]).toMatchObject({
        url: '/categories',
        method: 'POST',
        body: { kind, repeatable: true, ongoing: true, closes_at: null, options: [] },
      });
      expect(vi.mocked(fetch).mock.calls.some(([path]) => String(path).includes('/admin/'))).toBe(false);
    },
  );

  it('lets assigned managers edit repeatable definitions in the shared view', async () => {
    const calls = mount('/sammlungen/memory', { ...manager, category_ids: ['memory'] });
    fireEvent.click(await screen.findByRole('button', { name: 'Sammlung bearbeiten' }));
    expect(screen.queryByText('Wer darf bearbeiten')).toBeNull();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unsere Erinnerungen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({
      url: '/categories/memory',
      method: 'PATCH',
      body: { version: 1, name: 'Unsere Erinnerungen' },
    });
  });

  it('keeps an unassigned manager collection view read-only', async () => {
    mount('/sammlungen/memory', { ...manager, category_ids: [] });
    await screen.findByRole('heading', { name: 'Gesammelte Beiträge' });
    expect(screen.queryByRole('button', { name: 'Sammlung bearbeiten' })).toBeNull();
    expect(screen.queryByText('Wer darf bearbeiten')).toBeNull();
  });

  it('offers admins all six classes and keeps option fields for ballot classes', async () => {
    mount('/sammlungen?neu', admin);
    const klasse = await screen.findByLabelText('Klasse');
    expect(
      within(klasse)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Ideen', 'Zitate', 'Erinnerungen', 'Fotos', 'Personenwahl', 'Vorschlagswahl']);
    expect(screen.queryByLabelText('Antwortoption hinzufügen')).toBeNull();
    fireEvent.change(klasse, { target: { value: 'proposal' } });
    expect(screen.getByLabelText('Antwortoption hinzufügen')).toBeInTheDocument();
    fireEvent.change(klasse, { target: { value: 'person' } });
    expect(screen.getByRole('switch', { name: /Alle freigegebenen Personen/ })).toBeChecked();
    fireEvent.click(screen.getByRole('switch', { name: /Alle freigegebenen Personen/ }));
    expect(await screen.findByRole('button', { name: 'Anna' })).toBeInTheDocument();
  });

  it('offers only submission Sammlungen on the editorial review page', async () => {
    mount('/redaktion', manager);
    const select = (await screen.findAllByLabelText('Sammlung'))[0];
    await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1));
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Alle Sammlungen', 'Erinnerungen', 'Zitate']);
  });
});
