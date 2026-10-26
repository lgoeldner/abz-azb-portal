import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Category } from './api';
import { PollStack } from './PollStack';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Session } from './ui';
import type { ReactNode } from 'react';

function category(overrides: Partial<Category> = {}): Category {
  return {
    id: 'poll-1',
    name: 'Abimotto',
    description: 'Stimme für deinen Favoriten ab.',
    kind: 'proposal',
    repeatable: false,
    status: 'open',
    allow_self_vote: false,
    options: [{ id: 'option-1', label: 'Zusammen' }],
    my_option_id: null,
    my_option_ids: [],
    all_people: false,
    max_choices: 1,
    version: 1,
    created_at: '2026-10-01T00:00:00Z',
    opened_at: '2026-10-02T00:00:00Z',
    ballot_count: null,
    participation: null,
    ...overrides,
  };
}

function renderStack(items: Category[], client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <Session.Provider
          value={{
            user: {
              id: 'student',
              name: 'Mia Beispiel',
              role: 'student',
              admitted: true,
              cohort_member: true,
              category_ids: [],
              created_at: '2026-10-01T00:00:00Z',
            },
            csrf_token: 'csrf',
          }}
        >
          <MemoryRouter>{children}</MemoryRouter>
        </Session.Provider>
      </QueryClientProvider>
    );
  }
  return render(<PollStack items={items} />, { wrapper: Wrapper });
}

describe('PollStack', () => {
  it('navigates through every item and uses the right CTA and route', () => {
    const items = [
      category({ id: 'vote', name: 'Abimotto-Abstimmung' }),
      category({
        id: 'ideen',
        name: 'Ideensammlung',
        kind: 'idea',
        repeatable: true,
        options: [],
        opened_at: null,
      }),
      category({ id: 'photo', name: 'Fotowünsche', kind: 'photo', repeatable: true, options: [] }),
    ];
    renderStack(items);

    expect(screen.getByRole('button', { name: /Stimme speichern/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Zusammen' }));
    expect(screen.getByRole('button', { name: /Stimme speichern/ })).toBeEnabled();
    expect(screen.getByText('Sammlung 1 von 3: Abimotto-Abstimmung')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Nächste Sammlung' }));
    expect(screen.getByRole('link', { name: /Beitragen/ })).toHaveAttribute('href', '/sammlungen/ideen');
    expect(screen.getByText('Sammlung 2 von 3: Ideensammlung')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Nächste Sammlung' }));
    expect(screen.getByRole('heading', { name: 'Fotowünsche' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Beitragen/ })).toHaveAttribute('href', '/sammlungen/photo');
    expect(screen.getByRole('button', { name: 'Nächste Sammlung' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Vorherige Sammlung' }));
    expect(screen.getByRole('heading', { name: 'Ideensammlung' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Vorherige Sammlung' }));
    expect(screen.getByRole('button', { name: 'Zusammen' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('handles empty and one-item lists with bounded controls', () => {
    const { rerender } = renderStack([]);
    expect(screen.getByText('Keine Sammlungen verfügbar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vorherige Sammlung' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Nächste Sammlung' })).toBeDisabled();
    expect(screen.getByRole('link', { name: /Alle Sammlungen/ })).toHaveAttribute('href', '/sammlungen');

    rerender(<PollStack items={[category()]} />);
    expect(screen.getByText('1 / 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vorherige Sammlung' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Nächste Sammlung' })).toBeDisabled();
  });

  it('chooses a valid neighboring item when the active item is removed', () => {
    const first = category({ id: 'first', name: 'Erste' });
    const middle = category({ id: 'middle', name: 'Mittlere' });
    const last = category({ id: 'last', name: 'Letzte' });
    const { rerender } = renderStack([first, middle, last]);
    fireEvent.click(screen.getByRole('button', { name: 'Nächste Sammlung' }));
    rerender(<PollStack items={[first, last]} />);
    expect(screen.getByRole('heading', { name: 'Letzte' })).toBeInTheDocument();
    expect(screen.getByText('Sammlung 2 von 2: Letzte')).toBeInTheDocument();
  });

  it('preserves the active item when the list is reordered', () => {
    const first = category({ id: 'first', name: 'Erste' });
    const second = category({ id: 'second', name: 'Zweite' });
    const third = category({ id: 'third', name: 'Dritte' });
    const { rerender } = renderStack([first, second, third]);
    fireEvent.click(screen.getByRole('button', { name: 'Nächste Sammlung' }));
    rerender(<PollStack items={[third, first, second]} />);
    expect(screen.getByRole('heading', { name: 'Zweite' })).toBeInTheDocument();
    expect(screen.getByText('Sammlung 3 von 3: Zweite')).toBeInTheDocument();
  });
  it('submits directly on the card and advances only after the vote succeeds', async () => {
    let resolveVote!: (response: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveVote = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient();
    let finishRefresh!: () => void;
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    const next = category({ id: 'poll-2', name: 'Nächste Frage' });
    const { rerender } = renderStack([category(), next], client);
    fireEvent.click(screen.getByRole('button', { name: 'Zusammen' }));
    fireEvent.click(screen.getByRole('button', { name: /Stimme speichern/ }));
    expect(screen.getByRole('heading', { name: 'Abimotto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nächste Sammlung' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Nächste Sammlung' }));
    expect(screen.getByRole('heading', { name: 'Abimotto' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/categories/poll-1/ballot',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ option_ids: ['option-1'] }) }),
    );
    resolveVote(Response.json({ option_ids: ['option-1'], option_id: 'option-1' }));
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(screen.getByRole('heading', { name: 'Abimotto' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nächste Sammlung' })).toBeDisabled();
    rerender(<PollStack items={[next]} />);
    expect(screen.getByRole('heading', { name: 'Nächste Frage' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zusammen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Stimme speichern' })).toBeDisabled();
    finishRefresh();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Zusammen' })).toBeEnabled());
    await screen.findByRole('heading', { name: 'Nächste Frage' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stimme speichern' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Zusammen' }));
    fireEvent.click(screen.getByRole('button', { name: /Stimme speichern/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    resolveVote(Response.json({ error: { message: 'Bitte erneut versuchen.' } }, { status: 500 }));
    await screen.findByRole('alert');
    expect(screen.getByRole('heading', { name: 'Nächste Frage' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zusammen' })).toHaveAttribute('aria-pressed', 'true');
  });
});
