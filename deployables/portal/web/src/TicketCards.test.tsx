import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Area, Me, Ticket } from './api';
import { MyTasks } from './TicketCards';

const iso = (ms: number) => new Date(ms).toISOString();
const NOW = Date.parse('2026-11-16T12:00:00Z');
const viewerId = 'mona';

const area = (id: string, position: number, reviewerIds: string[]): Area => ({
  id,
  name: `Bereich ${id}`,
  position,
  version: 1,
  reviewers: reviewerIds.map((r) => ({ id: r, name: r })),
});
const areaA = area('area-a', 1, [viewerId]);
const areaB = area('area-b', 2, ['someone-else']);
const mona = { id: viewerId, name: 'Mona' };
const other = { id: 'x', name: 'X' };

function ticket(overrides: Partial<Ticket> & Pick<Ticket, 'id'>): Ticket {
  return {
    number: 1,
    comment_count: 0,
    type: 'aufgabe',
    title: overrides.id,
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
    created_at: iso(NOW - 30 * 86_400_000),
    updated_at: iso(NOW),
    status_changed_at: iso(NOW),
    ...overrides,
  };
}

const viewer = {
  id: viewerId,
  name: 'Mona',
  role: 'manager' as const,
  admitted: true,
  cohort_member: true,
  category_ids: [],
  created_at: iso(0),
};

function renderTasks(tickets: Ticket[] | Response, areas: Area[], who: Me['user'] = viewer) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/v1/tickets') return tickets instanceof Response ? tickets.clone() : Response.json(tickets);
      if (url === '/api/v1/areas') return Response.json(areas);
      throw new Error(`unexpected ${url}`);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user: Me = { user: who, consent_required: false, csrf_token: 'x' };
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MyTasks user={user} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const titles = () => screen.getAllByRole('link').map((a) => a.textContent ?? '');

describe('MyTasks', () => {
  it('lists my unfinished tickets as review, in progress, todo, then done awaiting approval', async () => {
    renderTasks(
      [
        ticket({ id: 'p-done', status: 'done', assignee: mona }),
        ticket({ id: 'p-todo', status: 'todo', assignee: mona }),
        ticket({ id: 'p-review', status: 'review', assignee: mona }),
        ticket({ id: 'p-work', status: 'in_progress', assignee: mona }),
      ],
      [areaB],
    );
    await screen.findByRole('link', { name: /p-review/ });
    const order = titles().filter((t) => t.startsWith('p-'));
    expect(order.findIndex((t) => t.includes('p-review'))).toBeLessThan(order.findIndex((t) => t.includes('p-work')));
    expect(order.findIndex((t) => t.includes('p-work'))).toBeLessThan(order.findIndex((t) => t.includes('p-todo')));
    expect(order.findIndex((t) => t.includes('p-todo'))).toBeLessThan(order.findIndex((t) => t.includes('p-done')));
  });

  it('links to the ticket and shows its area and status', async () => {
    renderTasks([ticket({ id: 't-1', title: 'Mein Ticket', status: 'in_progress', assignee: mona })], [areaA]);
    const link = await screen.findByRole('link', { name: /Mein Ticket/ });
    expect(link).toHaveAttribute('href', '/tickets/t-1');
    expect(link).toHaveTextContent('Bereich area-a');
    expect(link).toHaveTextContent('In Arbeit');
  });

  it('leaves out finished tickets and tickets of other people', async () => {
    renderTasks(
      [
        ticket({ id: 'open', title: 'Offen eins', assignee: mona }),
        ticket({ id: 'fin', title: 'Fertig eins', assignee: mona, status: 'done', approved: true }),
        ticket({ id: 'oth', title: 'Fremd eins', assignee: other }),
      ],
      [areaB],
    );
    await screen.findByRole('link', { name: /Offen eins/ });
    expect(screen.queryByText('Fertig eins')).not.toBeInTheDocument();
    expect(screen.queryByText('Fremd eins')).not.toBeInTheDocument();
  });

  it('shows what waits for approval only to reviewers, never their own tickets', async () => {
    const tickets = [
      ticket({ id: 'w1', title: 'In meinem Bereich', status: 'review', assignee: other }),
      ticket({ id: 'w2', title: 'Im anderen Bereich', status: 'review', assignee: other, area_id: areaB.id }),
      ticket({ id: 'w3', title: 'Mein eigenes', status: 'review', assignee: mona }),
    ];
    renderTasks(tickets, [areaA, areaB]);
    expect(await screen.findByRole('heading', { name: 'Wartet auf deine Freigabe' })).toBeInTheDocument();
    const section = screen.getByRole('heading', { name: 'Wartet auf deine Freigabe' }).parentElement!;
    expect(section).toHaveTextContent('In meinem Bereich');
    expect(section).not.toHaveTextContent('Im anderen Bereich');
    expect(section).not.toHaveTextContent('Mein eigenes');
  });

  it('hides the waiting list for a manager who reviews no area, shows all areas to an admin', async () => {
    const tickets = [ticket({ id: 'w', title: 'Wartet', status: 'review', assignee: other, area_id: areaB.id })];
    const { unmount } = renderTasks(tickets, [areaB]);
    await screen.findByText('Dir ist gerade nichts zugewiesen.');
    expect(screen.queryByRole('heading', { name: 'Wartet auf deine Freigabe' })).not.toBeInTheDocument();
    unmount();
    renderTasks(tickets, [areaB], { ...viewer, role: 'admin' });
    expect(await screen.findByRole('heading', { name: 'Wartet auf deine Freigabe' })).toBeInTheDocument();
  });

  it('shows six rows and a link for the rest', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ticket({ id: `m${i}`, title: `Aufgabe ${i}`, assignee: mona }));
    renderTasks(many, [areaB]);
    const more = await screen.findByRole('link', { name: 'und 2 weitere' });
    expect(more).toHaveAttribute('href', '/tickets');
    expect(screen.getAllByRole('link', { name: /Aufgabe/ })).toHaveLength(6);
  });

  it('shows a short empty state with a link to the board', async () => {
    renderTasks([], [areaA]);
    expect(await screen.findByText('Dir ist gerade nichts zugewiesen.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zum Board' })).toHaveAttribute('href', '/tickets');
  });

  it('shows a failure with retry when the tickets cannot be loaded', async () => {
    renderTasks(Response.json({ error: { code: 'boom', message: 'Kaputt' } }, { status: 500 }), [areaA]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Das hat noch nicht geklappt.');
  });
});
