-- Word polls store immutable normalized originals in label and keep moderation
-- state separately so edits, exclusions and merges remain reversible.
ALTER TABLE categories DROP CONSTRAINT categories_kind_check;
ALTER TABLE categories ADD CONSTRAINT categories_kind_check CHECK(kind IN ('idea','quote','memory','photo','person','proposal','words'));

ALTER TABLE categories DROP CONSTRAINT categories_repeatable_open_check;
ALTER TABLE categories ADD CONSTRAINT categories_repeatable_open_check CHECK(kind IN ('person','proposal','words') OR status='open');

ALTER TABLE categories DROP CONSTRAINT categories_people_choices_check;
ALTER TABLE categories ADD CONSTRAINT categories_people_choices_check CHECK(
    (kind='person' OR NOT all_people)
    AND (kind IN ('person','proposal','words') OR max_choices=1)
);

ALTER TABLE poll_options ADD COLUMN word_label text;
ALTER TABLE poll_options ADD COLUMN excluded boolean NOT NULL DEFAULT false;
ALTER TABLE poll_options ADD COLUMN moderation_version integer NOT NULL DEFAULT 1 CHECK(moderation_version >= 1);
