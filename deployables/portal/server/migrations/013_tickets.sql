-- Kanban ticket board replacing the Notion workflow. Areas (Bereiche) own default reviewers.
CREATE TABLE areas (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name text NOT NULL UNIQUE CHECK(btrim(name)<>'' AND char_length(name)<=100),
 position integer NOT NULL,
 version integer NOT NULL DEFAULT 1
);
CREATE TABLE area_reviewers (
 area_id uuid NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id),
 PRIMARY KEY(area_id,user_id)
);
CREATE INDEX area_reviewers_user_idx ON area_reviewers(user_id);
INSERT INTO areas(id,name,position) VALUES
 ('60000000-0000-4000-8000-000000000001','Redaktion',1),
 ('60000000-0000-4000-8000-000000000002','Ideen',2),
 ('60000000-0000-4000-8000-000000000003','Zitate',3),
 ('60000000-0000-4000-8000-000000000004','Fotos',4),
 ('60000000-0000-4000-8000-000000000005','Layout',5),
 ('60000000-0000-4000-8000-000000000006','Werbung',6),
 ('60000000-0000-4000-8000-000000000007','Druck',7),
 ('60000000-0000-4000-8000-000000000008','Orga',8);

CREATE TABLE tickets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 type text NOT NULL CHECK(type IN ('aufgabe','artikel')),
 title text NOT NULL CHECK(btrim(title)<>'' AND char_length(title)<=200),
 body text NOT NULL DEFAULT '' CHECK(char_length(body)<=50000),
 area_id uuid NOT NULL REFERENCES areas(id),
 assignee_id uuid REFERENCES users(id),
 created_by uuid NOT NULL REFERENCES users(id),
 size text NOT NULL CHECK(size IN ('XS','S','M','L','XL')),
 goal text NOT NULL CHECK(btrim(goal)<>'' AND char_length(goal)<=1000),
 est_pages integer,
 status text NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in_progress','review','done')),
 round integer NOT NULL DEFAULT 1 CHECK(round>=1),
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 status_changed_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT tickets_est_pages_check CHECK((type='aufgabe' AND est_pages IS NULL) OR (type='artikel' AND est_pages IS NOT NULL AND est_pages>=1))
);
CREATE INDEX tickets_status_idx ON tickets(status);
CREATE INDEX tickets_area_idx ON tickets(area_id);
CREATE INDEX tickets_assignee_idx ON tickets(assignee_id);
CREATE INDEX tickets_updated_idx ON tickets(updated_at DESC);
CREATE INDEX tickets_created_by_idx ON tickets(created_by);

-- created_at uses clock_timestamp() so events written in one transaction keep their order.
CREATE TABLE ticket_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 ticket_id uuid NOT NULL REFERENCES tickets(id),
 actor_id uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('comment','status','assign','review','edit')),
 body text NOT NULL DEFAULT '' CHECK(char_length(body)<=10000),
 detail text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ticket_events_ticket_idx ON ticket_events(ticket_id,created_at);
CREATE INDEX ticket_events_actor_idx ON ticket_events(actor_id);

CREATE TABLE ticket_reviews (
 ticket_id uuid NOT NULL REFERENCES tickets(id),
 user_id uuid NOT NULL REFERENCES users(id),
 round integer NOT NULL CHECK(round>=1),
 verdict text NOT NULL CHECK(verdict IN ('approve','changes')),
 binding boolean NOT NULL,
 self_confirmed boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(ticket_id,user_id,round)
);
CREATE INDEX ticket_reviews_user_idx ON ticket_reviews(user_id);
