import { Link } from 'react-router-dom';
import { ArrowRight, FileText } from 'lucide-react';
import type { Area, Me, Ticket } from './api';
import { AreaTag, Empty, Failure, Loading, StatusPill, btn, heading, useData } from './ui';

const LIMIT = 6;

/** A ticket is finished when it is done and approved by a binding review of the current round. */
export const isFinishedTicket = (ticket: Ticket) => ticket.status === 'done' && ticket.approved;

const byUpdatedAsc = (a: Ticket, b: Ticket) => Date.parse(a.updated_at) - Date.parse(b.updated_at);
const byUpdatedDesc = (a: Ticket, b: Ticket) => Date.parse(b.updated_at) - Date.parse(a.updated_at);
/** Work first, then what only waits for an approval. */
const taskRank = (ticket: Ticket) => ['review', 'in_progress', 'todo', 'done'].indexOf(ticket.status);

export type MyTasksData = {
  /** The viewer is a listed reviewer of at least one area. Otherwise the waiting list is hidden. */
  canReview: boolean;
  /** Unfinished tickets assigned to the viewer: review, in progress, todo, then done awaiting approval. */
  mine: Ticket[];
  /** Tickets in the viewer's review areas without a vote of the viewer, oldest change first. Never their own tickets. */
  waiting: Ticket[];
};

export function summarizeTickets(tickets: Ticket[], areas: Area[], viewerId: string): MyTasksData {
  const reviewAreaIds = new Set(
    areas.filter((area) => area.reviewers.some((reviewer) => reviewer.id === viewerId)).map((area) => area.id),
  );
  // A vote only binds in an area the viewer is a listed reviewer of, admins included.
  const canReview = reviewAreaIds.size > 0;
  const mine = tickets
    .filter((ticket) => ticket.assignee?.id === viewerId && !isFinishedTicket(ticket))
    .sort((a, b) => taskRank(a) - taskRank(b) || byUpdatedDesc(a, b));
  const waiting = canReview
    ? tickets
        .filter(
          (ticket) =>
            (ticket.status === 'review' || (ticket.status === 'done' && !ticket.approved)) &&
            ticket.assignee?.id !== viewerId &&
            reviewAreaIds.has(ticket.area_id) &&
            !ticket.reviews.some((review) => review.user.id === viewerId),
        )
        .sort(byUpdatedAsc)
    : [];
  return { canReview, mine, waiting };
}

const row =
  '-mx-2 flex min-h-12 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-2 transition-colors hover:bg-pop/30 active:bg-pop/30';

function TaskList({ tickets, positions }: { tickets: Ticket[]; positions: Map<string, number> }) {
  return (
    <>
      <ul className="divide-y divide-line">
        {tickets.slice(0, LIMIT).map((ticket) => (
          <li key={ticket.id}>
            <Link to={`/tickets/${ticket.id}`} className={row}>
              <FileText aria-hidden="true" strokeWidth={1.75} className="size-4 shrink-0 text-muted" />
              {/* Phones: title gets its own line, tags wrap below it. */}
              <span className="min-w-0 flex-1 basis-[calc(100%-1.75rem)] truncate text-[15px] font-semibold sm:basis-0">
                {ticket.title}
              </span>
              <span className="flex gap-2 pl-7 sm:pl-0">
                <AreaTag name={ticket.area_name} position={positions.get(ticket.area_id) ?? 1} />
                <StatusPill status={ticket.status} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {tickets.length > LIMIT && (
        <p className="mt-1 text-[13px] text-muted">
          <Link to="/tickets" className="underline">
            und {tickets.length - LIMIT} weitere
          </Link>
        </p>
      )}
    </>
  );
}

/** First thing on the Redaktion home: my open tickets and, for reviewers, what waits for their approval. */
export function MyTasks({ user }: { user: Me }) {
  const viewer = user.user;
  const tickets = useData<Ticket[]>('/tickets');
  const areas = useData<Area[]>('/areas');
  const error = tickets.error ?? areas.error;
  const s = tickets.data && areas.data ? summarizeTickets(tickets.data, areas.data, viewer.id) : null;
  const positions = new Map((areas.data ?? []).map((area) => [area.id, area.position]));
  return (
    <section aria-labelledby="my-tasks" className="min-w-0">
      <h2 id="my-tasks" className={heading}>
        Meine Aufgaben
      </h2>
      <div className="mt-3">
        {error ? (
          <Failure
            error={error}
            retry={() => {
              tickets.refetch();
              areas.refetch();
            }}
          />
        ) : !s ? (
          <Loading />
        ) : s.mine.length === 0 ? (
          <Empty>
            <p>Dir ist gerade nichts zugewiesen.</p>
            <Link to="/tickets" className="mt-1 inline-flex min-h-11 items-center">
              Zum Board
            </Link>
          </Empty>
        ) : (
          <TaskList tickets={s.mine} positions={positions} />
        )}
      </div>
      {s && s.canReview && s.waiting.length > 0 && (
        <div className="mt-8">
          <h3 className="text-base font-extrabold tracking-tight">Wartet auf deine Freigabe</h3>
          <div className="mt-2">
            <TaskList tickets={s.waiting} positions={positions} />
          </div>
        </div>
      )}
      {s && s.mine.length > 0 && (
        <Link to="/tickets" className={`${btn.text} mt-4 min-h-11`}>
          Zum Board <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
        </Link>
      )}
    </section>
  );
}
