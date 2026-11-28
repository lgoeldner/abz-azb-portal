import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { kindLabel } from './ui';

const user = {
  id: 'student-1',
  name: 'Mia Beispiel',
  role: 'student',
  admitted: true,
  cohort_member: true,
  category_ids: [],
};
const repeatable = ['idea', 'quote', 'memory', 'photo'];
const klassen = (group: HTMLElement) =>
  within(group)
    .getAllByRole('radio')
    .map((radio) => radio.closest('label')!.textContent);
// A complete Abstimmung as the API returns it; extra properties can override defaults independently by kind.
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
// Stands in for the browser back button.
function Back() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      Zurück (Test)
    </button>
  );
}

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

  expect(await screen.findByRole('link', { name: /^Anmelden$/ })).toHaveAttribute('href', '/auth/login');
  expect(fetchMock.mock.calls.every((call) => String(call[0]) === '/api/v1/me')).toBe(true);
});

describe('contribution submission', () => {
  it('keeps entered fields visible when the server rejects a stale submission', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/me')) return Response.json({ user, consent_required: false, csrf_token: 'csrf' });
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
      if (url.endsWith('/api/v1/me')) return Response.json({ user, consent_required: false, csrf_token: 'csrf' });
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
      await screen.findByText('Neue Beiträge können nur in offenen Abstimmungen eingereicht werden.'),
    ).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Gib deinem Beitrag einen Namen')).toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('rejects an unsupported photo before creating a contribution', async () => {
    const photos = sammlung('photos', 'Fotos', 'photo');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/me')) return Response.json({ user, consent_required: false, csrf_token: 'csrf' });
      if (url.endsWith('/api/v1/categories')) return Response.json([photos]);
      return Response.json([]);
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/beitraege/neu?kategorie=photos']}>
          <App />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.change(await screen.findByLabelText(/Mindestens ein Foto/), {
      target: { files: [new File(['PDF test'], 'notizen.pdf', { type: 'application/pdf' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Fotos einreichen/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Bitte wähle nur JPEG-, PNG- oder WebP-Bilder aus.'),
    );
    expect(
      fetchMock.mock.calls.some(([url, init]) => String(url) === '/api/v1/submissions' && init?.method === 'POST'),
    ).toBe(false);
  });

  it('lets a student replace a rejected first photo without creating a duplicate contribution', async () => {
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
    let successfulCreations = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/me')) return Response.json({ user, consent_required: false, csrf_token: 'csrf' });
      if (url.endsWith('/api/v1/categories')) return Response.json([photoCategory]);
      if (url === '/api/v1/submissions' && init?.method === 'POST') {
        const form = init.body as FormData;
        if (!created) {
          created = true;
          return Response.json(
            { error: { code: 'invalid_image', message: 'Das Foto ist ungültig.' } },
            { status: 400 },
          );
        }
        successfulCreations += 1;
        return Response.json(
          {
            ...submission,
            title: (form.get('file') as File).name,
            attachments: [
              {
                id: 'photo-1',
                filename: (form.get('file') as File).name,
                caption: '',
                mime_type: 'image/jpeg',
                size_bytes: 10,
                url: '/api/v1/attachments/photo-1',
                preview_url: '/api/v1/attachments/photo-1/preview',
              },
            ],
          },
          { status: 201 },
        );
      }
      if (url === '/api/v1/submissions') return Response.json(created ? [{ ...submission, attachments: [] }] : []);
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

    const photoPicker = await screen.findByLabelText(/Mindestens ein Foto/);
    fireEvent.change(photoPicker, { target: { files: [new File(['bad'], 'bad.jpg', { type: 'image/jpeg' })] } });
    fireEvent.click(screen.getByRole('button', { name: /Fotos einreichen/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Das Foto ist ungültig.'));
    expect(photoPicker).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Entfernen' }));
    fireEvent.change(photoPicker, {
      target: { files: [new File(['replacement'], 'replacement.jpg', { type: 'image/jpeg' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Fotos einreichen/ }));

    await waitFor(() => expect(successfulCreations).toBe(1));
    const createCalls = fetchMock.mock.calls.filter(
      ([url, init]) => String(url) === '/api/v1/submissions' && init?.method === 'POST',
    );
    expect(createCalls).toHaveLength(2);
    expect((createCalls[0][1]?.body as FormData).get('idempotency_key')).toBe(
      (createCalls[1][1]?.body as FormData).get('idempotency_key'),
    );
    expect(
      fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/attachments') && init?.method === 'POST'),
    ).toHaveLength(0);
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
        if (url === '/me') return Response.json({ user: me, consent_required: false, csrf_token: 'csrf' });
        if (method !== 'GET') {
          const c = { url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined };
          calls.push(c);
          return onWrite(c) ?? Response.json({ id: 'new-cat' });
        }
        if (url === '/admin/users') return Response.json(people());
        if (url === '/admin/email/status') return Response.json({ usage: { used: 0 }, policy: { daily_limit: 300 } });
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

  it.each([
    ['admin', admin, true],
    ['manager', editor, false],
  ])('the Redaktion menu links the editorial pages; Verwaltung only for admins (%s)', async (_role, me, verwaltung) => {
    localStorage.clear();
    mount('/redaktion', me);
    fireEvent.click(await screen.findByRole('button', { name: 'Redaktionsmenü' }));
    const menu = await screen.findByRole('navigation', { name: 'Redaktionsmenü' });
    const hrefs = within(menu)
      .getAllByRole('link')
      .map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining(['/', '/sammlungen?neu', '/sammlungen', '/redaktion/beitraege']));
    expect(within(menu).queryByRole('group', { name: 'Verwaltung' }) !== null).toBe(verwaltung);
    expect(hrefs.includes('/verwaltung/personen')).toBe(verwaltung);
    fireEvent.click(within(menu).getByRole('link', { name: /Alle Beiträge/ }));
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Redaktionsmenü' })).toBeNull());
  });

  it('offers the Redaktion menu to editors in the Schüler view too, but never to students', async () => {
    mount('/', guest);
    await screen.findByRole('region', { name: 'Konto' });
    expect(screen.queryByRole('button', { name: 'Redaktionsmenü' })).toBeNull();
    cleanup();
    localStorage.setItem('view', 'schueler');
    mount('/', editor);
    fireEvent.click(await screen.findByRole('button', { name: 'Redaktionsmenü' }));
    const menu = await screen.findByRole('navigation', { name: 'Redaktionsmenü' });
    fireEvent.click(within(menu).getByRole('link', { name: /abgestimmt/ }));
    // The Schüler view would redirect /sammlungen to /, so the menu must switch to Redaktion first.
    expect(await screen.findByRole('heading', { level: 1, name: 'Abstimmungen' })).toBeInTheDocument();
    expect(document.querySelector('[data-workspace="redaktion"]')).toBeInTheDocument();
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

  it('grants a new category to a manager with the full user payload', async () => {
    const calls = mount('/sammlungen');
    fireEvent.click(await screen.findByRole('button', { name: /Neue Abstimmung/ }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Neu' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Sam Redaktion' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abstimmung speichern' }));
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

  it('does not carry unsaved grant changes over to another Abstimmung', async () => {
    const quotes = sammlung('quotes', 'Zitate', 'quote');
    const photos = sammlung('photos', 'Fotos', 'photo');
    const calls = mount('/sammlungen/quotes', admin, undefined, undefined, [category, quotes, photos]);
    fireEvent.click(await screen.findByRole('button', { name: 'Abstimmung bearbeiten' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Sam Redaktion' }));
    expect(screen.getByRole('checkbox', { name: 'Sam Redaktion' })).toBeChecked();
    fireEvent.click(screen.getByRole('link', { name: '← Abstimmungen' }));
    const photoLinks = await within(screen.getByRole('main')).findAllByRole('link', { name: /Fotos/ });
    fireEvent.click(photoLinks.find((a) => a.getAttribute('href') === '/sammlungen/photos')!);
    fireEvent.click(await screen.findByRole('button', { name: 'Abstimmung bearbeiten' }));
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Fotos'));
    expect(screen.getByRole('checkbox', { name: 'Sam Redaktion' })).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Abstimmung speichern' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/categories/photos')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Abstimmung speichern' })).toBeNull());
    expect(calls.filter((c) => c.url.startsWith('/admin/users'))).toEqual([]);
  });

  it('merges grants into the current server state and retries a failed save without a second Abstimmung', async () => {
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
    fireEvent.click(await screen.findByRole('button', { name: /Neue Abstimmung/ }));
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Neu' } });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Sam Redaktion' }));
    // Another admin grants a further Abstimmung while this form is open.
    server = { ...server, category_ids: ['memory', 'quotes'] };
    fireEvent.click(screen.getByRole('button', { name: 'Abstimmung speichern' }));
    expect(await screen.findByText('Kurz nicht erreichbar.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abstimmung speichern' }));
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
      fireEvent.click(await screen.findByRole('checkbox', { name: 'Sam Redaktion' }));
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
      if (url.endsWith('/api/v1/me')) return Response.json({ user: who, consent_required: false, csrf_token: 'csrf' });
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
          <Back />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return urls;
  }

  it('removes a one-off contribution task from home after the student submits', async () => {
    const oneOffPhoto = sammlung('photo-once', 'Einmalfoto', 'photo', { repeatable: false });
    mount(user, {
      polls: [oneOffPhoto],
      submissions: [submission('photo-own', 'photo-once', user.id)],
    });

    await screen.findByRole('heading', { name: 'Jetzt dran' });
    const main = within(screen.getByRole('main'));
    expect(await main.findByRole('region', { name: 'Wiederholbar' })).toBeInTheDocument();
    const todo = main.getByRole('region', { name: 'Jetzt dran' });
    expect(within(todo).queryByText('Einmalfoto')).toBeNull();
  });

  it('treats multi-selection and saved-word ballots as submitted without a legacy single-option field', async () => {
    mount(user, {
      polls: [
        poll('multi', 'Mehrfachwahl', { my_option_ids: ['multi-a'], my_option_id: null }),
        poll('words', 'Wortwolke', { kind: 'words', options: [], my_option_ids: [], my_words: ['feier'] }),
      ],
      submissions: [],
    });
    await screen.findByRole('heading', { level: 1, name: /Gerade ist alles erledigt|warten|wartet/ });
    const main = screen.getByRole('main');
    expect(within(main).queryByRole('heading', { name: 'Mehrfachwahl' })).toBeNull();
    expect(within(main).queryByRole('heading', { name: 'Wortwolke' })).toBeNull();
  });

  it('restores the view of a shared page on back navigation', async () => {
    const who = { id: 'manager-1', name: 'Sam Redaktion', role: 'manager', admitted: true, cohort_member: false };
    mount({ ...who, category_ids: ['memory'] }, { polls: [], submissions: [] });
    const assigned = await screen.findByRole('region', { name: 'Meine Abstimmungen' });
    fireEvent.click(within(assigned).getByRole('link', { name: 'Alle' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Abstimmungen' })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('region', { name: 'Konto' })).getByRole('button', { name: 'Schüler' }));
    expect(await screen.findByRole('heading', { level: 1, name: /^Hey / })).toBeInTheDocument();
    // /sammlungen redirects the Schüler view home, so this only holds if back restores the Redaktion view.
    fireEvent.click(screen.getByRole('button', { name: 'Zurück (Test)' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Abstimmungen' })).toBeInTheDocument();
    expect(document.querySelector('[data-workspace="redaktion"]')).toBeInTheDocument();
  });
});

describe('sammlungen', () => {
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
        if (url === '/me') return Response.json({ user: me, consent_required: false, csrf_token: 'csrf' });
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

  it('renders the ballot flow for a single-answer Abstimmung and saves the vote', async () => {
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
    fireEvent.click(await screen.findByRole('button', { name: 'Abstimmung öffnen' }));
    await waitFor(() =>
      expect(calls).toEqual([
        { url: '/categories/entwurf/status', method: 'POST', body: { version: 1, status: 'open' } },
      ]),
    );
  });

  it('offers all eight classes to managers and creates a choice poll', async () => {
    const calls = mount('/sammlungen?neu', manager);
    const klasse = await screen.findByRole('group', { name: 'Klasse' });
    expect(klassen(klasse)).toEqual([
      'Ideen',
      'Zitate',
      'Erinnerungen',
      'Fotos',
      'Steckbrief',
      'Personenwahl',
      'Auswahl',
      'Wortwolke',
    ]);
    fireEvent.click(screen.getByRole('radio', { name: kindLabel['proposal'] }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Neues Motto' } });
    for (const option of ['A', 'B']) {
      fireEvent.change(screen.getByLabelText('Antwortoption hinzufügen'), { target: { value: option } });
      fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
    }
    expect(screen.queryByLabelText(/eigene Person/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Abstimmung speichern' }));
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
        allow_self_vote: false,
        options: [{ label: 'A' }, { label: 'B' }],
      },
    });
  });
});
