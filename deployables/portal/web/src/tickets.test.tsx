import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Area, Me, Ticket, TicketDetail, TicketEvent, TicketReview } from './api';
import { Board, NewTicket, TicketPage } from './tickets';
import { Session } from './ui';

// The real editor (Milkdown) needs a browser; a textarea keeps the contract: markdown in, markdown out.
vi.mock('./Editor', () => ({
  default: ({
    value,
    onChange,
    readonly,
    label,
  }: {
    value: string;
    onChange?: (v: string) => void;
    readonly?: boolean;
    label?: string;
  }) =>
    readonly ? (
      <div data-testid="readonly-md">{value}</div>
    ) : (
      <textarea aria-label={label} defaultValue={value} onChange={(e) => onChange?.(e.target.value)} />
    ),
}));

const base = {
  id: 'u',
  admitted: true,
  cohort_member: true,
  category_ids: [],
  created_at: '2026-09-01T00:00:00Z',
};
const manager: Me['user'] = { ...base, id: 'manager-1', name: 'Mona Manager', role: 'manager' };
const reviewer: Me['user'] = { ...base, id: 'reviewer-1', name: 'Rita Review', role: 'manager' };
const admin: Me['user'] = { ...base, id: 'admin-1', name: 'Ada Admin', role: 'admin' };
const ref = (u: Me['user']) => ({ id: u.id, name: u.name });

const areas: Area[] = [
  { id: 'area-redaktion', name: 'Redaktion', position: 1, version: 1, reviewers: [ref(reviewer)] },
  { id: 'area-layout', name: 'Layout', position: 2, version: 1, reviewers: [] },
];

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 'ticket-1',
    number: 1,
    comment_count: 0,
    type: 'aufgabe',
    title: 'Angebote besorgen',
    body: 'Ergebnis wird abgelegt in: Drive',
    area_id: 'area-redaktion',
    area_name: 'Redaktion',
    assignee: ref(manager),
    created_by: ref(reviewer),
    size: 'M',
    goal: '5 Angebote',
    est_pages: null,
    status: 'in_progress',
    round: 1,
    version: 3,
    approved: false,
    reviews: [],
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-02T10:00:00Z',
    status_changed_at: '2026-10-02T10:00:00Z',
    ...overrides,
  };
}
const vote = (u: Me['user'], verdict: TicketReview['verdict'], binding: boolean, self = false): TicketReview => ({
  user: ref(u),
  verdict,
  binding,
  self_confirmed: self,
  updated_at: '2026-10-03T10:00:00Z',
});

interface Write {
  path: string;
  method: string;
  body: Record<string, unknown>;
}
function installApi(
  tickets: Ticket[],
  options: { events?: TicketEvent[]; statusError?: number; reviewError?: number; patchError?: number } = {},
) {
  const writes: Write[] = [];
  const gets: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), window.location.origin);
    const path = url.pathname.replace('/api/v1', '');
    const method = init?.method ?? 'GET';
    if (method !== 'GET') {
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      writes.push({ path, method, body });
      if (path.endsWith('/review') && options.reviewError)
        return Response.json({ error: { code: 'stale', message: 'stale' } }, { status: options.reviewError });
      if (path.endsWith('/status') && options.statusError)
        return Response.json({ error: { code: 'stale', message: 'stale' } }, { status: options.statusError });
      if (method === 'PATCH' && options.patchError)
        return Response.json({ error: { code: 'stale', message: 'stale' } }, { status: options.patchError });
      // Like the server: a ticket with an assignee starts in progress.
      if (path === '/tickets')
        return Response.json(
          ticket({ id: 'created-1', ...(body as Partial<Ticket>), status: body.assignee_id ? 'in_progress' : 'todo' }),
        );
      return Response.json(tickets[0] ?? {});
    }
    gets.push(path + url.search);
    if (path === '/areas') return Response.json(areas);
    if (path === '/tickets') {
      const finished = url.searchParams.get('include_finished') === 'true';
      return Response.json(tickets.filter((t) => finished || !(t.status === 'done' && t.approved)));
    }
    const found = tickets.find((t) => path === '/tickets/' + t.id);
    if (found) return Response.json({ ticket: found, events: options.events ?? [] } satisfies TicketDetail);
    return Response.json({ error: { code: 'not_found', message: 'nicht gefunden' } }, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { writes, gets };
}

function renderAt(path: string, user: Me['user']) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Session.Provider value={{ user, consent_required: false, csrf_token: 'csrf' }}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/tickets" element={<Board />} />
            <Route path="/tickets/neu" element={<NewTicket />} />
            <Route path="/tickets/:id" element={<TicketPage />} />
          </Routes>
        </MemoryRouter>
      </Session.Provider>
    </QueryClientProvider>,
  );
}

const openFilter = async () => userEvent.click(screen.getByRole('button', { name: /^Filter/ }));
const findColumn = async (area: string, name: string) =>
  within(await screen.findByRole('region', { name: 'Bereich ' + area })).getByRole('region', { name });
async function pickArea(user: ReturnType<typeof userEvent.setup>, name: string, picker = 'Bereich') {
  await user.click(screen.getByRole('button', { name: picker }));
  await user.click(await screen.findByRole('option', { name }));
}

describe('ticket board', () => {
  const todo = ticket({ id: 't-todo', number: 1, title: 'Fotos sichten', status: 'todo', assignee: null });
  const work = ticket({
    id: 't-work',
    number: 2,
    title: 'Layout bauen',
    status: 'in_progress',
    area_id: 'area-layout',
    area_name: 'Layout',
  });
  const review = ticket({ id: 't-review', number: 3, title: 'Steckbriefe', status: 'review', assignee: ref(reviewer) });
  const waiting = ticket({ id: 't-wait', number: 4, title: 'Abizeitung drucken', status: 'done', approved: false });
  const approved = ticket({ id: 't-ok', number: 5, title: 'Cover entwerfen', status: 'done', approved: true });

  it('groups by Bereich in position order and puts every ticket into its status column', async () => {
    const api = installApi([work, todo, review, waiting, approved]);
    renderAt('/tickets', manager);
    for (const [area, name, title] of [
      ['Redaktion', 'Offen', 'Fotos sichten'],
      ['Layout', 'In Arbeit', 'Layout bauen'],
      ['Redaktion', 'Wartet auf Review', 'Steckbriefe'],
      ['Redaktion', 'Fertig', 'Abizeitung drucken'],
    ] as const) {
      expect(await within(await findColumn(area, name)).findByText(title)).toBeInTheDocument();
    }
    expect(screen.getAllByRole('region', { name: /^Bereich / }).map((r) => r.getAttribute('aria-label'))).toEqual([
      'Bereich Redaktion',
      'Bereich Layout',
    ]);
    expect(screen.queryByText('Cover entwerfen')).not.toBeInTheDocument();

    await openFilter();
    await userEvent.click(screen.getByLabelText('Abgeschlossene zeigen'));
    expect(await screen.findByText('Cover entwerfen')).toBeInTheDocument();
    expect(api.gets).toContain('/tickets?include_finished=true');
  });

  it('hides empty Bereiche, but keeps a chosen one with its "+ Neu" rows', async () => {
    installApi([todo]);
    const user = userEvent.setup();
    renderAt('/tickets', manager);
    await screen.findByText('Fotos sichten');
    expect(screen.queryByRole('region', { name: 'Bereich Layout' })).not.toBeInTheDocument();
    await pickArea(user, 'Layout', 'Alle Bereiche');
    const layout = screen.getByRole('region', { name: 'Bereich Layout' });
    expect(within(layout).getAllByRole('link', { name: /^Neu in Layout/ })).toHaveLength(4);
    expect(within(layout).queryByRole('article')).not.toBeInTheDocument();
  });

  it('links each "+ Neu" row to the new-ticket form with Bereich and status', async () => {
    installApi([todo]);
    renderAt('/tickets', manager);
    const link = await screen.findByRole('link', { name: 'Neu in Redaktion: Wartet auf Review' });
    expect(link).toHaveAttribute('href', '/tickets/neu?bereich=area-redaktion&status=review');
  });

  it('makes the whole card one link to the ticket and shows goal, assignee and comment count only when set', async () => {
    installApi([ticket({ id: 't-talk', number: 7, title: 'Mit Kommentaren', comment_count: 3 }), todo]);
    renderAt('/tickets', manager);
    const talk = await screen.findByRole('article', { name: '#7 Mit Kommentaren' });
    expect(within(talk).getByRole('link', { name: 'Mit Kommentaren' })).toHaveAttribute('href', '/tickets/t-talk');
    expect(within(talk).getByText('5 Angebote')).toBeInTheDocument();
    expect(within(talk).getByText('Mona Manager')).toBeInTheDocument();
    expect(within(talk).getByText('3')).toBeInTheDocument();
    expect(within(talk).getByText('Kommentare')).toBeInTheDocument();
    const quiet = screen.getByRole('article', { name: '#1 Fotos sichten' });
    expect(within(quiet).queryByText(/Kommentar/)).not.toBeInTheDocument();
    expect(within(quiet).queryByText('0')).not.toBeInTheDocument();
  });

  it('marks only done cards that wait for approval', async () => {
    installApi([waiting, approved]);
    renderAt('/tickets', manager);
    await screen.findByRole('article', { name: '#4 Abizeitung drucken' });
    await openFilter();
    await userEvent.click(screen.getByLabelText('Abgeschlossene zeigen'));
    const cardApproved = await screen.findByRole('article', { name: '#5 Cover entwerfen' });
    const cardWaiting = screen.getByRole('article', { name: '#4 Abizeitung drucken' });
    expect(within(cardWaiting).getByText('Wartet auf Abnahme')).toBeInTheDocument();
    expect(within(cardApproved).queryByText('Wartet auf Abnahme')).not.toBeInTheDocument();
  });

  it('moves a ticket through the status sheet, marks the current status and sends the current version', async () => {
    const api = installApi([work]);
    renderAt('/tickets', manager);
    await userEvent.click(await screen.findByRole('button', { name: 'Status von #2 ändern' }));
    const sheet = screen.getByRole('dialog', { name: 'Status von #2 wählen' });
    expect(within(sheet).getByRole('button', { name: 'In Arbeit' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(sheet).getByRole('button', { name: 'Fertig' })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(within(sheet).getByRole('button', { name: 'Wartet auf Review' }));
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({
      path: '/tickets/t-work/status',
      method: 'POST',
      body: { version: 3, status: 'review' },
    });
    expect(screen.queryByRole('dialog', { name: /Status von #2/ })).not.toBeInTheDocument();
  });

  it('closes the status sheet with Escape without sending anything', async () => {
    const api = installApi([work]);
    renderAt('/tickets', manager);
    await userEvent.click(await screen.findByRole('button', { name: 'Status von #2 ändern' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: /Status von #2/ })).not.toBeInTheDocument();
    expect(api.writes).toHaveLength(0);
  });

  it('moves a ticket by dragging its card to another column', async () => {
    const api = installApi([work]);
    renderAt('/tickets', manager);
    const card = await screen.findByRole('article', { name: '#2 Layout bauen' });
    const target = screen.getByRole('region', { name: 'Fertig' });
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
    fireEvent(card, Object.assign(createEvent.dragStart(card), { dataTransfer }));
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({ path: '/tickets/t-work/status', body: { version: 3, status: 'done' } });
  });

  it('shows the refusal and reloads the board when a move is rejected', async () => {
    const api = installApi([work], { statusError: 409 });
    renderAt('/tickets', manager);
    const before = () => api.gets.filter((g) => g === '/tickets').length;
    await userEvent.click(await screen.findByRole('button', { name: 'Status von #2 ändern' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fertig' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('geändert');
    await waitFor(() => expect(before()).toBeGreaterThan(1));
  });

  it('filters by Bereich (picker), Typ (filter menu), Meine and text', async () => {
    const article = ticket({
      id: 't-art',
      number: 6,
      title: 'Lehrerumfrage',
      type: 'artikel',
      est_pages: 2,
      assignee: ref(reviewer),
    });
    installApi([todo, work, review, article]);
    const user = userEvent.setup();
    renderAt('/tickets', manager);
    await screen.findByText('Layout bauen');

    await pickArea(user, 'Layout', 'Alle Bereiche');
    expect(screen.queryByText('Fotos sichten')).not.toBeInTheDocument();
    expect(screen.getByText('Layout bauen')).toBeInTheDocument();
    await pickArea(user, 'Alle Bereiche', 'Layout');
    expect(screen.getByText('Fotos sichten')).toBeInTheDocument();

    await openFilter();
    await user.click(within(screen.getByRole('group', { name: 'Typ' })).getByRole('button', { name: 'Artikel' }));
    expect(screen.getByText('Lehrerumfrage')).toBeInTheDocument();
    expect(screen.queryByText('Layout bauen')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Alle Typen' }));

    await user.click(screen.getByRole('button', { name: 'Meine' }));
    expect(screen.getByText('Layout bauen')).toBeInTheDocument();
    expect(screen.queryByText('Lehrerumfrage')).not.toBeInTheDocument();
    expect(screen.queryByText('Fotos sichten')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Meine' }));

    await user.type(screen.getByRole('searchbox', { name: 'Suche' }), '#6');
    expect(screen.getByText('Lehrerumfrage')).toBeInTheDocument();
    expect(screen.queryByText('Layout bauen')).not.toBeInTheDocument();
  });

  it('keeps Typ and finished filters in a Filter menu for managers but inline for admins', async () => {
    installApi([work]);
    const { unmount } = renderAt('/tickets', manager);
    await screen.findByText('Layout bauen');
    expect(screen.queryByLabelText('Abgeschlossene zeigen')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Typ' })).not.toBeInTheDocument();
    await openFilter();
    expect(screen.getByLabelText('Abgeschlossene zeigen')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Typ' })).toBeInTheDocument();
    unmount();

    renderAt('/tickets', admin);
    await screen.findByText('Layout bauen');
    expect(screen.queryByRole('button', { name: /^Filter/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Abgeschlossene zeigen')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Typ' })).toBeInTheDocument();
  });

  it('offers the Fertig help as a keyboard-reachable info button to admins only', async () => {
    installApi([work]);
    const { unmount } = renderAt('/tickets', manager);
    await screen.findByText('Layout bauen');
    expect(screen.queryByRole('button', { name: 'Hilfe: Fertig' })).not.toBeInTheDocument();
    unmount();

    renderAt('/tickets', admin);
    const hint = await screen.findByRole('button', { name: 'Hilfe: Fertig' });
    hint.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Status auf Fertig setzen und den Bereichsverantwortlichen schreiben.',
    );
  });
});

describe('area picker', () => {
  it('searches, selects with the keyboard and closes with Escape or an outside click', async () => {
    installApi([ticket({ status: 'todo' })]);
    const user = userEvent.setup();
    renderAt('/tickets/neu', manager);
    const trigger = await screen.findByRole('button', { name: 'Bereich' });
    expect(trigger).toHaveTextContent('Bitte wählen');

    await user.click(trigger);
    expect(
      within(screen.getByRole('listbox'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Redaktion', 'Layout']);
    await user.type(screen.getByRole('combobox', { name: 'Bereich suchen' }), 'lay');
    expect(
      within(screen.getByRole('listbox'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Layout']);
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveTextContent('Layout');

    await user.click(trigger);
    expect(screen.getByRole('option', { name: 'Layout' })).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{Enter}');
    expect(trigger).toHaveTextContent('Redaktion');

    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    await user.click(trigger);
    await user.click(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveTextContent('Redaktion');
  });
});

describe('ticket page review panel', () => {
  const reviewButton = () => screen.queryByRole('button', { name: 'Freigeben' });
  const selfConfirm = () =>
    screen.queryByLabelText('Ich nehme meine eigene Aufgabe selbst ab und trage die Verantwortung dafür');

  it('gives an assignee who is no reviewer no way to vote', async () => {
    installApi([ticket({ status: 'review', assignee: ref(manager) })]);
    renderAt('/tickets/ticket-1', manager);
    await screen.findByRole('heading', { name: /Angebote besorgen/ });
    expect(reviewButton()).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Änderungen nötig/ })).not.toBeInTheDocument();
    expect(selfConfirm()).not.toBeInTheDocument();
  });

  it('offers self approval only for a reviewer assignee on a small Aufgabe, and sends the confirmation', async () => {
    const api = installApi([ticket({ status: 'review', assignee: ref(reviewer), size: 'S', round: 4 })]);
    renderAt('/tickets/ticket-1', reviewer);
    const checkbox = await screen.findByLabelText(
      'Ich nehme meine eigene Aufgabe selbst ab und trage die Verantwortung dafür',
    );
    expect(checkbox).toHaveAccessibleDescription(/selbst abgenommen hast/);
    expect(screen.getByRole('button', { name: 'Freigeben' })).toBeDisabled();
    await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole('button', { name: 'Freigeben' }));
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({
      path: '/tickets/ticket-1/review',
      method: 'PUT',
      body: { verdict: 'approve', round: 4, self_confirmed: true },
    });
  });

  it.each([
    ['size M', { size: 'M' as const }],
    ['an Artikel', { type: 'artikel' as const, est_pages: 1, size: 'XS' as const }],
  ])('hides self approval for a reviewer assignee on %s', async (_name, change) => {
    installApi([ticket({ status: 'review', assignee: ref(reviewer), ...change })]);
    renderAt('/tickets/ticket-1', reviewer);
    await screen.findByRole('heading', { name: /Angebote besorgen/ });
    expect(selfConfirm()).not.toBeInTheDocument();
    expect(reviewButton()).not.toBeInTheDocument();
  });

  it('lets another manager vote, shows every vote with its verdict and marks only non-binding ones', async () => {
    const api = installApi([
      ticket({
        status: 'done',
        round: 4,
        reviews: [vote(reviewer, 'approve', true), vote(admin, 'changes', false)],
      }),
    ]);
    renderAt('/tickets/ticket-1', admin);
    const panel = (await screen.findByRole('heading', { name: 'Review' })).closest('section') as HTMLElement;
    expect(within(panel).getByText('nicht bindend')).toBeInTheDocument();
    expect(within(panel).queryByText(/^bindend$/i)).not.toBeInTheDocument();
    expect(within(panel).getByText(/Rita Review/)).toBeInTheDocument();
    expect(within(panel).getByRole('img', { name: 'Freigegeben' })).toBeInTheDocument();
    expect(within(panel).getByRole('img', { name: 'Änderungen nötig' })).toBeInTheDocument();
    expect(within(panel).getByText('Wartet auf Abnahme')).toBeInTheDocument();
    expect(selfConfirm()).not.toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: /Änderungen nötig/ }));
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({ method: 'PUT', body: { verdict: 'changes', round: 4 } });
    expect(api.writes[0].body).not.toHaveProperty('self_confirmed');
  });

  it('shows a German hint and reloads when the vote was cast for an outdated round', async () => {
    const api = installApi([ticket({ status: 'review', round: 2 })], { reviewError: 409 });
    renderAt('/tickets/ticket-1', admin);
    const loads = () => api.gets.filter((g) => g === '/tickets/ticket-1').length;
    await userEvent.click(await screen.findByRole('button', { name: 'Freigeben' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Das Ticket wurde inzwischen geändert. Bitte erneut prüfen.',
    );
    expect(api.writes[0].body).toMatchObject({ verdict: 'approve', round: 2 });
    await waitFor(() => expect(loads()).toBeGreaterThan(1));
  });

  it('offers no vote before the ticket reaches review', async () => {
    installApi([ticket({ status: 'in_progress', assignee: ref(reviewer) })]);
    renderAt('/tickets/ticket-1', admin);
    await screen.findByRole('heading', { name: /Angebote besorgen/ });
    expect(reviewButton()).not.toBeInTheDocument();
  });
});

describe('ticket page', () => {
  it('lets a manager claim an unassigned ticket with the help text on the button', async () => {
    const api = installApi([ticket({ status: 'todo', assignee: null })]);
    renderAt('/tickets/ticket-1', manager);
    const claim = await screen.findByRole('button', { name: /Übernehmen/ });
    expect(claim).toHaveAttribute('title', 'Dich selbst in Wer eintragen.');
    await userEvent.click(claim);
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({ path: '/tickets/ticket-1/claim', method: 'POST' });
  });

  it.each(['review', 'done'] as const)('does not offer to claim an unassigned ticket in %s', async (status) => {
    installApi([ticket({ status, assignee: null })]);
    renderAt('/tickets/ticket-1', manager);
    await screen.findByRole('heading', { name: /Angebote besorgen/ });
    expect(screen.queryByRole('button', { name: /Übernehmen/ })).not.toBeInTheDocument();
  });

  it('renders the timeline with markdown comments and posts a new comment only when it has content', async () => {
    const events: TicketEvent[] = [
      {
        id: 'e1',
        kind: 'comment',
        actor: ref(reviewer),
        body: 'Bitte **Vorlage** nutzen',
        detail: '',
        created_at: '2026-10-02T10:00:00Z',
      },
      {
        id: 'e2',
        kind: 'status',
        actor: ref(manager),
        body: '',
        detail: 'In Arbeit',
        created_at: '2026-10-02T11:00:00Z',
      },
    ];
    const api = installApi([ticket()], { events });
    renderAt('/tickets/ticket-1', manager);
    expect(await screen.findByText('Bitte **Vorlage** nutzen')).toBeInTheDocument();
    expect(screen.getByText(/hat den Status geändert/)).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Kommentieren' });
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByRole('textbox', { name: 'Kommentar' }), 'Erledigt');
    await userEvent.click(submit);
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({ path: '/tickets/ticket-1/comments', body: { body: 'Erledigt' } });
  });

  it('saves edits as a full TicketEdit that keeps the assignee and carries the version', async () => {
    const api = installApi([ticket()]);
    renderAt('/tickets/ticket-1', manager);
    await userEvent.click(await screen.findByRole('button', { name: /Bearbeiten/ }));
    const title = screen.getByLabelText('Titel');
    await userEvent.clear(title);
    await userEvent.type(title, 'Neue Angebote');
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({
      path: '/tickets/ticket-1',
      method: 'PATCH',
      body: {
        title: 'Neue Angebote',
        area_id: 'area-redaktion',
        assignee_id: 'manager-1',
        size: 'M',
        goal: '5 Angebote',
        est_pages: null,
        version: 3,
      },
    });
    expect(api.writes[0].body).not.toHaveProperty('type');
  });

  it('hides editing for a manager who neither owns the ticket nor reviews its Bereich', async () => {
    installApi([ticket({ assignee: ref(reviewer) })]);
    renderAt('/tickets/ticket-1', manager);
    await screen.findByRole('heading', { name: /Angebote besorgen/ });
    expect(screen.queryByRole('button', { name: /Bearbeiten/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();
  });
});

describe('ticket page state transitions', () => {
  it('moves through the stepper, marking earlier steps and the current one', async () => {
    const api = installApi([ticket({ status: 'review' })]);
    renderAt('/tickets/ticket-1', manager);
    const stepper = await screen.findByRole('group', { name: 'Status' });
    expect(within(stepper).getByRole('button', { name: 'Wartet auf Review' })).toHaveAttribute('aria-current', 'step');
    expect(within(stepper).getByRole('button', { name: 'Offen' })).not.toHaveAttribute('aria-current');
    await userEvent.click(within(stepper).getByRole('button', { name: 'Fertig' }));
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({
      path: '/tickets/ticket-1/status',
      method: 'POST',
      body: { version: 3, status: 'done' },
    });
  });

  it('offers the assignee "Zur Review geben" while the ticket is in progress', async () => {
    const api = installApi([ticket({ status: 'in_progress' })]);
    renderAt('/tickets/ticket-1', manager);
    await userEvent.click(await screen.findByRole('button', { name: /Zur Review geben/ }));
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({ path: '/tickets/ticket-1/status', body: { version: 3, status: 'review' } });
  });

  it.each(['todo', 'review'] as const)('does not offer "Zur Review geben" in %s', async (status) => {
    installApi([ticket({ status })]);
    renderAt('/tickets/ticket-1', manager);
    await screen.findByRole('heading', { name: /Angebote besorgen/ });
    expect(screen.queryByRole('button', { name: /Zur Review geben/ })).not.toBeInTheDocument();
  });

  it('shows a read-only status pill instead of the stepper to people who may not move the ticket', async () => {
    installApi([ticket({ assignee: ref(reviewer) })]);
    renderAt('/tickets/ticket-1', manager);
    await screen.findByRole('heading', { name: /Angebote besorgen/ });
    expect(screen.queryByRole('group', { name: 'Status' })).not.toBeInTheDocument();
    expect(screen.getByText('In Arbeit')).toBeInTheDocument();
  });

  it('renders status, assignment and review events compactly and falls back to the raw text', async () => {
    const at = (n: number) => '2026-10-02T1' + n + ':00:00Z';
    const events: TicketEvent[] = [
      { id: 'e1', kind: 'status', actor: ref(manager), body: '', detail: 'todo->review', created_at: at(1) },
      { id: 'e2', kind: 'status', actor: ref(manager), body: '', detail: 'kaputt', created_at: at(2) },
      { id: 'e3', kind: 'assign', actor: ref(manager), body: '', detail: 'niemand -> Mona Manager', created_at: at(3) },
      { id: 'e4', kind: 'review', actor: ref(reviewer), body: '', detail: 'changes:binding', created_at: at(4) },
    ];
    installApi([ticket()], { events });
    renderAt('/tickets/ticket-1', manager);
    const section = (await screen.findByRole('heading', { name: 'Aktivität' })).closest('section') as HTMLElement;
    await userEvent.click(within(section).getByRole('button', { name: /1 Änderung seit/ }));
    const items = within(section).getAllByRole('listitem');
    expect(within(items[0]).getByText('Offen')).toBeInTheDocument();
    expect(within(items[0]).getByText('Wartet auf Review')).toBeInTheDocument();
    expect(items[0]).not.toHaveTextContent('hat den Status geändert');
    expect(items[1]).toHaveTextContent('hat den Status geändert: kaputt');
    expect(within(items[2]).getByText('niemand')).toBeInTheDocument();
    expect(within(items[2]).getByText('Mona Manager', { selector: 'span' })).toBeInTheDocument();
    expect(items[3]).toHaveTextContent('Änderungen nötig');
    expect(items[3]).not.toHaveTextContent('changes');
  });
});

describe('ticket page activity', () => {
  it('shows only the latest three entries and summarizes the older ones until expanded', async () => {
    const events: TicketEvent[] = [1, 2, 3, 4, 5].map((n) => ({
      id: 'e' + n,
      kind: 'comment',
      actor: ref(manager),
      body: 'Kommentar ' + n,
      detail: '',
      created_at: '2026-12-0' + n + 'T11:30:00Z',
    }));
    installApi([ticket()], { events });
    renderAt('/tickets/ticket-1', manager);
    const section = (await screen.findByRole('heading', { name: 'Aktivität' })).closest('section') as HTMLElement;
    const summary = within(section).getByRole('button', { name: /^2 Änderungen seit / });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(summary).toHaveTextContent(
      new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(events[0]!.created_at)),
    );
    expect(within(section).getAllByRole('listitem')).toHaveLength(3);
    expect(within(section).queryByText('Kommentar 1')).not.toBeInTheDocument();
    await userEvent.click(summary);
    expect(within(section).getAllByRole('listitem')).toHaveLength(5);
    await userEvent.click(within(section).getByRole('button', { name: 'Ältere Änderungen ausblenden' }));
    expect(within(section).getAllByRole('listitem')).toHaveLength(3);
  });
});

describe('ticket page decluttering', () => {
  it('shows the Runde only to admins and no info hints in the read-only details', async () => {
    installApi([ticket({ round: 4 })]);
    const { unmount } = renderAt('/tickets/ticket-1', manager);
    await screen.findByRole('heading', { name: /Angebote besorgen/ });
    expect(screen.queryByText('Runde')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Hilfe:/ })).not.toBeInTheDocument();
    unmount();

    renderAt('/tickets/ticket-1', admin);
    expect(await screen.findByText('Runde')).toBeInTheDocument();
  });
});

describe('new ticket', () => {
  it('prefills Bereich and creates the ticket in the status of the "+ Neu" column', async () => {
    const api = installApi([]);
    const user = userEvent.setup();
    renderAt('/tickets/neu?bereich=area-layout&status=review', manager);
    await user.type(await screen.findByLabelText('Titel'), 'Seiten gestalten');
    expect(screen.getByRole('button', { name: 'Bereich' })).toHaveTextContent('Layout');
    await user.selectOptions(screen.getByLabelText('Größe'), 'S');
    await user.type(screen.getByLabelText('Zieldefinition'), '10 Seiten');
    await user.click(screen.getByRole('button', { name: 'Ticket anlegen' }));
    await waitFor(() => expect(api.writes).toHaveLength(2));
    expect(api.writes[0]).toMatchObject({ path: '/tickets', body: { area_id: 'area-layout' } });
    expect(api.writes[1]).toMatchObject({
      path: '/tickets/created-1/status',
      method: 'POST',
      body: { version: 3, status: 'review' },
    });
  });

  it('ignores unknown Bereich and status parameters and starts in todo', async () => {
    const api = installApi([]);
    const user = userEvent.setup();
    renderAt('/tickets/neu?bereich=nope&status=bogus', manager);
    await user.type(await screen.findByLabelText('Titel'), 'Sponsoren');
    expect(screen.getByRole('button', { name: 'Bereich' })).toHaveTextContent('Bitte wählen');
    await pickArea(user, 'Redaktion');
    await user.selectOptions(screen.getByLabelText('Größe'), 'S');
    await user.type(screen.getByLabelText('Zieldefinition'), 'Ziel');
    await user.click(screen.getByRole('button', { name: 'Ticket anlegen' }));
    await waitFor(() => expect(api.writes).toHaveLength(2));
    expect(api.writes[0].path).toBe('/tickets');
    expect(api.writes[1]).toMatchObject({ path: '/tickets/created-1/status', body: { status: 'todo' } });
  });

  async function createFrom(query: string) {
    const api = installApi([]);
    const user = userEvent.setup();
    renderAt('/tickets/neu?' + query, manager);
    await user.type(await screen.findByLabelText('Titel'), 'Sponsoren');
    await user.selectOptions(screen.getByLabelText('Größe'), 'S');
    await user.type(screen.getByLabelText('Zieldefinition'), 'Ziel');
    await user.click(screen.getByRole('button', { name: 'Ticket anlegen' }));
    return api;
  }

  it('moves a self-assigned ticket back to todo when created from the Offen column', async () => {
    const api = await createFrom('bereich=area-redaktion&status=todo');
    await waitFor(() => expect(api.writes).toHaveLength(2));
    expect(api.writes[1]).toMatchObject({ path: '/tickets/created-1/status', body: { version: 3, status: 'todo' } });
  });

  it('sends no extra status move when the created ticket already is in the requested column', async () => {
    const api = await createFrom('bereich=area-redaktion&status=in_progress');
    await waitFor(() => expect(api.writes).toHaveLength(1));
    // Give a wrongly sent second request the chance to show up.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.writes).toHaveLength(1);
  });

  async function fill(user: ReturnType<typeof userEvent.setup>, size?: string, goal?: string) {
    await user.type(await screen.findByLabelText('Titel'), 'Sponsoren anfragen');
    await pickArea(user, 'Redaktion');
    if (size) await user.selectOptions(screen.getByLabelText('Größe'), size);
    if (goal) await user.type(screen.getByLabelText('Zieldefinition'), goal);
  }

  it('requires size and goal and sends nothing while they are missing', async () => {
    const api = installApi([]);
    const user = userEvent.setup();
    renderAt('/tickets/neu', manager);
    await fill(user);
    await user.click(screen.getByRole('button', { name: 'Ticket anlegen' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Bitte eine Größe wählen.');
    expect(alert).toHaveTextContent('Bitte eine Zieldefinition eintragen.');
    expect(api.writes).toHaveLength(0);
  });

  it('requires an estimated page count of at least one for an Artikel', async () => {
    const api = installApi([]);
    const user = userEvent.setup();
    renderAt('/tickets/neu', manager);
    await user.click(await screen.findByLabelText('Artikel'));
    await fill(user, 'M', '1 Seite Text');
    await user.click(screen.getByRole('button', { name: 'Ticket anlegen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Seitenzahl');
    await user.type(screen.getByLabelText('Seiten'), '0');
    await user.click(screen.getByRole('button', { name: 'Ticket anlegen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Seitenzahl');
    expect(api.writes).toHaveLength(0);
    await user.clear(screen.getByLabelText('Seiten'));
    await user.type(screen.getByLabelText('Seiten'), '2');
    await user.click(screen.getByRole('button', { name: 'Ticket anlegen' }));
    await waitFor(() => expect(api.writes).toHaveLength(2)); // create, then the move to todo
    expect(api.writes[0].body).toMatchObject({ type: 'artikel', est_pages: 2, size: 'M', area_id: 'area-redaktion' });
  });

  it('creates an Aufgabe assigned to the manager with the template body and no page count', async () => {
    const api = installApi([]);
    const user = userEvent.setup();
    renderAt('/tickets/neu', manager);
    await fill(user, 'S', '5 Angebote');
    expect(screen.queryByLabelText('Seiten')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ticket anlegen' }));
    await waitFor(() => expect(api.writes).toHaveLength(2));
    expect(api.writes[0]).toMatchObject({ path: '/tickets', method: 'POST' });
    expect(api.writes[0].body).toMatchObject({
      type: 'aufgabe',
      title: 'Sponsoren anfragen',
      assignee_id: 'manager-1',
      est_pages: null,
      goal: '5 Angebote',
    });
    expect(String(api.writes[0].body.body)).toContain('Ergebnis wird abgelegt in:');
  });

  it('lets only area reviewers and admins leave the ticket unassigned', async () => {
    installApi([]);
    const user = userEvent.setup();
    const { unmount } = renderAt('/tickets/neu', manager);
    await screen.findByLabelText('Titel');
    await pickArea(user, 'Redaktion');
    expect(
      within(screen.getByLabelText('Wer'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Ich (Mona Manager)']);
    unmount();

    renderAt('/tickets/neu', reviewer);
    await screen.findByLabelText('Titel');
    await pickArea(user, 'Redaktion');
    const names = within(screen.getByLabelText('Wer'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(names).toContain('Unbesetzt');
    expect(names).toContain('Ich (Rita Review)');
  });

  it('shows the Notion checklist text for the Zieldefinition', async () => {
    installApi([]);
    renderAt('/tickets/neu', manager);
    (await screen.findByRole('button', { name: 'Hilfe: Zieldefinition' })).focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Muss messbar sein (begrenzte Anzahl statt offener Aufgabe, z. B. 5 Angebote besorgen statt mehrere) und innerhalb einer Arbeitsphase (zwei Wochen) erfüllbar sein, sonst in Unteraufgaben teilen.',
    );
  });
});

describe('ticket board permissions and drag', () => {
  const mine = ticket({ id: 't-mine', number: 1, title: 'Meins', status: 'todo' });
  const foreign = ticket({ id: 't-foreign', number: 2, title: 'Fremdes', status: 'todo', assignee: ref(reviewer) });
  const layout = ticket({
    id: 't-layout',
    number: 3,
    title: 'Layout bauen',
    status: 'todo',
    area_id: 'area-layout',
    area_name: 'Layout',
  });

  it('offers status changes and dragging only to the assignee, area reviewers and admins', async () => {
    installApi([mine, foreign]);
    const { unmount } = renderAt('/tickets', manager);
    const own = await screen.findByRole('article', { name: '#1 Meins' });
    const other = screen.getByRole('article', { name: '#2 Fremdes' });
    expect(own).toHaveAttribute('draggable', 'true');
    expect(within(own).getByRole('button', { name: 'Status von #1 ändern' })).toBeInTheDocument();
    expect(other).toHaveAttribute('draggable', 'false');
    expect(within(other).queryByRole('button', { name: /Status von/ })).not.toBeInTheDocument();
    expect(within(other).getByText('Offen')).toBeInTheDocument();
    unmount();

    for (const person of [reviewer, admin]) {
      const view = renderAt('/tickets', person);
      const card = await screen.findByRole('article', { name: '#1 Meins' });
      expect(card).toHaveAttribute('draggable', 'true');
      expect(within(card).getByRole('button', { name: 'Status von #1 ändern' })).toBeInTheDocument();
      view.unmount();
    }
  });

  it('refuses drops into another Bereich and does not send a status move', async () => {
    const api = installApi([mine, layout, ticket({ ...layout, id: 't-layout-2', number: 4, assignee: ref(manager) })]);
    renderAt('/tickets', manager);
    const card = await screen.findByRole('article', { name: '#4 Layout bauen' });
    const own = within(screen.getByRole('region', { name: 'Bereich Layout' }));
    const foreignColumn = within(screen.getByRole('region', { name: 'Bereich Redaktion' })).getByRole('region', {
      name: 'Fertig',
    });
    const sameColumn = own.getByRole('region', { name: 'Fertig' });
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' };
    fireEvent(card, Object.assign(createEvent.dragStart(card), { dataTransfer }));
    expect(fireEvent.dragOver(foreignColumn)).toBe(true); // not cancelled: no drop target
    fireEvent.drop(foreignColumn);
    expect(api.writes).toHaveLength(0);
    fireEvent(card, Object.assign(createEvent.dragStart(card), { dataTransfer }));
    expect(fireEvent.dragOver(sameColumn)).toBe(false); // cancelled: valid drop target
    fireEvent.drop(sameColumn);
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({ path: '/tickets/t-layout-2/status', body: { status: 'done' } });
  });

  it('keeps focus inside the status sheet: first option focused, Tab and Shift+Tab wrap', async () => {
    installApi([mine]);
    const user = userEvent.setup();
    renderAt('/tickets', manager);
    await user.click(await screen.findByRole('button', { name: 'Status von #1 ändern' }));
    const sheet = screen.getByRole('dialog', { name: 'Status von #1 wählen' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    const options = within(sheet).getAllByRole('button');
    expect(options[0]).toHaveFocus();
    await user.tab({ shift: true });
    expect(options[options.length - 1]).toHaveFocus();
    await user.tab();
    expect(options[0]).toHaveFocus();
  });

  it('closes the area picker when focus leaves it', async () => {
    installApi([mine]);
    const user = userEvent.setup();
    renderAt('/tickets/neu', manager);
    await user.click(await screen.findByRole('button', { name: 'Bereich' }));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.tab();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});

describe('ticket edit versions', () => {
  it('sends the version the edit started from, even when a refetch brought a newer one', async () => {
    const current = ticket({ version: 3 });
    const api = installApi([current]);
    renderAt('/tickets/ticket-1', manager);
    await userEvent.click(await screen.findByRole('button', { name: /Bearbeiten/ }));
    // Someone else saves meanwhile; the open page refetches.
    current.version = 4;
    const loads = () => api.gets.filter((g) => g === '/tickets/ticket-1').length;
    const before = loads();
    window.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(loads()).toBeGreaterThan(before));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({ method: 'PATCH', body: { version: 3 } });
  });

  it('shows the conflict hint and stays in the form when the save is rejected', async () => {
    const api = installApi([ticket()], { patchError: 409 });
    renderAt('/tickets/ticket-1', manager);
    await userEvent.click(await screen.findByRole('button', { name: /Bearbeiten/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent('inzwischen geändert');
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument();
    expect(api.writes).toHaveLength(1);
  });
});
