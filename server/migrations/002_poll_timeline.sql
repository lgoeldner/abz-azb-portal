ALTER TABLE polls ADD COLUMN created_at timestamptz, ADD COLUMN opened_at timestamptz;
-- Existing polls take their times from the audit log; now() only when no event exists.
UPDATE polls p SET
 created_at=coalesce((SELECT min(created_at) FROM audit_events WHERE entity_id=p.id AND action='poll.saved'), now()),
 opened_at=CASE WHEN p.status<>'draft' THEN coalesce((SELECT min(created_at) FROM audit_events WHERE entity_id=p.id AND action='poll.status.open'), (SELECT min(created_at) FROM audit_events WHERE entity_id=p.id AND action='poll.saved'), now()) END;
ALTER TABLE polls ALTER COLUMN created_at SET DEFAULT now(), ALTER COLUMN created_at SET NOT NULL;
