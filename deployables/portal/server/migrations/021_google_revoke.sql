-- Google sign-in bindings live in auth_accounts (provider_id 'google'). Like passkeys they are deleted
-- when the login email changes: after a corrected wrong-email assignment the previous holder must not
-- keep access. An erased user cannot get a new binding. Otherwise identical to 018.
CREATE TRIGGER auth_accounts_erased_guard BEFORE INSERT ON auth_accounts FOR EACH ROW EXECUTE FUNCTION portal_reject_erased_writer();

CREATE OR REPLACE FUNCTION portal_user_auth_revoke() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed_email boolean;
BEGIN
 changed_email:=TG_OP='DELETE';
 IF TG_OP='UPDATE' THEN changed_email:=OLD.login_email IS DISTINCT FROM NEW.login_email; END IF;
 IF changed_email OR (TG_OP='UPDATE' AND ((OLD.login_enabled AND NOT NEW.login_enabled) OR (OLD.admitted AND NOT NEW.admitted))) THEN
  DELETE FROM sessions WHERE user_id=OLD.id;
  DELETE FROM auth_sessions WHERE user_id=OLD.id;
  DELETE FROM auth_verifications WHERE CASE WHEN value IS JSON OBJECT THEN value::jsonb->'userData'->>'id'=OLD.id::text ELSE false END;
  IF OLD.login_email IS NOT NULL THEN
   DELETE FROM auth_verifications WHERE CASE WHEN value IS JSON OBJECT THEN lower(value::jsonb->>'email')=OLD.login_email ELSE false END;
  END IF;
 END IF;
 IF changed_email THEN
  DELETE FROM auth_passkeys WHERE user_id=OLD.id;
  DELETE FROM auth_accounts WHERE user_id=OLD.id AND provider_id='google';
 END IF;
 IF changed_email AND OLD.login_email IS NOT NULL THEN
  INSERT INTO retired_login_emails(email,user_id,reusable_after) VALUES(OLD.login_email,OLD.id,now()+interval '20 minutes')
   ON CONFLICT(email) DO UPDATE SET user_id=EXCLUDED.user_id,reusable_after=GREATEST(retired_login_emails.reusable_after,EXCLUDED.reusable_after);
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF changed_email THEN NEW.email_verified:=false; END IF;
 RETURN NEW;
END $$;
