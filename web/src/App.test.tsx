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

describe('admin access editing', () => {
  it('loads role and category grants for the newly selected person before saving', async () => {
    const admin = { id: 'admin-1', name: 'Test Admin', role: 'admin', admitted: true, cohort_member: false, category_ids: ['memory'] };
    const student = { id: 'student-2', name: 'Test Student', role: 'student', admitted: true, cohort_member: true, category_ids: [] };
    const categories = [category, { id: 'quotes', name: 'Zitate', description: '', kind: 'quote' }];
    let saved: { role: string; category_ids: string[] } | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/me')) return Response.json({ user: admin, csrf_token: 'csrf' });
      if (url.endsWith('/api/v1/admin/users') && !init?.method) return Response.json([admin, student]);
      if (url.endsWith('/api/v1/categories')) return Response.json(categories);
      if (url.endsWith('/api/v1/admin/status')) return Response.json({ backup_last_success: null, backup_stale: false, upload_bytes: 0 });
      if (url.endsWith('/api/v1/admin/users/student-2') && init?.method === 'PATCH') {
        saved = JSON.parse(String(init.body));
        return Response.json(student);
      }
      return Response.json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/admin']}><App/></MemoryRouter></QueryClientProvider>);

    await screen.findByRole('heading', { name: 'Unser Jahrgang & Team' });
    fireEvent.click(await screen.findByRole('button', { name: 'Test Admin bearbeiten' }));
    expect(screen.getByLabelText('Rolle')).toHaveValue('admin');
    fireEvent.click(screen.getByRole('button', { name: 'Test Student bearbeiten' }));

    expect(screen.getByLabelText('Rolle')).toHaveValue('student');
    expect(screen.getByLabelText('Erinnerungen')).not.toBeChecked();
    expect(screen.getByLabelText('Zitate')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Zugang speichern' }));

    await waitFor(() => expect(saved).toEqual(expect.objectContaining({ role: 'student', category_ids: [] })));
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
    expect(within(aside).queryByRole('link', { name: 'Verwaltung' }) !== null).toBe(role === 'admin');

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
    expect(within(aside).queryByRole('link', { name: 'Verwaltung' })).toBeNull();
  });
});

describe('admin home', () => {
  it('shows counts, the three newest people awaiting admission, the three latest polls and per-category tallies', async () => {
    localStorage.clear();
    const admin = { id: 'admin-1', name: 'Test Admin', role: 'admin', admitted: true, cohort_member: false, category_ids: [] };
    const day = (n: number) => new Date(Date.UTC(2026, 9, n)).toISOString();
    // Signup days are shuffled against the name order; s6 is admitted and must not appear.
    const people = [admin, ...[[1, 3], [2, 7], [3, 1], [4, 5], [5, 2], [6, 9]].map(([i, d]) => ({ ...user, id: `s${i}`, name: `Schüler ${i}`, admitted: i === 6, created_at: day(d) }))];
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
      if (url.endsWith('/api/v1/submissions')) return Response.json([{ category_id: 'memory' }, { category_id: 'memory' }, { category_id: 'memory' }, { category_id: 'quotes' }]);
      return Response.json([]);
    }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><MemoryRouter><App/></MemoryRouter></QueryClientProvider>);

    const people$ = await screen.findByRole('region', { name: 'Personen' });
    await waitFor(() => expect(within(people$).getByText('Angemeldet').previousElementSibling).toHaveTextContent('7'));
    expect(within(people$).getByText(/auf Freigabe/).previousElementSibling).toHaveTextContent('5');
    const waiting = within(within(people$).getByRole('list', { name: 'Warten auf Freigabe' })).getAllByRole('listitem');
    expect(waiting.map(li => li.textContent)).toEqual([expect.stringContaining('Schüler 2'), expect.stringContaining('Schüler 4'), expect.stringContaining('Schüler 1')]);
    expect(within(people$).getByText('und 2 weitere')).toBeInTheDocument();
    expect(within(people$).getByRole('link', { name: /Zugänge verwalten/ })).toHaveAttribute('href', '/admin');

    const pollCard = screen.getByRole('region', { name: 'Neueste Abstimmungen' });
    await waitFor(() => expect(within(pollCard).getByText('Erinnerungen')).toBeInTheDocument());
    const links = within(pollCard).getAllByRole('link').filter(a => a.getAttribute('href')?.startsWith('/abstimmungen/'));
    expect(links.map(a => a.getAttribute('href'))).toEqual(['/abstimmungen/p5', '/abstimmungen/p4', '/abstimmungen/p3']);
    const tile = (name: string) => within(pollCard).getByText(name).closest('a')!;
    await waitFor(() => expect(tile('Erinnerungen')).toHaveTextContent('3 Beiträge'));
    expect(tile('Erinnerungen')).toHaveTextContent('2 offen 1 beendet');
    expect(tile('Zitate')).toHaveTextContent('1 Beitrag');
    expect(tile('Zitate')).toHaveTextContent('2 offen 0 beendet');
  });
});
