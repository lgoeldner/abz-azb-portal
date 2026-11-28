import type { Area, Ticket } from './api';

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
    .filter((ticket) => ticket.assignees.some((a) => a.id === viewerId) && !isFinishedTicket(ticket))
    .sort((a, b) => taskRank(a) - taskRank(b) || byUpdatedDesc(a, b));
  const waiting = canReview
    ? tickets
        .filter(
          (ticket) =>
            (ticket.status === 'review' || (ticket.status === 'done' && !ticket.approved)) &&
            !ticket.assignees.some((a) => a.id === viewerId) &&
            reviewAreaIds.has(ticket.area_id) &&
            !ticket.reviews.some((review) => review.user.id === viewerId),
        )
        .sort(byUpdatedAsc)
    : [];
  return { canReview, mine, waiting };
}
