-- A request that started before an erasure must not write new data for the erased person afterwards.
-- FOR SHARE waits for a running erasure (FOR UPDATE on users) and then sees its committed erased_at.
CREATE FUNCTION portal_reject_erased_writer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE uid uuid; erased boolean;
BEGIN
 uid := COALESCE(to_jsonb(NEW)->>'author_id', to_jsonb(NEW)->>'user_id')::uuid;
 SELECT erased_at IS NOT NULL INTO erased FROM users WHERE id=uid FOR SHARE;
 IF erased THEN RAISE EXCEPTION 'erased user cannot write' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER submissions_erased_guard BEFORE INSERT ON submissions FOR EACH ROW EXECUTE FUNCTION portal_reject_erased_writer();
CREATE TRIGGER corrections_erased_guard BEFORE INSERT ON corrections FOR EACH ROW EXECUTE FUNCTION portal_reject_erased_writer();
CREATE TRIGGER ballots_erased_guard BEFORE INSERT ON ballots FOR EACH ROW EXECUTE FUNCTION portal_reject_erased_writer();
CREATE TRIGGER ballot_audit_erased_guard BEFORE INSERT ON ballot_audit FOR EACH ROW EXECUTE FUNCTION portal_reject_erased_writer();
