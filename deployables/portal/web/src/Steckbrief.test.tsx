import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Category, Submission } from './api';
import { Steckbrief } from './Steckbrief';

const category = { id: 'steckbrief', name: 'Steckbrief', kind: 'steckbrief', template: 'standard' } as Category;
const record = (change: Partial<Submission> = {}): Submission => ({
  id: 'mine',
  category_id: category.id,
  author_id: 'mia',
  author_name: 'Mia',
  title: 'Steckbrief',
  body: '{"name":"Mia"}',
  context: '',
  status: 'pending',
  version: 1,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
  attachments: [],
  ...change,
});

type Call = { method: string; path: string; body: unknown };
function stubApi(respond: (call: Call) => Submission) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), window.location.origin).pathname.replace('/api/v1', '');
      const body = init?.body instanceof FormData ? Object.fromEntries(init.body) : JSON.parse(String(init?.body));
      const call = { method: init?.method ?? 'GET', path, body };
      calls.push(call);
      return Response.json(respond(call));
    }),
  );
  return calls;
}
const show = (submission?: Submission, readOnly = false) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <Routes>
          <Route path="/" element={<Steckbrief category={category} submission={submission} readOnly={readOnly} />} />
          <Route path="/beitraege/:id" element={<p>Gespeicherter Steckbrief</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const toLastSheet = () => {
  const tabs = screen.getAllByRole('tab');
  fireEvent.click(tabs[tabs.length - 1]);
};

describe('Steckbrief', () => {
  it('offers saving only on the last sheet and warns about empty fields there', () => {
    stubApi(() => record());
    show();
    const save = () => screen.queryByRole('button', { name: /Steckbrief abgeben/ });
    expect(save()).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    toLastSheet();
    expect(save()).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/noch leer/);
  });

  it('creates one submission with only the filled answers as a JSON body', async () => {
    const calls = stubApi(() => record());
    const view = show();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: ' Mia ' } });
    fireEvent.change(screen.getByLabelText('Spitzname'), { target: { value: '  ' } });
    fireEvent.submit(view.container.querySelector('form')!);

    expect(await screen.findByText('Gespeicherter Steckbrief')).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/submissions' });
    expect(calls[0].body).toMatchObject({ category_id: category.id, title: 'Steckbrief', context: '' });
    expect(JSON.parse((calls[0].body as { body: string }).body)).toEqual({ name: 'Mia' });
  });

  it('keeps only the top sheet reachable and circles one answer, which a second click clears', () => {
    stubApi(() => record());
    show(record());
    expect(screen.getByRole('tabpanel', { name: /Das bin ich/ })).not.toHaveAttribute('inert');
    fireEvent.click(screen.getByRole('button', { name: 'Nächstes Blatt' }));
    expect(screen.getByRole('tab', { name: /Lieblingsdinge/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Name').closest('section')).toHaveAttribute('inert');

    const choice = screen.getByRole('radio', { name: 'letzte Reihe' });
    fireEvent.click(choice);
    expect(choice).toBeChecked();
    fireEvent.click(choice);
    expect(choice).not.toBeChecked();
  });

  it('uploads a photo into its slot on the current version without rewriting unchanged answers', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:preview');
    URL.revokeObjectURL = vi.fn();
    const calls = stubApi(() => record({ version: 5 }));
    show(record({ version: 4 }));
    toLastSheet();
    expect(screen.getByRole('button', { name: /Gespeichert/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Damals wählen'), {
      target: { files: [new File(['x'], 'kind.png', { type: 'image/png' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: /Änderungen speichern/ }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/submissions/mine/attachments' });
    expect(calls[0].body).toMatchObject({ caption: 'kinderfoto', version: '4' });
  });

  it('reads as plain text with no controls for the Redaktion', () => {
    const view = show(record({ body: '{"name":"Mia","typ_reihe":"letzte Reihe"}' }), true);
    expect(screen.getByText('Mia')).toBeInTheDocument();
    expect(screen.getByText('(gewählt)').parentElement).toHaveTextContent('letzte Reihe');
    expect(view.container.querySelectorAll('input, textarea, button')).toHaveLength(0);
    expect(view.container.querySelector('[inert]')).toBeNull();
  });
});
