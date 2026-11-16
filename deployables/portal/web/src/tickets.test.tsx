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
  options: { events?: TicketEvent[]; statusError?: number; reviewError?: number } = {},
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
      if (path === '/tickets') return Response.json(ticket({ id: 'created-1', ...(body as Partial<Ticket>) }));
      return Response.json(tickets[0]);
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

  it('puts every ticket into its status column and keeps finished tickets behind the toggle', async () => {
    const api = installApi([todo, work, review, waiting, approved]);
    renderAt('/tickets', manager);
    for (const [column, title] of [
      ['TODO', 'Fotos sichten'],
      ['In Arbeit', 'Layout bauen'],
      ['Wartet auf Review', 'Steckbriefe'],
      ['Fertig', 'Abizeitung drucken'],
    ]) {
      const section = await screen.findByRole('region', { name: column });
      expect(within(section).getByText(title)).toBeInTheDocument();
    }
    expect(screen.queryByText('Cover entwerfen')).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Abgeschlossene zeigen'));
    expect(await screen.findByText('Cover entwerfen')).toBeInTheDocument();
    expect(api.gets).toContain('/tickets?include_finished=true');
  });

  it('distinguishes waiting for approval from approved', async () => {
    installApi([waiting, approved]);
    renderAt('/tickets', manager);
    await userEvent.click(await screen.findByLabelText('Abgeschlossene zeigen'));
    const cardWaiting = await screen.findByRole('article', { name: '#4 Abizeitung drucken' });
    const cardApproved = await screen.findByRole('article', { name: '#5 Cover entwerfen' });
    expect(within(cardWaiting).getByText('Wartet auf Abnahme')).toBeInTheDocument();
    expect(within(cardWaiting).queryByText('Abgenommen')).not.toBeInTheDocument();
    expect(within(cardApproved).getByText('Abgenommen')).toBeInTheDocument();
    expect(within(cardApproved).queryByText('Wartet auf Abnahme')).not.toBeInTheDocument();
  });

  it('moves a ticket with the status select and sends the current version', async () => {
    const api = installApi([work]);
    renderAt('/tickets', manager);
    await userEvent.selectOptions(await screen.findByLabelText('Status von #2'), 'review');
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({
      path: '/tickets/t-work/status',
      method: 'POST',
      body: { version: 3, status: 'review' },
    });
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
    await userEvent.selectOptions(await screen.findByLabelText('Status von #2'), 'done');
    expect(await screen.findByRole('alert')).toHaveTextContent('geändert');
    await waitFor(() => expect(before()).toBeGreaterThan(1));
  });

  it('filters by Bereich, Typ, Meine and text', async () => {
    const article = ticket({
      id: 't-art',
      number: 6,
      title: 'Lehrerumfrage',
      type: 'artikel',
      est_pages: 2,
      assignee: ref(reviewer),
    });
    installApi([todo, work, review, article]);
    renderAt('/tickets', manager);
    await screen.findByText('Layout bauen');

    await userEvent.click(
      within(screen.getByRole('group', { name: 'Bereich' })).getByRole('button', { name: 'Layout' }),
    );
    expect(screen.queryByText('Fotos sichten')).not.toBeInTheDocument();
    expect(screen.getByText('Layout bauen')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Alle Bereiche' }));

    await userEvent.click(within(screen.getByRole('group', { name: 'Typ' })).getByRole('button', { name: 'Artikel' }));
    expect(screen.getByText('Lehrerumfrage')).toBeInTheDocument();
    expect(screen.queryByText('Layout bauen')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Alle Typen' }));

    await userEvent.click(screen.getByRole('button', { name: 'Meine' }));
    expect(screen.getByText('Layout bauen')).toBeInTheDocument();
    expect(screen.queryByText('Lehrerumfrage')).not.toBeInTheDocument();
    expect(screen.queryByText('Fotos sichten')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Meine' }));

    await userEvent.type(screen.getByRole('searchbox', { name: 'Suche' }), '#6');
    expect(screen.getByText('Lehrerumfrage')).toBeInTheDocument();
    expect(screen.queryByText('Layout bauen')).not.toBeInTheDocument();
  });

  it('offers the Fertig help as a keyboard-reachable info button', async () => {
    installApi([work]);
    renderAt('/tickets', manager);
    const hint = await screen.findByRole('button', { name: 'Hilfe: Fertig' });
    hint.focus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'Status auf Fertig setzen und den Bereichsverantwortlichen schreiben.',
    );
  });
});

describe('ticket page review panel', () => {
  const reviewButton = () => screen.queryByRole('button', { name: 'Freigeben' });
  const selfConfirm = () => screen.queryByLabelText('Ich bestätige: Das Ergebnis ist für niemand anderen relevant');

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
    const checkbox = await screen.findByLabelText('Ich bestätige: Das Ergebnis ist für niemand anderen relevant');
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

  it('lets another manager vote, shows every vote and labels binding and non-binding', async () => {
    const api = installApi([
      ticket({
        status: 'done',
        round: 4,
        reviews: [vote(reviewer, 'approve', true), vote(admin, 'changes', false)],
      }),
    ]);
    renderAt('/tickets/ticket-1', admin);
    const panel = (await screen.findByRole('heading', { name: 'Review' })).closest('section') as HTMLElement;
    expect(within(panel).getByText('Bindend')).toBeInTheDocument();
    expect(within(panel).getByText('Nicht bindend')).toBeInTheDocument();
    expect(within(panel).getByText(/Rita Review/)).toBeInTheDocument();
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

describe('new ticket', () => {
  async function fill(user: ReturnType<typeof userEvent.setup>, size?: string, goal?: string) {
    await user.type(await screen.findByLabelText('Titel'), 'Sponsoren anfragen');
    await user.selectOptions(screen.getByLabelText('Bereich'), 'Redaktion');
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
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0].body).toMatchObject({ type: 'artikel', est_pages: 2, size: 'M', area_id: 'area-redaktion' });
  });

  it('creates an Aufgabe assigned to the manager with the template body and no page count', async () => {
    const api = installApi([]);
    const user = userEvent.setup();
    renderAt('/tickets/neu', manager);
    await fill(user, 'S', '5 Angebote');
    expect(screen.queryByLabelText('Seiten')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ticket anlegen' }));
    await waitFor(() => expect(api.writes).toHaveLength(1));
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
    await user.selectOptions(await screen.findByLabelText('Bereich'), 'Redaktion');
    expect(
      within(screen.getByLabelText('Wer'))
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Ich (Mona Manager)']);
    unmount();

    renderAt('/tickets/neu', reviewer);
    await user.selectOptions(await screen.findByLabelText('Bereich'), 'Redaktion');
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
