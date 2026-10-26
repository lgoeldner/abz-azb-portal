ALTER TABLE categories ADD COLUMN repeatable boolean, ADD COLUMN ongoing boolean, ADD COLUMN closes_at timestamptz;

UPDATE categories
SET repeatable = kind IN ('idea', 'quote', 'memory', 'photo'), ongoing = true;

ALTER TABLE categories ALTER COLUMN repeatable SET NOT NULL, ALTER COLUMN ongoing SET NOT NULL;
ALTER TABLE categories ADD CONSTRAINT categories_ongoing_deadline_check CHECK (ongoing OR closes_at IS NOT NULL);

ALTER TABLE categories DROP CONSTRAINT categories_repeatable_open_check;

-- Seed and direct SQL inserts that omit repeatable keep the legacy kind default.
CREATE FUNCTION categories_default_collection_flags() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.repeatable IS NULL THEN
        NEW.repeatable := NEW.kind IN ('idea', 'quote', 'memory', 'photo');
    END IF;
    IF NEW.ongoing IS NULL THEN
        NEW.ongoing := true;
    END IF;
    IF NEW.ongoing THEN
        NEW.closes_at := NULL;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER categories_collection_flags_default
BEFORE INSERT ON categories
FOR EACH ROW EXECUTE FUNCTION categories_default_collection_flags();

ALTER TABLE ballots ADD COLUMN ballot_id uuid;

WITH ballot_groups AS (
    SELECT
        b.poll_id,
        b.user_id,
        COALESCE(
            (SELECT a.ballot_id
             FROM ballot_audit a
             WHERE a.poll_id=b.poll_id AND a.user_id=b.user_id AND a.ballot_id IS NOT NULL
             GROUP BY a.ballot_id
             HAVING array_agg(a.option_id ORDER BY a.option_id) = (
                 SELECT array_agg(current.option_id ORDER BY current.option_id)
                 FROM ballots current
                 WHERE current.poll_id=b.poll_id AND current.user_id=b.user_id
             )
             ORDER BY max(a.created_at) DESC,a.ballot_id DESC
             LIMIT 1),
            gen_random_uuid()
        ) AS ballot_id
    FROM ballots b
    GROUP BY b.poll_id,b.user_id
)
UPDATE ballots b
SET ballot_id=g.ballot_id
FROM ballot_groups g
WHERE b.poll_id=g.poll_id AND b.user_id=g.user_id;

ALTER TABLE ballots ALTER COLUMN ballot_id SET NOT NULL;
-- Legacy SQL fixtures and imports without an explicit key remain one grouped selection.
ALTER TABLE ballots ALTER COLUMN ballot_id SET DEFAULT '00000000-0000-4000-8000-000000000000';
ALTER TABLE ballots DROP CONSTRAINT ballots_pkey;
ALTER TABLE ballots ADD PRIMARY KEY (poll_id,user_id,ballot_id,option_id);
