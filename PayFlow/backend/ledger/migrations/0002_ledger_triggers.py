from django.db import migrations

FORWARD = """
CREATE FUNCTION ledger_forbid_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'ledger rows are append-only (% on %)', TG_OP, TG_TABLE_NAME
        USING ERRCODE = 'integrity_constraint_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_entry_append_only
    BEFORE UPDATE OR DELETE ON ledger_entry
    FOR EACH ROW EXECUTE FUNCTION ledger_forbid_mutation();

CREATE TRIGGER ledger_transaction_append_only
    BEFORE UPDATE OR DELETE ON ledger_ledgertransaction
    FOR EACH ROW EXECUTE FUNCTION ledger_forbid_mutation();

CREATE FUNCTION ledger_check_balanced() RETURNS trigger AS $$
DECLARE total bigint;
BEGIN
    SELECT COALESCE(SUM(amount), 0) INTO total FROM ledger_entry WHERE transaction_id = NEW.transaction_id;
    IF total <> 0 THEN
        RAISE EXCEPTION 'ledger transaction % is unbalanced (sum = %)', NEW.transaction_id, total
            USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_entry_balanced
    AFTER INSERT ON ledger_entry
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();
"""

REVERSE = """
DROP TRIGGER IF EXISTS ledger_entry_balanced ON ledger_entry;
DROP TRIGGER IF EXISTS ledger_entry_append_only ON ledger_entry;
DROP TRIGGER IF EXISTS ledger_transaction_append_only ON ledger_ledgertransaction;
DROP FUNCTION IF EXISTS ledger_check_balanced();
DROP FUNCTION IF EXISTS ledger_forbid_mutation();
"""


class Migration(migrations.Migration):
    """Database-level guarantees: the ledger is append-only and every transaction sums to zero
    (checked at commit, so the two entries of a transfer may be inserted in either order)."""

    dependencies = [("ledger", "0001_initial")]
    operations = [migrations.RunSQL(FORWARD, REVERSE)]
