CREATE TABLE users (
 id uuid PRIMARY KEY, subject text UNIQUE NOT NULL, name text NOT NULL,
 role text NOT NULL DEFAULT 'student' CHECK(role IN ('student','manager','admin')),
 admitted boolean NOT NULL DEFAULT false, cohort_member boolean NOT NULL DEFAULT false,
 category_ids uuid[] NOT NULL DEFAULT '{}'
);
CREATE TABLE categories (id uuid PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '', kind text NOT NULL CHECK(kind IN ('idea','quote','memory','photo')));
CREATE TABLE sessions (token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users, csrf text NOT NULL, expires_at timestamptz NOT NULL);
CREATE TABLE submissions (
 id uuid PRIMARY KEY, category_id uuid NOT NULL REFERENCES categories, author_id uuid NOT NULL REFERENCES users,
 title text NOT NULL, body text NOT NULL DEFAULT '', context text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected','withdrawn')),
 version integer NOT NULL DEFAULT 1, idempotency_key text NOT NULL, request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(author_id,idempotency_key)
);
CREATE INDEX submissions_author_idx ON submissions(author_id);
CREATE TABLE revisions (id uuid PRIMARY KEY, submission_id uuid NOT NULL REFERENCES submissions, version integer NOT NULL, actor_id uuid NOT NULL REFERENCES users, title text NOT NULL, body text NOT NULL, context text NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(submission_id,version));
CREATE TABLE attachments (id uuid PRIMARY KEY, submission_id uuid NOT NULL REFERENCES submissions, filename text NOT NULL, mime_type text NOT NULL, size_bytes bigint NOT NULL, sha256 text NOT NULL, storage_key text NOT NULL UNIQUE, preview_key text NOT NULL UNIQUE, deleted boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE corrections (id uuid PRIMARY KEY, submission_id uuid NOT NULL REFERENCES submissions, author_id uuid NOT NULL REFERENCES users, body text NOT NULL, resolved boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE polls (id uuid PRIMARY KEY, category_id uuid NOT NULL REFERENCES categories, title text NOT NULL, description text NOT NULL DEFAULT '', kind text NOT NULL CHECK(kind IN ('person','proposal')), status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','open','closed')), allow_self_vote boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1);
CREATE TABLE poll_options (id uuid PRIMARY KEY, poll_id uuid NOT NULL REFERENCES polls, label text NOT NULL, user_id uuid REFERENCES users, position integer NOT NULL, UNIQUE(poll_id,id));
CREATE TABLE ballots (poll_id uuid NOT NULL REFERENCES polls, user_id uuid NOT NULL REFERENCES users, option_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(poll_id,user_id), FOREIGN KEY(poll_id,option_id) REFERENCES poll_options(poll_id,id));
CREATE TABLE ballot_audit (id uuid PRIMARY KEY, poll_id uuid NOT NULL REFERENCES polls, user_id uuid NOT NULL REFERENCES users, option_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(poll_id,option_id) REFERENCES poll_options(poll_id,id));
CREATE TABLE audit_events (id uuid PRIMARY KEY, actor_id uuid NOT NULL REFERENCES users, action text NOT NULL, entity_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX audit_created_idx ON audit_events(created_at DESC);
