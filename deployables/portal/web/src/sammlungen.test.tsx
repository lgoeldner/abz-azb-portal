import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Category, Me, WordEntry } from './api';
import { Sammlungen, SammlungDetail } from './sammlungen';
import { Session, WorkspaceView, kindLabel, type Kind, type View } from './ui';

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
  const me: Me = { user, consent_required: false, csrf_token: 'csrf' };
  const workspaceView: [View, (next: View) => void] = [view, vi.fn()];
  return render(
    <QueryClientProvider client={client}>
      <Session.Provider value={me}>
        <WorkspaceView.Provider value={workspaceView}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/" element={<Link to={path}>Abimotto-Team</Link>} />
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
  fireEvent.click(screen.getByRole('button', { name: /Neue Abstimmung/ }));
  fireEvent.click(screen.getByRole('radio', { name: kindLabel[kind as Kind] }));
  expect(screen.getByLabelText('Maximale Zahl der Stimmen pro Person')).toHaveValue(1);
}

function addProposalOption(value: string, byEnter = false) {
  const input = screen.getByLabelText('Antwortoption hinzufügen');
  fireEvent.change(input, { target: { value } });
  if (byEnter) fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });
  else fireEvent.click(screen.getByRole('button', { name: 'Hinzufügen' }));
}
describe('words polls', () => {
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

  it('allows the assigned manager to rename an original into an existing label and exclude a word', async () => {
    const poll = wordsPoll();
    const rows: WordEntry[] = [
      { option_id: 'word-1', word: 'freiheit', label: 'freiheit', excluded: false, count: 1, version: 2 },
      { option_id: 'word-2', word: 'liebe', label: 'liebe', excluded: false, count: 1, version: 1 },
    ];
    const manager = { ...assignedManager, category_ids: [poll.id] };
    const { writes } = installApi([poll], [], { wordEntries: rows });
    renderPortal(`/sammlungen/${poll.id}`, manager);
    await screen.findByRole('heading', { name: 'Abstimmung verwalten' });
    const aside = screen.getByRole('complementary');
    expect(aside).toContainElement(screen.getByRole('heading', { name: 'Abstimmung verwalten' }));
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

describe('Abstimmungen person polls', () => {
  it('hides an open poll with the current version and refreshes its hidden label', async () => {
    const poll = personPoll();
    const { fetchMock, writes } = installApi([poll]);
    const manager = { ...student, id: 'manager-1', role: 'manager' as const, category_ids: [poll.id] };
    renderPortal(`/sammlungen/${poll.id}`, manager);

    fireEvent.click(await screen.findByRole('button', { name: 'Abstimmung verbergen' }));

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
    expect(screen.getByRole('button', { name: 'Abstimmung öffnen' })).toBeInTheDocument();
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
      fireEvent.click(screen.getByRole('button', { name: 'Abstimmung speichern' }));

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

  it('does not round or rewrite an unchanged published deadline', async () => {
    const poll = personPoll({ ongoing: false, closes_at: '2099-06-01T10:00:42.123Z' });
    const { writes } = installApi([poll]);
    renderPortal(`/sammlungen/${poll.id}`, assignedManager);
    fireEvent.click(await screen.findByRole('button', { name: 'Enddatum bearbeiten' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abstimmung speichern' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Abstimmung speichern' })).not.toBeInTheDocument());
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
    fireEvent.click(screen.getByRole('button', { name: 'Abstimmung speichern' }));
    await screen.findByText('Berechtigung fehlgeschlagen.');
    fireEvent.click(screen.getByRole('button', { name: '1d' }));
    fireEvent.click(screen.getByRole('button', { name: 'Abstimmung speichern' }));
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

    fireEvent.click(await screen.findByRole('button', { name: 'Abstimmung endgültig löschen' }));

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

    fireEvent.click(await screen.findByRole('button', { name: 'Abstimmung endgültig löschen' }));

    await screen.findByRole('heading', { name: 'Abstimmungen' });
    expect(writes).toContainEqual({
      path: `/categories/${poll.id}`,
      method: 'DELETE',
      body: { version: poll.version },
    });
    expect(screen.getByText('Hier geht’s bald los. Aktuell gibt es keine Abstimmungen.')).toBeInTheDocument();
  });

  it('preserves the exact stored deadline when editing an unrelated photo definition', async () => {
    const photo = personPoll({ kind: 'photo', options: [], ongoing: false, closes_at: '2099-06-01T10:00:42.123Z' });
    const { writes } = installApi([photo]);
    renderPortal(`/sammlungen/${photo.id}`, admin);
    fireEvent.click(await screen.findByRole('button', { name: 'Abstimmung bearbeiten' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Unser Foto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Abstimmung speichern' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toMatchObject({ name: 'Unser Foto', ongoing: false, closes_at: photo.closes_at });
  });

  it('includes a valid pending proposal option when saving without adding it first', async () => {
    const { writes } = installApi();
    renderPortal('/sammlungen', admin);
    await openPersonForm('proposal');

    addProposalOption('A');
    fireEvent.change(screen.getByLabelText('Antwortoption hinzufügen'), { target: { value: ' B ' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Abimotto' } });
    fireEvent.click(screen.getByRole('button', { name: 'Abstimmung speichern' }));

    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body.options).toEqual([{ label: 'A' }, { label: 'B' }]);
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
    fireEvent.click(screen.getByRole('link', { name: /Zur Übersicht/ }));
    fireEvent.click(await screen.findByRole('link', { name: /Abimotto-Team/ }));
    expect(await screen.findByText('Gespeicherte Stimmen: Bob Beispiel, Cara Beispiel')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Gesamtergebnisse' })).not.toBeInTheDocument();
  });
});
