-- One supported SQL/CLI provisioning path. UUIDs and all content references stay stable.
CREATE TABLE auth_runtime_state (singleton boolean PRIMARY KEY CHECK(singleton), mode text NOT NULL CHECK(mode IN ('mock','oidc','better_auth')));
CREATE TABLE retired_login_emails (email text PRIMARY KEY,user_id uuid NOT NULL,reusable_after timestamptz NOT NULL);
CREATE TABLE user_operator_audit (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL,action text NOT NULL,operator_name text NOT NULL DEFAULT current_user,created_at timestamptz NOT NULL DEFAULT now());

CREATE FUNCTION portal_user_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE others integer; real_auth boolean; losing boolean;
BEGIN
 -- Library verification/name/timestamp writes cannot wait on a separate
 -- connection's confirmation lock. Only identity/access changes need it.
 IF TG_OP='UPDATE' AND NEW.login_email IS NOT DISTINCT FROM OLD.login_email
  AND NEW.role=OLD.role AND NEW.admitted=OLD.admitted AND NEW.login_enabled=OLD.login_enabled THEN
  NEW.updated_at:=now(); RETURN NEW;
 END IF;
 PERFORM pg_advisory_xact_lock(74120984);
 SELECT COALESCE((SELECT mode='better_auth' FROM auth_runtime_state WHERE singleton),false) INTO real_auth;
 IF TG_OP='DELETE' THEN losing:=true;
 ELSE
  NEW.login_email:=NULLIF(lower(btrim(NEW.login_email)),'');
  IF NEW.login_email IS NOT NULL THEN
   IF NEW.login_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' OR length(NEW.login_email)>254 OR NEW.login_email ~ '[[:cntrl:]<>]' THEN RAISE EXCEPTION 'invalid login email' USING ERRCODE='23514'; END IF;
   IF EXISTS(SELECT 1 FROM retired_login_emails WHERE email=NEW.login_email AND user_id<>NEW.id AND reusable_after>now()) THEN RAISE EXCEPTION 'login email is temporarily unavailable' USING ERRCODE='23514'; END IF;
  END IF;
  NEW.updated_at:=now();
  losing:=NEW.role<>'admin' OR NOT NEW.admitted OR NOT NEW.login_enabled OR (real_auth AND NEW.login_email IS NULL);
 END IF;
 IF TG_OP<>'INSERT' AND OLD.role='admin' AND OLD.admitted AND OLD.login_enabled AND (NOT real_auth OR OLD.login_email IS NOT NULL) AND losing THEN
  SELECT count(*) INTO others FROM users WHERE id<>OLD.id AND role='admin' AND admitted AND login_enabled AND (NOT real_auth OR login_email IS NOT NULL);
  IF others=0 THEN RAISE EXCEPTION 'last usable administrator cannot be removed' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER user_provision_guard BEFORE INSERT OR UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION portal_user_guard();

CREATE FUNCTION portal_user_auth_revoke() RETURNS trigger LANGUAGE plpgsql AS $$
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
 IF changed_email AND OLD.login_email IS NOT NULL THEN
  INSERT INTO retired_login_emails(email,user_id,reusable_after) VALUES(OLD.login_email,OLD.id,now()+interval '20 minutes')
   ON CONFLICT(email) DO UPDATE SET user_id=EXCLUDED.user_id,reusable_after=GREATEST(retired_login_emails.reusable_after,EXCLUDED.reusable_after);
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF changed_email THEN NEW.email_verified:=false; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER user_auth_revoke BEFORE UPDATE OR DELETE ON users FOR EACH ROW EXECUTE FUNCTION portal_user_auth_revoke();

CREATE FUNCTION portal_provision_user(p_id uuid,p_email text,p_name text,p_role text DEFAULT NULL,p_admitted boolean DEFAULT NULL,p_cohort_member boolean DEFAULT NULL,p_login_enabled boolean DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE uid uuid; current_email text;
BEGIN
 PERFORM pg_advisory_xact_lock(74120984);
 p_email:=lower(btrim(p_email)); p_name:=btrim(p_name);
 IF p_email IS NULL OR p_email='' OR p_name IS NULL OR p_name='' OR length(p_name)>200 THEN RAISE EXCEPTION 'name and email required' USING ERRCODE='23514'; END IF;
 IF p_id IS NULL THEN SELECT id INTO uid FROM users WHERE login_email=p_email; ELSE uid:=p_id; END IF;
 IF uid IS NULL THEN uid:=gen_random_uuid(); END IF;
 IF EXISTS(SELECT 1 FROM users WHERE login_email=p_email AND id<>uid) THEN RAISE EXCEPTION 'identity conflict' USING ERRCODE='23505'; END IF;
 INSERT INTO users(id,login_email,name,role,admitted,cohort_member,login_enabled)
 VALUES(uid,p_email,p_name,COALESCE(p_role,'student'),COALESCE(p_admitted,false),COALESCE(p_cohort_member,false),COALESCE(p_login_enabled,false))
 ON CONFLICT(id) DO UPDATE SET login_email=EXCLUDED.login_email,name=EXCLUDED.name,role=COALESCE(p_role,users.role),admitted=COALESCE(p_admitted,users.admitted),cohort_member=COALESCE(p_cohort_member,users.cohort_member),login_enabled=COALESCE(p_login_enabled,users.login_enabled);
 INSERT INTO user_operator_audit(user_id,action) VALUES(uid,'user.provisioned');
 RETURN uid;
END $$;
CREATE FUNCTION portal_disable_user(p_id uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(74120984);
 UPDATE users SET login_enabled=false WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'unknown user' USING ERRCODE='23514'; END IF;
 INSERT INTO user_operator_audit(user_id,action) VALUES(p_id,'user.disabled');
END $$;
CREATE FUNCTION portal_set_user_email(p_id uuid,p_email text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(74120984);
 IF p_email IS NULL OR btrim(p_email)='' THEN RAISE EXCEPTION 'email required' USING ERRCODE='23514'; END IF;
 UPDATE users SET login_email=p_email WHERE id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'unknown user' USING ERRCODE='23514'; END IF;
 INSERT INTO user_operator_audit(user_id,action) VALUES(p_id,'user.email_changed');
END $$;
