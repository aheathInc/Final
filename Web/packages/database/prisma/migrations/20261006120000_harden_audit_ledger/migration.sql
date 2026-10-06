-- Preserve the historical hash format while allowing new writes to cover all
-- persisted event fields. Existing rows are truthfully classified as v1.
ALTER TABLE "audit_logs"
  ADD COLUMN "hash_version" INTEGER NOT NULL DEFAULT 1;

-- Actor identifiers are historical references. Keeping them independent from
-- mutable user rows prevents account deletion from rewriting ledger history.
ALTER TABLE "audit_logs"
  DROP CONSTRAINT IF EXISTS "audit_logs_actor_user_id_fkey";

CREATE FUNCTION prevent_audit_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit log entries are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION prevent_audit_log_mutation();
