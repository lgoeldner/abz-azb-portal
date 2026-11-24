import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { GoogleAccount } from './GoogleAccount';

function setup(
  options: { accounts?: { id: string; created_at: string }[]; list?: Response; link?: Response; path?: string } = {},
) {
  let accounts = options.accounts ?? [];
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const path = String(url);
      calls.push(path);
      if (path === '/api/auth/list-accounts') return options.list ?? Response.json(accounts);
      if (path === '/api/auth/link-social')
        return options.link ?? Response.json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?x=1' });
      if (path === '/api/auth/unlink-account') {
        accounts = [];
        return new Response(null, { status: 204 });
      }
      throw new Error('unexpected ' + path);
    }),
  );
  const assign = vi.fn();
  vi.stubGlobal('location', { ...window.location, assign });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[options.path ?? '/einstellungen']}>
        <GoogleAccount />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { calls, assign };
}

it('stays hidden while Google sign-in is not configured', async () => {
  const { calls } = setup({ list: Response.json({ error: 'not_found' }, { status: 404 }) });
  await waitFor(() => expect(calls).toContain('/api/auth/list-accounts'));
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Google' })).toBeNull());
});

it('sends the browser to Google to link', async () => {
  const { assign } = setup();
  fireEvent.click(await screen.findByRole('button', { name: 'Google verknüpfen' }));
  await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1'));
});

it('asks for a fresh login when the session is older than an hour', async () => {
  setup({ link: Response.json({ error: 'session_not_fresh' }, { status: 403 }) });
  fireEvent.click(await screen.findByRole('button', { name: 'Google verknüpfen' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('älter als eine Stunde');
});

it('unlinks after confirmation and reports the return from Google', async () => {
  vi.stubGlobal('confirm', () => true);
  setup({ accounts: [{ id: 'a1', created_at: '2026-11-20T10:00:00Z' }], path: '/einstellungen?google=linked' });
  expect(await screen.findByText(/Google ist verknüpft/)).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: /Entfernen/ }));
  expect(await screen.findByRole('button', { name: 'Google verknüpfen' })).toBeInTheDocument();
  expect(screen.getByText('Google-Verknüpfung entfernt.')).toBeInTheDocument();
});
