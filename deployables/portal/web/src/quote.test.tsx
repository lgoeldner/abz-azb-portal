import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Category, Me, Submission } from './api';
import { NewContribution } from './pages';
import { Session, WorkspaceView, type View } from './ui';

const student: Me['user'] = {
  id: 'student-quote',
  name: 'Mia',
  role: 'student',
  admitted: true,
  cohort_member: true,
  category_ids: [],
  created_at: '2026-09-01T00:00:00Z',
};

function category(id: string, kind: Category['kind'], name: string): Category {
  return {
    id,
    name,
    description: '',
    kind,
    repeatable: true,
    ongoing: true,
    closes_at: null,
    status: 'open',
    allow_self_vote: false,
    options: [],
    my_option_id: null,
    my_option_ids: [],
    all_people: false,
    max_choices: 1,
    version: 1,
    created_at: '2026-10-01T00:00:00Z',
    opened_at: '2026-10-02T00:00:00Z',
    ballot_count: null,
    participation: null,
  };
}

function renderNewContribution(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const me: Me = { user: student, csrf_token: 'csrf' };
  const workspaceView: [View, (next: View) => void] = ['schueler', vi.fn()];
  return render(
    <QueryClientProvider client={client}>
      <Session.Provider value={me}>
        <WorkspaceView.Provider value={workspaceView}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/beitraege/neu" element={<NewContribution />} />
              <Route path="/beitraege/:id" element={<p>Beitrag gespeichert</p>} />
            </Routes>
          </MemoryRouter>
        </WorkspaceView.Provider>
      </Session.Provider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('quote contribution form', () => {
  it('preserves quote fields and retries the same JSON submission with its idempotency key', async () => {
    const calls: { key: string; payload: Record<string, unknown> }[] = [];
    let attempts = 0;
    const saved: Submission = {
      id: 'saved-quote',
      category_id: 'quotes',
      author_id: student.id,
      author_name: student.name,
      title: 'Astrid Lindgren',
      body: 'Und dann muss man ja auch noch Zeit haben, einfach dazusitzen und vor sich hin zu schauen.',
      context: 'Lieblingszitat aus einer langen Unterhaltung',
      status: 'pending',
      version: 1,
      created_at: '2026-10-20T10:00:00Z',
      updated_at: '2026-10-20T10:00:00Z',
      attachments: [],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), window.location.origin);
        const path = url.pathname.replace('/api/v1', '');
        if (path === '/categories') return Response.json([category('quotes', 'quote', 'Zitate')]);
        if (path === '/submissions' && (init?.method ?? 'GET') === 'GET') return Response.json([]);
        if (path === '/submissions' && init?.method === 'POST') {
          const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
          calls.push({ key: String(payload.idempotency_key), payload });
          attempts += 1;
          if (attempts === 1)
            return Response.json({ error: { message: 'Speichern fehlgeschlagen.' } }, { status: 500 });
          return Response.json(saved, { status: 201 });
        }
        return Response.json([]);
      }),
    );

    const result = renderNewContribution('/beitraege/neu?kategorie=quotes');
    const attribution = await screen.findByPlaceholderText('Name oder Quelle');
    const quote = screen.getByLabelText(/Dein Zitat/);
    const context = screen.getByLabelText(/Kontext & Hinweise/);
    expect(attribution).toHaveAttribute('maxLength', '200');
    expect(attribution).toBeRequired();
    expect(quote).toHaveAttribute('maxLength', '20000');
    expect(context).toHaveAttribute('maxLength', '5000');
    fireEvent.change(attribution, { target: { value: saved.title } });
    fireEvent.change(quote, { target: { value: saved.body } });
    fireEvent.change(context, { target: { value: saved.context } });
    fireEvent.submit(result.container.querySelector('form')!);

    expect(await screen.findByRole('alert')).toHaveTextContent('Speichern fehlgeschlagen.');
    expect(attribution).toHaveValue(saved.title);
    expect(quote).toHaveValue(saved.body);
    expect(context).toHaveValue(saved.context);
    fireEvent.submit(result.container.querySelector('form')!);

    expect(await screen.findByText('Beitrag gespeichert')).toBeInTheDocument();
    expect(calls).toHaveLength(2);
    expect(calls[0].key).toBeTruthy();
    expect(calls[1].key).toBe(calls[0].key);
    expect(calls[0].payload).toEqual({
      idempotency_key: calls[0].key,
      category_id: 'quotes',
      title: saved.title,
      body: saved.body,
      context: saved.context,
    });
    expect(calls[1].payload).toEqual(calls[0].payload);
  });

  it('switches back to the generic contribution fields for non-quote collections', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), window.location.origin);
        if (url.pathname.endsWith('/categories'))
          return Response.json([
            category('quotes', 'quote', 'Zitate'),
            category('memories', 'memory', 'Erinnerungen'),
            category('photos', 'photo', 'Fotos'),
          ]);
        if (url.pathname.endsWith('/submissions')) return Response.json([]);
        return Response.json([]);
      }),
    );

    renderNewContribution('/beitraege/neu?kategorie=quotes');
    await screen.findByPlaceholderText('Name oder Quelle');
    fireEvent.change(screen.getByLabelText('Sammlung'), { target: { value: 'memories' } });

    expect(await screen.findByLabelText('Titel')).toBeInTheDocument();
    expect(screen.getByLabelText('Dein Beitrag')).toBeInTheDocument();
    expect(screen.getByLabelText(/Kontext & Hinweise/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByPlaceholderText('Name oder Quelle')).not.toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Sammlung'), { target: { value: 'photos' } });
    expect(await screen.findByLabelText(/Mindestens ein Foto/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Name oder Quelle')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Dein Zitat/)).not.toBeInTheDocument();
  });
});
