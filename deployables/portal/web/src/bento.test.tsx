import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Me, Ticket } from './api';
import { App } from './App';

const base = { admitted: true, cohort_member: true, category_ids: [], created_at: '2026-09-01T00:00:00Z' };
const student: Me['user'] = { ...base, id: 'student-1', name: 'Mia Beispiel', role: 'student' };
const manager: Me['user'] = { ...base, id: 'manager-1', name: 'Mona Manager', role: 'manager' };
const admin: Me['user'] = { ...base, id: 'admin-1', name: 'Ada Admin', role: 'admin' };
const other = { id: 'other-1', name: 'Olli Other' };
const areas = [{ id: 'area-1', name: 'Layout', position: 1, version: 1, reviewers: [] }];

function ticket(id: string, overrides: Partial<Ticket> = {}): Ticket {
  return {
    id,
    number: 1,
    comment_count: 0,
    type: 'aufgabe',
    title: `Ticket ${id}`,
    body: '',
    area_id: 'area-1',
    area_name: 'Layout',
    assignees: [{ id: manager.id, name: manager.name }],
    created_by: other,
    size: 'M',
    goal: '',
    est_pages: null,
    status: 'in_progress',
    round: 1,
    version: 1,
    approved: false,
    reviews: [],
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-02T10:00:00Z',
    status_changed_at: '2026-10-02T10:00:00Z',
    ...overrides,
  };
}

interface Options {
  path?: string;
  projects?: boolean;
  tickets?: Ticket[];
  documents?: unknown[];
  areas?: unknown[];
  fail?: string;
}
// Mounts the whole app and records every API path it reads.
function mount(user: Me['user'], { path = '/sammlungen', projects = true, ...data }: Options = {}) {
  const requests: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input).replace('/api/v1', '');
      if (url === '/me')
        return Response.json({ user, consent_required: false, csrf_token: 'csrf', project_management: projects });
      requests.push(url);
      if (url === data.fail) return Response.json({ error: { code: 'internal', message: 'Kaputt.' } }, { status: 500 });
      if (url === '/tickets') return Response.json(data.tickets ?? []);
      if (url === '/areas') return Response.json(data.areas ?? areas);
      if (url === '/documents') return Response.json(data.documents ?? []);
      if (url === '/admin/users') return Response.json([user]);
      if (url === '/admin/email/status') return Response.json({ usage: { used: 3 }, policy: { daily_limit: 100 } });
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
  return requests;
}

// Not the close button, which is also named "Redaktionsmenü …".
const trigger = /^Redaktionsmenü(?!\s*schließen)/;
async function openMenu() {
  fireEvent.click(await screen.findByRole('button', { name: trigger }));
  return screen.findByRole('navigation', { name: 'Redaktionsmenü' });
}
const hrefs = (element: HTMLElement) =>
  within(element)
    .queryAllByRole('link')
    .map((link) => link.getAttribute('href')!);
const tile = (menu: HTMLElement, href: string) =>
  within(menu)
    .getAllByRole('link')
    .find((link) => link.getAttribute('href') === href)!;
const back = 'Zurück zur Schüleransicht';
const workspace = () => document.querySelector('#inhalt')!.closest('[data-workspace]');

describe('Redaktionsmenü', () => {
  beforeEach(() => localStorage.clear());

  it('is never offered to students', async () => {
    const requests = mount(student, { path: '/' });
    await screen.findByRole('heading', { level: 1, name: /^Hey .*erledigt/ });
    expect(screen.getByRole('region', { name: 'Konto' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Redaktionsmenü/ })).toBeNull();
    expect(screen.queryByRole('link', { name: back })).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
    expect(requests.filter((url) => /^\/(admin|tickets|areas|documents)/.test(url))).toEqual([]);
  });

  it('leaves the account dock without a view switch and marks unread documents on the button', async () => {
    mount(manager, { documents: [{ id: 'doc-1', title: 'Neu', unread: true, updated_at: base.created_at }] });
    expect(await screen.findByRole('button', { name: /^Redaktionsmenü\s*, neue Dokumente$/ })).toBeInTheDocument();
    const account = within(screen.getByRole('region', { name: 'Konto' }));
    expect(account.getByRole('link', { name: 'Einstellungen' })).toBeInTheDocument();
    expect(account.getByRole('button', { name: 'Abmelden' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Schüler|Redaktion|Ansicht:.*)$/ })).toBeNull();
  });

  it.each([
    ['admin', admin, true],
    ['manager', manager, false],
  ])('shows admin tiles and makes admin requests only for admins (%s)', async (_role, user, isAdmin) => {
    const requests = mount(user);
    await screen.findByRole('heading', { level: 1, name: 'Abstimmungen' });
    expect(requests.some((url) => url.startsWith('/admin/'))).toBe(false);
    const menu = await openMenu();
    expect(hrefs(menu)).toEqual(
      expect.arrayContaining([
        '/',
        '/tickets',
        '/tickets/neu',
        '/redaktion/beitraege',
        '/sammlungen',
        '/sammlungen?neu',
        '/dokumente',
        '/dokumente/neu',
      ]),
    );
    await waitFor(() => expect(requests).toContain('/submissions'));
    expect([...new Set(requests.filter((url) => url.startsWith('/admin/')))].sort()).toEqual(
      isAdmin ? ['/admin/email/status', '/admin/users'] : [],
    );
    const group = within(menu).queryByRole('group', { name: 'Verwaltung' });
    expect(group !== null).toBe(isAdmin);
    if (group)
      expect(hrefs(group)).toEqual(
        expect.arrayContaining(['personen', 'email', 'protokoll', 'bereiche'].map((page) => `/verwaltung/${page}`)),
      );
    else expect(hrefs(menu).filter((href) => href.startsWith('/verwaltung'))).toEqual([]);
  });

  it('lists only own unfinished tickets in the carousel', async () => {
    mount(manager, {
      tickets: [
        ticket('open'),
        ticket('unapproved', { status: 'done', approved: false }),
        ticket('finished', { status: 'done', approved: true }),
        ticket('foreign', { assignees: [other] }),
      ],
    });
    const carousel = within(await openMenu()).getByRole('group', { name: 'Meine Aufgaben' });
    await within(carousel).findByRole('link', { name: /Ticket open/ });
    expect(hrefs(carousel).sort()).toEqual(['/tickets/open', '/tickets/unapproved']);
    expect(within(carousel).getByRole('button', { name: 'Ticket open zeigen' })).toBeInTheDocument();
  });

  it('caps the carousel at six tickets and then links to the board', async () => {
    mount(manager, { tickets: Array.from({ length: 7 }, (_, i) => ticket(`t${i}`)) });
    const carousel = within(await openMenu()).getByRole('group', { name: 'Meine Aufgaben' });
    expect(await within(carousel).findByRole('link', { name: 'Zum Board' })).toHaveAttribute('href', '/tickets');
    expect(hrefs(carousel).filter((href) => href.startsWith('/tickets/'))).toHaveLength(6);
  });

  it('leads a reviewer to the ticket that has waited longest', async () => {
    const review = { assignees: [other], status: 'review' as const };
    mount(
      { ...manager, id: 'rev-1' },
      {
        areas: [{ ...areas[0]!, reviewers: [{ id: 'rev-1', name: 'Rita' }] }],
        tickets: [
          ticket('newer', { ...review, updated_at: '2026-10-05T10:00:00Z' }),
          ticket('older', { ...review, updated_at: '2026-10-03T10:00:00Z' }),
        ],
      },
    );
    const link = await within(await openMenu()).findByRole('link', { name: /2 warten\s*auf deine Freigabe/ });
    expect(link).toHaveAttribute('href', '/tickets/older');
  });

  it('says when nothing is assigned', async () => {
    mount(manager);
    expect(await within(await openMenu()).findByText('Dir ist gerade nichts zugewiesen')).toBeInTheDocument();
  });

  it('has no ticket or document tiles or requests without project management', async () => {
    const requests = mount(admin, { projects: false });
    const menu = await openMenu();
    await waitFor(() => expect(requests).toContain('/submissions'));
    expect(within(menu).queryByRole('group', { name: 'Meine Aufgaben' })).toBeNull();
    expect(hrefs(menu).filter((href) => /^\/(tickets|dokumente|verwaltung\/bereiche)/.test(href))).toEqual([]);
    expect(requests.filter((url) => /^\/(tickets|areas|documents)/.test(url))).toEqual([]);
  });

  it('opens menu links in the Redaktion view and returns to the Schüler view through its tile', async () => {
    localStorage.setItem('view', 'schueler');
    mount(manager, { path: '/' });
    await screen.findByRole('heading', { level: 1, name: /^Hey / });
    expect(workspace()).toHaveAttribute('data-workspace', 'schueler');
    // The Schüler view redirects /sammlungen home, so arriving proves the view switched first.
    fireEvent.click(tile(await openMenu(), '/sammlungen'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Abstimmungen' })).toBeInTheDocument();
    expect(workspace()).toHaveAttribute('data-workspace', 'redaktion');
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Redaktionsmenü' })).toBeNull());
    fireEvent.click(within(await openMenu()).getByRole('link', { name: 'Zur Schüleransicht' }));
    expect(await screen.findByRole('heading', { level: 1, name: /^Hey / })).toBeInTheDocument();
    expect(workspace()).toHaveAttribute('data-workspace', 'schueler');
    await waitFor(() => expect(screen.queryByRole('navigation', { name: 'Redaktionsmenü' })).toBeNull());
  });

  it('leads back to the student view with the floating back button', async () => {
    mount(manager);
    fireEvent.click(await screen.findByRole('link', { name: back }));
    expect(await screen.findByRole('heading', { level: 1, name: /^Hey / })).toBeInTheDocument();
    expect(workspace()).toHaveAttribute('data-workspace', 'schueler');
    expect(screen.queryByRole('link', { name: back })).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByRole('button', { name: /Zum Redaktionsbereich/ })).toBeNull();
  });

  it.each([
    [undefined, false],
    ['preview', true],
  ])('shows the dismissed hint again on a later visit only in previews (env %s)', async (env, again) => {
    if (env) document.documentElement.dataset.env = env;
    try {
      mount(manager);
      expect(await screen.findByRole('note')).toHaveTextContent('Du bist in der Redaktion.');
      fireEvent.click(screen.getByRole('button', { name: 'Verstanden' }));
      expect(screen.queryByRole('note')).toBeNull();
      cleanup();
      mount(manager);
      await screen.findByRole('link', { name: back });
      expect(screen.queryByRole('note') !== null).toBe(again);
    } finally {
      delete document.documentElement.dataset.env;
    }
  });

  it('keeps the grid when one request fails', async () => {
    const requests = mount(manager, { fail: '/tickets' });
    const menu = await openMenu();
    expect(await within(menu).findByRole('alert')).toHaveTextContent('Kaputt.');
    expect(within(menu).getByRole('link', { name: 'Neue Abstimmung' })).toBeInTheDocument();
    expect(within(menu).getByRole('link', { name: 'Zur Schüleransicht' })).toBeInTheDocument();
    const before = requests.filter((url) => url === '/tickets').length;
    fireEvent.click(within(menu).getByRole('button', { name: 'Erneut versuchen' }));
    await waitFor(() => expect(requests.filter((url) => url === '/tickets').length).toBeGreaterThan(before));
  });

  it.each([
    [true, '/tickets'],
    [false, '/submissions?'],
  ])('redirects /redaktion (project management %s)', async (projects, loaded) => {
    const requests = mount(manager, { path: '/redaktion', projects });
    // The menu stays closed, so only the target page can have made these requests.
    await waitFor(() => expect(requests.some((url) => url.startsWith(loaded))).toBe(true));
    expect(screen.queryByRole('heading', { level: 1, name: 'Redaktion' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Meine Abstimmungen' })).toBeNull();
    expect(workspace()).toHaveAttribute('data-workspace', 'redaktion');
  });
});
