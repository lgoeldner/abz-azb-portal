import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Check,
  ChevronDown,
  ClipboardCheck,
  FileText,
  Hand,
  Info,
  ListChecks,
  MessageSquare,
  Newspaper,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, ApiError, date, json } from './api';
import type { Area, Ticket, TicketDetail, TicketEvent, UserRef } from './api';
import {
  ago,
  AreaTag,
  Avatar,
  btn,
  Empty,
  Failure,
  field,
  heading,
  KindIcon,
  label,
  Loading,
  PageHead,
  panel,
  StatusPill,
  statusTone,
  useData,
  useSession,
  type TicketStatus,
} from './ui';

// The editor (Milkdown) is large: it is only fetched when a ticket page or the new-ticket form is opened.
const MarkdownEditor = lazy(() => import('./Editor'));
const EditorFallback = () => (
  <div className="min-h-24 rounded-ui bg-soft px-4 py-3 text-sm text-muted" role="status">
    Editor wird geladen …
  </div>
);
function Markdown({ value, name }: { value: string; name: string }) {
  return (
    <Suspense fallback={<div className="whitespace-pre-wrap text-[15px]">{value}</div>}>
      <MarkdownEditor value={value} readonly label={name} />
    </Suspense>
  );
}

type Status = TicketStatus;
type Size = Ticket['size'];
const STATUSES: Status[] = ['todo', 'in_progress', 'review', 'done'];
const isStatus = (value: string | null | undefined): value is Status => STATUSES.includes(value as Status);
const SIZES: Size[] = ['XS', 'S', 'M', 'L', 'XL'];
const typeLabel: Record<Ticket['type'], string> = { aufgabe: 'Aufgabe', artikel: 'Artikel' };
const typeIcon: Record<Ticket['type'], LucideIcon> = { aufgabe: ListChecks, artikel: Newspaper };
const TEMPLATE = '## Ergebnis wird abgelegt in:\n\n';

const HELP = {
  wer: 'Offen, wenn niemand direkt anfängt. Wenn du direkt anfängst: dich in Wer eintragen.',
  bereich: 'Den richtigen Bereich eintragen.',
  seiten: 'Wenn am Ende Seiten in der Zeitung durch die Aufgabe landen: geschätzte Anzahl eintragen.',
  ziel: 'Muss messbar sein (begrenzte Anzahl statt offener Aufgabe, z. B. 5 Angebote besorgen statt mehrere) und innerhalb einer Arbeitsphase (zwei Wochen) erfüllbar sein, sonst in Unteraufgaben teilen.',
  beschreibung: 'Im Text soll stehen, wo das Ergebnis abgelegt wird.',
  groesse: 'T-Shirt-Größen: 10 Minuten Aufgabe = XS, 20 Stunden = XL.',
  uebernehmen: 'Dich selbst in Wer eintragen.',
  fertig: 'Status auf Fertig setzen und den Bereichsverantwortlichen schreiben.',
};
const fertigHelp = (reviewers: UserRef[]) =>
  reviewers.length
    ? HELP.fertig + ' Bereichsverantwortliche: ' + reviewers.map((r) => r.name).join(', ') + '.'
    : HELP.fertig;

const blank = (markdown: string) => markdown.replace(/<br\s*\/?>|&nbsp;|\s/gi, '') === '';
const errorText = (e: Error) => {
  if (e instanceof ApiError && e.status === 409) return 'Das Ticket wurde inzwischen geändert. Bitte erneut prüfen.';
  if (e instanceof ApiError && e.status === 403) return 'Dafür fehlt dir die Berechtigung.';
  return e.message;
};

/** "vor 2 Std."; older than a week falls back to the date. */

/** Closes a popover on Escape (focus goes back to its trigger, the first button) and on a press outside of it. */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const press = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      close();
      ref.current?.querySelector('button')?.focus();
    };
    // Tabbing out of the popover closes it as well.
    const leave = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      if (next && !ref.current?.contains(next)) close();
    };
    const node = ref.current;
    document.addEventListener('pointerdown', press);
    document.addEventListener('keydown', key);
    node?.addEventListener('focusout', leave);
    return () => {
      document.removeEventListener('pointerdown', press);
      document.removeEventListener('keydown', key);
      node?.removeEventListener('focusout', leave);
    };
  });
  return ref;
}

/** Below md the popovers span the screen width (fixed, left in the flow); from md they hang under their trigger. */
const popover =
  'z-30 rounded-lg border border-[#e9e9e7] bg-white shadow-lg max-md:fixed max-md:inset-x-4 md:absolute md:left-0 md:top-full mt-1';

/**
 * Runs one ticket write. Unlike useAction it also refetches after a failure, so a 409 never leaves a card
 * with a stale version. run() resolves true on success; success-only effects belong after it.
 */
function useTicketAction() {
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(fn: () => Promise<unknown>, success = '') {
    setBusy(true);
    setError('');
    try {
      await fn();
      if (success) toast.success(success);
      return true;
    } catch (e) {
      setError(errorText(e as Error));
      return false;
    } finally {
      await client.invalidateQueries();
      setBusy(false);
    }
  }
  return { busy, error, run, clear: () => setError('') };
}
const ErrorNotice = ({ error }: { error: string }) =>
  error ? (
    <p role="alert" className="rounded-ui bg-bad-tint px-4 py-3 text-sm text-bad">
      {error}
    </p>
  ) : null;

/** Info button with a popover; reachable by keyboard, closes with Escape or blur. */
function Hint({ name, children }: { name: string; children: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
    >
      <button
        type="button"
        aria-label={'Hilfe: ' + name}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        className="relative inline-flex size-6 items-center justify-center rounded-full bg-transparent text-muted before:absolute before:-inset-2.5 hover:text-ink"
        onClick={() => setOpen(!open)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        <Info aria-hidden="true" className="size-4" />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-0 top-full z-30 mt-1 w-64 rounded-ui bg-ink px-3 py-2 text-xs font-normal normal-case text-white shadow-lg"
        >
          {children}
        </span>
      )}
    </span>
  );
}

const isReviewer = (user: { id: string; role: string }, area?: Area) =>
  user.role === 'admin' || !!area?.reviewers.some((r) => r.id === user.id);
const canSelfApprove = (user: { id: string }, ticket: Ticket, area?: Area) =>
  ticket.assignee?.id === user.id &&
  !!area?.reviewers.some((r) => r.id === user.id) &&
  (ticket.size === 'XS' || ticket.size === 'S') &&
  ticket.type === 'aufgabe';
const awaitingApproval = (t: Ticket) => t.status === 'done' && !t.approved;

function ApprovalBadge({ ticket }: { ticket: Ticket }) {
  if (ticket.status !== 'done') return null;
  return ticket.approved ? (
    <span className="inline-flex rounded-full bg-ok-tint px-2.5 py-1 text-xs font-bold text-ok">Abgenommen</span>
  ) : (
    <span className="inline-flex rounded-full bg-wait-tint px-2.5 py-1 text-xs font-bold text-wait">
      Wartet auf Abnahme
    </span>
  );
}

// ---------------------------------------------------------------- Area picker

/** Notion-like Bereich select: tag button, popover with search, options as tags. */
function AreaPicker({
  areas,
  value,
  onChange,
  id,
  all = false,
}: {
  areas: Area[];
  value: string;
  onChange: (id: string) => void;
  id?: string;
  /** Filter mode: adds an "Alle Bereiche" option and shows it when nothing is selected. */
  all?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const close = () => {
    setOpen(false);
    setQuery('');
  };
  const ref = useDismiss(open, close);
  const current = areas.find((a) => a.id === value);
  const needle = query.trim().toLowerCase();
  const options: (Area | null)[] = [
    ...(all && !needle ? [null] : []),
    ...areas.filter((a) => a.name.toLowerCase().includes(needle)),
  ];
  const pick = (area: Area | null) => {
    onChange(area?.id ?? '');
    close();
    ref.current?.querySelector('button')?.focus();
  };
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (options.length) setActive((active + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = options[Math.min(active, options.length - 1)];
      if (chosen !== undefined) pick(chosen);
    }
  }
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={
          (all
            ? 'flex min-h-11 items-center gap-2 rounded-lg border border-line bg-white px-3 '
            : 'mt-1.5 flex min-h-12 w-full items-center gap-2 rounded-ui border-2 border-line bg-white px-4 py-2 text-left ') +
          'text-[15px] focus:border-ink'
        }
        onClick={() => {
          setActive(
            Math.max(
              0,
              options.findIndex((o) => (o?.id ?? '') === value),
            ),
          );
          setOpen(!open);
        }}
      >
        {current ? (
          <AreaTag name={current.name} position={current.position} />
        ) : (
          <span className={all ? 'font-semibold' : 'text-muted'}>{all ? 'Alle Bereiche' : 'Bitte wählen'}</span>
        )}
        <ChevronDown aria-hidden="true" className="ml-auto size-4 flex-none text-muted" />
      </button>
      {open && (
        <div className={popover + ' p-1.5 md:w-80'}>
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={options.length ? listId + '-' + Math.min(active, options.length - 1) : undefined}
            aria-label="Bereich suchen"
            placeholder="Bereich suchen …"
            className="mb-1 block min-h-11 w-full rounded-md border border-line bg-white px-3 text-[15px] focus:border-ink"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <div role="listbox" id={listId} aria-label="Bereiche" className="max-h-72 overflow-y-auto">
            {options.map((a, i) => {
              const selected = (a?.id ?? '') === value;
              return (
                <button
                  key={a?.id ?? 'all'}
                  type="button"
                  role="option"
                  id={listId + '-' + i}
                  tabIndex={-1}
                  aria-selected={selected}
                  className={
                    'flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-[15px] hover:bg-soft ' +
                    (i === active ? 'bg-soft' : '')
                  }
                  onClick={() => pick(a)}
                >
                  {a ? (
                    <AreaTag name={a.name} position={a.position} />
                  ) : (
                    <span className="font-semibold">Alle Bereiche</span>
                  )}
                  {selected && <Check aria-hidden="true" className="ml-auto size-4 flex-none" />}
                </button>
              );
            })}
            {!options.length && <p className="px-2 py-3 text-sm text-muted">Kein Bereich gefunden</p>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Board

const chip = (active: boolean) =>
  'inline-flex min-h-11 items-center rounded-full px-4 text-sm font-bold transition-colors ' +
  (active ? 'bg-ink text-white' : 'bg-pill text-ink hover:bg-soft');

/** Small "Filter" popover that keeps the less used board filters out of the way. */
function FilterMenu({ count, children }: { count: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={chip(count > 0) + ' gap-2'}
        onClick={() => setOpen(!open)}
      >
        <SlidersHorizontal aria-hidden="true" className="size-4" /> Filter
        {count > 0 && <span className="text-xs">({count})</span>}
      </button>
      {open && (
        <div role="dialog" aria-label="Filter" className={popover + ' grid gap-4 p-4 md:w-72'}>
          {children}
        </div>
      )}
    </div>
  );
}

export function Board() {
  const { user } = useSession();
  const admin = user.role === 'admin';
  const [showFinished, setShowFinished] = useState(false);
  const [areaId, setAreaId] = useState('');
  const [type, setType] = useState<Ticket['type'] | ''>('');
  const [mine, setMine] = useState(false);
  const [query, setQuery] = useState('');
  const [dragId, setDragId] = useState('');
  const [over, setOver] = useState('');
  const tickets = useData<Ticket[]>('/tickets' + (showFinished ? '?include_finished=true' : ''));
  const areas = useData<Area[]>('/areas');
  const action = useTicketAction();

  const needle = query.trim().toLowerCase().replace(/^#/, '');
  const visible = (tickets.data ?? []).filter(
    (t) =>
      (!areaId || t.area_id === areaId) &&
      (!type || t.type === type) &&
      (!mine || t.assignee?.id === user.id) &&
      (!needle ||
        [String(t.number), t.title, t.area_name, t.assignee?.name ?? ''].some((s) => s.toLowerCase().includes(needle))),
  );
  // A chosen Bereich always shows, even without tickets, so its "+ Neu" rows stay reachable.
  const groups = (areas.data ?? [])
    .filter((a) => (areaId ? a.id === areaId : visible.some((t) => t.area_id === a.id)))
    .sort((a, b) => a.position - b.position);

  function move(ticket: Ticket, status: Status) {
    if (ticket.status === status) return;
    void action.run(() => api('/tickets/' + ticket.id + '/status', json('POST', { version: ticket.version, status })));
  }
  const dragged = tickets.data?.find((t) => t.id === dragId);
  // A card only moves within its own Bereich.
  function drop(event: DragEvent, areaOfColumn: string, status: Status) {
    event.preventDefault();
    setOver('');
    setDragId('');
    if (dragged && dragged.area_id === areaOfColumn) move(dragged, status);
  }
  const mayMove = (t: Ticket, area: Area) => isReviewer(user, area) || t.assignee?.id === user.id;

  const typeFilter = (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Typ">
      {(['', 'aufgabe', 'artikel'] as const).map((t) => (
        <button
          key={t || 'alle'}
          type="button"
          aria-pressed={type === t}
          className={chip(type === t)}
          onClick={() => setType(t)}
        >
          {t ? typeLabel[t] + (t === 'aufgabe' ? 'n' : '') : 'Alle Typen'}
        </button>
      ))}
    </div>
  );
  const finishedFilter = (
    <label className="flex min-h-11 items-center gap-3 text-sm font-bold">
      <input
        type="checkbox"
        checked={showFinished}
        onChange={(e) => setShowFinished(e.target.checked)}
        className="size-5"
      />
      Abgeschlossene zeigen
    </label>
  );

  return (
    <div>
      <PageHead
        title="Tickets"
        action={
          <Link className={btn.primary} to="/tickets/neu">
            <Plus aria-hidden="true" className="size-4" /> Neues Ticket
          </Link>
        }
      >
        {admin
          ? 'Aufgaben und Artikel der Abizeitung. Ziehe Karten in eine andere Spalte oder tippe auf den Status einer Karte.'
          : undefined}
      </PageHead>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <label className="relative block min-w-48 flex-1 text-sm font-bold sm:max-w-xs">
          <span className="sr-only">Suche</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            placeholder="Titel, Nummer, Person …"
            aria-label="Suche"
            className={field + ' !mt-0 !min-h-11 pl-9'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {areas.data && <AreaPicker all areas={areas.data} value={areaId} onChange={setAreaId} />}
        <button type="button" aria-pressed={mine} className={chip(mine)} onClick={() => setMine(!mine)}>
          Meine
        </button>
        {admin ? (
          <>
            {typeFilter}
            {finishedFilter}
          </>
        ) : (
          <FilterMenu count={(type ? 1 : 0) + (showFinished ? 1 : 0)}>
            {typeFilter}
            {finishedFilter}
          </FilterMenu>
        )}
      </div>
      <div className="mb-4">
        <ErrorNotice error={action.error} />
      </div>
      {tickets.isPending || areas.isPending ? (
        <Loading />
      ) : tickets.error ? (
        <Failure error={tickets.error} retry={() => void tickets.refetch()} />
      ) : areas.error ? (
        <Failure error={areas.error} retry={() => void areas.refetch()} />
      ) : groups.length ? (
        <div className="grid grid-cols-1 gap-8">
          {groups.map((area) => {
            const inArea = visible.filter((t) => t.area_id === area.id);
            return (
              <section key={area.id} aria-label={'Bereich ' + area.name}>
                <details open className="group">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                    <ChevronDown
                      aria-hidden="true"
                      className="size-5 text-muted transition-transform -rotate-90 group-open:rotate-0"
                    />
                    <AreaTag name={area.name} position={area.position} className="!text-[15px]" />
                    <span className="text-sm text-muted">{inArea.length}</span>
                  </summary>
                  <div className="mt-2 flex snap-x snap-mandatory items-start gap-3 overflow-x-auto pb-2 md:grid md:items-stretch md:grid-cols-2 md:overflow-visible xl:grid-cols-4">
                    {STATUSES.map((status) => {
                      const tone = statusTone[status];
                      const cards = inArea.filter((t) => t.status === status);
                      const key = area.id + ':' + status;
                      return (
                        <section
                          key={status}
                          aria-label={tone.label}
                          data-column={status}
                          className={
                            'w-[85vw] max-w-sm flex-none snap-start rounded-xl p-3 md:w-auto md:max-w-none ' +
                            tone.column +
                            (over === key && dragged ? ' outline outline-2 outline-ink/30' : '')
                          }
                          onDragOver={(e) => {
                            if (!dragged || dragged.area_id !== area.id) return;
                            e.preventDefault();
                            setOver(key);
                          }}
                          onDragLeave={() => setOver('')}
                          onDrop={(e) => drop(e, area.id, status)}
                        >
                          <h3 className="mb-3 flex items-center gap-2 px-1">
                            <StatusPill status={status} />
                            <span className="text-sm font-semibold text-muted">{cards.length}</span>
                            {status === 'done' && admin && <Hint name="Fertig">{fertigHelp(area.reviewers)}</Hint>}
                          </h3>
                          <ul className="grid gap-2.5">
                            {cards.map((t) => (
                              <TicketCard
                                key={t.id}
                                ticket={t}
                                position={area.position}
                                busy={action.busy}
                                movable={mayMove(t, area)}
                                onDragStart={() => setDragId(t.id)}
                                onDragEnd={() => {
                                  setDragId('');
                                  setOver('');
                                }}
                                onMove={(s) => move(t, s)}
                              />
                            ))}
                            <li>
                              <Link
                                to={'/tickets/neu?bereich=' + area.id + '&status=' + status}
                                aria-label={'Neu in ' + area.name + ': ' + tone.label}
                                className={
                                  'flex min-h-11 items-center gap-2 rounded-[10px] px-3.5 text-[15px] font-semibold hover:bg-white/70 ' +
                                  tone.text
                                }
                              >
                                <Plus aria-hidden="true" className="size-4" /> Neu
                              </Link>
                            </li>
                          </ul>
                        </section>
                      );
                    })}
                  </div>
                </details>
              </section>
            );
          })}
        </div>
      ) : (
        <Empty>Keine Tickets</Empty>
      )}
    </div>
  );
}

/** The card's status pill: opens four large status buttons (bottom sheet on phones, popover from md). */
function StatusMenu({ ticket: t, busy, onMove }: { ticket: Ticket; busy: boolean; onMove: (status: Status) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useDismiss(open, () => setOpen(false));
  // Keeps Tab inside the modal sheet.
  function trapTab(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const buttons = e.currentTarget.querySelectorAll('button');
    const [first, last] = [buttons[0], buttons[buttons.length - 1]];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
  return (
    // Above the card's stretched link; the open menu rises above the neighbouring cards.
    <div ref={ref} className={'relative flex-none ' + (open ? 'z-50' : 'z-10')}>
      <button
        type="button"
        disabled={busy}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={'Status von #' + t.number + ' ändern'}
        className="-my-2 inline-flex min-h-11 items-center gap-1 rounded-full"
        onClick={() => setOpen(!open)}
      >
        <StatusPill status={t.status} />
        <ChevronDown aria-hidden="true" className="size-4 text-muted" />
      </button>
      {open && (
        <>
          <div
            aria-hidden="true"
            className="fixed inset-0 z-40 bg-ink/30 md:bg-transparent"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={'Status von #' + t.number + ' wählen'}
            onKeyDown={trapTab}
            className="fixed inset-x-0 bottom-0 z-50 grid gap-1 rounded-t-2xl bg-white p-3 pb-8 shadow-lg md:absolute md:inset-x-auto md:bottom-auto md:right-0 md:top-full md:mt-1 md:w-64 md:rounded-lg md:border md:border-[#e9e9e7] md:p-1.5"
          >
            <p className="px-3 pb-1 pt-1 text-sm font-bold text-muted md:hidden">Status ändern</p>
            {STATUSES.map((s, i) => (
              <button
                key={s}
                type="button"
                autoFocus={i === 0}
                aria-pressed={s === t.status}
                className="flex min-h-12 items-center justify-between gap-3 rounded-lg px-3 text-left hover:bg-soft"
                onClick={() => {
                  setOpen(false);
                  onMove(s);
                }}
              >
                <StatusPill status={s} className="!text-[15px]" />
                {s === t.status && <Check aria-hidden="true" className="size-5" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TicketCard({
  ticket: t,
  position,
  busy,
  movable,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  ticket: Ticket;
  position: number;
  busy: boolean;
  /** Only the assignee, a reviewer of the Bereich and admins may change the status (the server answers 403 otherwise). */
  movable: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (status: Status) => void;
}) {
  return (
    <li>
      <article
        draggable={movable}
        aria-label={'#' + t.number + ' ' + t.title}
        className={
          'relative grid gap-2 rounded-[10px] border border-[#e9e9e7] bg-white p-3.5 shadow-[0_1px_2px_rgba(15,15,15,0.06)] transition-colors hover:bg-[#fbfbfa] ' +
          (movable ? 'cursor-grab active:cursor-grabbing' : '')
        }
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', t.id);
          e.dataTransfer.effectAllowed = 'move';
          onDragStart();
        }}
        onDragEnd={onDragEnd}
      >
        <div className="flex items-start gap-2">
          <FileText aria-hidden="true" className="mt-0.5 size-5 flex-none text-muted" />
          {/* The link stretches over the whole card; the status button sits above it. */}
          <Link
            to={'/tickets/' + t.id}
            className="min-w-0 flex-1 text-[17px] font-bold leading-snug after:absolute after:inset-0"
          >
            {t.title}
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <AreaTag name={t.area_name} position={position} />
          {t.assignee && (
            <span className="inline-flex min-w-0 items-center gap-1.5 text-sm">
              <Avatar user={t.assignee} />
              <span className="truncate">{t.assignee.name}</span>
            </span>
          )}
        </div>
        {t.goal && <p className="line-clamp-3 text-[15px] leading-snug">{t.goal}</p>}
        <div className="flex items-center justify-between gap-2">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {t.comment_count > 0 && (
              <span className="inline-flex items-center gap-1">
                <MessageSquare aria-hidden="true" className="size-4" />
                {t.comment_count}
                <span className="sr-only">{t.comment_count === 1 ? 'Kommentar' : 'Kommentare'}</span>
              </span>
            )}
            {awaitingApproval(t) && <span className="text-xs font-bold text-wait">Wartet auf Abnahme</span>}
          </span>
          {movable ? <StatusMenu ticket={t} busy={busy} onMove={onMove} /> : <StatusPill status={t.status} />}
        </div>
      </article>
    </li>
  );
}

// ---------------------------------------------------------------- Form (new and edit)

interface TicketPayload {
  type: Ticket['type'];
  title: string;
  body: string;
  area_id: string;
  assignee_id: string | null;
  size: Size;
  goal: string;
  est_pages: number | null;
}

/** Selectable people. Only area reviewers and admins can assign others; the people list is limited to what GET /areas knows. */
function assigneeOptions(
  user: { id: string; name: string; role: string },
  area: Area | undefined,
  current: UserRef | null,
  creating: boolean,
) {
  const me = { id: user.id, name: 'Ich (' + user.name + ')' };
  const none = { id: '', name: 'Unbesetzt' };
  if (isReviewer(user, area)) {
    const others = (area?.reviewers ?? []).filter((r) => r.id !== user.id);
    const list = [none, me, ...others];
    if (current && !list.some((o) => o.id === current.id)) list.push(current);
    return list;
  }
  if (creating) return [me];
  // An assignee who is no reviewer may only keep the ticket or release it.
  return current ? [current, none] : [none];
}

/** Label, info button and control. The hint sits beside the label so it does not become the label's control. */
function Field({
  name,
  help,
  hintName = name,
  children,
}: {
  name: string;
  help: string;
  hintName?: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-center gap-1">
        <label htmlFor={id} className={label}>
          {name}
        </label>
        <Hint name={hintName}>{help}</Hint>
      </div>
      {children(id)}
    </div>
  );
}

function TicketForm({
  mode,
  areas,
  initial,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  mode: 'new' | 'edit';
  areas: Area[];
  initial: {
    type: Ticket['type'];
    title: string;
    body: string;
    area_id: string;
    assignee: UserRef | null;
    size: Size | '';
    goal: string;
    est_pages: number | null;
  };
  busy: boolean;
  error: string;
  onSubmit: (payload: TicketPayload) => void;
  onCancel?: () => void;
}) {
  const { user } = useSession();
  const [type, setType] = useState(initial.type);
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState(initial.body);
  const [areaId, setAreaId] = useState(initial.area_id);
  const [assigneeChoice, setAssigneeChoice] = useState<string | null>(null);
  const [size, setSize] = useState<Size | ''>(initial.size);
  const [goal, setGoal] = useState(initial.goal);
  const [pages, setPages] = useState(initial.est_pages == null ? '' : String(initial.est_pages));
  const [problems, setProblems] = useState<string[]>([]);

  const area = areas.find((a) => a.id === areaId);
  const options = assigneeOptions(user, area, initial.assignee, mode === 'new');
  const defaultAssignee = mode === 'edit' ? (initial.assignee?.id ?? '') : isReviewer(user, area) ? '' : user.id;
  const assignee =
    assigneeChoice !== null && options.some((o) => o.id === assigneeChoice)
      ? assigneeChoice
      : options.some((o) => o.id === defaultAssignee)
        ? defaultAssignee
        : options[0].id;

  function submit(event: FormEvent) {
    event.preventDefault();
    const found: string[] = [];
    const pageCount = Number(pages);
    if (!title.trim()) found.push('Bitte einen Titel eintragen.');
    if (!areaId) found.push('Bitte einen Bereich wählen.');
    if (!size) found.push('Bitte eine Größe wählen.');
    if (!goal.trim()) found.push('Bitte eine Zieldefinition eintragen.');
    if (type === 'artikel' && !(Number.isInteger(pageCount) && pageCount >= 1))
      found.push('Bitte die geschätzte Seitenzahl eintragen (mindestens 1).');
    setProblems(found);
    if (found.length || !size) return;
    onSubmit({
      type,
      title: title.trim(),
      body: blank(body) ? '' : body,
      area_id: areaId,
      assignee_id: assignee || null,
      size,
      goal: goal.trim(),
      est_pages: type === 'artikel' ? pageCount : null,
    });
  }

  return (
    <form
      noValidate
      onSubmit={submit}
      className="grid gap-5"
      aria-label={mode === 'new' ? 'Neues Ticket' : 'Ticket bearbeiten'}
    >
      {mode === 'new' ? (
        <fieldset className="flex gap-2">
          <legend className={label + ' mb-1.5'}>Typ</legend>
          {(['aufgabe', 'artikel'] as const).map((t) => (
            <label key={t} className={chip(type === t) + ' cursor-pointer gap-2'}>
              <input
                type="radio"
                name="ticket-type"
                value={t}
                checked={type === t}
                onChange={() => setType(t)}
                className="sr-only"
              />
              <KindIcon icon={typeIcon[t]} />
              {typeLabel[t]}
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="text-sm text-muted">Typ: {typeLabel[type]} (nicht änderbar)</p>
      )}
      <label className={label}>
        Titel
        <input className={field} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field name="Bereich" help={HELP.bereich}>
          {(id) => <AreaPicker areas={areas} value={areaId} onChange={setAreaId} id={id} />}
        </Field>
        <Field name="Wer" help={HELP.wer} hintName="Status/Wer">
          {(id) => (
            <select id={id} className={field} value={assignee} onChange={(e) => setAssigneeChoice(e.target.value)}>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field name="Größe" help={HELP.groesse}>
          {(id) => (
            <select id={id} className={field} value={size} onChange={(e) => setSize(e.target.value as Size)}>
              <option value="">Bitte wählen</option>
              {SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
        </Field>
        {type === 'artikel' && (
          <Field name="Seiten" help={HELP.seiten}>
            {(id) => (
              <input
                id={id}
                className={field}
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={pages}
                onChange={(e) => setPages(e.target.value)}
              />
            )}
          </Field>
        )}
      </div>
      <Field name="Zieldefinition" help={HELP.ziel}>
        {(id) => (
          <textarea id={id} className={field + ' min-h-24'} value={goal} onChange={(e) => setGoal(e.target.value)} />
        )}
      </Field>
      <div>
        <div className="flex items-center gap-1">
          <p className={label}>Beschreibung</p>
          <Hint name="Beschreibung">{HELP.beschreibung}</Hint>
        </div>
        <div className="mt-1.5">
          <Suspense fallback={<EditorFallback />}>
            <MarkdownEditor value={initial.body} onChange={setBody} label="Beschreibung" />
          </Suspense>
        </div>
      </div>
      {problems.length > 0 && (
        <ul role="alert" className="list-disc rounded-ui bg-bad-tint py-3 pl-8 pr-4 text-sm text-bad">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <ErrorNotice error={error} />
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={btn.primary} disabled={busy}>
          {mode === 'new' ? 'Ticket anlegen' : 'Speichern'}
        </button>
        {onCancel && (
          <button type="button" className={btn.secondary} onClick={onCancel}>
            Abbrechen
          </button>
        )}
      </div>
    </form>
  );
}

export function NewTicket() {
  const areas = useData<Area[]>('/areas');
  const navigate = useNavigate();
  const action = useTicketAction();
  const [params] = useSearchParams();
  const startParam = params.get('status');
  const start: Status = isStatus(startParam) ? startParam : 'todo';
  const presetArea = areas.data?.find((a) => a.id === params.get('bereich'))?.id ?? '';
  return (
    <div className="max-w-3xl">
      <PageHead title="Neues Ticket">
        Aufgabe oder Artikel anlegen. Alle Felder außer der Beschreibung sind Pflicht.
      </PageHead>
      {areas.isPending ? (
        <Loading />
      ) : areas.error ? (
        <Failure error={areas.error} retry={() => void areas.refetch()} />
      ) : (
        <div className={panel}>
          {start !== 'todo' && (
            <p className="mb-5 flex items-center gap-2 text-sm font-bold">
              Startet in <StatusPill status={start} />
            </p>
          )}
          <TicketForm
            mode="new"
            areas={areas.data}
            initial={{
              type: 'aufgabe',
              title: '',
              body: TEMPLATE,
              area_id: presetArea,
              assignee: null,
              size: '',
              goal: '',
              est_pages: null,
            }}
            busy={action.busy}
            error={action.error}
            onSubmit={(payload) => {
              void (async () => {
                let created: Ticket | undefined;
                const ok = await action.run(async () => {
                  created = await api<Ticket>('/tickets', json('POST', payload));
                }, 'Ticket angelegt.');
                if (!ok || !created) return;
                // TicketInput has no status: tickets start in todo, other columns need one status change.
                // The server starts assigned tickets in progress, and a no-op move is answered with 409.
                if (start !== created.status) {
                  try {
                    await api(
                      '/tickets/' + created.id + '/status',
                      json('POST', { version: created.version, status: start }),
                    );
                  } catch {
                    toast.error('Das Ticket wurde angelegt, der Status konnte aber nicht gesetzt werden.');
                  }
                }
                navigate('/tickets/' + created.id);
              })();
            }}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Ticket page

export function TicketPage() {
  const { id = '' } = useParams();
  const detail = useData<TicketDetail>('/tickets/' + id);
  const areas = useData<Area[]>('/areas');
  if (detail.isPending || areas.isPending) return <Loading />;
  if (detail.error) return <Failure error={detail.error} retry={() => void detail.refetch()} />;
  if (areas.error) return <Failure error={areas.error} retry={() => void areas.refetch()} />;
  return <TicketView detail={detail.data} areas={areas.data} />;
}

const eventText: Record<TicketEvent['kind'], { text: string }> = {
  comment: { text: 'hat kommentiert' },
  status: { text: 'hat den Status geändert' },
  assign: { text: 'hat die Zuständigkeit geändert' },
  review: { text: 'hat ein Review abgegeben' },
  edit: { text: 'hat das Ticket bearbeitet' },
};
const EVENT_LIMIT = 50;
const editedField: Record<string, string> = {
  title: 'Titel',
  body: 'Beschreibung',
  area_id: 'Bereich',
  size: 'Größe',
  goal: 'Zieldefinition',
  est_pages: 'Seiten',
};
const Arrow = () => <ArrowRight aria-hidden="true" className="size-4 flex-none" />;
const nameTag = (name: string) => (
  <span className="rounded-full bg-pill px-2.5 py-0.5 text-[13px] font-semibold text-ink">{name}</span>
);

/**
 * Compact rendering of the server-defined event detail ("todo->review", "old -> new", "approve:binding",
 * "title,goal"). Anything unparsable returns null and is shown as raw text by the caller.
 */
function eventSummary(event: TicketEvent): ReactNode {
  const detail = event.detail;
  if (event.kind === 'status') {
    const [from, to, ...rest] = detail.split('->');
    if (isStatus(from) && isStatus(to) && !rest.length)
      return (
        <>
          <StatusPill status={from} />
          <Arrow />
          <StatusPill status={to} />
        </>
      );
  }
  if (event.kind === 'assign') {
    const [from, to, ...rest] = detail.split(' -> ');
    if (from && to && !rest.length)
      return (
        <>
          <UserRound aria-hidden="true" className="size-4 flex-none" />
          {nameTag(from)}
          <Arrow />
          {nameTag(to)}
        </>
      );
  }
  if (event.kind === 'review') {
    const verdict = detail.split(':')[0];
    if (verdict === 'approve')
      return (
        <span className="inline-flex items-center gap-1 font-semibold text-ok">
          <Check aria-hidden="true" className="size-4" /> Freigabe
        </span>
      );
    if (verdict === 'changes')
      return (
        <span className="inline-flex items-center gap-1 font-semibold text-wait">
          <RefreshCw aria-hidden="true" className="size-4" /> Änderungen nötig
        </span>
      );
  }
  if (event.kind === 'edit') {
    const fields = detail.split(',');
    if (fields.every((f) => editedField[f]))
      return <span>hat {fields.map((f) => editedField[f]).join(', ')} bearbeitet</span>;
  }
  return null;
}

function TicketView({ detail, areas }: { detail: TicketDetail; areas: Area[] }) {
  const { user } = useSession();
  const { ticket, events } = detail;
  const area = areas.find((a) => a.id === ticket.area_id);
  const admin = user.role === 'admin';
  const isAssignee = ticket.assignee?.id === user.id;
  const reviewerHere = isReviewer(user, area);
  const mayEdit = reviewerHere || isAssignee;
  const [editing, setEditing] = useState(false);
  // The version the edit started from: a refetch while editing must not turn into a silent overwrite.
  const [baseVersion, setBaseVersion] = useState(0);
  const [draft, setDraft] = useState('');
  const [composer, setComposer] = useState(0);
  const [allEvents, setAllEvents] = useState(false);
  const action = useTicketAction();
  const shown = allEvents ? events : events.slice(-EVENT_LIMIT);

  const post = (path: string, body?: unknown, message = '') => action.run(() => api(path, json('POST', body)), message);
  const move = (status: Status) =>
    status !== ticket.status && void post('/tickets/' + ticket.id + '/status', { version: ticket.version, status });
  const canClaim = !ticket.assignee && (ticket.status === 'todo' || ticket.status === 'in_progress');
  const canHandOver = isAssignee && ticket.status === 'in_progress';

  return (
    <div>
      <div className="mb-6">
        <Link to="/tickets" className={btn.text}>
          ← Zurück zum Board
        </Link>
      </div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            {ticket.title} <span className="font-semibold text-muted">#{ticket.number}</span>
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
            {!mayEdit && <StatusPill status={ticket.status} />}
            <ApprovalBadge ticket={ticket} />
            {typeLabel[ticket.type]} von {ticket.created_by.name}, angelegt am {date(ticket.created_at)}
          </p>
        </div>
        {mayEdit && !editing && (
          <button
            type="button"
            className={btn.secondary}
            onClick={() => {
              setBaseVersion(ticket.version);
              setEditing(true);
            }}
          >
            <Pencil aria-hidden="true" className="size-4" /> Bearbeiten
          </button>
        )}
      </header>
      {(mayEdit || canClaim) && (
        <div className="mb-8 grid gap-3">
          {mayEdit && <StatusStepper status={ticket.status} busy={action.busy} onMove={move} />}
          {(canClaim || canHandOver) && (
            <div className="flex flex-wrap gap-3">
              {canClaim && (
                <button
                  type="button"
                  className={btn.primary + ' min-h-11'}
                  title={HELP.uebernehmen}
                  disabled={action.busy}
                  onClick={() => void post('/tickets/' + ticket.id + '/claim', undefined, 'Ticket übernommen.')}
                >
                  <Hand aria-hidden="true" className="size-4" /> Übernehmen
                </button>
              )}
              {canHandOver && (
                <button
                  type="button"
                  className={btn.primary + ' min-h-11'}
                  disabled={action.busy}
                  onClick={() => move('review')}
                >
                  <ClipboardCheck aria-hidden="true" className="size-4" /> Zur Review geben
                </button>
              )}
            </div>
          )}
        </div>
      )}
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="grid min-w-0 gap-8">
          {editing ? (
            <section className={panel} aria-label="Ticket bearbeiten">
              <TicketForm
                mode="edit"
                areas={areas}
                initial={{
                  type: ticket.type,
                  title: ticket.title,
                  body: ticket.body,
                  area_id: ticket.area_id,
                  assignee: ticket.assignee,
                  size: ticket.size,
                  goal: ticket.goal,
                  est_pages: ticket.est_pages,
                }}
                busy={action.busy}
                error={action.error}
                onCancel={() => {
                  action.clear();
                  setEditing(false);
                }}
                onSubmit={(payload) => {
                  void (async () => {
                    // The type is immutable and not part of TicketEdit.
                    const fields = { ...payload, type: undefined };
                    const ok = await action.run(
                      () => api('/tickets/' + ticket.id, json('PATCH', { ...fields, version: baseVersion })),
                      'Ticket gespeichert.',
                    );
                    if (ok) setEditing(false);
                  })();
                }}
              />
            </section>
          ) : (
            <section aria-labelledby="ticket-description" className="rounded-ui border-2 border-line bg-white p-5">
              <h2 id="ticket-description" className={heading + ' mb-3'}>
                Beschreibung
              </h2>
              {ticket.body.trim() ? (
                <Markdown key={'body-' + ticket.version} value={ticket.body} name="Beschreibung" />
              ) : (
                <p className="text-sm text-muted">Keine Beschreibung.</p>
              )}
            </section>
          )}
          <ReviewPanel
            ticket={ticket}
            area={area}
            busy={action.busy}
            onVote={(verdict, self) =>
              void action.run(
                () =>
                  api(
                    '/tickets/' + ticket.id + '/review',
                    json('PUT', { verdict, round: ticket.round, ...(self && { self_confirmed: true }) }),
                  ),
                verdict === 'approve' ? 'Freigabe gespeichert.' : 'Änderungswunsch gespeichert.',
              )
            }
          />
          <section aria-labelledby="ticket-timeline">
            <h2 id="ticket-timeline" className={heading + ' mb-4'}>
              Aktivität
            </h2>
            {events.length > shown.length && (
              <button type="button" className={btn.text + ' mb-4'} onClick={() => setAllEvents(true)}>
                Ältere Aktivität anzeigen ({events.length - shown.length})
              </button>
            )}
            {shown.length ? (
              <ol className="grid gap-4">
                {shown.map((e) => (
                  <TimelineEvent key={e.id} event={e} />
                ))}
              </ol>
            ) : (
              <Empty>Noch keine Aktivität.</Empty>
            )}
            <form
              className="mt-6 grid gap-3"
              aria-label="Kommentar schreiben"
              onSubmit={(event) => {
                event.preventDefault();
                if (blank(draft)) return;
                void (async () => {
                  const ok = await action.run(() =>
                    api('/tickets/' + ticket.id + '/comments', json('POST', { body: draft })),
                  );
                  if (ok) {
                    setDraft('');
                    setComposer(composer + 1);
                  }
                })();
              }}
            >
              <Suspense fallback={<EditorFallback />}>
                <MarkdownEditor
                  key={composer}
                  value=""
                  onChange={setDraft}
                  label="Kommentar"
                  placeholder="Kommentar schreiben …"
                />
              </Suspense>
              <div>
                <button type="submit" className={btn.primary} disabled={action.busy || blank(draft)}>
                  Kommentieren
                </button>
              </div>
            </form>
          </section>
        </div>
        <aside className="grid gap-4" aria-label="Details">
          <ErrorNotice error={action.error} />
          <dl className="grid gap-4 rounded-ui bg-soft p-5 text-sm">
            <Side title="Bereich">
              {area ? <AreaTag name={area.name} position={area.position} /> : ticket.area_name}
            </Side>
            <Side title="Wer">
              {ticket.assignee ? (
                <span className="flex items-center gap-2">
                  <Avatar user={ticket.assignee} />
                  {ticket.assignee.name}
                </span>
              ) : (
                'Unbesetzt'
              )}
            </Side>
            <Side title="Größe">{ticket.size}</Side>
            {ticket.est_pages != null && <Side title="Seiten">{ticket.est_pages}</Side>}
            <Side title="Zieldefinition">
              <span className="whitespace-pre-wrap">{ticket.goal}</span>
            </Side>
            <Side title="Bereichsverantwortliche">
              {area?.reviewers.length ? (
                <span className="flex -space-x-1.5">
                  {area.reviewers.map((r) => (
                    <span key={r.id} title={r.name} className="inline-flex rounded-full ring-2 ring-soft">
                      <Avatar user={r} className="size-7 text-xs" />
                      <span className="sr-only">{r.name}</span>
                    </span>
                  ))}
                </span>
              ) : (
                'Niemand eingetragen'
              )}
            </Side>
            {admin && <Side title="Runde">{ticket.round}</Side>}
          </dl>
        </aside>
      </div>
    </div>
  );
}

/** Four steps, earlier ones checked, the current one filled in its status tone. */
function StatusStepper({ status, busy, onMove }: { status: Status; busy: boolean; onMove: (status: Status) => void }) {
  const at = STATUSES.indexOf(status);
  return (
    <div role="group" aria-label="Status" className="grid grid-cols-2 gap-1.5 rounded-2xl bg-soft p-1.5 sm:grid-cols-4">
      {STATUSES.map((s, i) => {
        const tone = statusTone[s];
        return (
          <button
            key={s}
            type="button"
            disabled={busy}
            aria-current={i === at ? 'step' : undefined}
            className={
              'flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition-colors ' +
              (i === at ? tone.pill + ' shadow-sm' : 'bg-white text-muted hover:text-ink')
            }
            onClick={() => onMove(s)}
          >
            {i < at ? (
              <Check aria-hidden="true" className="size-4 flex-none text-ok" />
            ) : (
              <span
                aria-hidden="true"
                className={'size-2.5 flex-none rounded-full ' + (i === at ? tone.dot : 'bg-line')}
              />
            )}
            {tone.label}
          </button>
        );
      })}
    </div>
  );
}

function Side({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-extrabold uppercase tracking-wide text-muted">{title}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

function TimelineEvent({ event }: { event: TicketEvent }) {
  const when = (
    <time dateTime={event.created_at} title={date(event.created_at)}>
      {ago(event.created_at)}
    </time>
  );
  if (event.kind === 'comment') {
    return (
      <li>
        <article className="rounded-ui border-2 border-line bg-white" aria-label={'Kommentar von ' + event.actor.name}>
          <header className="flex flex-wrap items-center gap-2 border-b border-line bg-soft px-4 py-2 text-sm">
            <Avatar user={event.actor} />
            <strong>{event.actor.name}</strong>
            <span className="text-muted">· {when}</span>
          </header>
          <div className="px-4 py-3">
            <Markdown value={event.body} name={'Kommentar von ' + event.actor.name} />
          </div>
        </article>
      </li>
    );
  }
  // detail/body of non-comment events are server-defined text; unparsable ones are shown verbatim.
  const summary = eventSummary(event);
  const text = event.detail || event.body;
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-sm text-muted">
      <Avatar user={event.actor} />
      <strong className="text-ink">{event.actor.name}</strong>
      {summary ?? (
        <span>
          {eventText[event.kind].text}
          {text && <>: {text}</>}
        </span>
      )}
      <span>· {when}</span>
    </li>
  );
}

function ReviewPanel({
  ticket,
  area,
  busy,
  onVote,
}: {
  ticket: Ticket;
  area?: Area;
  busy: boolean;
  onVote: (verdict: 'approve' | 'changes', selfConfirmed: boolean) => void;
}) {
  const { user } = useSession();
  const [confirmed, setConfirmed] = useState(false);
  const isAssignee = ticket.assignee?.id === user.id;
  const selfApproval = canSelfApprove(user, ticket, area);
  const reviewing = ticket.status === 'review' || ticket.status === 'done';
  const mayVote = reviewing && (!isAssignee || selfApproval);
  return (
    <section aria-labelledby="review-heading" className="grid gap-3 rounded-ui bg-soft p-5 text-sm">
      <h2 id="review-heading" className="flex items-center gap-2 text-base font-extrabold">
        <ClipboardCheck aria-hidden="true" className="size-5" /> Review
      </h2>
      {ticket.status === 'done' && (
        <p className="font-bold">{awaitingApproval(ticket) ? 'Wartet auf Abnahme' : 'Abgenommen'}</p>
      )}
      {ticket.reviews.length ? (
        <ul className="grid gap-2">
          {ticket.reviews.map((r) => {
            const notes = [!r.binding && 'nicht bindend', r.self_confirmed && 'selbstbestätigt'].filter(Boolean);
            return (
              <li key={r.user.id} className="flex items-center gap-3 rounded-ui bg-white px-3 py-2">
                <Avatar user={r.user} className="size-8 text-xs" />
                <span className="min-w-0 flex-1">
                  <span className="font-bold">{r.user.name}</span>
                  {r.user.id === user.id && ' (du)'}
                  {notes.length > 0 && <span className="block text-xs text-muted">{notes.join(' · ')}</span>}
                </span>
                {r.verdict === 'approve' ? (
                  <Check role="img" aria-label="Freigegeben" className="size-5 flex-none text-ok" />
                ) : (
                  <RefreshCw role="img" aria-label="Änderungen nötig" className="size-5 flex-none text-wait" />
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-muted">Noch keine Stimmen in dieser Runde.</p>
      )}
      {!reviewing && <p className="text-muted">Reviews sind ab „Wartet auf Review“ möglich.</p>}
      {mayVote && (
        <div className="grid gap-3">
          {selfApproval && (
            <label className="flex items-start gap-2 font-bold">
              <input
                type="checkbox"
                className="mt-0.5 size-4"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Ich bestätige: Das Ergebnis ist für niemand anderen relevant
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={btn.primary + ' min-h-11 !px-5 !py-2.5'}
              disabled={busy || (selfApproval && !confirmed)}
              onClick={() => onVote('approve', selfApproval)}
            >
              Freigeben
            </button>
            {!isAssignee && (
              <button
                type="button"
                className={btn.secondary + ' min-h-11'}
                disabled={busy}
                onClick={() => onVote('changes', false)}
              >
                <RefreshCw aria-hidden="true" className="size-4" /> Änderungen nötig
              </button>
            )}
          </div>
          {!isAssignee && !isReviewer(user, area) && (
            <p className="text-xs text-muted">
              Deine Stimme ist nicht bindend, solange du kein Bereichsverantwortlicher bist.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
