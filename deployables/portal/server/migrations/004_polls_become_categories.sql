-- Polls become single-answer categories that keep their ids; the polls table goes away.
ALTER TABLE categories DROP CONSTRAINT categories_kind_check;
ALTER TABLE categories
 ADD CONSTRAINT categories_kind_check CHECK(kind IN ('idea','quote','memory','photo','person','proposal')),
 ADD COLUMN status text NOT NULL DEFAULT 'open' CHECK(status IN ('draft','open','closed')),
 ADD COLUMN allow_self_vote boolean NOT NULL DEFAULT false,
 ADD COLUMN version integer NOT NULL DEFAULT 1,
 ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
 ADD COLUMN opened_at timestamptz;
-- Existing repeatable categories are open since they were created.
UPDATE categories SET opened_at=created_at;
INSERT INTO categories(id,name,description,kind,status,allow_self_vote,version,created_at,opened_at)
 SELECT id,title,description,kind,status,allow_self_vote,version,created_at,opened_at FROM polls;
-- Managers granted a poll's former category are granted the poll's category too.
UPDATE users u SET category_ids=u.category_ids||ARRAY(SELECT p.id FROM polls p WHERE p.category_id=ANY(u.category_ids) AND NOT p.id=ANY(u.category_ids))
 WHERE EXISTS(SELECT 1 FROM polls p WHERE p.category_id=ANY(u.category_ids) AND NOT p.id=ANY(u.category_ids));
ALTER TABLE poll_options DROP CONSTRAINT poll_options_poll_id_fkey;
ALTER TABLE ballots DROP CONSTRAINT ballots_poll_id_fkey;
ALTER TABLE ballot_audit DROP CONSTRAINT ballot_audit_poll_id_fkey;
DROP TABLE polls;
ALTER TABLE poll_options ADD CONSTRAINT poll_options_poll_id_fkey FOREIGN KEY(poll_id) REFERENCES categories(id);
ALTER TABLE ballots ADD CONSTRAINT ballots_poll_id_fkey FOREIGN KEY(poll_id) REFERENCES categories(id);
ALTER TABLE ballot_audit ADD CONSTRAINT ballot_audit_poll_id_fkey FOREIGN KEY(poll_id) REFERENCES categories(id);
-- Repeatable categories have no lifecycle.
ALTER TABLE categories ADD CONSTRAINT categories_repeatable_open_check CHECK(kind IN ('person','proposal') OR status='open');
