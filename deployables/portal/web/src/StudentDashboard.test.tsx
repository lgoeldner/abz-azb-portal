import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';

const studentUser = {
  id: 'student-1',
  name: 'Mia Weber',
  role: 'student',
  admitted: true,
  cohort_member: true,
  category_ids: [],
  created_at: '2026-10-01T00:00:00Z',
};

const baseCategory = (id: string, name: string, kind: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  description: '',
  kind,
  template: kind === 'steckbrief' ? 'standard' : '',
  repeatable: ['idea', 'quote', 'memory', 'photo'].includes(kind),
  ongoing: true,
  closes_at: null,
  status: 'open',
  allow_self_vote: false,
  all_people: false,
  max_choices: 1,
  version: 1,
  created_at: '2026-10-01T00:00:00Z',
  opened_at: '2026-10-02T00:00:00Z',
  options: [],
  my_option_id: null,
  my_option_ids: [],
  my_words: [],
  ballot_count: null,
  participation: null,
  ...extra,
});

function renderStudentApp(categories: unknown[], submissions: unknown[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/me'))
        return Response.json({ user: studentUser, consent_required: false, csrf_token: 'c' });
      if (url.endsWith('/api/v1/categories')) return Response.json(categories);
      if (url.endsWith('/api/v1/submissions')) return Response.json(submissions);
      return Response.json([]);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('minimalist student UI', () => {
  it('renders header progress bar, active poll carousel, Abgegeben sheet, Sammeln rows, and Steckbrief account badge', async () => {
    const categories = [
      baseCategory('p1', 'Unser Abimotto', 'proposal', {
        options: [
          { id: 'o1', label: 'Abizeitbetrug' },
          { id: 'o2', label: 'ABIversal' },
        ],
      }),
      baseCategory('p2', 'Mottowoche', 'proposal', {
        options: [{ id: 'o3', label: 'Kindheitshelden' }],
        my_option_id: 'o3',
        my_option_ids: ['o3'],
      }),
      baseCategory('p3', 'Alte Wahl', 'proposal', {
        status: 'closed',
        options: [{ id: 'o4', label: 'Skifahrt' }],
        my_option_id: 'o4',
        my_option_ids: ['o4'],
      }),
      baseCategory('c-photo', 'Fotos', 'photo'),
      baseCategory('c-quote', 'Zitate', 'quote'),
      baseCategory('c-sb', 'Steckbrief', 'steckbrief', { repeatable: false }),
    ];

    renderStudentApp(categories);

    // Header progress bar tracks 1 of 2 open polls
    const progressbar = await screen.findByRole('progressbar', { name: '1 von 2 Fragen beantwortet' });
    expect(progressbar).toHaveAttribute('aria-valuenow', '1');
    expect(progressbar).toHaveAttribute('aria-valuemax', '2');

    // Carousel shows only unanswered open polls
    const carousel = screen.getByRole('region', { name: 'Fragen-Karussell' });
    expect(within(carousel).getByText('Unser Abimotto')).toBeInTheDocument();
    expect(within(carousel).queryByText('Mottowoche')).not.toBeInTheDocument();

    // Sammeln list shows Fotos & Zitate, never Steckbrief
    const sammeln = screen.getByRole('region', { name: 'Sammeln' });
    expect(within(sammeln).getByText('Fotos')).toBeInTheDocument();
    expect(within(sammeln).getByText('Zitate')).toBeInTheDocument();
    expect(within(sammeln).queryByText('Steckbrief')).not.toBeInTheDocument();

    // Account button has red Steckbrief reminder and hides admin/redaktion controls
    const accountBtn = screen.getByRole('button', { name: /Steckbrief noch offen/i });
    fireEvent.click(accountBtn);
    const menu = screen.getByRole('menu', { name: 'Kontomenü' });
    expect(within(menu).getByText('Steckbrief')).toBeInTheDocument();
    expect(within(menu).getByText('Offen')).toBeInTheDocument();
    expect(within(menu).queryByText(/Redaktion/i)).not.toBeInTheDocument();

    // Abgegeben hairline row opens bottom sheet split into Noch änderbar and Beendet
    fireEvent.click(screen.getByRole('button', { name: /Abgegeben/i }));
    const sheet = screen.getByRole('dialog', { name: 'Abgegeben' });
    expect(within(sheet).getByText('Noch änderbar')).toBeInTheDocument();
    expect(within(sheet).getByText('Mottowoche')).toBeInTheDocument();
    expect(within(sheet).getByText('Beendet')).toBeInTheDocument();
    expect(within(sheet).getByText('Alte Wahl')).toBeInTheDocument();
  });
});
