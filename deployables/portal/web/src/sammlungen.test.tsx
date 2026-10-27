import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Category, Me, WordEntry } from './api';
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
    ongoing: true,
    closes_at: null,
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

function wordsPoll(overrides: Partial<Category> = {}): Category {
  return personPoll({
    id: 'words-poll',
    name: 'Wörter fürs Motto',
    kind: 'words',
    options: [],
    max_choices: 3,
    my_words: [],
    ...overrides,
  });
}

function installApi(
  initial: Category[] = [],
  auditRows: unknown[] = [],
  options: { wordEntries?: WordEntry[]; ballotError?: boolean; results?: unknown[] } = {},
) {
  let categories = [...initial];
  let wordEntries = [...(options.wordEntries ?? [])];
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
        kind: (body?.kind as Category['kind']) ?? 'person',
        repeatable: false,
        ongoing: true,
        closes_at: null,
        status: 'draft',
        allow_self_vote: false,
        options: (body?.options as Category['options'] | undefined) ?? [],
        my_option_id: null,
        my_option_ids: [],
        my_words: [],
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
    if (path.startsWith('/categories/') && method === 'PATCH') {
      writes.push({ path, method, body: body ?? {} });
      const updated = categories.find((category) => category.id === path.split('/')[2]);
      return Response.json({ ...updated, ...body, version: Number(body?.version ?? 1) + 1 });
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
    if (path.endsWith('/words') && method === 'GET') return Response.json(wordEntries);
    if (path.includes('/words/') && method === 'PATCH') {
      writes.push({ path, method, body: body ?? {} });
      const optionId = path.split('/').at(-1);
      wordEntries = wordEntries.map((entry) =>
        entry.option_id === optionId
          ? {
              ...entry,
              label: String(body?.label ?? entry.label),
              excluded: Boolean(body?.excluded),
              version: entry.version + 1,
            }
          : entry,
      );
      return Response.json(wordEntries.find((entry) => entry.option_id === optionId));
    }
    if (path.endsWith('/results')) return Response.json(options.results ?? []);
    if (path.endsWith('/audit')) return Response.json(auditRows);
    if (path.endsWith('/ballot') && method === 'PUT') {
      writes.push({ path, method, body: body ?? {} });
      if (options.ballotError)
        return Response.json({ error: { code: 'save_failed', message: 'Speichern fehlgeschlagen.' } }, { status: 500 });
      if (Array.isArray(body?.words)) {
        const pollId = path.split('/')[2];
        categories = categories.map((category) =>
          category.id === pollId ? { ...category, my_words: body.words as string[] } : category,
        );
        return Response.json({ words: body.words, option_ids: [] });
      }
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

function addProposalOption(value: string, byEnter = false) {
  const input = screen.getByLabelText('Antwortoption hinzufügen');
  fireEvent.change(input, { target: { value } });
  if (byEnter) fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });
  else fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
}
describe('words polls', () => {
  it('creates a word portrait with an empty option set and the three-word default', async () => {
    const { writes } = installApi();
    renderPortal('/sammlungen', admin);

    fireEvent.click(screen.getByRole('button', { name: /Neue Sammlung/ }));
    fireEvent.change(screen.getByLabelText('Klasse'), { target: { value: 'words' } });
    expect(screen.getByLabelText('Maximale Zahl der Wörter pro Person')).toHaveValue(3);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Wortwolke' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toMatchObject({
      kind: 'words',
      max_choices: 3,
      all_people: false,
      options: [],
    });
  });

  it('normalizes words, prevents duplicates, enforces the cap, and keeps choices after a failed save', async () => {
    const poll = wordsPoll({ max_choices: 2 });
    const { writes } = installApi([poll], [], { ballotError: true });
    renderPortal(`/sammlungen/${poll.id}`, student);
    const input = await screen.findByLabelText(/Wörter eingeben/);

    fireEvent.change(input, { target: { value: 'Feier' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    fireEvent.change(input, { target: { value: 'FEIER' } });
    fireEvent.keyDown(input, { key: ',', code: 'Comma' });
    expect(screen.getAllByText('feier')).toHaveLength(1);
    fireEvent.change(input, { target: { value: 'Zusammenhalt' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(screen.getByText('2 von 2 ausgewählt')).toBeInTheDocument();
    expect(screen.getByLabelText(/Wörter eingeben/)).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Stimme speichern/ }));
    await screen.findByText('Speichern fehlgeschlagen.');
    expect(writes).toContainEqual({
      path: `/categories/${poll.id}/ballot`,
      method: 'PUT',
      body: { words: ['feier', 'zusammenhalt'] },
    });
    expect(screen.getByText('feier')).toBeInTheDocument();
    expect(screen.getByText('zusammenhalt')).toBeInTheDocument();
  });

  it('shows a student only their saved words on a closed poll and never requests editorial data', async () => {
    const poll = wordsPoll({ status: 'closed', my_words: ['abitur', 'zusammenhalt'] });
    const { fetchMock } = installApi([poll]);
    renderPortal(`/sammlungen/${poll.id}`, student);

    expect(await screen.findByText('abitur')).toBeInTheDocument();
    expect(screen.getByText('zusammenhalt')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /CSV herunterladen/ })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => /\/(results|words)(\/export)?$/.test(String(input)))).toBe(false);
  });

  it('lets all managers read words and results but exposes moderation only to the assigned manager', async () => {
    const poll = wordsPoll();
    const rows: WordEntry[] = [
      { option_id: 'word-1', word: 'freiheit', label: 'freiheit', excluded: false, count: 1, version: 2 },
    ];
    const { fetchMock } = installApi([poll], [], {
      wordEntries: rows,
      results: [{ option_id: 'merged', label: 'freiheit', count: 2 }],
    });
    const manager = { ...unassignedManager, category_ids: [] };
    renderPortal(`/sammlungen/${poll.id}`, manager);

    expect(await screen.findByRole('list', { name: /Wortwolke mit 1 Begriff und 2 Nennungen/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Wortliste als CSV herunterladen/ })).toHaveAttribute(
      'href',
      `/api/v1/categories/${poll.id}/words/export`,
    );
    expect(
      await within(screen.getByRole('list', { name: 'Eingegebene Wörter' })).findByText('freiheit'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Aktionen für Begriff freiheit' })).not.toBeInTheDocument();
    const aside = screen.getByRole('complementary');
    expect(aside).not.toContainElement(screen.getByRole('heading', { name: 'Gesamtergebnisse' }));
    expect(aside).not.toContainElement(screen.getByRole('heading', { name: 'Stimmen' }));
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith(`/categories/${poll.id}/words`))).toBe(true);
  });

  it('allows the assigned manager to rename an original into an existing label and exclude a word', async () => {
    const poll = wordsPoll();
    const rows: WordEntry[] = [
      { option_id: 'word-1', word: 'freiheit', label: 'freiheit', excluded: false, count: 1, version: 2 },
      { option_id: 'word-2', word: 'liebe', label: 'liebe', excluded: false, count: 1, version: 1 },
    ];
    const manager = { ...assignedManager, category_ids: [poll.id] };
    const { writes } = installApi([poll], [], { wordEntries: rows });
    renderPortal(`/sammlungen/${poll.id}`, manager);
    await screen.findByRole('heading', { name: 'Sammlung verwalten' });
    const aside = screen.getByRole('complementary');
    expect(aside).toContainElement(screen.getByRole('heading', { name: 'Sammlung verwalten' }));
    expect(aside).not.toContainElement(screen.getByRole('heading', { name: 'Gesamtergebnisse' }));
    await screen.findByRole('button', { name: 'Aktionen für Begriff freiheit' });
    const firstTrigger = screen.getByRole('button', { name: 'Aktionen für Begriff freiheit' });
    const secondTrigger = screen.getByRole('button', { name: 'Aktionen für Begriff liebe' });
    expect(screen.queryByLabelText('Bezeichnung bearbeiten')).not.toBeInTheDocument();
    fireEvent.click(firstTrigger);
    expect(await screen.findByLabelText('Bezeichnung bearbeiten')).toBeInTheDocument();
    expect(writes).toHaveLength(0);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Begriff freiheit bearbeiten' })).not.toBeInTheDocument();
    expect(firstTrigger).toHaveFocus();
    fireEvent.click(firstTrigger);
    expect(await screen.findByLabelText('Bezeichnung bearbeiten')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('dialog', { name: 'Begriff freiheit bearbeiten' })).not.toBeInTheDocument();
    fireEvent.click(firstTrigger);
    const reopenedInput = await screen.findByLabelText('Bezeichnung bearbeiten');

    fireEvent.change(reopenedInput, { target: { value: 'LIEBE' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Umbenennen' })[0]);
    await waitFor(() =>
      expect(writes).toContainEqual({
        path: `/categories/${poll.id}/words/word-1`,
        method: 'PATCH',
        body: { version: 2, label: 'liebe', excluded: false },
      }),
    );
    fireEvent.mouseDown(secondTrigger);
    fireEvent.click(secondTrigger);
    const secondMenu = await screen.findByRole('dialog', { name: 'Begriff liebe bearbeiten' });
    fireEvent.click(within(secondMenu).getByRole('button', { name: 'Ausschließen' }));
    await waitFor(() =>
      expect(writes).toContainEqual({
        path: `/categories/${poll.id}/words/word-2`,
        method: 'PATCH',
        body: { version: 1, label: 'liebe', excluded: true },
      }),
    );
  });
});

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

  it.each(['open', 'closed', 'draft'] as const)(
    'lets assigned managers update a published %s poll deadline without sending definitions',
    async (status) => {
      const poll = personPoll({ status, ongoing: false, closes_at: '2099-06-01T10:00:42.123Z' });
      const { writes } = installApi([poll]);
      renderPortal(`/sammlungen/${poll.id}`, assignedManager);

      fireEvent.click(await screen.findByRole('button', { name: 'Enddatum bearbeiten' }));
      expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Klasse')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '1w' }));
      fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));

      const end = new Date();
      const original = new Date(poll.closes_at!);
      end.setDate(end.getDate() + 7);
      end.setHours(original.getHours(), original.getMinutes(), 0, 0);
      await waitFor(() =>
        expect(writes).toEqual([
          {
            path: `/categories/${poll.id}`,
            method: 'PATCH',
            body: { version: poll.version, closes_at: end.toISOString() },
          },
        ]),
      );
    },
  );

  it('keeps deadline controls away from unassigned managers', async () => {
    const poll = personPoll({ ongoing: false, closes_at: '2099-06-01T10:00:00Z' });
    installApi([poll]);
    renderPortal(`/sammlungen/${poll.id}`, unassignedManager);
    await screen.findByRole('heading', { name: poll.name });
    expect(screen.queryByRole('button', { name: 'Enddatum bearbeiten' })).not.toBeInTheDocument();
  });

  it('does not round or rewrite an unchanged published deadline', async () => {
    const poll = personPoll({ ongoing: false, closes_at: '2099-06-01T10:00:42.123Z' });
    const { writes } = installApi([poll]);
    renderPortal(`/sammlungen/${poll.id}`, assignedManager);
    fireEvent.click(await screen.findByRole('button', { name: 'Enddatum bearbeiten' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Sammlung speichern' })).not.toBeInTheDocument());
    expect(writes).toEqual([]);
  });

  it('honors a changed deadline when retrying after a failed permission update', async () => {
    const original = new Date();
    original.setDate(original.getDate() + 1);
    original.setHours(18, 30, 0, 0);
    const poll = personPoll({ ongoing: false, closes_at: original.toISOString() });
    const { writes, fetchMock } = installApi([poll]);
    let permissionAttempts = 0;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/v1/admin/users'))
        return Response.json([{ ...assignedManager, name: 'Redaktion Test', category_ids: [] }]);
      if (String(input).endsWith(`/api/v1/admin/users/${assignedManager.id}`)) {
        permissionAttempts++;
        if (permissionAttempts === 1)
          return Response.json({ error: { message: 'Berechtigung fehlgeschlagen.' } }, { status: 500 });
        return Response.json({ ...assignedManager, category_ids: [poll.id] });
      }
      return fetchMock(input, init);
    });
    renderPortal(`/sammlungen/${poll.id}`, admin);
    fireEvent.click(await screen.findByRole('button', { name: 'Enddatum bearbeiten' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Redaktion Test' }));
    fireEvent.click(screen.getByRole('button', { name: '1w' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));
    await screen.findByText('Berechtigung fehlgeschlagen.');
    fireEvent.click(screen.getByRole('button', { name: '1d' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));
    await waitFor(() => expect(permissionAttempts).toBe(2));
    expect(writes).toHaveLength(2);
    expect(writes[1].body).toEqual({ version: poll.version + 1, closes_at: original.toISOString() });
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
      if (kind === 'proposal') {
        addProposalOption('A');
        addProposalOption('B');
      }

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

  it('creates one-off photo collections without changing their content kind', async () => {
    const { writes } = installApi();
    renderPortal('/sammlungen', admin);
    fireEvent.click(screen.getByRole('button', { name: /Neue Sammlung/ }));
    const kind = screen.getByLabelText('Klasse');
    fireEvent.change(kind, { target: { value: 'photo' } });
    const repeatable = screen.getByRole('switch', { name: 'Wiederholbar' });
    expect(repeatable).toBeChecked();
    fireEvent.click(repeatable);
    expect(kind).toHaveValue('photo');
    expect(kind.querySelectorAll('option')).toHaveLength(7);
    fireEvent.click(screen.getByRole('switch', { name: 'Fortlaufend' }));
    fireEvent.click(screen.getByRole('button', { name: '1w' }));
    fireEvent.change(screen.getByLabelText('Uhrzeit'), { target: { value: '12:00' } });
    expect(screen.queryByLabelText('Antwortoption hinzufügen')).toBeNull();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Ein Foto pro Person' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toMatchObject({
      kind: 'photo',
      repeatable: false,
      ongoing: false,
      closes_at: (() => {
        const end = new Date();
        end.setDate(end.getDate() + 7);
        end.setHours(12, 0, 0, 0);
        return end.toISOString();
      })(),
      options: [],
    });
  });

  it('shows an existing one-off photo contribution without ballot controls or another-create action', async () => {
    const photo = personPoll({ kind: 'photo', name: 'Ein Foto pro Person', options: [], repeatable: false });
    const { fetchMock } = installApi([photo]);
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/api/v1/submissions'))
        return Response.json([
          {
            id: 'my-photo',
            category_id: photo.id,
            author_id: student.id,
            author_name: student.name,
            title: 'Mein Abschlussfoto',
            body: '',
            context: '',
            status: 'pending',
            version: 1,
            created_at: '2026-10-25T00:00:00Z',
            updated_at: '2026-10-25T00:00:00Z',
            attachments: [],
          },
        ]);
      return fetchMock(input, init);
    });
    renderPortal(`/sammlungen/${photo.id}`, student);
    expect(await screen.findByRole('link', { name: /Mein Abschlussfoto/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Beitrag einreichen/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Stimme speichern/ })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => /\/(results|audit)$/.test(String(url)))).toBe(false);
  });

  it('preserves the exact stored deadline when editing an unrelated photo definition', async () => {
    const photo = personPoll({ kind: 'photo', options: [], ongoing: false, closes_at: '2099-06-01T10:00:42.123Z' });
    const { writes } = installApi([photo]);
    renderPortal(`/sammlungen/${photo.id}`, admin);
    fireEvent.click(await screen.findByRole('button', { name: 'Sammlung bearbeiten' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unser Foto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toMatchObject({ name: 'Unser Foto', ongoing: false, closes_at: photo.closes_at });
  });

  it('preloads proposal options as chips and keeps the collection group locked while editing', async () => {
    const proposal = personPoll({
      kind: 'proposal',
      status: 'draft',
      opened_at: null,
      options: [
        { id: 'option-a', label: 'Mitternachtsblau' },
        { id: 'option-b', label: 'Sonnengelb' },
      ],
    });
    installApi([proposal]);
    renderPortal(`/sammlungen/${proposal.id}`, admin);

    fireEvent.click(await screen.findByRole('button', { name: 'Definition bearbeiten' }));

    const group = screen.getByRole('switch', { name: 'Wiederholbar' });
    expect(group).not.toBeChecked();
    expect(group).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mitternachtsblau entfernen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sonnengelb entfernen' })).toBeInTheDocument();
  });

  it('adds trimmed proposal chips by button or Enter, blocks blanks and duplicates, and removes chips', async () => {
    const { writes } = installApi();
    renderPortal('/sammlungen', admin);
    await openPersonForm('proposal');

    expect(screen.queryByRole('switch', { name: 'Stimme für die eigene Person erlauben' })).not.toBeInTheDocument();
    addProposalOption('  A  ');
    addProposalOption('B', true);
    addProposalOption('a');
    expect(screen.getByRole('button', { name: 'A entfernen' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'B entfernen' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /entfernen$/ })).toHaveLength(2);

    const input = screen.getByLabelText('Antwortoption hinzufügen');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: 'Hinzufügen' })).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });
    expect(screen.getAllByRole('button', { name: /entfernen$/ })).toHaveLength(2);

    addProposalOption('C');
    fireEvent.click(screen.getByRole('button', { name: 'C entfernen' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Abimotto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toMatchObject({
      kind: 'proposal',
      allow_self_vote: false,
      options: [{ label: 'A' }, { label: 'B' }],
    });
  });

  it('allows self-voting for person polls', async () => {
    const { writes } = installApi();
    renderPortal('/sammlungen', admin);
    await openPersonForm();

    const selfVote = screen.getByRole('switch', { name: 'Stimme für die eigene Person erlauben' });
    fireEvent.click(selfVote);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Personenwahl' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toMatchObject({ kind: 'person', allow_self_vote: true });
  });

  it.each(['proposal', 'words'] as const)('hides and clears self-voting after switching to %s', async (kind) => {
    const { writes } = installApi();
    renderPortal('/sammlungen', admin);
    await openPersonForm();
    fireEvent.click(screen.getByRole('switch', { name: 'Stimme für die eigene Person erlauben' }));
    fireEvent.change(screen.getByLabelText('Klasse'), { target: { value: kind } });
    expect(screen.queryByRole('switch', { name: 'Stimme für die eigene Person erlauben' })).not.toBeInTheDocument();
    if (kind === 'proposal') {
      addProposalOption('A');
      addProposalOption('B');
    }
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: `Sammlung ${kind}` } });
    fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toMatchObject({ kind, allow_self_vote: false });
  });

  it('includes a valid pending proposal option when saving without adding it first', async () => {
    const { writes } = installApi();
    renderPortal('/sammlungen', admin);
    await openPersonForm('proposal');

    addProposalOption('A');
    fireEvent.change(screen.getByLabelText('Antwortoption hinzufügen'), { target: { value: ' B ' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Abimotto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sammlung speichern' }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body.options).toEqual([{ label: 'A' }, { label: 'B' }]);
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
    fireEvent.click(screen.getByRole('button', { name: 'Mitternachtsblau' }));
    fireEvent.click(screen.getByRole('button', { name: 'Waldgrün' }));
    fireEvent.click(screen.getByRole('button', { name: /Stimme speichern/ }));
    await waitFor(() => expect(writes[0].body).toEqual({ option_ids: ['gold', 'green'] }));
    await screen.findByText('Alles erledigt. Danke fürs Mitmachen!');
    fireEvent.click(screen.getByRole('link', { name: /Alle Sammlungen ansehen/ }));
    fireEvent.click(await screen.findByRole('link', { name: /Abimotto-Team/ }));
    expect(await screen.findByText('Gespeicherte Stimmen: Sonnengelb, Waldgrün')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sonnengelb' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Waldgrün' })).toHaveAttribute('aria-pressed', 'true');
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

describe('all collections overview', () => {
  it.each(['schueler', 'redaktion'] as const)(
    'groups by repeatability, orders one-off deadlines and collapses ended polls in %s mode',
    async (view) => {
      const categories = [
        personPoll({ id: 'late', name: 'Späte Wahl', ongoing: false, closes_at: '2027-05-10T12:00:00Z' }),
        personPoll({ id: 'no-deadline', name: 'Ohne Enddatum', ongoing: true }),
        personPoll({
          id: 'early',
          name: 'Frühe Wahl',
          ongoing: false,
          closes_at: '2027-02-10T12:00:00Z',
          my_option_ids: ['alice'],
        }),
        personPoll({ id: 'quote', name: 'Zitate', kind: 'quote', repeatable: true, ongoing: true }),
        personPoll({
          id: 'repeated-ballot',
          name: 'Wiederholbare Wahl',
          repeatable: true,
          ongoing: false,
          closes_at: '2027-01-10T12:00:00Z',
        }),
        personPoll({
          id: 'photo',
          name: 'Einmalige Fotos',
          kind: 'photo',
          ongoing: false,
          closes_at: '2027-06-10T12:00:00Z',
          status: 'closed',
        }),
        personPoll({
          id: 'expired',
          name: 'Abgelaufene Wahl',
          status: 'closed',
          ongoing: false,
          closes_at: '2026-01-10T12:00:00Z',
        }),
        personPoll({ id: 'ended-repeatable', name: 'Beendete wiederholbare Wahl', status: 'closed', repeatable: true }),
      ];
      installApi(categories);
      renderPortal('/sammlungen', view === 'schueler' ? student : admin, [], view);

      const once = await screen.findByRole('region', { name: 'Einmalig' });
      const repeated = screen.getByRole('region', { name: 'Wiederholbar' });
      const ids = (element: HTMLElement) =>
        within(element)
          .getAllByRole('link')
          .map((link) => link.getAttribute('href'));
      expect(ids(once)).toEqual([
        '/sammlungen/early',
        '/sammlungen/late',
        '/sammlungen/photo',
        '/sammlungen/no-deadline',
      ]);
      expect(ids(repeated)).toEqual(['/sammlungen/quote', '/sammlungen/repeated-ballot']);
      expect(once.compareDocumentPosition(repeated) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(within(once).getByText('Bis 10.2.2027')).toBeInTheDocument();
      expect(within(once).getByText('Beendet · Bis 10.6.2027')).toBeInTheDocument();
      expect(within(repeated).getByText('Bis 10.1.2027')).toBeInTheDocument();
      const summary = screen.getByText('Beendete Abstimmungen (2)');
      const ended = summary.closest('details')!;
      expect(ended).not.toHaveAttribute('open');
      expect(repeated.compareDocumentPosition(ended) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      fireEvent.click(summary);
      expect(
        within(ended)
          .getAllByRole('link', { hidden: true })
          .map((link) => link.getAttribute('href')),
      ).toEqual(['/sammlungen/expired', '/sammlungen/ended-repeatable']);
      const own = screen.getByRole('link', { name: 'Meine Beiträge' });
      expect(own).toHaveAttribute('href', '/beitraege');
      expect(ended.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    },
  );

  it('keeps class filtering and the own submissions link available', async () => {
    installApi([personPoll(), personPoll({ id: 'quote', name: 'Zitate', kind: 'quote', repeatable: true })]);
    renderPortal('/sammlungen?klasse=quote', student);
    const repeated = await screen.findByRole('region', { name: 'Wiederholbar' });
    expect(within(repeated).getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Einmalig' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Meine Beiträge' })).toHaveAttribute('href', '/beitraege');
  });
});
