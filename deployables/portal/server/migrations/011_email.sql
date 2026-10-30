-- Email delivery metadata is deliberately separate from the general audit log.
ALTER TABLE users ADD COLUMN email_reminders_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE categories ADD COLUMN email_reminders_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE mail_policy (
    id smallint PRIMARY KEY CHECK (id = 1),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0),
    paused boolean NOT NULL DEFAULT false,
    pause_all boolean NOT NULL DEFAULT false,
    daily_limit integer NOT NULL DEFAULT 300 CHECK (daily_limit BETWEEN 1 AND 100000),
    reminder_limit integer NOT NULL DEFAULT 150 CHECK (reminder_limit BETWEEN 0 AND 100000),
    login_reserve integer NOT NULL DEFAULT 150 CHECK (login_reserve BETWEEN 0 AND 100000),
    provider_credits integer CHECK (provider_credits >= 0),
    provider_observed_at timestamptz,
    provider_error text CHECK (provider_error IN ('unavailable', 'rate_limited', 'unauthorized', 'provider_error')),
    last_reconcile_at timestamptz,
    last_worker_run timestamptz,
    last_prune_at timestamptz,
    CONSTRAINT mail_policy_budgets_fit CHECK (
        reminder_limit <= daily_limit AND login_reserve <= daily_limit
        AND reminder_limit + login_reserve <= daily_limit
    )
);

CREATE TABLE mail_messages (
    id uuid PRIMARY KEY,
    user_id uuid REFERENCES users(id) ON DELETE SET NULL,
    category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
    kind text NOT NULL CHECK (kind IN ('login', 'reminder')),
    status text NOT NULL CHECK (status IN ('queued', 'accepted', 'delivered', 'deferred', 'bounced', 'failed', 'suppressed', 'cancelled', 'unknown')),
    provider_message_id text,
    failure_code text,
    dedup_key text UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (failure_code IS NULL OR failure_code IN (
        'provider_unavailable', 'provider_rejected', 'rate_limited', 'quota_exhausted',
        'paused', 'email_unavailable', 'invalid_request', 'bounce', 'deferred',
        'suppressed', 'cancelled', 'unknown'
    ))
);
CREATE INDEX mail_messages_created_idx ON mail_messages(created_at DESC, id DESC);
CREATE INDEX mail_messages_status_idx ON mail_messages(status, created_at DESC);
CREATE INDEX mail_messages_user_idx ON mail_messages(user_id, created_at DESC);

-- Isolate the immutable address snapshot from ordinary message metadata and
-- expose it only through the admin endpoint's masking function.
CREATE TABLE mail_destinations (
    message_id uuid PRIMARY KEY REFERENCES mail_messages(id) ON DELETE CASCADE,
    recipient_snapshot text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE mail_attempts (
    id uuid PRIMARY KEY,
    message_id uuid NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
    attempt_number integer NOT NULL CHECK (attempt_number > 0),
    status text NOT NULL CHECK (status IN ('started', 'accepted', 'failed', 'unknown')),
    failure_code text,
    provider_message_id text,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    UNIQUE (message_id, attempt_number),
    CHECK (failure_code IS NULL OR failure_code IN (
        'provider_unavailable', 'provider_rejected', 'rate_limited', 'quota_exhausted',
        'paused', 'email_unavailable', 'invalid_request', 'bounce', 'deferred',
        'suppressed', 'cancelled', 'unknown'
    ))
);
CREATE INDEX mail_attempts_message_idx ON mail_attempts(message_id, attempt_number);

CREATE TABLE mail_reservations (
    id uuid PRIMARY KEY,
    message_id uuid NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
    attempt_id uuid NOT NULL UNIQUE REFERENCES mail_attempts(id) ON DELETE CASCADE,
    quota_day date NOT NULL,
    kind text NOT NULL CHECK (kind IN ('login', 'reminder')),
    state text NOT NULL CHECK (state IN ('reserved', 'consumed', 'uncertain', 'released')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mail_reservations_quota_idx ON mail_reservations(quota_day, kind, state);

CREATE TABLE mail_delivery_events (
    id uuid PRIMARY KEY,
    message_id uuid NOT NULL REFERENCES mail_messages(id) ON DELETE CASCADE,
    dedup_key text NOT NULL UNIQUE,
    status text NOT NULL CHECK (status IN ('delivered', 'deferred', 'bounced', 'suppressed', 'failed')),
    failure_code text,
    occurred_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (failure_code IS NULL OR failure_code IN ('bounce', 'deferred', 'suppressed', 'provider_rejected'))
);
CREATE INDEX mail_delivery_events_message_idx ON mail_delivery_events(message_id, occurred_at, id);

CREATE TABLE mail_admin_events (
    id uuid PRIMARY KEY,
    actor_id uuid NOT NULL REFERENCES users(id),
    action text NOT NULL CHECK (action IN ('settings_updated', 'reconciled')),
    details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mail_admin_events_created_idx ON mail_admin_events(created_at DESC, id DESC);

CREATE TABLE mail_reminder_jobs (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    closes_at timestamptz NOT NULL,
    milestone smallint NOT NULL CHECK (milestone IN (24, 72)),
    dedup_key text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'leased', 'sent', 'failed', 'uncertain', 'cancelled')),
    not_before timestamptz NOT NULL DEFAULT now(),
    lease_until timestamptz,
    last_message_id uuid REFERENCES mail_messages(id) ON DELETE SET NULL,
    failure_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, category_id, closes_at, milestone),
    CHECK (failure_code IS NULL OR failure_code IN (
        'provider_unavailable', 'provider_rejected', 'rate_limited', 'quota_exhausted',
        'paused', 'email_unavailable', 'invalid_request', 'bounce', 'deferred',
        'suppressed', 'cancelled', 'unknown'
    ))
);
CREATE INDEX mail_reminder_jobs_pending_idx ON mail_reminder_jobs(not_before, created_at) WHERE status IN ('queued', 'leased');
CREATE INDEX mail_reminder_jobs_cooldown_idx ON mail_reminder_jobs(user_id, category_id, updated_at) WHERE status = 'sent';
