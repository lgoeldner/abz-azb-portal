import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Document, Me } from './api';
import { DocumentPage, DocumentsPage, DocumentTiles, NewDocument } from './Documents';
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

describe('DocumentTiles', () => {
  it('puts changed documents first, marks them and counts them', async () => {
    const docs = [
      doc({ id: 'read-new', title: 'Gelesen', updated_at: daysAgo(1) }),
      doc({ id: 'unread-old', title: 'Ungelesen', unread: true, updated_by: ref(other), updated_at: daysAgo(5) }),
    ];
    setup((c) => (c.path === '/documents' ? Response.json(docs) : undefined), <DocumentTiles />);
    expect(await screen.findByText('1 seit deinem letzten Besuch geändert')).toBeInTheDocument();
    const tiles = screen.getAllByRole('link').filter((a) => /^\/dokumente\/(?!neu)/.test(a.getAttribute('href') ?? ''));
    expect(tiles.map((t) => t.getAttribute('href'))).toEqual(['/dokumente/unread-old', '/dokumente/read-new']);
    expect(within(tiles[0]!).getByText('Geändert')).toBeInTheDocument();
    expect(within(tiles[1]!).queryByText('Geändert')).not.toBeInTheDocument();
    expect(tiles[0]).toHaveTextContent('Otto Other · vor 5 Tagen');
    expect(screen.getByRole('link', { name: 'Neues Dokument' })).toHaveAttribute('href', '/dokumente/neu');
  });

  it('shows a plain-text excerpt without markdown syntax', async () => {
    setup(
      () => Response.json([doc({ id: 'a', body: '## Agenda\n\n- **Budget** klären\n- [Link](https://x.de) prüfen' })]),
      <DocumentTiles />,
    );
    expect(await screen.findByText('Agenda · Budget klären · Link prüfen')).toBeInTheDocument();
  });

  it('shows at most limit documents and a link to all of them', async () => {
    const docs = ['a', 'b', 'c', 'd'].map((id) => doc({ id, title: `Dok ${id}` }));
    setup(() => Response.json(docs), <DocumentTiles limit={2} />);
    expect(await screen.findByRole('link', { name: 'Alle Dokumente' })).toHaveAttribute('href', '/dokumente');
    expect(screen.getAllByRole('link', { name: /Dok / })).toHaveLength(2);
  });
});

describe('DocumentsPage', () => {
  it('filters by kind and by search text in title and body', async () => {
    const user = userEvent.setup();
    const docs = [
      doc({ id: 'm', title: 'Treffen 1', kind: 'meeting', body: 'Budget besprochen' }),
      doc({ id: 'n', title: 'Ideen', kind: 'note', body: 'Motto sammeln' }),
    ];
    setup(() => Response.json(docs), <DocumentsPage />);
    await screen.findByRole('link', { name: /Treffen 1/ });
    await user.click(screen.getByRole('button', { name: 'Notizen' }));
    expect(screen.queryByRole('link', { name: /Treffen 1/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ideen/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Alle' }));
    await user.type(screen.getByRole('searchbox', { name: 'Dokumente durchsuchen' }), 'budget');
    expect(screen.getByRole('link', { name: /Treffen 1/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Ideen/ })).not.toBeInTheDocument();
  });
});

describe('NewDocument', () => {
  it('posts the payload and opens the new document', async () => {
    const user = userEvent.setup();
    const created = doc({ id: 'new-1', title: 'Wunschliste', kind: 'note', body: 'Eis' });
    const calls = setup(
      (c) => {
        if (c.method === 'POST' && c.path === '/documents') return Response.json(created, { status: 201 });
        if (c.path === '/documents/new-1') return Response.json(created);
        if (c.path === '/documents') return Response.json([created]);
      },
      <Routes>
        <Route path="/dokumente/neu" element={<NewDocument />} />
        <Route path="/dokumente/:id" element={<DocumentPage />} />
      </Routes>,
      manager,
      '/dokumente/neu',
    );
    expect((screen.getByLabelText('Titel') as HTMLInputElement).value).toMatch(/^Treffen \d{2}\.\d{2}\.$/);
    expect(screen.getByRole('button', { name: 'Protokoll' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Notiz' }));
    expect(screen.getByRole('button', { name: 'Notiz' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Protokoll' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Titel')).toHaveValue('');
    await user.type(screen.getByLabelText('Titel'), 'Wunschliste');
    await user.type(await screen.findByLabelText('Inhalt'), 'Eis');
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    expect(await screen.findByRole('heading', { name: 'Wunschliste' })).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ title: 'Wunschliste', kind: 'note', body: 'Eis' });
  });

  it('prefills a Protokoll title with today when the user typed none', async () => {
    const user = userEvent.setup();
    const calls = setup(
      (c) => (c.method === 'POST' ? Response.json(doc({ id: 'p' }), { status: 201 }) : Response.json([])),
      <NewDocument />,
    );
    await user.click(screen.getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    const sent = calls.find((c) => c.method === 'POST')!.body as { title: string; kind: string };
    expect(sent.kind).toBe('meeting');
    expect(sent.title).toMatch(/^Treffen \d{2}\.\d{2}\.$/);
  });
});

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

  it('shows who changed the document last and the rendered text', async () => {
    page(manager, () => Response.json(current));
    expect(await screen.findByRole('heading', { name: 'Treffen 22.11.' })).toBeInTheDocument();
    expect(screen.getByText(/Zuletzt geändert von Otto Other · vor 2 Tagen/)).toBeInTheDocument();
    expect(screen.getByTestId('readonly-md')).toHaveTextContent('Protokoll');
    expect(screen.getByRole('link', { name: /Dokumente/ })).toHaveAttribute('href', '/dokumente');
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

  it('hides delete from a manager who did not create the document', async () => {
    page(other, () => Response.json(doc({ id: 'd1', created_by: ref(manager) })));
    await screen.findByRole('button', { name: 'Bearbeiten' });
    expect(screen.queryByRole('button', { name: 'Löschen' })).not.toBeInTheDocument();
  });

  it('lets the creator delete their own document', async () => {
    page(manager, () => Response.json(doc({ id: 'd1', created_by: ref(manager) })));
    expect(await screen.findByRole('button', { name: 'Löschen' })).toBeInTheDocument();
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
