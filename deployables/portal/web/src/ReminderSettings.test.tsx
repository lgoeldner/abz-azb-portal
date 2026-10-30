import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReminderSettings } from './ReminderSettings';
it('loads on disclosure and changes only reminder delivery', async () => {
  let enabled = true;
  const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
    if (options?.method === 'PATCH') enabled = JSON.parse(String(options.body)).enabled;
    return Response.json({ enabled });
  });
  vi.stubGlobal('fetch', fetcher);
  const { container } = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ReminderSettings />
    </QueryClientProvider>,
  );
  expect(fetcher).not.toHaveBeenCalled();
  const details = container.querySelector('details')!;
  details.open = true;
  fireEvent(details, new Event('toggle'));
  fireEvent.click(await screen.findByRole('button', { name: 'Erinnerungen ausschalten' }));
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/me/email-reminders',
      expect.objectContaining({ method: 'PATCH', body: '{"enabled":false}' }),
    ),
  );
  expect(await screen.findByRole('button', { name: 'Erinnerungen aktivieren' })).toBeInTheDocument();
});
