ALTER TABLE users ADD COLUMN created_at timestamptz;
-- Existing users take their first audit trace; now() only when none exists.
UPDATE users u SET created_at=coalesce((SELECT min(created_at) FROM audit_events WHERE actor_id=u.id OR entity_id=u.id), now());
ALTER TABLE users ALTER COLUMN created_at SET DEFAULT now(), ALTER COLUMN created_at SET NOT NULL;
