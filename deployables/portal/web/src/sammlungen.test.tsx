import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Category, Me } from './api';
import { Sammlungen, SammlungDetail } from './sammlungen';
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
const admin: Me['user'] = { ...student, id: 'admin-1', name: 'Ada Admin', role: 'admin' };
const assignedManager: Me['user'] = { ...student, id: 'manager-1', role: 'manager', category_ids: ['person-poll'] };
const unassignedManager: Me['user'] = { ...student, id: 'manager-2', role: 'manager' };
const roster = [
  { id: 'user-alice', name: 'Alice Beispiel' },
  { id: 'user-bob', name: 'Bob Beispiel' },
  { id: 'user-cara', name: 'Cara Beispiel' },
  ...['Anna Berg', 'Elias Koch', 'Lina Schulz', 'Noah Braun', 'Emma Wolf', 'Paul Lang', 'Clara Maier'].map((name) => ({
    id: name,
    name,
  })),
];

function personPoll(overrides: Partial<Category> = {}): Category {
  return {
    id: 'person-poll',
    name: 'Abimotto-Team',
    description: '',
    kind: 'person',
    repeatable: false,
    status: 'open',
    allow_self_vote: false,
    options: [
      { id: 'self', label: 'Mia Beispiel', user_id: student.id },
      { id: 'alice', label: 'Alice Beispiel', user_id: 'user-alice' },
      { id: 'bob', label: 'Bob Beispiel', user_id: 'user-bob' },
      { id: 'cara', label: 'Cara Beispiel', user_id: 'user-cara' },
    ],
    my_option_id: null,
    my_option_ids: [],
    all_people: false,
    max_choices: 2,
    version: 1,
    created_at: '2026-10-01T00:00:00Z',
    opened_at: '2026-10-02T00:00:00Z',
    ballot_count: null,
    participation: null,
    ...overrides,
  };
}

function installApi(initial: Category[] = [], auditRows: unknown[] = []) {
  let categories = [...initial];
  const writes: { path: string; method: string; body: Record<string, unknown> }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.origin);
    const path = url.pathname.replace('/api/v1', '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;

    if (path === '/categories' && method === 'GET') return Response.json(categories);
    if (path === '/roster') return Response.json(roster);
    if (path === '/categories' && method === 'POST') {
      writes.push({ path, method, body: body ?? {} });
      const created: Category = {
        id: 'created-person-poll',
        name: String(body?.name ?? ''),
        description: String(body?.description ?? ''),
        kind: body?.kind === 'proposal' ? 'proposal' : 'person',
        repeatable: false,
        status: 'draft',
        allow_self_vote: false,
        options: (body?.options as Category['options'] | undefined) ?? [],
        my_option_id: null,
        my_option_ids: [],
        all_people: body?.all_people === true,
        max_choices: Number(body?.max_choices ?? 1),
        version: 1,
        created_at: '2026-10-25T00:00:00Z',
        opened_at: null,
        ballot_count: null,
        participation: null,
      } as Category;
      categories = [...categories, created];
      return Response.json(created, { status: 201 });
    }
    if (path.endsWith('/status') && method === 'POST') {
      writes.push({ path, method, body: body ?? {} });
      const categoryId = path.split('/')[2];
      const updated = categories.find((category) => category.id === categoryId);
      if (!updated) return Response.json({ error: { message: 'Not found' } }, { status: 404 });
      const next = { ...updated, status: body?.status as Category['status'], version: updated.version + 1 };
      categories = categories.map((category) => (category.id === categoryId ? next : category));
      return Response.json(next);
    }
    if (path.startsWith('/categories/') && method === 'DELETE') {
      writes.push({ path, method, body: body ?? {} });
      const categoryId = path.split('/')[2];
      categories = categories.filter((category) => category.id !== categoryId);
      return new Response(null, { status: 204 });
    }
    if (path.endsWith('/results')) return Response.json([]);
    if (path.endsWith('/audit')) return Response.json(auditRows);
    if (path.endsWith('/ballot') && method === 'PUT') {
      writes.push({ path, method, body: body ?? {} });
      const optionIds =
        (body?.option_ids as string[] | undefined) ?? (body?.option_id ? [body.option_id as string] : []);
      const pollId = path.split('/')[2];
      categories = categories.map((category) =>
        category.id === pollId
          ? { ...category, my_option_ids: optionIds, my_option_id: optionIds[0] ?? null }
          : category,
      );
      return Response.json({ option_ids: optionIds, option_id: optionIds[0] ?? null });
    }
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, writes };
}

function renderPortal(
  path: string,
  user: Me['user'],
  _categories: Category[] = [],
  view: View = user.role === 'student' ? 'schueler' : 'redaktion',
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const me: Me = { user, csrf_token: 'csrf' };
  const workspaceView: [View, (next: View) => void] = [view, vi.fn()];
  return render(
    <QueryClientProvider client={client}>
      <Session.Provider value={me}>
        <WorkspaceView.Provider value={workspaceView}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/sammlungen" element={<Sammlungen />} />
              <Route path="/sammlungen/:id" element={<SammlungDetail />} />
            </Routes>
          </MemoryRouter>
        </WorkspaceView.Provider>
      </Session.Provider>
    </QueryClientProvider>,
  );
}

async function openPersonForm(kind = 'person') {
  fireEvent.click(screen.getByRole('button', { name: /Neue Sammlung/ }));
  fireEvent.change(screen.getByLabelText('Klasse'), { target: { value: kind } });
  expect(screen.getByLabelText('Maximale Zahl der Stimmen pro Person')).toHaveValue(1);
}

describe('Sammlungen person polls', () => {
  it.each([
    { role: 'admin', user: admin, canHide: true },
    { role: 'assigned manager', user: assignedManager, canHide: true },
    { role: 'unassigned manager', user: unassignedManager, canHide: false },
    { role: 'student', user: student, canHide: false },
  ])('$role permission for an open poll', async ({ user, canHide }) => {
    const poll = personPoll();
    installApi([poll]);
    renderPortal(`/sammlungen/${poll.id}`, user);

    await screen.findByRole('heading', { name: poll.name });
    const hide = screen.queryByRole('button', { name: 'Sammlung verbergen' });
    if (canHide) expect(hide).toBeInTheDocument();
    else expect(hide).toBeNull();
    const remove = screen.queryByRole('button', { name: 'Sammlung endgültig löschen' });
    if (user.role === 'admin') expect(remove).toBeInTheDocument();
    else expect(remove).toBeNull();
  });

  it.each([
    { role: 'admin', user: admin, canHide: true },
    { role: 'assigned manager', user: assignedManager, canHide: true },
    { role: 'unassigned manager', user: unassignedManager, canHide: false },
    { role: 'student', user: student, canHide: false },
  ])('$role permission for a closed poll', async ({ user, canHide }) => {
    const poll = personPoll({ status: 'closed' });
    installApi([poll]);
    renderPortal(`/sammlungen/${poll.id}`, user);

    await screen.findByRole('heading', { name: poll.name });
    const hide = screen.queryByRole('button', { name: 'Sammlung verbergen' });
    if (canHide) expect(hide).toBeInTheDocument();
    else expect(hide).toBeNull();
    const remove = screen.queryByRole('button', { name: 'Sammlung endgültig löschen' });
    if (user.role === 'admin') expect(remove).toBeInTheDocument();
    else expect(remove).toBeNull();
  });

  it('hides an open poll with the current version and refreshes its hidden label', async () => {
    const poll = personPoll();
    const { fetchMock, writes } = installApi([poll]);
    const manager = { ...student, id: 'manager-1', role: 'manager' as const, category_ids: [poll.id] };
    renderPortal(`/sammlungen/${poll.id}`, manager);

    fireEvent.click(await screen.findByRole('button', { name: 'Sammlung verbergen' }));

    await screen.findByText('Verborgen');
    expect(writes).toContainEqual({
      path: `/categories/${poll.id}/status`,
      method: 'POST',
      body: { version: poll.version, status: 'draft' },
    });
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith('/api/v1/categories'))).toHaveLength(2);
  });

  it('keeps a previously opened hidden poll definition locked while allowing reopening', async () => {
    const poll = personPoll({ status: 'draft' });
    const manager = { ...student, id: 'manager-1', role: 'manager' as const, category_ids: [poll.id] };
    installApi([poll]);
    renderPortal(`/sammlungen/${poll.id}`, manager);

    expect(await screen.findByText('Verborgen')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Definition bearbeiten' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sammlung öffnen' })).toBeInTheDocument();
  });

  it('lets managers edit a draft that has never been opened', async () => {
    const poll = personPoll({ status: 'draft', opened_at: null });
    const manager = { ...student, id: 'manager-1', role: 'manager' as const, category_ids: [poll.id] };
    installApi([poll]);
    renderPortal(`/sammlungen/${poll.id}`, manager);

    fireEvent.click(await screen.findByRole('button', { name: 'Definition bearbeiten' }));
    expect(screen.getByLabelText('Name')).toHaveValue(poll.name);
  });

  it('lets admins edit permissions on a hidden poll without unlocking its definition', async () => {
    const poll = personPoll({ status: 'draft' });
    installApi([poll]);
    renderPortal(`/sammlungen/${poll.id}`, admin);

    fireEvent.click(await screen.findByRole('button', { name: 'Berechtigungen bearbeiten' }));

    expect(screen.getByRole('heading', { name: 'Berechtigungen bearbeiten' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });

  it('does not send a delete request when an admin cancels confirmation', async () => {
    const poll = personPoll({ status: 'closed' });
    const { writes } = installApi([poll]);
    vi.stubGlobal(
      'confirm',
      vi.fn(() => false),
    );
    renderPortal(`/sammlungen/${poll.id}`, admin);

    fireEvent.click(await screen.findByRole('button', { name: 'Sammlung endgültig löschen' }));

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Stimmprotokoll'));
    expect(writes).toEqual([]);
    expect(await screen.findByRole('heading', { name: poll.name })).toBeInTheDocument();
  });

  it('deletes for an admin after confirmation and navigates back to collections', async () => {
    const poll = personPoll({ status: 'draft' });
    const { writes } = installApi([poll]);
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );
    renderPortal(`/sammlungen/${poll.id}`, admin);

    fireEvent.click(await screen.findByRole('button', { name: 'Sammlung endgültig löschen' }));

    await screen.findByRole('heading', { name: 'Sammlungen' });
    expect(writes).toContainEqual({
      path: `/categories/${poll.id}`,
      method: 'DELETE',
      body: { version: poll.version },
    });
    expect(screen.getByText('Hier geht’s bald los. Aktuell gibt es keine Sammlungen.')).toBeInTheDocument();
  });

  it.each(['person', 'proposal'])(
    'clamps %s count controls and saves direct input without submitting from the buttons',
    async (kind) => {
      const { writes } = installApi();
      renderPortal('/sammlungen', admin);
      await openPersonForm(kind);
      if (kind === 'proposal')
        fireEvent.change(screen.getByLabelText(/Antwortoptionen/), { target: { value: 'A\nB' } });

      const count = screen.getByLabelText('Maximale Zahl der Stimmen pro Person');
      const less = screen.getByRole('button', { name: kind === 'person' ? 'Weniger Personen' : 'Weniger Optionen' });
      const more = screen.getByRole('button', { name: kind === 'person' ? 'Mehr Personen' : 'Mehr Optionen' });
      expect(less).toBeDisabled();
      fireEvent.click(more);
      expect(count).toHaveValue(2);
      expect(writes).toHaveLength(0);

      fireEvent.change(count, { target: { value: '500' } });
      expect(more).toBeDisabled();
      fireEvent.click(less);
      expect(count).toHaveValue(499);

      fireEvent.change(count, { target: { value: '501' } });
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Abimotto-Team' } });
      fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));
      expect(writes).toHaveLength(0);

      fireEvent.change(count, { target: { value: '500' } });
      fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));
      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0].body).toMatchObject({ max_choices: 500 });
    },
  );

  it('defaults new person polls to all people and creates with an empty options list', async () => {
    const { writes } = installApi();
    renderPortal('/sammlungen', admin);
    await openPersonForm();

    expect(screen.getByRole('switch', { name: 'Alle freigegebenen Personen zur Abstimmung zulassen' })).toBeChecked();
    expect(screen.getByLabelText('Maximale Zahl der Stimmen pro Person')).toHaveValue(1);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Abimotto-Team' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toMatchObject({
      path: '/categories',
      method: 'POST',
      body: {
        kind: 'person',
        all_people: true,
        max_choices: 1,
        options: [],
      },
    });
  });

  it('searches and removes selected subset candidates before creating the poll', async () => {
    const { writes } = installApi();
    renderPortal('/sammlungen', admin);
    await openPersonForm();

    fireEvent.click(screen.getByRole('switch', { name: 'Alle freigegebenen Personen zur Abstimmung zulassen' }));
    const search = await screen.findByRole('searchbox', { name: 'Person suchen' });
    fireEvent.change(search, { target: { value: 'Alice' } });
    fireEvent.click(screen.getByRole('button', { name: 'Alice Beispiel' }));
    const aliceChip = screen.getByRole('button', { name: 'Alice Beispiel entfernen' });
    expect(aliceChip.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.change(search, { target: { value: 'niemand' } });
    expect(screen.getByRole('status')).toHaveTextContent('Keine Auswahlmöglichkeiten gefunden.');
    fireEvent.change(search, { target: { value: 'Bob' } });
    fireEvent.click(screen.getByRole('button', { name: 'Bob Beispiel' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Kandidat:innen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toMatchObject({
      kind: 'person',
      all_people: false,
      options: [
        { label: 'Alice Beispiel', user_id: 'user-alice' },
        { label: 'Bob Beispiel', user_id: 'user-bob' },
      ],
    });
  });

  it('advances after saving a multi-person ballot and restores saved choices when revisited', async () => {
    const poll = personPoll();
    const { writes } = installApi([poll]);
    renderPortal(`/sammlungen/${poll.id}`, student, [poll]);

    expect(await screen.findByRole('button', { name: /Mia Beispiel.*Eigene Stimme nicht erlaubt/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Alice Beispiel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Bob Beispiel' }));
    expect(screen.getByText('2 von 2 ausgewählt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Cara Beispiel/ })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Alice Beispiel entfernen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cara Beispiel' }));
    fireEvent.click(screen.getByRole('button', { name: /Stimme speichern/ }));

    await waitFor(() =>
      expect(writes).toContainEqual({
        path: `/categories/${poll.id}/ballot`,
        method: 'PUT',
        body: { option_ids: ['bob', 'cara'] },
      }),
    );
    await screen.findByText('Alles erledigt. Danke fürs Mitmachen!');
    fireEvent.click(screen.getByRole('link', { name: /Alle Sammlungen ansehen/ }));
    fireEvent.click(await screen.findByRole('link', { name: /Abimotto-Team/ }));
    expect(await screen.findByText('Gespeicherte Stimmen: Bob Beispiel, Cara Beispiel')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Gesamtergebnisse' })).not.toBeInTheDocument();
  });

  it('saves multiple proposal choices on a card and restores chips when revisited', async () => {
    const poll = personPoll({
      kind: 'proposal',
      options: [
        { id: 'blue', label: 'Mitternachtsblau' },
        { id: 'gold', label: 'Sonnengelb' },
        { id: 'green', label: 'Waldgrün' },
      ],
    });
    const { writes } = installApi([poll]);
    renderPortal(`/sammlungen/${poll.id}`, student);
    fireEvent.click(await screen.findByRole('button', { name: 'Mitternachtsblau' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sonnengelb' }));
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Waldgrün/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Mitternachtsblau entfernen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Waldgrün' }));
    fireEvent.click(screen.getByRole('button', { name: /Stimme speichern/ }));
    await waitFor(() => expect(writes[0].body).toEqual({ option_ids: ['gold', 'green'] }));
    await screen.findByText('Alles erledigt. Danke fürs Mitmachen!');
    fireEvent.click(screen.getByRole('link', { name: /Alle Sammlungen ansehen/ }));
    fireEvent.click(await screen.findByRole('link', { name: /Abimotto-Team/ }));
    expect(await screen.findByText('Gespeicherte Stimmen: Sonnengelb, Waldgrün')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sonnengelb entfernen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Waldgrün entfernen' })).toBeInTheDocument();
  });

  it('keeps editorial controls out of the student voting queue as its active poll changes', async () => {
    const first = personPoll({ description: 'Erste Beschreibung' });
    const second = personPoll({ id: 'second-poll', name: 'Zweite Frage', description: 'Zweite Beschreibung' });
    const { fetchMock } = installApi([first, second]);
    renderPortal(`/sammlungen/${first.id}`, admin, [], 'schueler');
    await screen.findByRole('heading', { name: first.name });
    fireEvent.click(screen.getByRole('button', { name: 'Nächste Sammlung' }));
    expect(screen.getByRole('heading', { name: second.name })).toBeInTheDocument();
    expect(screen.queryByText(first.description)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sammlung beenden' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Gesamtergebnisse' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Namentliches Stimmprotokoll öffnen' })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => /\/(results|audit)$/.test(String(input)))).toBe(false);
  });

  it('groups each admin audit ballot into one complete selection row', async () => {
    const poll = personPoll();
    const auditRows = [
      {
        user_id: student.id,
        user_name: student.name,
        option_id: 'alice',
        option_label: 'Alice Beispiel',
        created_at: '2026-10-24T10:00:00Z',
        ballot_id: 'ballot-1',
      },
      {
        user_id: student.id,
        user_name: student.name,
        option_id: 'bob',
        option_label: 'Bob Beispiel',
        created_at: '2026-10-24T10:00:00Z',
        ballot_id: 'ballot-1',
      },
      {
        user_id: student.id,
        user_name: student.name,
        option_id: 'cara',
        option_label: 'Cara Beispiel',
        created_at: '2026-10-24T11:00:00Z',
        ballot_id: 'ballot-2',
      },
    ];
    installApi([poll], auditRows);
    renderPortal(`/sammlungen/${poll.id}`, admin, [poll], 'redaktion');

    fireEvent.click(await screen.findByRole('button', { name: 'Namentliches Stimmprotokoll öffnen' }));
    const table = await screen.findByRole('table');
    const rows = table.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelectorAll('td')[0]).toHaveTextContent('Mia Beispiel');
    expect([...rows[0].querySelectorAll('td')[1].querySelectorAll('li')].map((item) => item.textContent)).toEqual([
      'Alice Beispiel',
      'Bob Beispiel',
    ]);
    expect(rows[1].querySelectorAll('td')[1]).toHaveTextContent('Cara Beispiel');
  });

  it.each([
    ['closed', personPoll({ status: 'closed' }), student],
    ['ineligible', personPoll(), { ...student, admitted: false }],
  ] as const)('disables candidate search for a %s voter', async (_name, poll, user) => {
    installApi([poll]);
    renderPortal(`/sammlungen/${poll.id}`, user, [poll]);

    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    await screen.findByRole('button', { name: 'Alice Beispiel' });
    expect(screen.getByRole('button', { name: 'Alice Beispiel' })).toBeDisabled();
    if (!user.admitted) expect(screen.getByText(/Nur freigegebene Mitglieder/)).toBeInTheDocument();
    if (poll.status === 'closed')
      expect(screen.queryByRole('button', { name: /Stimme speichern/ })).not.toBeInTheDocument();
  });
});
