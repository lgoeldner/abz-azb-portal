import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Session } from './ui';
import { EmailAdmin } from './EmailAdmin';

const admin = {
  user: {
    id: 'a',
    name: 'Admin',
    role: 'admin' as const,
    admitted: true,
    cohort_member: true,
    category_ids: [],
    created_at: '2026-10-29T00:00:00Z',
  },
  csrf_token: 'x',
};
const status = {
  policy: { version: 4, paused: false, pause_all: false, daily_limit: 40, reminder_limit: 10, login_reserve: 8 },
  usage: { day: '2026-10-29', used: 3, reserved: 1, login: 2, reminder: 1, remaining: 36 },
  provider: { name: 'Brevo', configured: true, credits: null, observed_at: null, error: null },
  health: { last_worker_run: null, pending: 0, failed: 0 },
};
function renderPage(role: 'admin' | 'student' = 'admin') {
  return render(
    <Session.Provider value={{ ...admin, user: { ...admin.user, role } }}>
      <EmailAdmin />
    </Session.Provider>,
  );
}

describe('email administration', () => {
  it('guards non-admin use and leaves unknown quota visibly unknown', async () => {
    renderPage('student');
    expect(screen.getByRole('alert')).toHaveTextContent('nur für Administratoren');
    const f = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/messages')
        ? Response.json({ items: [], next_cursor: null })
        : Response.json({ ...status, usage: { ...status.usage, remaining: null } }),
    );
    vi.stubGlobal('fetch', f);
    renderPage();
    expect(await screen.findByText('Verfügbar:')).toBeInTheDocument();
    expect(screen.getByText('Verfügbar:').parentElement).toHaveTextContent('—');
  });
  it('sends policy version, warns on pause all, and distinguishes accepted from delivered', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith('/admin/email/status')) return Response.json(status);
        if (url.includes('/admin/email/messages?'))
          return Response.json({
            items: [
              {
                id: 'm',
                created_at: '2026-10-29T12:00:00Z',
                user_id: null,
                user_name: '',
                recipient_masked: 'm***@example.org',
                kind: 'login',
                status: 'delivered',
                provider_message_id: null,
                attempts: 1,
                failure_code: null,
              },
            ],
            next_cursor: null,
          });
        return Response.json(status);
      }),
    );
    renderPage();
    await screen.findByText('Zugestellt');
    fireEvent.click(screen.getByLabelText('Alle E-Mails pausieren'));
    expect(screen.getByRole('alert')).toHaveTextContent('stoppt auch Anmelde-E-Mails');
    fireEvent.click(screen.getByRole('button', { name: 'Einstellungen speichern' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/admin/email/settings'))).toBe(true));
    const body = JSON.parse(calls.find((c) => c.url.endsWith('/admin/email/settings'))!.init!.body as string);
    expect(body.version).toBe(4);
    expect(body.pause_all).toBe(true);
  });

  it('offers a working retry after status loading fails', async () => {
    let statusCalls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/messages')) return Response.json({ items: [], next_cursor: null });
        statusCalls++;
        return statusCalls === 1
          ? Response.json(
              { error: { code: 'unavailable', message: 'Vorübergehend nicht erreichbar.' } },
              { status: 503 },
            )
          : Response.json(status);
      }),
    );
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Vorübergehend nicht erreichbar.');
    fireEvent.click(screen.getByRole('button', { name: 'Erneut versuchen' }));
    expect(await screen.findByText(/Brevo: konfiguriert/)).toBeInTheDocument();
  });
});
