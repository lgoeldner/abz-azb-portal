import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConsentStep } from './Consent';

it('accepts the shown version and reloads a changed text instead of accepting it', async () => {
  let version = 'v1';
  const posted: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: unknown, options?: RequestInit) => {
      if (options?.method === 'POST') {
        const sent = JSON.parse(String(options.body)).version;
        posted.push(sent);
        if (sent !== version)
          return Response.json({ error: { code: 'consent_outdated', message: 'geändert' } }, { status: 409 });
        return Response.json({ version, draft: true, text: [`Text ${version}`], accepted_at: '2026-11-16T10:00:00Z' });
      }
      return Response.json({ version, draft: true, text: [`Text ${version}`], accepted_at: null });
    }),
  );
  const accepted = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConsentStep brand={null} logout={null} onAccepted={accepted} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Text v1')).toBeInTheDocument();
  expect(screen.getByText('Entwurf, noch nicht final')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Datenschutz' })).toHaveAttribute('href', '/datenschutz');

  version = 'v2';
  fireEvent.click(screen.getByRole('button', { name: 'Ich stimme zu' }));
  expect(await screen.findByText('Text v2')).toBeInTheDocument();
  expect(accepted).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Ich stimme zu' }));
  await waitFor(() => expect(accepted).toHaveBeenCalledOnce());
  expect(posted).toEqual(['v1', 'v2']);
});
