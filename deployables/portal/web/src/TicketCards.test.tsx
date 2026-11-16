import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Area, Me, Ticket } from './api';
import { PAGE_TARGET, STALE_AFTER_DAYS, TicketCards, summarizeTickets } from './TicketCards';

const DAY = 86_400_000;
const NOW = Date.parse('2026-11-16T12:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const viewerId = 'mona';

const area = (id: string, reviewerIds: string[]): Area => ({
  id,
  name: `Bereich ${id}`,
  position: 1,
  version: 1,
  reviewers: reviewerIds.map((r) => ({ id: r, name: r })),
});
const areaA = area('area-a', [viewerId]);
const areaB = area('area-b', ['someone-else']);

function ticket(overrides: Partial<Ticket> & Pick<Ticket, 'id'>): Ticket {
  return {
    number: 1,
    type: 'aufgabe',
    title: 'Ticket',
    body: '',
    area_id: areaA.id,
    area_name: areaA.name,
    assignee: null,
    created_by: { id: 'creator', name: 'Creator' },
    size: 'M',
    goal: 'Ziel',
    est_pages: null,
    status: 'todo',
    round: 1,
    version: 1,
    approved: false,
    reviews: [],
    created_at: iso(NOW - 30 * DAY),
    updated_at: iso(NOW - DAY),
    status_changed_at: iso(NOW - DAY),
    ...overrides,
  };
}
const me = {
  id: 'x',
  name: 'x',
  role: 'manager' as const,
  admitted: true,
  cohort_member: true,
  category_ids: [],
  created_at: iso(0),
};

describe('summarizeTickets', () => {
  it('counts pages approved against planned articles and ignores tasks', () => {
    const tickets = [
      ticket({ id: '1', type: 'artikel', est_pages: 30, status: 'done', approved: true }),
      ticket({ id: '2', type: 'artikel', est_pages: 20, status: 'done', approved: true }),
      ticket({ id: '3', type: 'artikel', est_pages: 15, status: 'done', approved: false }),
      ticket({ id: '4', type: 'artikel', est_pages: 10, status: 'in_progress' }),
      ticket({ id: '5', type: 'aufgabe', est_pages: null, status: 'done', approved: true }),
    ];
    const s = summarizeTickets(tickets, [areaA], viewerId, false, NOW);
    expect(s.pagesDone).toBe(50);
    expect(s.pagesPlanned).toBe(25);
    expect(PAGE_TARGET).toBe(100);
  });

  it('marks an assigned ticket stale only when older than seven days', () => {
    const at = (age: number) => ticket({ id: 'a', assignee: { id: 'x', name: 'Xaver' }, updated_at: iso(NOW - age) });
    const boundary = summarizeTickets([at(STALE_AFTER_DAYS * DAY)], [areaA], viewerId, false, NOW);
    expect(boundary.asleep).toHaveLength(0);
    const justOver = summarizeTickets([at(STALE_AFTER_DAYS * DAY + 60_000)], [areaA], viewerId, false, NOW);
    expect(justOver.asleep).toHaveLength(1);
    expect(justOver.asleep[0].days).toBe(7);
  });

  it('never lists unassigned, approved, or recently changed tickets as asleep', () => {
    const old = iso(NOW - 30 * DAY);
    const s = summarizeTickets(
      [
        ticket({ id: 'u', updated_at: old }),
        ticket({ id: 'f', assignee: { id: 'x', name: 'X' }, status: 'done', approved: true, updated_at: old }),
        ticket({ id: 'r', assignee: { id: 'x', name: 'X' }, updated_at: iso(NOW - DAY) }),
      ],
      [areaA],
      viewerId,
      false,
      NOW,
    );
    expect(s.asleep).toHaveLength(0);
  });

  it('shows waiting tickets only for areas the viewer reviews and never own tickets', () => {
    const tickets = [
      ticket({ id: 'mine-in-review', area_id: areaA.id, status: 'review', assignee: { id: viewerId, name: 'Mona' } }),
      ticket({ id: 'in-my-area', area_id: areaA.id, status: 'review', assignee: { id: 'x', name: 'X' } }),
      ticket({ id: 'other-area', area_id: areaB.id, status: 'review', assignee: { id: 'x', name: 'X' } }),
      ticket({ id: 'done-unapproved', area_id: areaA.id, status: 'done', assignee: { id: 'x', name: 'X' } }),
      ticket({
        id: 'done-approved',
        area_id: areaA.id,
        status: 'done',
        approved: true,
        assignee: { id: 'x', name: 'X' },
      }),
    ];
    const s = summarizeTickets(tickets, [areaA, areaB], viewerId, false, NOW);
    expect(s.canReview).toBe(true);
    expect(s.waiting.map((t) => t.id).sort()).toEqual(['done-unapproved', 'in-my-area']);
  });

  it('gives a manager who reviews no area an empty waiting list', () => {
    const s = summarizeTickets(
      [ticket({ id: 'w', area_id: areaB.id, status: 'review', assignee: { id: 'x', name: 'X' } })],
      [areaB],
      viewerId,
      false,
      NOW,
    );
    expect(s.canReview).toBe(false);
    expect(s.waiting).toHaveLength(0);
  });

  it('lets an admin see waiting tickets of every area, but not their own', () => {
    const tickets = [
      ticket({ id: 'b', area_id: areaB.id, status: 'review', assignee: { id: 'x', name: 'X' } }),
      ticket({ id: 'own', area_id: areaB.id, status: 'review', assignee: { id: viewerId, name: 'Mona' } }),
    ];
    const s = summarizeTickets(tickets, [areaB], viewerId, true, NOW);
    expect(s.canReview).toBe(true);
    expect(s.waiting.map((t) => t.id)).toEqual(['b']);
  });

  it('lists only open tickets assigned to the viewer', () => {
    const tickets = [
      ticket({ id: 'open', assignee: { id: viewerId, name: 'Mona' } }),
      ticket({ id: 'done', assignee: { id: viewerId, name: 'Mona' }, status: 'done', approved: true }),
      ticket({ id: 'other', assignee: { id: 'x', name: 'X' } }),
    ];
    expect(summarizeTickets(tickets, [areaA], viewerId, false, NOW).mine.map((t) => t.id)).toEqual(['open']);
  });
});

function renderCards(tickets: Response, areas: Response, viewer = me) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith('/api/v1/tickets')) return tickets.clone();
      if (url === '/api/v1/areas') return areas.clone();
      throw new Error(`unexpected ${url}`);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user: Me = { user: viewer, consent_required: false, csrf_token: 'x' };
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TicketCards user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('TicketCards', () => {
  it('hides the waiting card for a manager who reviews no area', async () => {
    const tickets = [ticket({ id: 't-3', number: 3, title: 'Mein Ticket', assignee: { id: viewerId, name: 'Mona' } })];
    renderCards(Response.json(tickets), Response.json([areaB]), { ...me, id: viewerId });
    expect(await screen.findByRole('link', { name: /Mein Ticket/ })).toHaveAttribute('href', '/tickets/t-3');
    expect(screen.queryByRole('heading', { name: 'Wartet auf deine Abnahme' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Seiten fertig' })).toBeInTheDocument();
  });

  it('shows the waiting card for a reviewer', async () => {
    const tickets = [
      ticket({ id: 'w', title: 'Zur Abnahme', area_id: areaA.id, status: 'review', assignee: { id: 'x', name: 'X' } }),
    ];
    renderCards(Response.json(tickets), Response.json([areaA]), { ...me, id: viewerId });
    expect(await screen.findByRole('link', { name: /Zur Abnahme/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Wartet auf deine Abnahme' })).toBeInTheDocument();
  });

  it('shows a failure with retry when the tickets cannot be loaded', async () => {
    renderCards(Response.json({ error: { code: 'boom', message: 'Kaputt' } }, { status: 500 }), Response.json([areaA]));
    const alerts = await screen.findAllByRole('alert');
    expect(alerts.length).toBeGreaterThan(0);
    alerts.forEach((alert) => expect(alert).toHaveTextContent('Das hat noch nicht geklappt.'));
  });
});
