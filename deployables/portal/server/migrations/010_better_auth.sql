-- Better Auth v1.7.14 shared-user and credential schema.
-- Existing portal users keep their UUIDs and legacy OIDC subjects.
ALTER TABLE users
    ADD COLUMN login_email text,
    ADD COLUMN email_verified boolean NOT NULL DEFAULT false,
    ADD COLUMN image text,
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN login_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE users ALTER COLUMN subject DROP NOT NULL;

CREATE UNIQUE INDEX users_login_email_lower_uq
    ON users (lower(login_email))
    WHERE login_email IS NOT NULL;
-- Better Auth's generated schema also expects a unique index on the mapped field.
-- This raw index coexists with the case-insensitive index above; NULL stays allowed.
CREATE UNIQUE INDEX users_login_email_uq ON users(login_email);

CREATE TABLE auth_sessions (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    expires_at timestamptz NOT NULL,
    token text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    ip_address text,
    user_agent text,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX auth_sessions_user_id_idx ON auth_sessions(user_id);
CREATE INDEX auth_sessions_expires_at_idx ON auth_sessions(expires_at);

CREATE TABLE auth_accounts (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    account_id text NOT NULL,
    provider_id text NOT NULL,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamptz,
    refresh_token_expires_at timestamptz,
    scope text,
    password text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(provider_id, account_id)
);
CREATE INDEX auth_accounts_user_id_idx ON auth_accounts(user_id);

CREATE TABLE auth_verifications (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_verifications_identifier_idx ON auth_verifications(identifier);
CREATE INDEX auth_verifications_expires_at_idx ON auth_verifications(expires_at);

CREATE TABLE auth_rate_limits (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    key text NOT NULL UNIQUE,
    count integer NOT NULL,
    last_request bigint NOT NULL
);

-- Adds per-address resend protection for the HTTP wrapper. The email itself is
-- never stored here; key_hash is an HMAC made with the auth service secret.
CREATE TABLE auth_email_rate_limits (
    key_hash text PRIMARY KEY,
    window_started_at timestamptz NOT NULL,
    count integer NOT NULL
);
CREATE INDEX auth_email_rate_limits_window_idx ON auth_email_rate_limits(window_started_at);
