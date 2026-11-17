-- Passkeys for the @better-auth/passkey 1.7.14 plugin. Column names map the plugin's camelCase fields.
-- counter is integer like Better Auth's generated schema (pg returns bigint as text).
CREATE TABLE auth_passkeys (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    name text,
    public_key text NOT NULL,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id text NOT NULL UNIQUE,
    counter integer NOT NULL,
    device_type text NOT NULL,
    backed_up boolean NOT NULL,
    transports text,
    created_at timestamptz NOT NULL DEFAULT now(),
    aaguid text
);
CREATE INDEX auth_passkeys_user_id_idx ON auth_passkeys(user_id);

-- An erased user cannot get a new passkey.
CREATE TRIGGER auth_passkeys_erased_guard BEFORE INSERT ON auth_passkeys FOR EACH ROW EXECUTE FUNCTION portal_reject_erased_writer();

-- A login email change also deletes that user's passkeys: after a corrected wrong-email
-- assignment the previous holder must not keep access. Otherwise identical to 012.
CREATE OR REPLACE FUNCTION portal_user_auth_revoke() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed_email boolean;
BEGIN
 changed_email:=TG_OP='DELETE';
 IF TG_OP='UPDATE' THEN changed_email:=OLD.login_email IS DISTINCT FROM NEW.login_email; END IF;
 IF changed_email OR (TG_OP='UPDATE' AND ((OLD.login_enabled AND NOT NEW.login_enabled) OR (OLD.admitted AND NOT NEW.admitted))) THEN
  DELETE FROM sessions WHERE user_id=OLD.id;
  DELETE FROM auth_sessions WHERE user_id=OLD.id;
  IF OLD.login_email IS NOT NULL THEN
   DELETE FROM auth_verifications WHERE CASE WHEN value IS JSON OBJECT THEN lower(value::jsonb->>'email')=OLD.login_email ELSE false END;
  END IF;
 END IF;
 IF changed_email THEN DELETE FROM auth_passkeys WHERE user_id=OLD.id; END IF;
 IF changed_email AND OLD.login_email IS NOT NULL THEN
  INSERT INTO retired_login_emails(email,user_id,reusable_after) VALUES(OLD.login_email,OLD.id,now()+interval '20 minutes')
   ON CONFLICT(email) DO UPDATE SET user_id=EXCLUDED.user_id,reusable_after=GREATEST(retired_login_emails.reusable_after,EXCLUDED.reusable_after);
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF changed_email THEN NEW.email_verified:=false; END IF;
 RETURN NEW;
END $$;
