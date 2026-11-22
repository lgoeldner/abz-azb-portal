-- Shared Redaktion documents (meeting minutes, notes) for the PROJECT_MANAGEMENT feature.
-- No per-document ACL: every admitted manager and admin reads and edits all documents.
CREATE TABLE documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 title text NOT NULL CHECK(btrim(title)<>'' AND char_length(title)<=200),
 kind text NOT NULL DEFAULT 'note' CHECK(kind IN ('meeting','note')),
 body text NOT NULL DEFAULT '' CHECK(char_length(body)<=100000),
 created_by uuid NOT NULL REFERENCES users(id),
 updated_by uuid NOT NULL REFERENCES users(id),
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_updated_idx ON documents(updated_at DESC);
CREATE INDEX documents_created_by_idx ON documents(created_by);
CREATE INDEX documents_updated_by_idx ON documents(updated_by);

-- Last time a user opened a document; drives the "changed since last view" flag. Personal reading data, removed on erasure.
CREATE TABLE document_views (
 document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 viewed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,document_id)
);
CREATE INDEX document_views_document_idx ON document_views(document_id);
