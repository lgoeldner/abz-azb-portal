import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

const user = { id: 'student-1', name: 'Mia Beispiel', role: 'student', admitted: true, cohort_member: true, category_ids: [] };
const category = { id: 'memory', name: 'Erinnerungen', description: 'Was bleibt', kind: 'memory' };

it('starts provider login without fetching identities from the portal', async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL) => Response.json({ error: { code: 'unauthorized', message: 'Bitte anmelden.' } }, { status: 401 }));
  vi.stubGlobal('fetch', fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><App/></MemoryRouter></QueryClientProvider>);

  expect(await screen.findByRole('link', { name: /Mit Schulkonto anmelden/ })).toHaveAttribute('href', '/auth/login');
  expect(fetchMock.mock.calls.every(call => String(call[0]) === '/api/v1/me')).toBe(true);
});

describe('contribution submission', () => {
  it('keeps entered fields visible when the server rejects a stale submission', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/me')) return Response.json({ user, csrf_token: 'csrf' });
      if (url.endsWith('/api/v1/categories')) return Response.json([category]);
      if (url === '/api/v1/submissions') return Response.json({ error: { code: 'stale_version', message: 'Bitte erneut prüfen.' } }, { status: 409 });
      return Response.json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/beitraege/neu?kategorie=memory']}><App/></MemoryRouter></QueryClientProvider>);

    const title = await screen.findByPlaceholderText('Gib deiner Erinnerung einen Namen');
    fireEvent.change(title, { target: { value: 'Die letzte Freistunde' } });
    fireEvent.change(screen.getByPlaceholderText('Was ist passiert? Welcher Spruch darf nicht fehlen?'), { target: { value: 'Wir waren alle dabei.' } });
    fireEvent.click(screen.getByRole('button', { name: /Beitrag einreichen/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Eine neuere Version liegt vor.'));
    expect(title).toHaveValue('Die letzte Freistunde');
    expect(screen.getByDisplayValue('Wir waren alle dabei.')).toBeInTheDocument();
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
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/beitraege/neu?kategorie=memory']}><App/></MemoryRouter></QueryClientProvider>);

    const title = await screen.findByPlaceholderText('Gib deiner Erinnerung einen Namen');
    fireEvent.change(title, { target: { value: 'Die letzte Freistunde' } });
    fireEvent.change(screen.getByLabelText(/höchstens 10 Bilder/), {
      target: { files: [new File(['PDF test'], 'notizen.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Beitrag einreichen/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Bitte wähle nur JPEG-, PNG- oder WebP-Bilder aus.'));
    expect(fetchMock.mock.calls.some(([url, init]) => String(url) === '/api/v1/submissions' && init?.method === 'POST')).toBe(false);
    expect(title).toHaveValue('Die letzte Freistunde');
  });

  it('lets a student replace a rejected photo and retry without creating another contribution', async () => {
    const submission = {
      id: 'new-submission', category_id: 'memory', author_id: user.id, author_name: user.name,
      title: 'Das letzte Schulfest', body: 'Wir waren alle dabei.', context: '', status: 'pending', version: 1,
      created_at: '2026-10-23T12:00:00Z', updated_at: '2026-10-23T12:00:00Z', attachments: [],
    };
    let uploadCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/me')) return Response.json({ user, csrf_token: 'csrf' });
      if (url.endsWith('/api/v1/categories')) return Response.json([category]);
      if (url === '/api/v1/submissions' && init?.method === 'POST') return Response.json(submission, { status: 201 });
      if (url === '/api/v1/submissions/new-submission/attachments' && init?.method === 'POST') {
        uploadCount += 1;
        if (uploadCount === 1) return Response.json({ error: { code: 'invalid_image', message: 'Das Foto ist ungültig.' } }, { status: 400 });
        return Response.json({ ...submission, version: 2 });
      }
      if (url === '/api/v1/submissions/new-submission') return Response.json({ ...submission, version: 2 });
      if (url.endsWith('/revisions') || url.endsWith('/corrections')) return Response.json([]);
      return Response.json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/beitraege/neu?kategorie=memory']}><App/></MemoryRouter></QueryClientProvider>);

    const title = await screen.findByPlaceholderText('Gib deiner Erinnerung einen Namen');
    fireEvent.change(title, { target: { value: submission.title } });
    fireEvent.change(screen.getByPlaceholderText('Was ist passiert? Welcher Spruch darf nicht fehlen?'), { target: { value: submission.body } });
    const photoPicker = screen.getByLabelText(/höchstens 10 Bilder/);
    fireEvent.change(photoPicker, { target: { files: [new File(['bad'], 'bad.jpg', { type: 'image/jpeg' })] } });
    fireEvent.click(screen.getByRole('button', { name: /Beitrag einreichen/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Das Foto ist ungültig.'));
    expect(screen.getByRole('button', { name: 'Ohne weitere Fotos fortfahren' })).toBeInTheDocument();
    expect(photoPicker).toBeEnabled();
    fireEvent.change(photoPicker, { target: { files: [new File(['replacement'], 'replacement.jpg', { type: 'image/jpeg' })] } });
    fireEvent.click(screen.getByRole('button', { name: /Fotos erneut hochladen/ }));

    await screen.findByRole('heading', { name: submission.title });
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url) === '/api/v1/submissions' && init?.method === 'POST')).toHaveLength(1);
    expect(uploadCount).toBe(2);
  });
});


describe('verwaltung', () => {
  const admin = { id: 'admin-1', name: 'Test Admin', role: 'admin', admitted: true, cohort_member: true, category_ids: [] };
  const guest = { id: 'guest-1', name: 'Gast Gerda', role: 'student', admitted: true, cohort_member: false, category_ids: [] };
  const waiting = { id: 'wait-1', name: 'Warte Willi', role: 'student', admitted: false, cohort_member: true, category_ids: [] };
  const editor = { id: 'mgr-1', name: 'Sam Redaktion', role: 'manager', admitted: true, cohort_member: true, category_ids: ['memory'] };
  const everyone = [admin, guest, waiting, editor];
  type Call = { url: string; method: string; body: Record<string, unknown> | undefined };
  function mount(path: string, me: Record<string, unknown> = admin, onWrite: (c: Call) => Response | undefined = () => undefined, people: () => unknown[] = () => everyone, categories: unknown[] = [category]) {
    const calls: Call[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input).replace('/api/v1', ''); const method = init?.method ?? 'GET';
      if (url === '/me') return Response.json({ user: me, csrf_token: 'csrf' });
      if (method !== 'GET') { const c = { url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined }; calls.push(c); return onWrite(c) ?? Response.json({ id: 'new-cat' }); }
      if (url === '/admin/users') return Response.json(people());
      if (url === '/categories') return Response.json(categories);
      if (url === '/admin/status') return Response.json({ backup_last_success: null, backup_stale: false, upload_bytes: 0 });
      return Response.json([]);
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><App/></MemoryRouter></QueryClientProvider>);
    return calls;
  }
  const openMenu = async (name: string) => fireEvent.click(await screen.findByRole('button', { name: `Aktionen für ${name}` }));

  it('redirects /admin to the people page', async () => {
    mount('/admin');
    expect(await screen.findByRole('heading', { level: 1, name: 'Personen' })).toBeInTheDocument();
  });

  it.each(['personen', 'rubriken', 'protokoll'])('keeps non-admins away from /verwaltung/%s', async page => {
    mount(`/verwaltung/${page}`, editor);
    expect(await screen.findByRole('heading', { level: 1, name: 'Redaktion' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: /Personen|Rubriken|Aktivitätsprotokoll/ })).toBeNull();
  });

  it('shows the collapsible Verwaltung group only to admins and remembers it', async () => {
    localStorage.clear();
    mount('/');
    const toggle = await screen.findByRole('button', { name: 'Verwaltung' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const aside = screen.getByRole('complementary');
    expect(within(aside).getByRole('link', { name: 'Aktivitätsprotokoll' })).toHaveAttribute('href', '/verwaltung/protokoll');
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
    fireEvent.click(within(screen.getByRole('group', { name: 'Personen filtern' })).getByRole('button', { name: /^Redaktion/ }));
    expect(screen.getByText('Sam Redaktion')).toBeInTheDocument();
    expect(screen.queryByText('Warte Willi')).toBeNull();
  });

  it('promotes a guest by changing only cohort_member', async () => {
    const calls = mount('/verwaltung/personen');
    fireEvent.click(await screen.findByRole('button', { name: 'Zum Jahrgangsmitglied machen: Gast Gerda' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ url: '/admin/users/guest-1', method: 'PATCH', body: { name: 'Gast Gerda', role: 'student', admitted: true, cohort_member: true, category_ids: [] } });
  });

  it('keeps grants another admin added after the list loaded when changing a role', async () => {
    let server = everyone;
    const calls = mount('/verwaltung/personen', admin, undefined, () => server);
    await openMenu('Sam Redaktion');
    server = everyone.map(u => u.id === editor.id ? { ...editor, category_ids: ['memory', 'quotes'] } : u);
    fireEvent.click(screen.getByRole('menuitem', { name: /Rolle ändern/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Administration' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Bestätigen' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ name: 'Sam Redaktion', role: 'admin', admitted: true, cohort_member: true, category_ids: ['memory', 'quotes'] });
  });

  it('admits a waiting person with one click', async () => {
    const calls = mount('/verwaltung/personen');
    fireEvent.click(await screen.findByRole('button', { name: 'Zugang freigeben: Warte Willi' }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body).toEqual({ name: 'Warte Willi', role: 'student', admitted: true, cohort_member: true, category_ids: [] });
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
    expect(calls[0]).toEqual({ url: '/admin/users/guest-1', method: 'PATCH', body: { name: 'Gast Gerda', role: 'manager', admitted: true, cohort_member: false, category_ids: [] } });
  });

  it('deletes only after confirmation and shows the server error in the dialog', async () => {
    const calls = mount('/verwaltung/personen', admin, () => Response.json({ error: { code: 'has_content', message: 'Die Person hat bereits Beiträge.' } }, { status: 409 }));
    await openMenu('Gast Gerda');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Löschen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Gast Gerda löschen?' });
    expect(calls).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Löschen' }));
    await waitFor(() => expect(calls).toEqual([{ url: '/admin/users/guest-1', method: 'DELETE', body: undefined }]));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Die Person hat bereits Beiträge.');
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

  it('grants a new category to a manager with the full user payload', async () => {
    const calls = mount('/verwaltung/rubriken');
    fireEvent.click(await screen.findByRole('button', { name: /Neue Rubrik/ }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Neu' } });
    fireEvent.click(await screen.findByLabelText('Sam Redaktion'));
    fireEvent.click(screen.getByRole('button', { name: 'Rubrik speichern' }));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[0]).toMatchObject({ url: '/categories', method: 'POST' });
    expect(calls[1]).toEqual({ url: '/admin/users/mgr-1', method: 'PATCH', body: { name: 'Sam Redaktion', role: 'manager', admitted: true, cohort_member: true, category_ids: ['memory', 'new-cat'] } });
  });

  it('does not carry unsaved grant changes over to another Rubrik', async () => {
    const quotes = { id: 'quotes', name: 'Zitate', description: '', kind: 'quote' };
    const photos = { id: 'photos', name: 'Fotos', description: '', kind: 'photo' };
    const calls = mount('/verwaltung/rubriken', admin, undefined, undefined, [category, quotes, photos]);
    fireEvent.click(await screen.findByRole('button', { name: 'Rubrik bearbeiten: Zitate' }));
    fireEvent.click(await screen.findByLabelText('Sam Redaktion'));
    expect(screen.getByLabelText('Sam Redaktion')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Rubrik bearbeiten: Fotos' }));
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Fotos'));
    expect(screen.getByLabelText('Sam Redaktion')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Rubrik speichern' }));
    await waitFor(() => expect(calls.some(c => c.url === '/categories/photos')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Rubrik speichern' })).toBeNull());
    expect(calls.filter(c => c.url.startsWith('/admin/users'))).toEqual([]);
  });

  it('merges grants into the current server state and retries a failed save without a second Rubrik', async () => {
    let server = { ...editor, category_ids: ['memory'] };
    let failGrant = true;
    const calls = mount('/verwaltung/rubriken', admin, c => {
      if (c.url === '/admin/users/mgr-1') {
        if (failGrant) { failGrant = false; return Response.json({ error: { code: 'unavailable', message: 'Kurz nicht erreichbar.' } }, { status: 503 }); }
        server = { ...server, ...(c.body as object) };
      }
      return undefined;
    }, () => [admin, server]);
    fireEvent.click(await screen.findByRole('button', { name: /Neue Rubrik/ }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Neu' } });
    fireEvent.click(await screen.findByLabelText('Sam Redaktion'));
    // Another admin grants a further Rubrik while this form is open.
    server = { ...server, category_ids: ['memory', 'quotes'] };
    fireEvent.click(screen.getByRole('button', { name: 'Rubrik speichern' }));
    expect(await screen.findByText('Kurz nicht erreichbar.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Rubrik speichern' }));
    await waitFor(() => expect(server.category_ids).toEqual(['memory', 'quotes', 'new-cat']));
    expect(calls.filter(c => c.url === '/categories' && c.method === 'POST')).toHaveLength(1);
  });
});

describe('navigation by view', () => {
  const now = Date.now();
  const iso = (daysAgo: number) => new Date(now - daysAgo * 86_400_000).toISOString();
  const categories = [category, { id: 'quotes', name: 'Zitate', description: 'Sprüche', kind: 'quote' }];
  const poll = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
    id, category_id: 'memory', title, description: 'Beschreibung', kind: 'proposal', format: 'single_choice', status: 'open',
    allow_self_vote: false, options: [{ id: `${id}-a`, label: 'A' }, { id: `${id}-b`, label: 'B' }], my_option_id: null, version: 1,
    created_at: iso(10), opened_at: iso(3), ballot_count: null, ...extra,
  });
  const submission = (id: string, categoryId: string, authorId: string, status = 'pending') => ({
    id, category_id: categoryId, author_id: authorId, author_name: 'Wer', title: `Beitrag ${id}`, body: 'x', context: '', status, version: 1,
    created_at: iso(1), updated_at: iso(1), attachments: [],
  });
  function mount(who: Record<string, unknown>, data: { polls: unknown[]; submissions: unknown[] }) {
    localStorage.clear();
    const urls: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/api/v1/me')) return Response.json({ user: who, csrf_token: 'csrf' });
      if (url.endsWith('/api/v1/categories')) return Response.json(categories);
      if (url.endsWith('/api/v1/polls')) return Response.json(data.polls);
      if (url.endsWith('/api/v1/submissions')) return Response.json(data.submissions);
      return Response.json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><App/></MemoryRouter></QueryClientProvider>);
    return urls;
  }

  it('shows students open unvoted polls first, files finished ones under "Erledigt" and never offers the view switch', async () => {
    const urls = mount(user, {
      polls: [
        poll('p-open', 'Abimotto', { opened_at: iso(3) }),
        poll('p-newer', 'Lehrerzitat', { opened_at: iso(1) }),
        poll('p-voted', 'Mottowoche', { my_option_id: 'p-voted-a' }),
        poll('p-closed', 'Altlast', { status: 'closed' }),
        poll('p-draft', 'Geheimer Entwurf', { status: 'draft', opened_at: null }),
      ],
      submissions: [submission('s1', 'memory', user.id), submission('s2', 'memory', user.id), submission('s3', 'memory', 'someone-else')],
    });
    const aside = await screen.findByRole('complementary');
    const open = await within(aside).findByRole('list', { name: 'Offen' });
    const links = within(open).getAllByRole('link');
    expect(links.map(l => l.textContent)).toEqual([expect.stringContaining('Lehrerzitat'), expect.stringContaining('Abimotto')]);
    expect(links[0]).toHaveAttribute('href', '/abstimmungen/p-newer');

    const category = within(aside).getByRole('link', { name: /Erinnerungen/ });
    expect(category).toHaveAttribute('href', '/beitraege/neu?kategorie=memory');
    expect(category).toHaveTextContent('2 eingereicht');
    expect(within(aside).getByRole('link', { name: /Zitate/ })).toHaveTextContent('Noch nichts eingereicht');
    expect(open.compareDocumentPosition(category) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const voted = within(aside).getByRole('link', { name: /Mottowoche/ });
    const closed = within(aside).getByRole('link', { name: /Altlast/ });
    expect(voted.closest('details')).not.toBeNull();
    expect(closed.closest('details')).not.toBeNull();
    expect(open).not.toContainElement(voted);
    expect(within(aside).getByRole('link', { name: /Abimotto/ }).closest('details')).toBeNull();
    expect(within(aside).queryByText('Geheimer Entwurf')).toBeNull();
    expect(within(aside).getByText(/Erledigt \(2\)/)).toBeInTheDocument();

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Hey Mia. 2 Abstimmungen warten auf dich.');
    expect(screen.queryByRole('button', { name: 'Schüler' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Redaktion' })).toBeNull();
    expect(urls.some(url => url.includes('/results') || url.includes('/audit'))).toBe(false);
  });

  it.each([['manager', 'Sam Redaktion'], ['admin', 'Alex Admin']])('lets a %s switch between the editorial and the student home', async (role, name) => {
    const who = { id: `${role}-1`, name, role, admitted: true, cohort_member: false, category_ids: ['memory'] };
    mount(who, {
      polls: [poll('p-open', 'Abimotto', { ballot_count: 34 }), poll('p-draft', 'Entwurf', { status: 'draft', opened_at: null, ballot_count: 0 })],
      submissions: [submission('s1', 'memory', 'a'), submission('s2', 'memory', 'b'), submission('s3', 'memory', 'c', 'accepted'), submission('s4', 'quotes', 'd')],
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
      expect(await within(main).findByText('3 Beiträge warten auf Prüfung · 1 Abstimmung offen')).toBeInTheDocument();
      expect(within(main).getByRole('link', { name: /Abimotto/ })).toHaveTextContent(/34\s*Stimmen/);
      expect(within(main).getByRole('link', { name: /Erinnerungen/ })).toHaveTextContent(/3\s*Beiträge.*2 offen/);
      expect(within(main).getByRole('link', { name: /Zitate/ })).toHaveTextContent(/1\s*Beitrag1 offen/);
    }
    expect(within(aside).getByRole('link', { name: /Abimotto/ })).toHaveTextContent('34 Stimmen');
    expect(within(aside).getByRole('link', { name: /Erinnerungen/ })).toHaveTextContent('3 Beiträge, 2 offen');
    expect(within(aside).getByRole('link', { name: /Erinnerungen/ })).toHaveAttribute('href', '/redaktion?rubrik=memory');
    expect(within(aside).getByRole('link', { name: 'Neue Abstimmung' })).toHaveAttribute('href', '/abstimmungen?neu');

    fireEvent.click(within(aside).getByRole('button', { name: 'Schüler' }));
    expect(await screen.findByRole('heading', { level: 1, name: /^Hey / })).toHaveTextContent(`Hey ${name.split(' ')[0]}.`);
    expect(within(aside).getByRole('button', { name: 'Schüler' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(aside).getByRole('list', { name: 'Offen' })).toBeInTheDocument();
    expect(within(aside).queryByRole('link', { name: 'Neue Abstimmung' })).toBeNull();
    expect(within(aside).queryByRole('button', { name: 'Verwaltung' }) !== null).toBe(role === 'admin');
  });
});

describe('admin home', () => {
  it('shows user and waiting counts, only the three latest polls and open/closed counts per category', async () => {
    localStorage.clear();
    const admin = { id: 'admin-1', name: 'Test Admin', role: 'admin', admitted: true, cohort_member: false, category_ids: [] };
    const people = [admin, ...[1, 2, 3, 4].map(i => ({ ...user, id: `s${i}`, name: `Schüler ${i}`, admitted: i > 2 }))];
    const day = (n: number) => new Date(Date.UTC(2026, 9, n)).toISOString();
    const poll = (id: string, categoryId: string, status: string, n: number) => ({
      id, category_id: categoryId, title: `Titel ${id}`, description: '', kind: 'proposal', format: 'single_choice', status,
      allow_self_vote: false, options: [], my_option_id: null, version: 1, created_at: day(n), opened_at: day(n), ballot_count: 0,
    });
    const polls = [poll('p1', 'memory', 'open', 1), poll('p2', 'memory', 'closed', 2), poll('p3', 'quotes', 'open', 3), poll('p4', 'quotes', 'open', 4), poll('p5', 'memory', 'open', 5)];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/me')) return Response.json({ user: admin, csrf_token: 'csrf' });
      if (url.endsWith('/api/v1/admin/users')) return Response.json(people);
      if (url.endsWith('/api/v1/polls')) return Response.json(polls);
      if (url.endsWith('/api/v1/categories')) return Response.json([category, { id: 'quotes', name: 'Zitate', description: '', kind: 'quote' }]);
      return Response.json([]);
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><App/></MemoryRouter></QueryClientProvider>);

    const people$ = await screen.findByRole('region', { name: 'Personen' });
    await waitFor(() => expect(within(people$).getByText('Angemeldet').previousElementSibling).toHaveTextContent('5'));
    expect(within(people$).getByText(/auf Freigabe/).previousElementSibling).toHaveTextContent('2');
    expect(within(people$).getByRole('link', { name: /Zugänge verwalten/ })).toHaveAttribute('href', '/verwaltung/personen');

    const pollCard = screen.getByRole('region', { name: 'Neueste Abstimmungen' });
    await waitFor(() => expect(within(pollCard).getByText('Erinnerungen')).toBeInTheDocument());
    const links = within(pollCard).getAllByRole('link').filter(a => a.getAttribute('href')?.startsWith('/abstimmungen/'));
    expect(links.map(a => a.getAttribute('href'))).toEqual(['/abstimmungen/p5', '/abstimmungen/p4', '/abstimmungen/p3']);
    expect(within(pollCard).getByText('Erinnerungen').parentElement).toHaveTextContent('2 offen, 1 beendet');
    expect(within(pollCard).getByText('Zitate').parentElement).toHaveTextContent('2 offen, 0 beendet');
  });
});
