import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Area, Me, User } from './api';
import { AreasAdmin } from './AreasAdmin';
import { Session } from './ui';

const admin: Me = {
  consent_required: false,
  csrf_token: 'x',
  user: {
    id: 'ada',
    name: 'Ada Admin',
    role: 'admin',
    admitted: true,
    cohort_member: true,
    category_ids: [],
    created_at: '2026-09-01T00:00:00Z',
  },
};
const person = (id: string, name: string, role: User['role'], admitted = true): User => ({
  id,
  name,
  role,
  admitted,
  cohort_member: true,
  category_ids: [],
  created_at: '2026-09-01T00:00:00Z',
});
const users: User[] = [
  admin.user,
  person('mona', 'Mona Manager', 'manager'),
  person('nina', 'Nina Neu', 'manager', false),
  person('sam', 'Sam Student', 'student'),
];
const areas: Area[] = [
  { id: 'area-1', name: 'Mathe', position: 1, version: 3, reviewers: [{ id: 'mona', name: 'Mona Manager' }] },
  { id: 'area-2', name: 'Deutsch', position: 2, version: 1, reviewers: [] },
];

type Call = { method: string; url: string; body?: Record<string, unknown> };

function mockApi(options: { patchStatus?: number } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      if (method === 'GET' && url === '/api/v1/areas') return Response.json(areas);
      if (method === 'GET' && url === '/api/v1/admin/users') return Response.json(users);
      if (method === 'PATCH' && options.patchStatus === 409)
        return Response.json({ error: { code: 'stale_version', message: 'Veraltet' } }, { status: 409 });
      return Response.json({ ...areas[0], version: 4 });
    }),
  );
  return calls;
}

function renderPage(me: Me = admin) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Session.Provider value={me}>
        <AreasAdmin />
      </Session.Provider>
    </QueryClientProvider>,
  );
}

describe('area administration', () => {
  it('saves a rename with the version it was loaded with', async () => {
    const calls = mockApi();
    renderPage();
    const form = await screen.findByRole('form', { name: 'Bereich Mathe' });
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: 'Mathematik' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.method === 'PATCH')!;
    expect(patch.url).toBe('/api/v1/admin/areas/area-1');
    expect(patch.body).toEqual({ name: 'Mathematik', reviewer_ids: ['mona'], version: 3 });
  });

  it('reports a stale version without dropping the entered name', async () => {
    mockApi({ patchStatus: 409 });
    renderPage();
    const form = await screen.findByRole('form', { name: 'Bereich Mathe' });
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: 'Mathematik' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Speichern' }));
    expect(await within(form).findByText('Eine neuere Version liegt vor.')).toBeInTheDocument();
    expect(within(form).getByRole('textbox')).toHaveValue('Mathematik');
  });
});
