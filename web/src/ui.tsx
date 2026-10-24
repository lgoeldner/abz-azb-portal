import { ArrowUpRight } from 'lucide-react';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError, canEdit, date, editorial, statusLabels, type Category, type Me, type Submission, type User } from './api';
import { DevDebug } from './DevDebug';
import { toast } from 'sonner';

// Shared class strings. Pages compose these with layout utilities; no component CSS exists.
export const btn = {
  primary: 'inline-flex items-center justify-center gap-3 rounded-full bg-ink px-6 py-3 text-[15px] font-bold text-white transition-transform hover:bg-accent active:scale-95 hover:-translate-y-0.5',
  secondary: 'inline-flex items-center justify-center gap-2 rounded-full bg-pop px-5 py-2.5 text-[15px] font-bold text-ink transition-transform hover:-translate-y-0.5 active:scale-95',
  text: 'inline-flex items-center gap-2 bg-transparent p-0 text-sm font-bold text-ink underline decoration-2 underline-offset-4 decoration-pop hover:decoration-accent hover:text-accent-dark',
  danger: 'inline-flex items-center gap-2 bg-transparent p-0 text-sm font-bold text-bad hover:underline',
};
export const field = 'mt-1.5 block font-normal min-h-12 w-full rounded-ui border-2 border-line bg-white px-4 py-2 text-[15px] text-ink placeholder:text-muted/70 focus:border-ink';
export const label = 'block text-sm font-bold';
export const panel = 'rounded-ui bg-soft p-5 sm:p-6';
export const heading = 'text-xl font-extrabold tracking-tight';
export const notice = 'rounded-ui bg-soft px-4 py-3 text-sm';

export const Session = createContext<Me>(null!);
export const useSession = () => useContext(Session);
export function useData<T>(path: string, enabled = true) { return useQuery({ queryKey: [path], queryFn: () => api<T>(path), enabled }); }
export function useAction() {
  const client = useQueryClient(); const [busy, setBusy] = useState(false); const [error, setError] = useState<Error|null>(null);
  async function run(fn: () => Promise<unknown>, message = '') { setBusy(true); setError(null); try { await fn(); await client.invalidateQueries(); if (message) toast.success(message); } catch (e) { setError(e as Error); } finally { setBusy(false); } }
  return { busy, error, run, feedback: error && <Failure error={error}/> };
}

// View mode is a per-browser preference; only editors can leave the student view.
export type View = 'schueler' | 'redaktion';
export function useView(): [View, (v: View) => void] {
  const { user } = useSession();
  const [view, setView] = useState<View>(() => { try { return localStorage.getItem('view') === 'schueler' ? 'schueler' : 'redaktion'; } catch { return 'redaktion'; } });
  const set = (v: View) => { setView(v); try { localStorage.setItem('view', v); } catch { /* private mode */ } };
  return [editorial(user) ? view : 'schueler', set];
}

export const roleName = (role: User['role']) => ({ student: 'Jahrgang', manager: 'Redaktion', admin: 'Administration' })[role];
export function since(value: string | null | undefined) {
  if (!value) return '';
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  return days <= 0 ? 'seit heute' : days === 1 ? 'seit gestern' : `seit ${days} Tagen`;
}

export function Failure({ error, retry }: { error: Error; retry?: () => void }) {
  const stale = error instanceof ApiError && error.status === 409;
  return <div className="rounded-ui bg-bad-tint px-4 py-3 text-sm text-bad" role="alert"><strong>{stale ? 'Eine neuere Version liegt vor.' : 'Das hat noch nicht geklappt.'}</strong><p className="mt-1">{stale ? 'Deine Eingaben bleiben erhalten. Lade die aktuelle Version, prüfe die Änderungen und versuche es erneut.' : error.message}</p>{error instanceof ApiError && error.status === 401 ? <a className="mt-2 inline-block underline" href="/auth/login">Erneut anmelden →</a> : retry && <button type="button" className={`${btn.text} mt-2 text-bad`} onClick={retry}>Erneut versuchen</button>}</div>;
}
export function Loading() { return <div className="flex min-h-36 items-center justify-center gap-3 text-sm text-muted" role="status"><span className="size-5 animate-spin rounded-full border-2 border-line border-t-accent"/> Einen Moment …</div>; }
export function Empty({ children }: { children: ReactNode }) { return <div className="flex min-h-32 flex-col items-center justify-center rounded-ui border-2 border-dashed border-pill px-6 py-8 text-center text-sm text-muted [&_a]:font-semibold [&_a]:text-ink [&_a]:underline">{children}</div>; }
const badgeTone: Record<keyof typeof statusLabels, string> = { pending: 'bg-wait-tint text-wait', accepted: 'bg-ok-tint text-ok', open: 'bg-ok-tint text-ok', rejected: 'bg-bad-tint text-bad', withdrawn: 'bg-pill text-muted', closed: 'bg-pill text-muted', draft: 'bg-pill text-muted' };
export function Badge({ status }: { status: keyof typeof statusLabels }) { return <span className={`inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${badgeTone[status]}`}><span className="size-1.5 rounded-full bg-current"/>{statusLabels[status]}</span>; }
export function Arrow() { return <ArrowUpRight aria-hidden="true" className="size-4 shrink-0"/>; }
export function PageHead({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <header className="mb-10 flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><h1 className="text-4xl font-extrabold leading-[1.05] tracking-tighter sm:text-5xl">{title}</h1>{children && <p className="mt-2 max-w-2xl text-[15px] text-muted">{children}</p>}</div>{action}</header>;
}
export function SubmissionList({ items, categories, showAuthor = false }: { items: Submission[]; categories: Category[]; showAuthor?: boolean }) {
  const { user } = useSession();
  return <ul className="divide-y divide-line overflow-hidden rounded-ui border-2 border-line bg-white">{items.map(s => <li className="min-w-0" key={s.id}><Link to={`/beitraege/${s.id}`} className="flex items-center gap-4 px-4 py-3.5 transition-colors hover:bg-pop/30"><span className="min-w-0 flex-1"><strong className="block truncate text-[15px] font-semibold">{s.title}</strong><small className="mt-0.5 block text-[13px] text-muted"><span className="flex flex-wrap gap-x-2"><span>{categories.find(c => c.id === s.category_id)?.name ?? 'Beitrag'}</span>{showAuthor && <span>{s.author_name}</span>}<span>{date(s.updated_at)}</span>{!!s.attachments?.length && <span>{s.attachments.length} Datei(en)</span>}</span></small></span><Badge status={s.status}/></Link>{import.meta.env.DEV && <div className="px-4 pb-2"><DevDebug label="Beitrag" data={{ id: s.id, category: s.category_id, status: s.status, version: s.version, attachments: s.attachments?.length ?? 0, editable: (s.status === 'pending' && s.author_id === user.id) || canEdit(user, s.category_id), own: s.author_id === user.id }}/></div>}</li>)}</ul>;
}
