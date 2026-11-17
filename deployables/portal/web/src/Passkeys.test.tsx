import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Passkeys } from './Passkeys';

const base = '/api/auth/passkey';
const created = '2026-11-03T10:00:00Z';

function setup(options: { supported?: boolean; verify?: Response; create?: () => Promise<unknown> } = {}) {
  let keys = [{ id: 'k1', name: null, created_at: created }];
  const calls: string[] = [];
  const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
    const path = String(url).replace(base + '/', '');
    calls.push(path);
    if (path === 'list-user-passkeys') return Response.json(keys);
    if (path === 'generate-register-options') return Response.json({ challenge: 'c', user: { id: 'u' } });
    if (path === 'verify-registration') {
      const res = options.verify ?? new Response(null, { status: 204 });
      if (res.ok) keys = [...keys, { id: 'k2', name: null, created_at: '2026-11-17T10:00:00Z' }];
      return res;
    }
    if (path === 'delete-passkey') {
      keys = keys.filter((k) => k.id !== JSON.parse(String(init?.body)).id);
      return new Response(null, { status: 204 });
    }
    throw new Error('unexpected ' + path);
  });
  vi.stubGlobal('fetch', fetcher);
  if (options.supported !== false) {
    vi.stubGlobal('PublicKeyCredential', { parseCreationOptionsFromJSON: (o: unknown) => ({ parsed: o }) });
    vi.stubGlobal('navigator', {
      credentials: { create: vi.fn(options.create ?? (async () => ({ toJSON: () => ({ id: 'cred' }) }))) },
    });
  }
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Passkeys />
    </QueryClientProvider>,
  );
  return { fetcher, calls };
}

it('lists passkeys by date without any key material', async () => {
  setup();
  expect(await screen.findByText('Passkey vom 03.11.2026')).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/k1|public|credential/i);
});

it('registers in order: options, browser dialog, verification, refreshed list', async () => {
  const { fetcher, calls } = setup();
  await screen.findByText('Passkey vom 03.11.2026');
  fireEvent.click(screen.getByRole('button', { name: 'Passkey hinzufügen' }));
  expect(await screen.findByText('Passkey vom 17.11.2026')).toBeInTheDocument();
  expect(calls.filter((c) => c !== 'list-user-passkeys')).toEqual(['generate-register-options', 'verify-registration']);
  expect(navigator.credentials.create).toHaveBeenCalledWith({
    publicKey: { parsed: { challenge: 'c', user: { id: 'u' } } },
  });
  const verify = fetcher.mock.calls.find(([u]) => String(u).endsWith('verify-registration'))!;
  expect(JSON.parse(String(verify[1]?.body))).toEqual({ response: { id: 'cred' } });
  expect(screen.getByText('Passkey hinzugefügt.')).toBeInTheDocument();
});

it('tells the user to log in again when the session is not fresh', async () => {
  setup({ verify: Response.json({ error: 'session_not_fresh' }, { status: 403 }) });
  await screen.findByText('Passkey vom 03.11.2026');
  fireEvent.click(screen.getByRole('button', { name: 'Passkey hinzufügen' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('älter als eine Stunde');
  expect(screen.getByRole('link', { name: 'Erneut anmelden' })).toHaveAttribute('href', '/auth/login');
});

it('stays quiet when the browser dialog is cancelled', async () => {
  const { calls } = setup({ create: async () => Promise.reject(new DOMException('x', 'NotAllowedError')) });
  await screen.findByText('Passkey vom 03.11.2026');
  fireEvent.click(screen.getByRole('button', { name: 'Passkey hinzufügen' }));
  await waitFor(() => expect(navigator.credentials.create).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Passkey hinzufügen' })).toBeEnabled());
  expect(screen.queryByRole('alert')).toBeNull();
  expect(calls).not.toContain('verify-registration');
});

it('hides the add button when the browser lacks passkey support', async () => {
  setup({ supported: false });
  await screen.findByText('Passkey vom 03.11.2026');
  expect(screen.queryByRole('button', { name: 'Passkey hinzufügen' })).toBeNull();
  expect(screen.getByText(/unterstützt keine Passkeys/)).toBeInTheDocument();
});

it('removes a passkey after confirmation and refreshes the list', async () => {
  const { fetcher } = setup();
  await screen.findByText('Passkey vom 03.11.2026');
  vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
  fireEvent.click(screen.getByRole('button', { name: /Entfernen/ }));
  expect(fetcher.mock.calls.some(([u]) => String(u).endsWith('delete-passkey'))).toBe(false);
  vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
  fireEvent.click(screen.getByRole('button', { name: /Entfernen/ }));
  await waitFor(() => expect(screen.queryByText('Passkey vom 03.11.2026')).toBeNull());
  const del = fetcher.mock.calls.find(([u]) => String(u).endsWith('delete-passkey'))!;
  expect(JSON.parse(String(del[1]?.body))).toEqual({ id: 'k1' });
  expect(screen.getByText('Du hast noch keinen Passkey.')).toBeInTheDocument();
});
