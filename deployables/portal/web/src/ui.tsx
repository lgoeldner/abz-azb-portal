import {
  ArrowUpRight,
  BookHeart,
  Camera,
  Hash,
  Lightbulb,
  ListChecks,
  Quote,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  ApiError,
  date,
  editorial,
  statusLabels,
  type Category,
  type Me,
  type MyBallot,
  type Submission,
  type User,
} from './api';
import { DevDebug } from './DevDebug';
import { toast } from 'sonner';

// Shared class strings composed with page layout utilities.
export const btn = {
  primary:
    'inline-flex items-center justify-center gap-3 rounded-full bg-ink px-6 py-3 text-[15px] font-bold text-white transition-transform hover:bg-accent active:scale-95 hover:-translate-y-0.5',
  secondary:
    'inline-flex items-center justify-center gap-2 rounded-full bg-pop px-5 py-2.5 text-[15px] font-bold text-ink transition-transform hover:-translate-y-0.5 active:scale-95',
  text: 'inline-flex items-center gap-2 bg-transparent p-0 text-sm font-bold text-ink underline decoration-2 underline-offset-4 decoration-pop hover:decoration-accent hover:text-accent-dark',
  danger: 'inline-flex items-center gap-2 bg-transparent p-0 text-sm font-bold text-bad hover:underline',
};
export const field =
  'mt-1.5 block font-normal min-h-12 w-full rounded-ui border-2 border-line bg-white px-4 py-2 text-[15px] text-ink placeholder:text-muted/70 focus:border-ink';
export const label = 'block text-sm font-bold';
export const panel = 'rounded-ui bg-soft p-5 sm:p-6';
export const heading = 'text-xl font-extrabold tracking-tight';
export const notice = 'rounded-ui bg-soft px-4 py-3 text-sm';

export const Session = createContext<Me>(null!);
export const useSession = () => useContext(Session);
export function useData<T>(path: string, enabled = true) {
  return useQuery({ queryKey: [path], queryFn: () => api<T>(path), enabled });
}
export function useAction() {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  async function run(fn: () => Promise<unknown>, message = '') {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await client.invalidateQueries();
      if (message) toast.success(message);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, feedback: error && <Failure error={error} /> };
}

// View mode is a per-browser preference; only editors can leave the student view.
export type View = 'schueler' | 'redaktion';
export const WorkspaceView = createContext<[View, (view: View) => void]>(['schueler', () => {}]);
export const useWorkspaceView = () => useContext(WorkspaceView);
export function useView(): [View, (v: View) => void] {
  const { user } = useSession();
  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem('view') === 'schueler' ? 'schueler' : 'redaktion';
    } catch {
      return 'redaktion';
    }
  });
  const set = useCallback((v: View) => {
    setView(v);
    try {
      localStorage.setItem('view', v);
    } catch {
      /* private mode */
    }
  }, []);
  return [editorial(user) ? view : 'schueler', set];
}

export const roleName = (role: User['role']) =>
  ({ student: 'Jahrgang', manager: 'Redaktion', admin: 'Administration' })[role];
export function since(value: string | null | undefined) {
  if (!value) return '';
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  return days <= 0 ? 'seit heute' : days === 1 ? 'seit gestern' : `seit ${days} Tagen`;
}

export function Failure({ error, retry }: { error: Error; retry?: () => void }) {
  const stale =
    error instanceof ApiError &&
    error.status === 409 &&
    !['self_delete', 'last_admin', 'has_content'].includes(error.code);
  return (
    <div className="rounded-ui bg-bad-tint px-4 py-3 text-sm text-bad" role="alert">
      <strong>{stale ? 'Eine neuere Version liegt vor.' : 'Das hat noch nicht geklappt.'}</strong>
      <p className="mt-1">
        {stale
          ? 'Deine Eingaben bleiben erhalten. Lade die aktuelle Version, prüfe die Änderungen und versuche es erneut.'
          : error.message}
      </p>
      {error instanceof ApiError && error.status === 401 ? (
        <a className="mt-2 inline-block underline" href="/auth/login">
          Erneut anmelden →
        </a>
      ) : (
        retry && (
          <button type="button" className={`${btn.text} mt-2 text-bad`} onClick={retry}>
            Erneut versuchen
          </button>
        )
      )}
    </div>
  );
}
export function Loading() {
  return (
    <div className="flex min-h-36 items-center justify-center gap-3 text-sm text-muted" role="status">
      <span className="size-5 animate-spin rounded-full border-2 border-line border-t-accent" /> Einen Moment …
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-32 flex-col items-center justify-center rounded-ui border-2 border-dashed border-pill px-6 py-8 text-center text-sm text-muted [&_a]:font-semibold [&_a]:text-ink [&_a]:underline">
      {children}
    </div>
  );
}
const badgeTone: Record<keyof typeof statusLabels, string> = {
  pending: 'bg-pill text-muted',
  accepted: 'bg-ok-tint text-ok',
  open: 'bg-ok-tint text-ok',
  rejected: 'bg-bad-tint text-bad',
  withdrawn: 'bg-pill text-muted',
  closed: 'bg-pill text-muted',
  draft: 'bg-pill text-muted',
};
export function Badge({ status, label }: { status: keyof typeof statusLabels; label?: string }) {
  return (
    <span
      className={`inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${badgeTone[status]}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {label ?? statusLabels[status]}
    </span>
  );
}
// One class (kind) per Sammlung: one icon and one label for all six, shown wherever the class is named.
export type Kind = Category['kind'];
export const kindIcon: Record<Kind, LucideIcon> = {
  idea: Lightbulb,
  quote: Quote,
  memory: BookHeart,
  photo: Camera,
  person: UserRound,
  proposal: ListChecks,
  words: Hash,
};
export const kindLabel: Record<Kind, string> = {
  idea: 'Ideen',
  quote: 'Zitate',
  memory: 'Erinnerungen',
  photo: 'Fotos',
  person: 'Personenwahl',
  proposal: 'Vorschlagswahl',
  words: 'Wortwolke',
};
export const submissionKinds: Kind[] = ['idea', 'quote', 'memory', 'photo'];
export const ballotKinds: Kind[] = ['person', 'proposal', 'words'];
export const isSubmissionCollection = (kind: Kind) => submissionKinds.includes(kind);
export const isBallot = (kind: Kind) => ballotKinds.includes(kind);
// Keep these aliases while Sammlungen defaults migrate to the kind-based helpers.
export const repeatableKinds = submissionKinds;
export const singleKinds = ballotKinds;
export const allKinds: Kind[] = [...submissionKinds, ...ballotKinds];
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const time = (value: string | null | undefined) => (value ? new Date(value).getTime() : 0);
export const newestOpened = (a: Category, b: Category) =>
  time(b.opened_at ?? b.created_at) - time(a.opened_at ?? a.created_at);
export function KindIcon({ icon: Icon, className = 'size-4' }: { icon: LucideIcon; className?: string }) {
  return <Icon aria-hidden="true" strokeWidth={1.75} className={`shrink-0 ${className}`} />;
}
export function Arrow() {
  return <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />;
}
export function PageHead({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-10 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tighter sm:text-5xl">{title}</h1>
        {children && <p className="mt-2 max-w-2xl text-[15px] text-muted">{children}</p>}
      </div>
      {action}
    </header>
  );
}
export function SubmissionList({
  items,
  categories,
  ballots = [],
  showAuthor = false,
  editorialView = false,
  limit,
}: {
  items: Submission[];
  categories: Category[];
  ballots?: MyBallot[];
  showAuthor?: boolean;
  editorialView?: boolean;
  limit?: number;
}) {
  const { user } = useSession();
  const photoCollections = new Map(
    categories
      .filter((category) => !editorialView && category.kind === 'photo')
      .map((category) => [category.id, category]),
  );
  type Row =
    | { type: 'submission'; item: Submission; sortAt: number }
    | { type: 'photo'; category: Category; count: number; sortAt: number }
    | { type: 'ballot'; item: MyBallot; sortAt: number };
  const rows: Row[] = [];
  const photoGroups = new Map<string, Submission[]>();
  for (const item of items) {
    const collection = photoCollections.get(item.category_id);
    if (collection) {
      const photos = photoGroups.get(collection.id) ?? [];
      photos.push(item);
      photoGroups.set(collection.id, photos);
    } else rows.push({ type: 'submission', item, sortAt: new Date(item.updated_at).getTime() });
  }
  for (const [categoryId, photos] of photoGroups) {
    const category = photoCollections.get(categoryId)!;
    rows.push({
      type: 'photo',
      category,
      count: photos.reduce((total, item) => total + item.attachments.length, 0),
      sortAt: Math.max(...photos.map((item) => new Date(item.updated_at).getTime())),
    });
  }
  for (const item of ballots) rows.push({ type: 'ballot', item, sortAt: new Date(item.created_at).getTime() });
  if (!editorialView) rows.sort((a, b) => b.sortAt - a.sortAt);
  return (
    <ul className="divide-y divide-line overflow-hidden rounded-ui border-2 border-line bg-white">
      {rows.slice(0, limit).map((row) => {
        if (row.type === 'photo') {
          return (
            <li className="min-w-0" key={`photo:${row.category.id}`}>
              <Link
                className="flex items-center justify-between gap-4 rounded-ui px-4 py-3.5 hover:bg-pop/30"
                to={`/sammlungen/${row.category.id}`}
              >
                <span className="min-w-0">
                  <strong className="block break-words text-[15px] font-semibold">{row.category.name}</strong>
                  <small className="text-muted">
                    {row.count} {row.count === 1 ? 'Foto' : 'Fotos'}
                  </small>
                </span>
                <Arrow />
              </Link>
            </li>
          );
        }
        if (row.type === 'ballot') {
          const content = (
            <span className="flex items-center justify-between gap-4 rounded-ui px-4 py-3.5">
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[15px] font-semibold">{row.item.category_name}</strong>
                <small className="mt-0.5 block text-[13px] text-muted">
                  <span className="flex flex-wrap gap-x-2">
                    <span>{kindLabel[row.item.category_kind]}</span>
                    <span>{date(row.item.created_at)}</span>
                  </span>
                </small>
              </span>
              <span className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full bg-ok-tint px-2.5 py-1 text-xs font-bold text-ok">
                Abgestimmt
              </span>
            </span>
          );
          return (
            <li className="min-w-0" key={`ballot:${row.item.category_id}:${row.item.id}`}>
              {row.item.category_status === 'draft' ? (
                content
              ) : (
                <Link
                  className="block rounded-ui transition-colors hover:bg-pop/30"
                  to={`/sammlungen/${row.item.category_id}`}
                >
                  {content}
                </Link>
              )}
            </li>
          );
        }
        const s = row.item;
        return (
          <li className="min-w-0" key={`submission:${s.id}`}>
            <Link
              to={editorialView ? `/redaktion/beitraege/${s.id}` : `/beitraege/${s.id}`}
              data-editorial-row={editorialView || undefined}
              className="flex items-center gap-4 rounded-ui px-4 py-3.5 transition-colors hover:bg-pop/30"
            >
              <span className="min-w-0 flex-1">
                <strong className="block truncate text-[15px] font-semibold">{s.title}</strong>
                <small className="mt-0.5 block text-[13px] text-muted">
                  <span className="flex flex-wrap gap-x-2">
                    <span>{categories.find((c) => c.id === s.category_id)?.name ?? 'Beitrag'}</span>
                    {showAuthor && <span>{s.author_name}</span>}
                    <span>{date(s.updated_at)}</span>
                    {!!s.attachments?.length && <span>{s.attachments.length} Datei(en)</span>}
                  </span>
                </small>
              </span>
              <Badge status={s.status} />
            </Link>
            {import.meta.env.DEV && (
              <div className="px-4 pb-2">
                <DevDebug
                  label="Beitrag"
                  data={{
                    id: s.id,
                    category: s.category_id,
                    status: s.status,
                    version: s.version,
                    attachments: s.attachments?.length ?? 0,
                    editable: !editorialView && s.status === 'pending' && s.author_id === user.id,
                    own: s.author_id === user.id,
                  }}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
