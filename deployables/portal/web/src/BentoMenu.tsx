import { Drawer } from '@base-ui/react/drawer';
import { ArrowRight, Grip, Plus, SquareKanban, Vote } from 'lucide-react';
import { useRef, useState, useSyncExternalStore, type ReactNode, type PointerEvent } from 'react';
import { Link } from 'react-router-dom';
import type { components } from './generated/api';
import { canEdit, type Area, type Category, type Document, type Submission, type Ticket, type User } from './api';
import { summarizeTickets } from './TicketCards';
import {
  AreaTag,
  Failure,
  isBallot,
  Mark,
  projectsEnabled,
  roundButton,
  StatusPill,
  useData,
  useSession,
  useWorkspaceView,
} from './ui';

type EmailStatus = components['schemas']['EmailStatus'];
const CARDS = 6;
const grid =
  'grid grid-flow-row-dense auto-rows-[84px] grid-cols-4 gap-2 min-[651px]:auto-rows-[88px] min-[651px]:grid-cols-6';
const lift =
  'transition-[translate,box-shadow] duration-100 hover:-translate-y-0.5 hover:shadow-[0_3px_0_var(--color-ink)] active:translate-y-0 active:shadow-none';
const figure = 'text-2xl font-extrabold leading-tight tracking-tight tabular-nums';
const caption = 'text-[13px] font-semibold leading-tight';
const wide = 'col-span-2';
const small = 'items-center px-1 text-center';

// Redaktionsmenü for editors in both views: a bento grid of figures and links.
// Phones: a Base UI sheet with two snap points. Below full height the grid cannot scroll, so a swipe up expands
// the sheet; at full height the grid scrolls and a swipe down from its top collapses or closes it.
// From 651px: a floating card with its own scroll and no snap points.
const phoneSnapPoints = [0.72, 1];
const phoneQuery = '(max-width: 650px)'; // = Tailwind max-[651px]
function usePhone() {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(phoneQuery);
      query.addEventListener('change', onChange);
      return () => query.removeEventListener('change', onChange);
    },
    () => window.matchMedia(phoneQuery).matches,
    () => false,
  );
}

export function BentoMenu({ container }: { container: HTMLElement | null }) {
  const session = useSession();
  const [, setView] = useWorkspaceView();
  const [open, setOpen] = useState(false);
  const phone = usePhone();
  // Not gated on the open menu: the dot on the trigger needs it.
  const documents = useData<Document[]>('/documents', projectsEnabled(session));
  const unread = documents.data?.some((doc) => doc.unread);
  return (
    <Drawer.Root
      open={open}
      onOpenChange={setOpen}
      swipeDirection="down"
      snapPoints={phone ? phoneSnapPoints : undefined}
    >
      <Drawer.Trigger className="relative flex-none rounded-[30px] bg-white p-1.5 text-ink shadow-lg">
        <span
          className={`${roundButton} bg-redaktion text-white hover:border-redaktion-dark hover:bg-redaktion-dark hover:shadow-[0_4px_0_var(--color-redaktion-dark)]`}
        >
          <Grip aria-hidden="true" className="size-6" />
          <span className="sr-only">Redaktionsmenü</span>
        </span>
        {unread && (
          <>
            <span
              aria-hidden="true"
              className="absolute right-[3px] top-[3px] size-3.5 rounded-full border-2 border-white bg-[#d81e44]"
            />
            <span className="sr-only">, neue Dokumente</span>
          </>
        )}
      </Drawer.Trigger>
      <Drawer.Portal container={container}>
        <Drawer.Backdrop className="fixed inset-0 z-50 bg-black/40 transition-opacity duration-300 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none min-[651px]:bg-transparent" />
        <Drawer.Viewport className="fixed inset-0 z-50">
          {/* ponytail: bottom-24 = 24px offset + 60px account pill + 12px gap, so the card opens over the menu button;
              follow the Dock if it changes. */}
          <Drawer.Popup
            data-workspace="redaktion"
            className="group absolute inset-0 flex flex-col text-ink outline-none transition-[transform,opacity] duration-300 ease-out [transform:translateY(calc(var(--drawer-snap-point-offset,0px)+var(--drawer-swipe-movement-y,0px)))] max-[651px]:rounded-t-[30px] max-[651px]:bg-white max-[651px]:shadow-[0_-6px_24px_rgba(0,0,0,.14),0_50dvh_0_white] max-[651px]:data-[expanded]:rounded-none data-[swiping]:transition-none motion-reduce:transition-none max-[651px]:data-[ending-style]:[transform:translateY(100%)] max-[651px]:data-[starting-style]:[transform:translateY(100%)] min-[651px]:inset-auto min-[651px]:bottom-24 min-[651px]:left-6 min-[651px]:max-h-[calc(100dvh-120px)] min-[651px]:w-[600px] min-[651px]:max-w-[calc(100vw-48px)] min-[651px]:rounded-[30px] min-[651px]:bg-white min-[651px]:pb-[60px] min-[651px]:shadow-lg min-[651px]:data-[ending-style]:opacity-0 min-[651px]:data-[starting-style]:opacity-0 min-[651px]:data-[ending-style]:[transform:translateY(1rem)] min-[651px]:data-[starting-style]:[transform:translateY(1rem)]"
          >
            {/* The solid offset shadow above continues the sheet below its edge, so an overshoot never shows the page.
                Phones scroll only at full height: otherwise Base UI takes the swipe and moves the sheet. */}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-t-[inherit] [scrollbar-width:thin] max-[651px]:overflow-hidden max-[651px]:group-data-[expanded]:overflow-y-auto">
              <div className="bg-white max-[651px]:pb-[env(safe-area-inset-bottom)]">
                <div className="sticky top-0 z-10 bg-white px-3 pb-2 min-[651px]:pt-3">
                  <Drawer.Close
                    aria-label="Menü schließen"
                    className="flex h-7 w-full items-center justify-center rounded-full min-[651px]:hidden"
                  >
                    <span aria-hidden="true" className="h-1.5 w-11 rounded-full bg-pill" />
                  </Drawer.Close>
                  <Drawer.Title className="flex h-12 items-center gap-2.5 px-1">
                    <Mark className="size-10" workspace="redaktion" />
                    <span className="text-[22px] font-extrabold tracking-tight">Redaktionsmenü</span>
                  </Drawer.Title>
                </div>
                <Drawer.Content
                  render={<nav aria-label="Redaktionsmenü" />}
                  className="px-3 pb-6 pt-1 min-[651px]:pb-3"
                  onClick={(e) => {
                    const link = (e.target as Element).closest('a');
                    // A modified click opens a new tab: this one keeps its view and menu.
                    if (!link || e.metaKey || e.ctrlKey || e.shiftKey) return;
                    // Also opened from the Schüler view; Abstimmungen pages would redirect students away.
                    // The home link is the way back to the Schüler view.
                    if (link.getAttribute('href') !== '/') setView('redaktion');
                    setOpen(false);
                  }}
                >
                  <Bento />
                </Drawer.Content>
              </div>
            </div>
            {/* Desktop: sits exactly on the trigger, so the Grip stays put and turns dark while the card is open. */}
            <Drawer.Close
              aria-label="Redaktionsmenü schließen"
              className="absolute bottom-0 left-0 p-1.5 max-[651px]:hidden"
            >
              <span
                className={`${roundButton} bg-ink text-white hover:border-ink hover:bg-gray-600 hover:shadow-[0_4px_0_var(--color-ink)]`}
              >
                <Grip aria-hidden="true" className="size-6" />
              </span>
            </Drawer.Close>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function Tile({
  to,
  label,
  tone = 'bg-soft',
  className = '',
  children,
}: {
  to: string;
  label?: string;
  tone?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      className={`relative flex min-w-0 flex-col justify-center gap-0.5 rounded-[18px] px-4 ${lift} ${tone} ${className}`}
    >
      {children}
    </Link>
  );
}

function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <>
      <span className={`truncate ${figure}`}>{value}</span>{' '}
      <span className={`line-clamp-2 break-words ${caption}`}>{label}</span>
    </>
  );
}

const time = (value: string) => new Date(value).getTime();
const midnight = (value: number) => new Date(value).setHours(0, 0, 0, 0);
function dueIn(value: string) {
  const days = Math.round((midnight(time(value)) - midnight(Date.now())) / 86_400_000);
  return days === 0 ? 'Heute' : days === 1 ? 'Morgen' : `${days} Tage`;
}
const upcoming = (c: Category) => c.status === 'open' && !!c.closes_at && time(c.closes_at) > Date.now();
const lastWeek = (s: Submission) => time(s.created_at) > Date.now() - 7 * 86_400_000;

// Mounted only while the menu is open, so its requests run only then.
function Bento() {
  const session = useSession();
  const { user } = session;
  const admin = user.role === 'admin';
  const projects = projectsEnabled(session);
  const categories = useData<Category[]>('/categories');
  const submissions = useData<Submission[]>('/submissions');
  const tickets = useData<Ticket[]>('/tickets', projects);
  const areas = useData<Area[]>('/areas', projects);
  const documents = useData<Document[]>('/documents', projects);
  const users = useData<User[]>('/admin/users', admin);
  const email = useData<EmailStatus>('/admin/email/status', admin);
  const failed = [categories, submissions, tickets, areas, documents, users, email].filter((q) => q.error);

  const editable = categories.data?.filter((c) => canEdit(user, c.id));
  const ballots = editable?.filter((c) => isBallot(c.kind));
  const open = ballots?.filter((c) => c.status === 'open');
  const voted = open?.reduce((sum, c) => sum + (c.participation?.voted ?? 0), 0) ?? 0;
  const eligible = open?.reduce((sum, c) => sum + (c.participation?.eligible ?? 0), 0) ?? 0;
  const percent = eligible ? Math.min(100, Math.round((voted / eligible) * 100)) : null;
  const deadline = editable?.filter(upcoming).sort((a, b) => time(a.closes_at!) - time(b.closes_at!))[0];
  const editableIds = new Set(editable?.map((c) => c.id));
  const own = editable && submissions.data?.filter((s) => editableIds.has(s.category_id));
  const mine = tickets.data && areas.data ? summarizeTickets(tickets.data, areas.data, user.id) : undefined;
  const unread = documents.data?.filter((doc) => doc.unread).length;
  const changed = documents.data?.toSorted((a, b) => time(b.updated_at) - time(a.updated_at))[0];
  const waiting = users.data?.filter((u) => !u.admitted).length;

  return (
    <>
      {failed.length > 0 && (
        <div className="mb-2">
          <Failure error={failed[0]!.error!} retry={() => failed.forEach((q) => q.refetch())} />
        </div>
      )}
      <div className={grid}>
        {projects && (
          <>
            <Tasks tickets={mine?.mine} areas={areas.data} failed={!!(tickets.error || areas.error)} />
            <Tile to="/tickets" className={small}>
              <SquareKanban aria-hidden="true" className="size-7" />
              <span className={caption}>Aufgaben</span>
            </Tile>
            <Tile to="/tickets/neu" label="Neues Ticket" className={small}>
              <Plus aria-hidden="true" className="size-7" />
              <span className={caption}>Ticket</span>
            </Tile>
          </>
        )}
        <Tile to="/redaktion/beitraege" className={wide}>
          <Stat value={own?.length ?? '–'} label="Alle Beiträge" />
        </Tile>
        <Tile to="/sammlungen" className="col-span-4 min-[651px]:col-span-3">
          <span className="flex items-center gap-2.5">
            <Vote aria-hidden="true" className="size-6 shrink-0" />
            <span className={`truncate ${figure}`}>{percent === null ? '–' : `${percent} %`} abgestimmt</span>
          </span>{' '}
          <span className="text-[13px] leading-tight text-muted">
            {admin ? 'Offene Abstimmungen' : 'Meine Abstimmungen'}
          </span>
          <span aria-hidden="true" className="mt-1 block h-1.5 overflow-hidden rounded-full bg-line">
            <span className="block h-full bg-ok" style={{ width: `${percent ?? 0}%` }} />
          </span>
        </Tile>
        {projects && (
          <>
            <Tile to="/dokumente" className={small}>
              {!!unread && (
                <span aria-hidden="true" className="absolute left-2.5 top-2.5 size-2.5 rounded-full bg-[#d81e44]" />
              )}
              <span className={figure}>{unread ?? '–'}</span>{' '}
              <span className="text-xs font-semibold leading-tight">
                {unread === 1 ? 'neues Dokument' : 'neue Dokumente'}
              </span>
            </Tile>
            <Tile to="/dokumente/neu" label="Neues Dokument" className={small}>
              <Plus aria-hidden="true" className="size-7" />
              <span className="text-xs font-semibold leading-tight">Dokument</span>
            </Tile>
          </>
        )}
        <Tile
          to="/sammlungen?neu"
          tone="bg-redaktion text-white"
          className={`${wide} !flex-row items-center justify-start !gap-2.5`}
        >
          <Plus aria-hidden="true" className="size-6 shrink-0" />
          <span className="text-base font-bold leading-tight">Neue Abstimmung</span>
        </Tile>
        <Tile
          to="/"
          tone="bg-[#15181f] text-[#c8f23c]"
          className="col-span-4 !flex-row items-center !justify-between !gap-2 min-[651px]:col-span-2"
        >
          <span className="text-base font-bold leading-tight">Zur Schüleransicht</span>
          <ArrowRight aria-hidden="true" className="size-5 shrink-0" />
        </Tile>
        {mine?.canReview && (
          // The oldest waiting ticket: voting on it moves the tile on to the next, as the board has no such filter.
          <Tile to={mine.waiting[0] ? `/tickets/${mine.waiting[0].id}` : '/tickets'} className={wide}>
            <Stat
              value={`${mine.waiting.length} ${mine.waiting.length === 1 ? 'wartet' : 'warten'}`}
              label="auf deine Freigabe"
            />
          </Tile>
        )}
        {deadline && (
          <Tile to={`/sammlungen/${deadline.id}`} className={wide}>
            <span className={figure}>{dueIn(deadline.closes_at!)}</span>{' '}
            <span className={`truncate ${caption}`}>Frist: {deadline.name}</span>
          </Tile>
        )}
        <Tile to="/redaktion/beitraege" className={wide}>
          <Stat value={own ? `${own.filter(lastWeek).length} neu` : '–'} label="Beiträge in 7 Tagen" />
        </Tile>
        {changed && (
          <Tile to={`/dokumente/${changed.id}`} className={wide}>
            <span className="text-[13px] leading-tight text-muted">Zuletzt geändert</span>{' '}
            <span className="line-clamp-2 break-words text-[15px] font-bold leading-tight">{changed.title}</span>
          </Tile>
        )}
        <Tile to="/sammlungen" className="col-span-4 min-[651px]:col-span-2">
          <span className={caption}>Abstimmungen</span>{' '}
          <span className="flex flex-wrap gap-x-4 text-[13px] font-semibold">
            <span>
              <span className={figure}>{open?.length ?? '–'}</span> offen
            </span>{' '}
            <span>
              <span className={figure}>{ballots?.filter((c) => c.status === 'closed').length ?? '–'}</span> beendet
            </span>
          </span>
        </Tile>
      </div>
      {/* Its own grid, so dense packing never pulls an admin tile above the divider. */}
      {admin && (
        <div role="group" aria-label="Verwaltung">
          <p className="flex items-center gap-3 px-1 pb-2 pt-4 text-sm font-bold text-muted after:h-px after:flex-1 after:bg-line">
            Admin
          </p>
          <div className={grid}>
            <Tile to="/verwaltung/personen" className={wide}>
              <Stat
                value={waiting === undefined ? '–' : `${waiting} ${waiting === 1 ? 'wartet' : 'warten'}`}
                label="auf Zugang"
              />
            </Tile>
            <Tile to="/verwaltung/email" className={wide}>
              <Stat
                value={email.data ? `${email.data.usage.used} / ${email.data.policy.daily_limit}` : '–'}
                label="E-Mails heute"
              />
            </Tile>
            {[
              ['/verwaltung/personen', 'Personen'],
              ['/verwaltung/protokoll', 'Protokoll'],
              ...(projects ? [['/verwaltung/bereiche', 'Bereiche']] : []),
              ['/verwaltung/email', 'E-Mail'],
            ].map(([to, name]) => (
              <Tile key={name} to={to!} className={small}>
                <span className={caption}>{name}</span>
              </Tile>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

// Own open tickets as a swipeable row: touch scrolls and snaps natively, the mouse drags, the dots jump.
function Tasks({ tickets, areas, failed }: { tickets?: Ticket[]; areas?: Area[]; failed: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; left: number; from: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const [current, setCurrent] = useState(0);
  const shown = tickets?.slice(0, CARDS) ?? [];
  const positions = new Map(areas?.map((area) => [area.id, area.position]));
  const names = [...shown.map((t) => t.title), ...(tickets && tickets.length > CARDS ? ['Zum Board'] : [])];
  const step = () => (track.current!.firstElementChild as HTMLElement).offsetWidth + 8;
  const nearest = () => Math.max(0, Math.min(names.length - 1, Math.round(track.current!.scrollLeft / (step() || 1))));
  const show = (index: number) => track.current!.scrollTo?.({ left: index * step(), behavior: 'smooth' });
  const release = (e: PointerEvent) => {
    const start = drag.current;
    drag.current = null;
    if (!start?.moved) return;
    const dx = e.clientX - start.x;
    show(Math.max(0, Math.min(names.length - 1, start.from + (Math.abs(dx) > 40 ? -Math.sign(dx) : 0))));
    // Snapping again right away would cut the smooth scroll short.
    const node = track.current!;
    setTimeout(() => (node.style.scrollSnapType = ''), 400);
  };
  const card = 'flex min-w-0 flex-[0_0_88%] snap-start flex-col rounded-[18px] bg-soft px-3.5 py-3';
  return (
    <div
      role="group"
      aria-roledescription="Karussell"
      aria-label="Meine Aufgaben"
      className="col-span-full row-span-2 flex min-w-0 flex-col"
    >
      {!shown.length ? (
        <Link
          to="/tickets"
          className={`flex min-h-0 flex-1 flex-col justify-center rounded-[18px] bg-soft px-4 ${lift}`}
        >
          <span className="text-base font-bold">
            {tickets ? 'Dir ist gerade nichts zugewiesen' : failed ? '–' : 'Wird geladen …'}
          </span>{' '}
          <span className="text-[13px] font-semibold underline">Zum Board</span>
        </Link>
      ) : (
        <div
          ref={track}
          className="-mx-3 flex min-h-0 flex-1 cursor-grab snap-x snap-mandatory scroll-px-3 gap-2 overflow-x-auto px-3 select-none [scrollbar-width:none] min-[651px]:mx-0 min-[651px]:scroll-px-0 min-[651px]:px-0"
          onScroll={() => setCurrent(nearest())}
          onPointerDown={(e) => {
            dragged.current = false;
            if (e.pointerType !== 'mouse' || e.button !== 0) return;
            drag.current = { x: e.clientX, left: e.currentTarget.scrollLeft, from: nearest(), moved: false };
          }}
          onPointerMove={(e) => {
            const start = drag.current;
            if (!start || (!start.moved && Math.abs(e.clientX - start.x) < 5)) return;
            start.moved = dragged.current = true;
            e.currentTarget.style.scrollSnapType = 'none';
            e.currentTarget.scrollLeft = start.left - (e.clientX - start.x);
          }}
          onPointerUp={release}
          onPointerLeave={release}
          // A drag ends in a click on a card; that must neither navigate nor close the menu.
          onClickCapture={(e) => {
            // detail 0 is a keyboard activation: never part of a drag, even if the last one ended outside the row.
            if (!dragged.current || e.detail === 0) return;
            dragged.current = false;
            e.preventDefault();
            e.stopPropagation();
          }}
        >
          {shown.map((ticket) => (
            <Link key={ticket.id} to={`/tickets/${ticket.id}`} draggable={false} className={`gap-1.5 ${card}`}>
              <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
                <StatusPill status={ticket.status} />
                <AreaTag name={ticket.area_name} position={positions.get(ticket.area_id) ?? 1} />
              </span>{' '}
              <span className="truncate text-[19px] font-extrabold leading-tight tracking-tight">{ticket.title}</span>{' '}
              {ticket.goal && (
                <span className="line-clamp-2 break-words text-[13px] leading-snug text-muted">
                  <b>Ziel:</b> {ticket.goal}
                </span>
              )}
            </Link>
          ))}
          {names.length > shown.length && (
            <Link to="/tickets" draggable={false} className={`items-center justify-center text-base font-bold ${card}`}>
              Zum Board
            </Link>
          )}
        </div>
      )}
      <div className="flex h-7 flex-none items-center justify-between gap-2 px-1">
        <span className="truncate text-[13px] font-bold">
          {/* Narrow phones: the dots need the room. */}
          <span className="max-[380px]:sr-only">Meine </span>Aufgaben{tickets ? ` · ${tickets.length} offen` : ''}
        </span>
        {names.length > 1 && (
          <span className="flex">
            {names.map((name, index) => (
              <button
                key={index}
                type="button"
                aria-label={`${name} zeigen`}
                aria-current={index === current}
                className="grid h-7 min-w-6 place-items-center px-[3px]"
                onClick={() => show(index)}
              >
                <span
                  className={`block h-1.5 rounded-full transition-[width] ${index === current ? 'w-4 bg-ink' : 'w-1.5 bg-muted/60'}`}
                />
              </button>
            ))}
          </span>
        )}
      </div>
    </div>
  );
}
