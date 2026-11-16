import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  ClipboardCheck,
  Hand,
  Info,
  ListChecks,
  MessageSquare,
  Newspaper,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import { lazy, Suspense, useId, useState, type DragEvent, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { api, ApiError, date, json } from './api';
import type { Area, Ticket, TicketDetail, TicketEvent, UserRef } from './api';
import {
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
  useData,
  useSession,
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

type Status = Ticket['status'];
type Size = Ticket['size'];
const COLUMNS: { status: Status; title: string }[] = [
  { status: 'todo', title: 'TODO' },
  { status: 'in_progress', title: 'In Arbeit' },
  { status: 'review', title: 'Wartet auf Review' },
  { status: 'done', title: 'Fertig' },
];
const statusTitle = Object.fromEntries(COLUMNS.map((c) => [c.status, c.title])) as Record<Status, string>;
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
        className="inline-flex size-6 items-center justify-center rounded-full bg-transparent text-muted hover:text-ink"
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

// ---------------------------------------------------------------- Board

const chip = (active: boolean) =>
  'inline-flex min-h-9 items-center rounded-full px-3.5 text-sm font-bold transition-colors ' +
  (active ? 'bg-ink text-white' : 'bg-pill text-ink hover:bg-soft');

export function Board() {
  const { user } = useSession();
  const [showFinished, setShowFinished] = useState(false);
  const [areaId, setAreaId] = useState('');
  const [type, setType] = useState<Ticket['type'] | ''>('');
  const [mine, setMine] = useState(false);
  const [query, setQuery] = useState('');
  const [dragId, setDragId] = useState('');
  const [over, setOver] = useState<Status | ''>('');
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
  const selectedArea = areas.data?.find((a) => a.id === areaId);

  function move(ticket: Ticket, status: Status) {
    if (ticket.status === status) return;
    void action.run(() => api('/tickets/' + ticket.id + '/status', json('POST', { version: ticket.version, status })));
  }
  function drop(event: DragEvent, status: Status) {
    event.preventDefault();
    setOver('');
    const ticket = tickets.data?.find((t) => t.id === dragId);
    setDragId('');
    if (ticket) move(ticket, status);
  }

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
        Aufgaben und Artikel der Abizeitung. Ziehe Karten in eine andere Spalte oder nutze die Statusauswahl auf der
        Karte.
      </PageHead>
      <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3" role="group" aria-label="Filter">
        <label className="relative block min-w-56 text-sm font-bold">
          <span className="sr-only">Suche</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
          />
          <input
            type="search"
            placeholder="Titel, Nummer, Person …"
            aria-label="Suche"
            className={field + ' !mt-0 !min-h-10 pl-9'}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Bereich">
          <button type="button" aria-pressed={!areaId} className={chip(!areaId)} onClick={() => setAreaId('')}>
            Alle Bereiche
          </button>
          {areas.data?.map((a) => (
            <button
              key={a.id}
              type="button"
              aria-pressed={areaId === a.id}
              className={chip(areaId === a.id)}
              onClick={() => setAreaId(areaId === a.id ? '' : a.id)}
            >
              {a.name}
            </button>
          ))}
        </div>
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
        <button type="button" aria-pressed={mine} className={chip(mine)} onClick={() => setMine(!mine)}>
          Meine
        </button>
        <label className="flex items-center gap-2 text-sm font-bold">
          <input
            type="checkbox"
            checked={showFinished}
            onChange={(e) => setShowFinished(e.target.checked)}
            className="size-4"
          />
          Abgeschlossene zeigen
        </label>
      </div>
      <div className="mb-4">
        <ErrorNotice error={action.error} />
      </div>
      {tickets.isPending ? (
        <Loading />
      ) : tickets.error ? (
        <Failure error={tickets.error} retry={() => void tickets.refetch()} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map(({ status, title }) => {
            const cards = visible.filter((t) => t.status === status);
            return (
              <section
                key={status}
                aria-label={title}
                data-column={status}
                className={
                  'min-w-0 rounded-ui bg-soft p-3 ' +
                  (over === status && dragId ? 'outline outline-2 outline-accent' : '')
                }
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  setOver(status);
                }}
                onDragLeave={() => setOver('')}
                onDrop={(e) => drop(e, status)}
              >
                <h2 className="mb-3 flex items-center gap-2 px-1 text-sm font-extrabold uppercase tracking-wide">
                  {title}
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-bold text-muted">{cards.length}</span>
                  {status === 'done' && <Hint name="Fertig">{fertigHelp(selectedArea?.reviewers ?? [])}</Hint>}
                </h2>
                {cards.length ? (
                  <ul className="grid gap-3">
                    {cards.map((t) => (
                      <TicketCard
                        key={t.id}
                        ticket={t}
                        busy={action.busy}
                        onDragStart={() => setDragId(t.id)}
                        onDragEnd={() => {
                          setDragId('');
                          setOver('');
                        }}
                        onMove={(s) => move(t, s)}
                      />
                    ))}
                  </ul>
                ) : (
                  <Empty>Keine Tickets</Empty>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TicketCard({
  ticket: t,
  busy,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  ticket: Ticket;
  busy: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (status: Status) => void;
}) {
  const Icon = typeIcon[t.type];
  return (
    <li>
      <article
        draggable
        aria-label={'#' + t.number + ' ' + t.title}
        className="grid cursor-grab gap-2 rounded-ui border border-line bg-white p-3 text-sm active:cursor-grabbing"
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', t.id);
          e.dataTransfer.effectAllowed = 'move';
          onDragStart();
        }}
        onDragEnd={onDragEnd}
      >
        <div className="flex items-start gap-2">
          <span title={typeLabel[t.type]} className="mt-0.5 text-muted">
            <KindIcon icon={Icon} />
            <span className="sr-only">{typeLabel[t.type]}</span>
          </span>
          <Link to={'/tickets/' + t.id} className="min-w-0 font-bold hover:underline">
            <span className="text-muted">#{t.number}</span> {t.title}
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold">
          <span className="rounded-full bg-pill px-2 py-0.5">{t.area_name}</span>
          <span className="rounded-full bg-pill px-2 py-0.5">Größe {t.size}</span>
          {t.est_pages != null && (
            <span className="rounded-full bg-pill px-2 py-0.5">
              {t.est_pages === 1 ? '1 Seite' : t.est_pages + ' Seiten'}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-muted">
            <KindIcon icon={UserRound} />
            {t.assignee?.name ?? 'Unbesetzt'}
          </span>
          <ApprovalBadge ticket={t} />
        </div>
        <select
          aria-label={'Status von #' + t.number}
          className="min-h-10 w-full rounded-ui border-2 border-line bg-white px-2 text-sm"
          value={t.status}
          disabled={busy}
          onChange={(e) => onMove(e.target.value as Status)}
        >
          {COLUMNS.map((c) => (
            <option key={c.status} value={c.status}>
              {c.title}
            </option>
          ))}
        </select>
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
          {(id) => (
            <select id={id} className={field} value={areaId} onChange={(e) => setAreaId(e.target.value)}>
              <option value="">Bitte wählen</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}
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
          <TicketForm
            mode="new"
            areas={areas.data}
            initial={{
              type: 'aufgabe',
              title: '',
              body: TEMPLATE,
              area_id: '',
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
                if (ok && created) navigate('/tickets/' + created.id);
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

const eventText: Record<TicketEvent['kind'], { icon: LucideIcon; text: string }> = {
  comment: { icon: MessageSquare, text: 'hat kommentiert' },
  status: { icon: ArrowRightLeft, text: 'hat den Status geändert' },
  assign: { icon: UserRound, text: 'hat die Zuständigkeit geändert' },
  review: { icon: ClipboardCheck, text: 'hat ein Review abgegeben' },
  edit: { icon: Pencil, text: 'hat das Ticket bearbeitet' },
};
const EVENT_LIMIT = 50;

function TicketView({ detail, areas }: { detail: TicketDetail; areas: Area[] }) {
  const { user } = useSession();
  const { ticket, events } = detail;
  const area = areas.find((a) => a.id === ticket.area_id);
  const isAssignee = ticket.assignee?.id === user.id;
  const reviewerHere = isReviewer(user, area);
  const mayEdit = reviewerHere || isAssignee;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [composer, setComposer] = useState(0);
  const [allEvents, setAllEvents] = useState(false);
  const action = useTicketAction();
  const shown = allEvents ? events : events.slice(-EVENT_LIMIT);

  const post = (path: string, body?: unknown, message = '') => action.run(() => api(path, json('POST', body)), message);

  return (
    <div>
      <div className="mb-6">
        <Link to="/tickets" className={btn.text}>
          ← Zurück zum Board
        </Link>
      </div>
      <header className="mb-8 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">
            {ticket.title} <span className="font-semibold text-muted">#{ticket.number}</span>
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="rounded-full bg-pill px-2.5 py-1 text-xs font-bold text-ink">
              {statusTitle[ticket.status]}
            </span>
            <ApprovalBadge ticket={ticket} />
            {typeLabel[ticket.type]} von {ticket.created_by.name}, angelegt am {date(ticket.created_at)}
          </p>
        </div>
        {mayEdit && !editing && (
          <button type="button" className={btn.secondary} onClick={() => setEditing(true)}>
            <Pencil aria-hidden="true" className="size-4" /> Bearbeiten
          </button>
        )}
      </header>
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
                      () => api('/tickets/' + ticket.id, json('PATCH', { ...fields, version: ticket.version })),
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
            <Side title="Bereich" hint={HELP.bereich}>
              {ticket.area_name}
            </Side>
            <Side title="Wer" hintName="Status/Wer" hint={HELP.wer}>
              <span className="flex flex-wrap items-center gap-2">
                {ticket.assignee?.name ?? 'Unbesetzt'}
                {!ticket.assignee && (ticket.status === 'todo' || ticket.status === 'in_progress') && (
                  <button
                    type="button"
                    className={btn.secondary + ' !px-3 !py-1.5 !text-sm'}
                    title={HELP.uebernehmen}
                    disabled={action.busy}
                    onClick={() => void post('/tickets/' + ticket.id + '/claim', undefined, 'Ticket übernommen.')}
                  >
                    <Hand aria-hidden="true" className="size-4" /> Übernehmen
                  </button>
                )}
              </span>
            </Side>
            <Side title="Größe" hint={HELP.groesse}>
              {ticket.size}
            </Side>
            {ticket.est_pages != null && (
              <Side title="Seiten" hint={HELP.seiten}>
                {ticket.est_pages}
              </Side>
            )}
            <Side title="Zieldefinition" hint={HELP.ziel}>
              <span className="whitespace-pre-wrap">{ticket.goal}</span>
            </Side>
            <Side title="Status" hintName="Fertig" hint={fertigHelp(area?.reviewers ?? [])}>
              {reviewerHere || isAssignee ? (
                <select
                  aria-label="Status"
                  className="min-h-10 w-full rounded-ui border-2 border-line bg-white px-2 text-sm"
                  value={ticket.status}
                  disabled={action.busy}
                  onChange={(e) =>
                    void post('/tickets/' + ticket.id + '/status', { version: ticket.version, status: e.target.value })
                  }
                >
                  {COLUMNS.map((c) => (
                    <option key={c.status} value={c.status}>
                      {c.title}
                    </option>
                  ))}
                </select>
              ) : (
                statusTitle[ticket.status]
              )}
            </Side>
            <Side title="Bereichsverantwortliche">
              {area?.reviewers.length ? area.reviewers.map((r) => r.name).join(', ') : 'Niemand eingetragen'}
            </Side>
            <Side title="Runde">{ticket.round}</Side>
          </dl>
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
        </aside>
      </div>
    </div>
  );
}

function Side({
  title,
  hint,
  hintName,
  children,
}: {
  title: string;
  hint?: string;
  hintName?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt className="flex items-center gap-1 text-xs font-extrabold uppercase tracking-wide text-muted">
        {title}
        {hint && <Hint name={hintName ?? title}>{hint}</Hint>}
      </dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

function TimelineEvent({ event }: { event: TicketEvent }) {
  const meta = eventText[event.kind];
  if (event.kind === 'comment') {
    return (
      <li>
        <article className="rounded-ui border-2 border-line bg-white" aria-label={'Kommentar von ' + event.actor.name}>
          <header className="flex flex-wrap items-center gap-2 border-b border-line bg-soft px-4 py-2 text-sm">
            <strong>{event.actor.name}</strong>
            <span className="text-muted">hat kommentiert · {date(event.created_at)}</span>
          </header>
          <div className="px-4 py-3">
            <Markdown value={event.body} name={'Kommentar von ' + event.actor.name} />
          </div>
        </article>
      </li>
    );
  }
  // detail/body of non-comment events are server-defined text; shown verbatim.
  const text = event.detail || event.body;
  return (
    <li className="flex items-start gap-2 px-1 text-sm text-muted">
      <KindIcon icon={meta.icon} className="mt-0.5 size-4" />
      <span>
        <strong className="text-ink">{event.actor.name}</strong> {meta.text}
        {text && <>: {text}</>} · {date(event.created_at)}
      </span>
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
          {ticket.reviews.map((r) => (
            <li key={r.user.id} className="rounded-ui bg-white px-3 py-2">
              <span className="font-bold">{r.user.name}</span>
              {r.user.id === user.id && ' (du)'}: {r.verdict === 'approve' ? 'Freigegeben' : 'Änderungen nötig'}
              <span className="mt-1 flex flex-wrap gap-1.5 text-xs font-bold">
                <span
                  className={'rounded-full px-2 py-0.5 ' + (r.binding ? 'bg-ok-tint text-ok' : 'bg-pill text-muted')}
                >
                  {r.binding ? 'Bindend' : 'Nicht bindend'}
                </span>
                {r.self_confirmed && (
                  <span className="rounded-full bg-pill px-2 py-0.5 text-muted">Selbstbestätigt</span>
                )}
              </span>
            </li>
          ))}
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
              className={btn.primary + ' !px-5 !py-2.5'}
              disabled={busy || (selfApproval && !confirmed)}
              onClick={() => onVote('approve', selfApproval)}
            >
              Freigeben
            </button>
            {!isAssignee && (
              <button type="button" className={btn.secondary} disabled={busy} onClick={() => onVote('changes', false)}>
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
