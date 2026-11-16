-- Versioned consent per user. A new consent version requires a new row; old rows stay as proof.
CREATE TABLE consents (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 version text NOT NULL CHECK(btrim(version)<>'' AND char_length(version)<=100),
 accepted_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,version)
);

-- Erased users stay as identity-free tombstones so team history (tickets, revisions, audit) keeps its references.
ALTER TABLE users ADD COLUMN erased_at timestamptz;

CREATE FUNCTION portal_erased_user_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'erased user cannot be changed' USING ERRCODE='23514';
END $$;
CREATE TRIGGER user_erased_guard BEFORE UPDATE ON users FOR EACH ROW WHEN (OLD.erased_at IS NOT NULL) EXECUTE FUNCTION portal_erased_user_guard();
