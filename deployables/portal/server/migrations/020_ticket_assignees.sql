-- A ticket can have several assignees ("Wer"). Replaces tickets.assignee_id; existing assignments carry over.
CREATE TABLE ticket_assignees (
 ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id),
 PRIMARY KEY(ticket_id,user_id)
);
CREATE INDEX ticket_assignees_user_idx ON ticket_assignees(user_id);
INSERT INTO ticket_assignees(ticket_id,user_id) SELECT id,assignee_id FROM tickets WHERE assignee_id IS NOT NULL;
-- Everyone who left the assignees. They worked on the ticket, so their vote never binds under rule 2.
CREATE TABLE ticket_former_assignees (
 ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id),
 PRIMARY KEY(ticket_id,user_id)
);
CREATE INDEX ticket_former_assignees_user_idx ON ticket_former_assignees(user_id);
DROP INDEX tickets_assignee_idx;
ALTER TABLE tickets DROP COLUMN assignee_id;
