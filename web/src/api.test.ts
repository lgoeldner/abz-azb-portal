import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, canEdit, setCsrf } from './api';

afterEach(() => setCsrf(''));

describe('API client', () => {
  it('sends the session cookie and CSRF token on unsafe requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    setCsrf('csrf-test-token');

    await api('/submissions', { method: 'POST', body: JSON.stringify({ title: 'Probe' }) });

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/submissions', expect.objectContaining({
      credentials: 'same-origin',
      headers: expect.any(Headers),
    }));
    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get('X-CSRF-Token')).toBe('csrf-test-token');
    expect(headers.get('Content-Type')).toBe('application/json');
  });

  it('surfaces structured conflict errors without discarding their message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: { code: 'stale_version', message: 'Version ist veraltet.' } }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    )));

    await expect(api('/submissions/one')).rejects.toMatchObject({
      status: 409,
      code: 'stale_version',
      message: 'Version ist veraltet.',
    } satisfies Partial<ApiError>);
  });

  it('grants managers only their assigned categories', () => {
    const manager = { id: 'm', name: 'Redaktion', role: 'manager' as const, admitted: true, cohort_member: true, category_ids: ['a'], created_at: '2026-10-01T00:00:00Z' };
    expect(canEdit(manager, 'a')).toBe(true);
    expect(canEdit(manager, 'b')).toBe(false);
    expect(canEdit({ ...manager, role: 'admin' }, 'b')).toBe(true);
    expect(canEdit({ ...manager, role: 'student' }, 'a')).toBe(false);
  });
});
