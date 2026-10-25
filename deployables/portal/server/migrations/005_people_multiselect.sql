-- Existing person polls retain their explicitly selected candidates and current votes.
ALTER TABLE categories ADD COLUMN all_people boolean NOT NULL DEFAULT false;
ALTER TABLE categories ADD COLUMN max_choices integer NOT NULL DEFAULT 1 CHECK(max_choices BETWEEN 1 AND 500);
ALTER TABLE categories ADD CONSTRAINT categories_people_choices_check CHECK(kind='person' OR (NOT all_people AND max_choices=1));
ALTER TABLE ballots DROP CONSTRAINT ballots_pkey;
ALTER TABLE ballots ADD PRIMARY KEY(poll_id,user_id,option_id);
-- A full replacement snapshot shares one ballot_id; legacy single-choice history remains intact.
ALTER TABLE ballot_audit ADD COLUMN ballot_id uuid;
