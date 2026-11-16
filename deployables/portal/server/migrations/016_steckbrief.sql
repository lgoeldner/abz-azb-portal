-- Steckbrief: a one-off contribution kind with a hardcoded per-template form (templates live in code).
ALTER TABLE categories DROP CONSTRAINT categories_kind_check;
ALTER TABLE categories ADD CONSTRAINT categories_kind_check CHECK(kind IN ('idea','quote','memory','photo','steckbrief','person','proposal','words'));

ALTER TABLE categories ADD COLUMN template text NOT NULL DEFAULT '';
ALTER TABLE categories ADD CONSTRAINT categories_template_check CHECK((kind='steckbrief') = (template<>''));
ALTER TABLE categories ADD CONSTRAINT categories_steckbrief_one_off_check CHECK(kind<>'steckbrief' OR NOT repeatable);
