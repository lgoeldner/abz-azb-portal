import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Area, Me, Ticket, TicketDetail, TicketEvent } from './api';
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
    assignees: [ref(manager)],
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
          ticket({
            id: 'created-1',
            ...(body as Partial<Ticket>),
            status: (body.assignee_ids as string[]).length ? 'in_progress' : 'todo',
          }),
        );
      return Response.json(tickets[0] ?? {});
    }
    gets.push(path + url.search);
    if (path === '/areas') return Response.json(areas);
    if (path === '/tickets/people') return Response.json([ref(admin), ref(manager), ref(reviewer)]);
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
async function pickArea(user: ReturnType<typeof userEvent.setup>, name: string, picker = 'Bereich') {
  await user.click(screen.getByRole('button', { name: picker }));
  await user.click(await screen.findByRole('option', { name }));
}

describe('ticket board', () => {
  const work = ticket({
    id: 't-work',
    number: 2,
    title: 'Layout bauen',
    status: 'in_progress',
    area_id: 'area-layout',
    area_name: 'Layout',
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

  it('shows the refusal and reloads the board when a move is rejected', async () => {
    const api = installApi([work], { statusError: 409 });
    renderAt('/tickets', manager);
    const before = () => api.gets.filter((g) => g === '/tickets').length;
    await userEvent.click(await screen.findByRole('button', { name: 'Status von #2 ändern' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Fertig' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('geändert');
    await waitFor(() => expect(before()).toBeGreaterThan(1));
  });
});

describe('ticket page review panel', () => {
  it('offers self approval only for a reviewer assignee on a small Aufgabe, and sends the confirmation', async () => {
    const api = installApi([ticket({ status: 'review', assignees: [ref(reviewer)], size: 'S', round: 4 })]);
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
});

describe('ticket page', () => {
  it('saves edits as a full TicketEdit that keeps the assignee and carries the version', async () => {
    const api = installApi([ticket()]);
    renderAt('/tickets/ticket-1', reviewer);
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
        assignee_ids: ['manager-1'],
        size: 'M',
        goal: '5 Angebote',
        est_pages: null,
        version: 3,
      },
    });
    expect(api.writes[0].body).not.toHaveProperty('type');
  });

  it('lets a plain assignee change only who works on an open ticket', async () => {
    const api = installApi([ticket()]);
    const user = userEvent.setup();
    renderAt('/tickets/ticket-1', manager);
    await user.click(await screen.findByRole('button', { name: /Wer ändern/ }));
    expect(screen.queryByRole('button', { name: /Bearbeiten/ })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('checkbox', { name: /Ada Admin/ }));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({
      method: 'PATCH',
      body: { title: 'Angebote besorgen', assignee_ids: ['manager-1', 'admin-1'], size: 'M', version: 3 },
    });
  });

  it('saves Wer against the version the picker opened with', async () => {
    const current = ticket({ version: 3 });
    const api = installApi([current]);
    const user = userEvent.setup();
    renderAt('/tickets/ticket-1', manager);
    await user.click(await screen.findByRole('button', { name: /Wer ändern/ }));
    current.version = 4;
    const loads = () => api.gets.filter((g) => g === '/tickets/ticket-1').length;
    const before = loads();
    window.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(loads()).toBeGreaterThan(before));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(api.writes).toHaveLength(1));
    expect(api.writes[0]).toMatchObject({ method: 'PATCH', body: { version: 3 } });
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
});

describe('ticket edit versions', () => {
  it('sends the version the edit started from, even when a refetch brought a newer one', async () => {
    const current = ticket({ version: 3 });
    const api = installApi([current]);
    renderAt('/tickets/ticket-1', reviewer);
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
    renderAt('/tickets/ticket-1', reviewer);
    await userEvent.click(await screen.findByRole('button', { name: /Bearbeiten/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Speichern' }));
    expect((await screen.findAllByRole('alert'))[0]).toHaveTextContent('inzwischen geändert');
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeInTheDocument();
    expect(api.writes).toHaveLength(1);
  });
});
