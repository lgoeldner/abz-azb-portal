import {
  ArrowUpRight,
  BookHeart,
  Camera,
  Hash,
  IdCard,
  Lightbulb,
  ListChecks,
  Quote,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { createContext, useCallback, useContext, useState, type ReactNode, type ComponentProps } from 'react';
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
  redaktion:
    'inline-flex items-center justify-center gap-3 rounded-full bg-redaktion px-6 py-3 text-[15px] font-bold text-white transition-transform hover:bg-redaktion-dark active:scale-95 hover:-translate-y-0.5',
  text: 'inline-flex items-center gap-2 bg-transparent p-0 text-sm font-bold text-ink underline decoration-2 underline-offset-4 decoration-accent/40 hover:decoration-accent hover:text-accent-dark',
  danger: 'inline-flex items-center gap-2 bg-transparent p-0 text-sm font-bold text-bad hover:underline',
};
export const field =
  'mt-1.5 block font-normal min-h-12 w-full rounded-ui border-2 border-line bg-white px-4 py-2 text-[15px] text-ink placeholder:text-muted focus:border-ink';
export const label = 'block text-sm font-bold';
export const panel = 'rounded-ui bg-soft p-5 sm:p-6';
export const heading = 'text-xl font-bold tracking-tight';
export const card = 'flex min-w-0 flex-col rounded-ui border border-line bg-white p-5 sm:p-6';
export const notice = 'rounded-ui bg-soft px-4 py-3 text-sm';

// Floating controls share one geometry so the corners stay concentric: 48px items, padding = gap = 6px,
// outer radius = 24px item radius + 6px = 30px.
export const roundButton =
  'grid size-12 flex-none place-items-center rounded-full border border-black/10 transition-[translate,border-color,box-shadow] duration-100 hover:-translate-y-1 active:translate-y-0.5 active:shadow-none';
// Colours follow the surrounding workspace; `workspace` pins one palette (corner, 27, ink, paper) regardless of the view.
export function Mark({ className = 'size-8', workspace }: { className?: string; workspace?: View }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 40 40" className={`flex-none ${className}`} data-workspace={workspace}>
      <g transform="rotate(-7 20 20)">
        <path d="M5 4h30a2 2 0 0 1 2 2v28a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" className="fill-ink" />
        <path d="M37 6v11H26a2 2 0 0 1-2-2V4h11a2 2 0 0 1 2 2z" className="fill-accent" />
        <path d="M24 4v11a2 2 0 0 0 2 2h11" fill="none" strokeWidth="1.5" className="stroke-paper" />
        <text
          x="4.5"
          y="31"
          fontSize="21"
          fontWeight="800"
          letterSpacing="-1.5"
          className="fill-pop"
          style={{ fontFamily: 'inherit' }}
        >
          27
        </text>
        <rect x="6" y="9" width="13" height="2.4" rx="1.2" className="fill-paper" />
      </g>
    </svg>
  );
}
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
    <div className="flex min-h-32 flex-col items-center justify-center rounded-ui bg-soft px-6 py-8 text-center text-sm text-muted [&_a]:font-semibold [&_a]:text-ink [&_a]:underline">
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
// One class (kind) per Abstimmung: one icon and one label for all eight, shown wherever the class is named.
export type Kind = Category['kind'];
export const kindIcon: Record<Kind, LucideIcon> = {
  idea: Lightbulb,
  quote: Quote,
  memory: BookHeart,
  photo: Camera,
  steckbrief: IdCard,
  person: UserRound,
  proposal: ListChecks,
  words: Hash,
};
export const kindLabel: Record<Kind, string> = {
  idea: 'Ideen',
  quote: 'Zitate',
  memory: 'Erinnerungen',
  photo: 'Fotos',
  steckbrief: 'Steckbrief',
  person: 'Personenwahl',
  proposal: 'Auswahl',
  words: 'Wortwolke',
};
export const submissionKinds: Kind[] = ['idea', 'quote', 'memory', 'photo', 'steckbrief'];
export const ballotKinds: Kind[] = ['person', 'proposal', 'words'];
export const isSubmissionCollection = (kind: Kind) => submissionKinds.includes(kind);
export const isBallot = (kind: Kind) => ballotKinds.includes(kind);
// Keep these aliases while Abstimmungen defaults migrate to the kind-based helpers.
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
        <h1 className="text-4xl leading-[1.05] sm:text-5xl">{title}</h1>
        {children && <p className="mt-2 max-w-2xl text-[15px] text-ink-soft">{children}</p>}
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

// ---------- project tools (PROJECT_MANAGEMENT): shared tags, avatars and status tones ----------
export const projectsEnabled = (me: Me) => !!me.project_management;
export const initialsOf = (name: string) =>
  name
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('');
// Notion-like tag tones; full class strings so Tailwind sees them.
const TAG_TONES = [
  'bg-[#e3e2e0] text-[#32302c]',
  'bg-[#d3e5ef] text-[#183347]',
  'bg-[#e8deee] text-[#412454]',
  'bg-[#dbeddb] text-[#1c3829]',
  'bg-[#fadec9] text-[#49290e]',
  'bg-[#fdecc8] text-[#402c1b]',
  'bg-[#f5e0e9] text-[#4c2337]',
  'bg-[#eee0da] text-[#442a1e]',
  'bg-[#ffe2dd] text-[#5d1715]',
];
/** Bereich tag tone from its position, so colours stay stable without a DB column. */
export const areaTone = (position: number) =>
  TAG_TONES[(((position - 1) % TAG_TONES.length) + TAG_TONES.length) % TAG_TONES.length]!;
export function AreaTag({ name, position, className = '' }: { name: string; position: number; className?: string }) {
  return (
    <span
      className={`inline-flex max-w-full items-center truncate rounded-md px-2 py-0.5 text-[13px] font-semibold ${areaTone(position)} ${className}`}
    >
      {name}
    </span>
  );
}
const AVATAR_TONES = [
  'bg-[#c2185b]',
  'bg-[#e8590c]',
  'bg-[#2f80c1]',
  'bg-[#7b4fb0]',
  'bg-[#2e7d4f]',
  'bg-[#b7791f]',
  'bg-[#5d6270]',
];
const hash = (value: string) => [...value].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7);
export function Avatar({
  user,
  className = 'size-6 text-[11px]',
}: {
  user: { id: string; name: string };
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`grid flex-none place-items-center rounded-full font-bold text-white ${AVATAR_TONES[Math.abs(hash(user.id)) % AVATAR_TONES.length]} ${className}`}
    >
      {initialsOf(user.name) || '?'}
    </span>
  );
}
/** Scrollable checkbox list of people with avatars (ticket assignees, collection editors). */
export function PersonChecklist<T extends { id: string; name: string }>({
  people,
  checked,
  onToggle,
  name = (person) => person.name,
  extra,
  ...group
}: {
  people: T[];
  checked: (person: T) => boolean;
  onToggle: (person: T, checked: boolean) => void;
  name?: (person: T) => string;
  extra?: (person: T) => ReactNode;
} & Pick<ComponentProps<'div'>, 'id' | 'role' | 'aria-label'>) {
  return (
    <div {...group} className="grid max-h-60 gap-0.5 overflow-y-auto rounded-ui border border-[#e9e9e7] bg-white p-1.5">
      {people.map((p) => (
        <label
          key={p.id}
          className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm hover:bg-soft"
        >
          <input
            type="checkbox"
            className="size-4 flex-none"
            checked={checked(p)}
            onChange={(e) => onToggle(p, e.target.checked)}
          />
          <Avatar user={p} />
          <span className="min-w-0 flex-1 truncate">{name(p)}</span>
          {extra?.(p)}
        </label>
      ))}
    </div>
  );
}
export type TicketStatus = 'todo' | 'in_progress' | 'review' | 'done';
/** Board column tones as in the Notion reference: grey, blue, purple, green. */
export const statusTone: Record<
  TicketStatus,
  { label: string; column: string; pill: string; dot: string; text: string }
> = {
  todo: {
    label: 'Offen',
    column: 'bg-[#e9e8e4]',
    pill: 'bg-[#e3e2e0] text-[#32302c]',
    dot: 'bg-[#9b9a97]',
    text: 'text-[#787774]',
  },
  in_progress: {
    label: 'In Arbeit',
    column: 'bg-[#dde9f3]',
    pill: 'bg-[#d3e5ef] text-[#183347]',
    dot: 'bg-[#2f80c1]',
    text: 'text-[#2f80c1]',
  },
  review: {
    label: 'Wartet auf Review',
    column: 'bg-[#eae1f2]',
    pill: 'bg-[#e8deee] text-[#412454]',
    dot: 'bg-[#9065b0]',
    text: 'text-[#9065b0]',
  },
  done: {
    label: 'Fertig',
    column: 'bg-[#deede2]',
    pill: 'bg-[#dbeddb] text-[#1c3829]',
    dot: 'bg-[#448361]',
    text: 'text-[#448361]',
  },
};
export function StatusPill({ status, className = '' }: { status: TicketStatus; className?: string }) {
  const tone = statusTone[status];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${tone.pill} ${className}`}
    >
      <span aria-hidden="true" className={`size-2 rounded-full ${tone.dot}`} />
      {tone.label}
    </span>
  );
}

/** Short relative time ("vor 5 Min.", "vor 2 Tagen"), the full date after a week. */
export function ago(value: string) {
  const minutes = Math.floor((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return 'vor ' + minutes + ' Min.';
  if (minutes < 1440) return 'vor ' + Math.floor(minutes / 60) + ' Std.';
  const days = Math.floor(minutes / 1440);
  return days < 7 ? (days === 1 ? 'vor 1 Tag' : 'vor ' + days + ' Tagen') : date(value);
}
