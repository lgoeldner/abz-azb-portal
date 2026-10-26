import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Category, Me } from './api';
import { BallotForm } from './BallotForm';
import { Session } from './ui';

const student: Me['user'] = {
  id: 'student-1',
  name: 'Mia Beispiel',
  role: 'student',
  admitted: true,
  cohort_member: true,
  category_ids: [],
  created_at: '2026-09-01T00:00:00Z',
};

function poll(overrides: Partial<Category> = {}): Category {
  return {
    id: 'poll-1',
    name: 'Abimotto',
    description: '',
    kind: 'proposal',
    repeatable: false,
    ongoing: true,
    closes_at: null,
    status: 'open',
    allow_self_vote: false,
    options: [
      { id: 'option-1', label: 'Zusammen' },
      { id: 'option-2', label: 'Einmalig' },
      { id: 'option-3', label: 'Für immer' },
    ],
    my_option_id: null,
    my_option_ids: [],
    all_people: false,
    max_choices: 2,
    version: 1,
    created_at: '2026-10-01T00:00:00Z',
    opened_at: '2026-10-02T00:00:00Z',
    ballot_count: null,
    participation: null,
    ...overrides,
  };
}

function mockFetch(status = 200) {
  const response =
    status < 400
      ? { option_ids: ['option-1'], option_id: 'option-1' }
      : { error: { message: 'Die Stimme konnte nicht gespeichert werden.' } };
  const fetchMock = vi.fn(async () => Response.json(response, { status }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderForm({
  ballot = poll(),
  user = student,
  choices = [],
  onSaved = vi.fn(),
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
}: {
  ballot?: Category;
  user?: Me['user'];
  choices?: string[];
  onSaved?: () => void;
  client?: QueryClient;
} = {}) {
  function ControlledForm() {
    const [selected, setSelected] = useState(choices);
    return <BallotForm poll={ballot} choices={selected} onChoicesChange={setSelected} onSaved={onSaved} />;
  }
  const view = render(
    <QueryClientProvider client={client}>
      <Session.Provider value={{ user, csrf_token: 'csrf' }}>
        <MemoryRouter>
          <ControlledForm />
        </MemoryRouter>
      </Session.Provider>
    </QueryClientProvider>,
  );
  return { ...view, client, onSaved };
}

afterEach(() => vi.unstubAllGlobals());

describe('BallotForm', () => {
  it('submits the selected options, invalidates cached queries, and calls onSaved', async () => {
    const fetchMock = mockFetch();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const onSaved = vi.fn();
    renderForm({ client, onSaved });

    fireEvent.click(screen.getByRole('button', { name: 'Zusammen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stimme speichern' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/categories/poll-1/ballot',
        expect.objectContaining({ method: 'PUT', body: JSON.stringify({ option_ids: ['option-1'] }) }),
      ),
    );
    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it('keeps changed choices when saving fails', async () => {
    mockFetch(500);
    const onSaved = vi.fn();
    renderForm({ onSaved });

    fireEvent.click(screen.getByRole('button', { name: 'Zusammen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stimme speichern' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Die Stimme konnte nicht gespeichert werden.');
    expect(screen.getByRole('button', { name: 'Zusammen entfernen' })).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('uses a fresh ballot id for each deliberate repeatable vote', async () => {
    const requests: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({ ballot_id: 'saved', option_ids: ['option-1'] });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderForm({ ballot: poll({ repeatable: true }) });

    fireEvent.click(screen.getByRole('button', { name: 'Zusammen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stimme speichern' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.getByText(/Jede erneute Abgabe wird als eigene Stimme geführt/)).toBeInTheDocument();
    const reVote = await screen.findByRole('button', { name: 'Erneut abstimmen' });
    fireEvent.click(reVote);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const firstId = requests[0].ballot_id;
    expect(firstId).toEqual(expect.any(String));
    expect(requests[0].option_ids).toEqual(['option-1']);
    expect(requests[1].option_ids).toEqual(['option-1']);
    expect(requests[1].ballot_id).not.toBe(firstId);
  });

  it('reuses the ballot id for a failed retry of the same selection', async () => {
    const requests: Record<string, unknown>[] = [];
    let attempt = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      attempt += 1;
      return attempt === 1
        ? Response.json({ error: { message: 'Bitte erneut versuchen.' } }, { status: 500 })
        : Response.json({ ballot_id: 'saved', option_ids: ['option-1'] });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderForm({ ballot: poll({ repeatable: true }) });

    fireEvent.click(screen.getByRole('button', { name: 'Zusammen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stimme speichern' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bitte erneut versuchen.');
    fireEvent.click(screen.getByRole('button', { name: 'Stimme speichern' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(requests[0].ballot_id).toEqual(expect.any(String));
    expect(requests[1].ballot_id).toBe(requests[0].ballot_id);
  });

  it('replaces the pending ballot id if the selection changes after a failure', async () => {
    const requests: Record<string, unknown>[] = [];
    let attempt = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      attempt += 1;
      return attempt === 1
        ? Response.json({ error: { message: 'Bitte erneut versuchen.' } }, { status: 500 })
        : Response.json({ ballot_id: 'saved', option_ids: ['option-1', 'option-2'] });
    });
    vi.stubGlobal('fetch', fetchMock);
    renderForm({ ballot: poll({ repeatable: true }) });

    fireEvent.click(screen.getByRole('button', { name: 'Zusammen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stimme speichern' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Bitte erneut versuchen.');
    fireEvent.click(screen.getByRole('button', { name: 'Einmalig' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stimme speichern' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(requests[0].ballot_id).not.toBe(requests[1].ballot_id);
    expect(requests[0].option_ids).toEqual(['option-1']);
    expect(requests[1].option_ids).toEqual(['option-1', 'option-2']);
  });

  it.each([
    { reason: 'an ineligible voter', ballot: poll(), user: { ...student, admitted: false }, choices: ['option-1'] },
    { reason: 'a closed poll', ballot: poll({ status: 'closed' }), user: student, choices: ['option-1'] },
    { reason: 'an empty selection', ballot: poll(), user: student, choices: [] },
    { reason: 'too many choices', ballot: poll({ max_choices: 1 }), user: student, choices: ['option-1', 'option-2'] },
    { reason: 'an unknown choice', ballot: poll(), user: student, choices: ['missing-option'] },
    { reason: 'a duplicate choice', ballot: poll(), user: student, choices: ['option-1', 'option-1'] },
    {
      reason: 'a forbidden self-vote',
      ballot: poll({ kind: 'person', options: [{ id: 'self', label: 'Mia Beispiel', user_id: student.id }] }),
      user: student,
      choices: ['self'],
    },
  ])('does not submit $reason even when the form is submitted directly', ({ ballot, user, choices }) => {
    const fetchMock = mockFetch();
    const { container } = renderForm({ ballot, user, choices });
    const form = container.querySelector('form');

    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ignores another direct submit while a ballot request is pending', async () => {
    let finishRequest: (response: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishRequest = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { container } = renderForm({ choices: ['option-1'] });
    const form = container.querySelector('form');

    fireEvent.submit(form!);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stimme speichern' })).toBeDisabled());
    fireEvent.submit(form!);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    finishRequest(Response.json({ option_ids: ['option-1'], option_id: 'option-1' }));
  });
});
