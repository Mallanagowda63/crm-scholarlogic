-- Student and financial records are never hard-deleted. This applies to raw SQL
-- as well as the app. TRUNCATE doesn't fire these triggers, and is used only by
-- the local seed script.
CREATE FUNCTION prevent_hard_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% records cannot be deleted', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER no_delete BEFORE DELETE ON "Student" FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON "Application" FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON "FeePlan" FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON "Instalment" FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON "Payment" FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();
CREATE TRIGGER no_delete BEFORE DELETE ON "Receipt" FOR EACH ROW EXECUTE FUNCTION prevent_hard_delete();
