import type { User } from './api-types';
export type * from './api-types';
export class ApiError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
let csrf = '';
export function setCsrf(value: string) { csrf = value; }
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  if (init.method && !['GET','HEAD'].includes(init.method)) headers.set('X-CSRF-Token', csrf);
  const response = await fetch(path.startsWith('/auth/') ? path : `/api/v1${path}`, { ...init, headers, credentials: 'same-origin' });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new ApiError(response.status, data?.error?.code ?? 'request_failed', data?.error?.message ?? 'Die Anfrage konnte nicht abgeschlossen werden.');
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export const json = (method: string, value?: unknown): RequestInit => ({ method, ...(value === undefined ? {} : { body: JSON.stringify(value) }) });
export const canEdit = (user: User, category: string) => user.role === 'admin' || user.role === 'manager' && user.category_ids.includes(category);
export const editorial = (user: User) => user.role !== 'student';
export const statusLabels = { pending: 'In Prüfung', accepted: 'Angenommen', rejected: 'Abgelehnt', withdrawn: 'Zurückgezogen', draft: 'Entwurf', open: 'Offen', closed: 'Beendet' };
export const date = (value: string) => new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
