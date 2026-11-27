import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Document, Me } from './api';
import { DocumentPage } from './Documents';
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

const base = { admitted: true, cohort_member: true, category_ids: [], created_at: '2026-09-01T00:00:00Z' };
const manager: Me['user'] = { ...base, id: 'manager-1', name: 'Mona Manager', role: 'manager' };
const other: Me['user'] = { ...base, id: 'manager-2', name: 'Otto Other', role: 'manager' };
const admin: Me['user'] = { ...base, id: 'admin-1', name: 'Ada Admin', role: 'admin' };
const ref = (u: Me['user']) => ({ id: u.id, name: u.name });
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

function doc(overrides: Partial<Document> & Pick<Document, 'id'>): Document {
  return {
    title: overrides.id,
    kind: 'note',
    body: '',
    unread: false,
    version: 1,
    created_by: ref(manager),
    updated_by: ref(manager),
    created_at: daysAgo(10),
    updated_at: daysAgo(2),
    ...overrides,
  };
}

type Call = { method: string; path: string; body: unknown };
function setup(handler: (call: Call) => Response | undefined, ui: ReactNode, viewer = manager, at = '/') {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const call = {
        method: init?.method ?? 'GET',
        path: String(input).replace('/api/v1', ''),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const res = handler(call);
      if (!res) throw new Error(`unexpected ${call.method} ${call.path}`);
      return res;
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const session: Me = { user: viewer, consent_required: false, csrf_token: 'x' };
  render(
    <QueryClientProvider client={client}>
      <Session.Provider value={session}>
        <MemoryRouter initialEntries={[at]}>{ui}</MemoryRouter>
      </Session.Provider>
    </QueryClientProvider>,
  );
  return calls;
}

describe('DocumentPage', () => {
  const page = (viewer: Me['user'], handler: (c: Call) => Response | undefined) =>
    setup(
      handler,
      <Routes>
        <Route path="/dokumente/:id" element={<DocumentPage />} />
      </Routes>,
      viewer,
      '/dokumente/d1',
    );
  const current = doc({
    id: 'd1',
    title: 'Treffen 22.11.',
    kind: 'meeting',
    body: 'Protokoll',
    updated_by: ref(other),
  });

  it('shows the conflict text with a reload button when the document changed meanwhile', async () => {
    const user = userEvent.setup();
    page(manager, (c) =>
      c.method === 'PATCH'
        ? Response.json({ error: { code: 'stale', message: 'stale' } }, { status: 409 })
        : Response.json(current),
    );
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(
      await screen.findByText(
        'Jemand hat das Dokument inzwischen geändert. Neu laden, um die aktuelle Fassung zu sehen.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Neu laden' })).toBeInTheDocument();
  });

  it('saves the edit against the version it started from', async () => {
    const user = userEvent.setup();
    const calls = page(manager, (c) =>
      c.method === 'PATCH' ? Response.json({ ...current, version: 3 }) : Response.json(current),
    );
    await user.click(await screen.findByRole('button', { name: 'Bearbeiten' }));
    await user.clear(screen.getByLabelText('Titel'));
    await user.type(screen.getByLabelText('Titel'), 'Neu');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({
      title: 'Neu',
      kind: 'meeting',
      body: 'Protokoll',
      version: 1,
    });
  });

  it('lets an admin delete after a confirm step', async () => {
    const user = userEvent.setup();
    const calls = page(admin, (c) =>
      c.method === 'DELETE' ? new Response(null, { status: 204 }) : Response.json(current),
    );
    await user.click(await screen.findByRole('button', { name: 'Löschen' }));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Ja, löschen' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'DELETE')?.body).toEqual({ version: 1 }));
  });
});
