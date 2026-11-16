import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { Area, Me, Ticket } from './api';
import { DevDebug } from './DevDebug';
import { Empty, Failure, Loading, btn, heading, useData } from './ui';

export const PAGE_TARGET = 100;
export const STALE_AFTER_DAYS = 7;
const DAY_MS = 86_400_000;

export type TicketSummary = {
  /** The viewer reviews at least one area, or is admin. Otherwise the waiting card is hidden. */
  canReview: boolean;
  /** Open tickets assigned to the viewer, most recently changed first. */
  mine: Ticket[];
  /** Tickets waiting for a review by the viewer, oldest change first. Never the viewer's own tickets. */
  waiting: Ticket[];
  pagesDone: number;
  pagesPlanned: number;
  /** Open tickets with an assignee that were not changed for more than STALE_AFTER_DAYS, oldest first. */
  asleep: { ticket: Ticket; days: number }[];
};

/** A ticket is finished when it is done and approved by a binding review of the current round. */
export const isFinishedTicket = (ticket: Ticket) => ticket.status === 'done' && ticket.approved;

const pages = (tickets: Ticket[]) => tickets.reduce((sum, ticket) => sum + (ticket.est_pages ?? 0), 0);
const byUpdatedDesc = (a: Ticket, b: Ticket) => Date.parse(b.updated_at) - Date.parse(a.updated_at);
const byUpdatedAsc = (a: Ticket, b: Ticket) => Date.parse(a.updated_at) - Date.parse(b.updated_at);

/** Pure card numbers. `now` is injectable so the stale boundary can be tested exactly. */
export function summarizeTickets(
  tickets: Ticket[],
  areas: Area[],
  viewerId: string,
  isAdmin: boolean,
  now: number = Date.now(),
): TicketSummary {
  const reviewAreaIds = new Set(
    areas.filter((area) => area.reviewers.some((reviewer) => reviewer.id === viewerId)).map((area) => area.id),
  );
  const canReview = isAdmin || reviewAreaIds.size > 0;
  const open = tickets.filter((ticket) => !isFinishedTicket(ticket));
  const mine = open.filter((ticket) => ticket.assignee?.id === viewerId).sort(byUpdatedDesc);
  const waiting = canReview
    ? tickets
        .filter(
          (ticket) =>
            (ticket.status === 'review' || (ticket.status === 'done' && !ticket.approved)) &&
            ticket.assignee?.id !== viewerId &&
            (isAdmin || reviewAreaIds.has(ticket.area_id)),
        )
        .sort(byUpdatedAsc)
    : [];
  const artikel = tickets.filter((ticket) => ticket.type === 'artikel');
  const asleep = open
    .filter((ticket) => ticket.assignee !== null && now - Date.parse(ticket.updated_at) > STALE_AFTER_DAYS * DAY_MS)
    .map((ticket) => ({ ticket, days: Math.floor((now - Date.parse(ticket.updated_at)) / DAY_MS) }))
    .sort((a, b) => byUpdatedAsc(a.ticket, b.ticket));
  return {
    canReview,
    mine,
    waiting,
    pagesDone: pages(artikel.filter(isFinishedTicket)),
    pagesPlanned: pages(artikel.filter((ticket) => !isFinishedTicket(ticket))),
    asleep,
  };
}

const card = 'flex min-w-0 flex-col rounded-ui bg-white p-5 sm:p-6';
const figure = 'block text-4xl font-extrabold tabular-nums leading-none tracking-tight';
const row = '-mx-2 flex min-w-0 items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-pop/30';
const more = (count: number) => (count > 0 ? <p className="mt-1 text-[13px] text-muted">und {count} weitere</p> : null);

/** Dashboard cards for managers and admins. Renders four sections for the parent grid. */
export function TicketCards({ user }: { user: Me }) {
  const viewer = user.user;
  const isAdmin = viewer.role === 'admin';
  const tickets = useData<Ticket[]>('/tickets?include_finished=true');
  const areas = useData<Area[]>('/areas');
  const pending = tickets.isPending || areas.isPending;
  const error = tickets.error ?? areas.error;
  const ladder = pending ? (
    <div className="mt-4">
      <Loading />
    </div>
  ) : error ? (
    <div className="mt-4">
      <Failure
        error={error}
        retry={() => {
          tickets.refetch();
          areas.refetch();
        }}
      />
    </div>
  ) : null;
  const s = tickets.data && areas.data ? summarizeTickets(tickets.data, areas.data, viewer.id, isAdmin) : null;
  const pageShare = s ? Math.min(100, Math.round((s.pagesDone / PAGE_TARGET) * 100)) : 0;
  return (
    <>
      <section aria-labelledby="tickets-mine" className={card}>
        <h2 id="tickets-mine" className={heading}>
          Meine Tickets
        </h2>
        {ladder ?? (
          <>
            <p className="mt-5">
              <strong className={figure}>{s!.mine.length}</strong>
              <span className="mt-1.5 block text-[13px] text-muted">offen</span>
            </p>
            {s!.mine.length === 0 ? (
              <div className="mt-4">
                <Empty>Dir ist gerade kein offenes Ticket zugewiesen.</Empty>
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {s!.mine.slice(0, 5).map((ticket) => (
                  <li key={ticket.id}>
                    <Link to={`/tickets/${ticket.id}`} className={row}>
                      <span className="flex-none text-[13px] text-muted">#{ticket.number}</span>
                      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{ticket.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {more(s!.mine.length - 5)}
            <Link to="/tickets" className={`${btn.text} mt-5 self-start`}>
              Zum Board <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
            </Link>
            <DevDebug label="Meine Tickets" data={{ open: s?.mine.length, tickets: tickets.data?.length }} />
          </>
        )}
      </section>
      {(!s || s.canReview) && (
        <section aria-labelledby="tickets-abnahme" className={card}>
          <h2 id="tickets-abnahme" className={heading}>
            Wartet auf deine Abnahme
          </h2>
          {ladder ?? (
            <>
              <p className="mt-5">
                <strong className={figure}>{s!.waiting.length}</strong>
                <span className="mt-1.5 block text-[13px] text-muted">
                  {s!.waiting.length === 1 ? 'Ticket' : 'Tickets'} in Besprechung oder Abnahme
                </span>
              </p>
              {s!.waiting.length === 0 ? (
                <div className="mt-4">
                  <Empty>Gerade wartet nichts auf deine Abnahme.</Empty>
                </div>
              ) : (
                <ul className="mt-3 divide-y divide-line">
                  {s!.waiting.slice(0, 5).map((ticket) => (
                    <li key={ticket.id}>
                      <Link to={`/tickets/${ticket.id}`} className={row}>
                        <span className="flex-none text-[13px] text-muted">#{ticket.number}</span>
                        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{ticket.title}</span>
                        <span className="flex-none text-[13px] text-muted">
                          {ticket.status === 'review' ? 'Besprechung' : 'Abnahme'}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {more(s!.waiting.length - 5)}
              <DevDebug label="Wartet auf Abnahme" data={{ waiting: s?.waiting.length, canReview: s?.canReview }} />
            </>
          )}
        </section>
      )}
      <section aria-labelledby="tickets-seiten" className={card}>
        <h2 id="tickets-seiten" className={heading}>
          Seiten fertig
        </h2>
        {ladder ?? (
          <>
            <p className="mt-5">
              <strong className={figure}>{s!.pagesDone}</strong>
              <span className="mt-1.5 block text-[13px] text-muted">von {PAGE_TARGET} Seiten</span>
            </p>
            <div
              role="progressbar"
              aria-label="Seiten fertig"
              aria-valuemin={0}
              aria-valuemax={PAGE_TARGET}
              aria-valuenow={Math.min(s!.pagesDone, PAGE_TARGET)}
              className="mt-4 h-2 overflow-hidden rounded-full bg-pill"
            >
              <div className="h-full rounded-full bg-accent" style={{ width: `${pageShare}%` }} />
            </div>
            <p className="mt-4 text-[13px] text-muted">
              <strong className="text-lg font-extrabold tabular-nums text-ink">{s!.pagesPlanned}</strong> Seiten
              verplant, noch nicht abgenommen
            </p>
            <DevDebug
              label="Seiten fertig"
              data={{ done: s?.pagesDone, planned: s?.pagesPlanned, target: PAGE_TARGET }}
            />
          </>
        )}
      </section>
      <section aria-labelledby="tickets-schlafen" className={card}>
        <h2 id="tickets-schlafen" className={heading}>
          Eingeschlafen
        </h2>
        {ladder ?? (
          <>
            <p className="mt-5">
              <strong className={figure}>{s!.asleep.length}</strong>
              <span className="mt-1.5 block text-[13px] text-muted">
                ohne Änderung seit mehr als {STALE_AFTER_DAYS} Tagen
              </span>
            </p>
            {s!.asleep.length === 0 ? (
              <div className="mt-4">
                <Empty>Keine eingeschlafenen Tickets.</Empty>
              </div>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {s!.asleep.slice(0, 5).map(({ ticket, days }) => (
                  <li key={ticket.id}>
                    <Link to={`/tickets/${ticket.id}`} className={row}>
                      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{ticket.title}</span>
                      <span className="flex-none text-[13px] text-muted">
                        {ticket.assignee?.name} · {days} Tage
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {more(s!.asleep.length - 5)}
            <DevDebug label="Eingeschlafen" data={{ asleep: s?.asleep.length }} />
          </>
        )}
      </section>
    </>
  );
}
