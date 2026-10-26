ALTER TABLE attachments ADD COLUMN caption text NOT NULL DEFAULT '' CHECK (char_length(caption) <= 2000);
ALTER TABLE revisions ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]'::jsonb;
