BEGIN;
CREATE TABLE pos_invoices (
 id uuid PRIMARY KEY, number bigint GENERATED ALWAYS AS IDENTITY UNIQUE,
 patient_collection_path text NOT NULL DEFAULT 'patients' CHECK(patient_collection_path='patients'), patient_id text NOT NULL,
 branch_collection_path text NOT NULL DEFAULT 'branches' CHECK(branch_collection_path='branches'), branch_id text NOT NULL,
 patient_name text NOT NULL, branch_name text NOT NULL,
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','posted','void')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0), currency text NOT NULL DEFAULT 'PHP' CHECK(currency='PHP'),
 total_cents bigint NOT NULL CHECK(total_cents BETWEEN 0 AND 999999999999),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=3000), or_number text CHECK(length(or_number)<=120),
 created_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz,
 actor jsonb NOT NULL, CHECK(state<>'posted' OR posted_at IS NOT NULL),
 FOREIGN KEY(patient_collection_path,patient_id) REFERENCES app_records(collection_path,id) ON DELETE RESTRICT,
 FOREIGN KEY(branch_collection_path,branch_id) REFERENCES app_records(collection_path,id) ON DELETE RESTRICT
);
CREATE INDEX pos_invoices_branch ON pos_invoices(branch_id,created_at,id);
CREATE TABLE pos_invoice_items (
 id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES pos_invoices(id) ON DELETE RESTRICT,
 position integer NOT NULL, kind text NOT NULL CHECK(kind IN ('service','package','visit','appointment')),
 name text NOT NULL, amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 0 AND 999999999999),
 snapshot jsonb NOT NULL, UNIQUE(invoice_id,position)
);
CREATE TABLE pos_payments (
 id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES pos_invoices(id) ON DELETE RESTRICT,
 amount_cents bigint NOT NULL CHECK(amount_cents>0), tender_cents bigint NOT NULL CHECK(tender_cents>=amount_cents),
 method text NOT NULL CHECK(method IN ('cash','card','gcash','bank')), reference text NOT NULL DEFAULT '' CHECK(length(reference)<=120),
 actor jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 CHECK(method='cash' OR (tender_cents=amount_cents AND length(btrim(reference))>0))
);
CREATE INDEX pos_payments_invoice ON pos_payments(invoice_id);
CREATE TABLE pos_events (
 id uuid PRIMARY KEY, command_id uuid NOT NULL UNIQUE, invoice_id uuid NOT NULL REFERENCES pos_invoices(id),
 request_hash text NOT NULL, kind text NOT NULL, actor jsonb NOT NULL, detail jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now()
);
-- Claims cover both a Visit and its appointment, preventing the same care from
-- being posted once from booking and again from the resulting Visit.
CREATE TABLE pos_source_claims (
 collection_path text NOT NULL CHECK(collection_path IN ('visits','appointments')), record_id text NOT NULL,
 invoice_id uuid NOT NULL REFERENCES pos_invoices(id), PRIMARY KEY(collection_path,record_id),
 FOREIGN KEY(collection_path,record_id) REFERENCES app_records(collection_path,id) ON DELETE RESTRICT
);
CREATE TABLE pos_package_purchases (
 item_id uuid PRIMARY KEY REFERENCES pos_invoice_items(id), purchase_id uuid NOT NULL UNIQUE REFERENCES treatment_ledger_purchases(id)
);
CREATE FUNCTION pos_purchase_usable(purchase uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT NOT EXISTS (
 SELECT 1 FROM pos_package_purchases link JOIN pos_invoice_items item ON item.id=link.item_id
 JOIN pos_invoices invoice ON invoice.id=item.invoice_id WHERE link.purchase_id=purchase
 AND (invoice.state<>'posted' OR invoice.total_cents > COALESCE((SELECT sum(amount_cents) FROM pos_payments WHERE invoice_id=invoice.id),0)))
$$;
CREATE FUNCTION pos_guard_ledger_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.type IN ('usage','adjustment') AND NOT pos_purchase_usable(NEW.purchase_id) THEN
 RAISE EXCEPTION 'Package awaits full invoice payment' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pos_ledger_funding BEFORE INSERT ON treatment_ledger_events FOR EACH ROW EXECUTE FUNCTION pos_guard_ledger_usage();
CREATE FUNCTION pos_protect_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_state text;
BEGIN
 IF TG_TABLE_NAME IN ('pos_payments','pos_events','pos_package_purchases') THEN
 RAISE EXCEPTION 'POS history is immutable' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='pos_invoice_items' THEN
 SELECT state INTO parent_state FROM pos_invoices WHERE id=COALESCE(NEW.invoice_id,OLD.invoice_id);
 IF parent_state<>'draft' THEN RAISE EXCEPTION 'Posted invoice lines are immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Invoices cannot be deleted' USING ERRCODE='23514'; END IF;
 IF NEW.version<>OLD.version+1 OR OLD.state='void' THEN RAISE EXCEPTION 'Invalid invoice revision' USING ERRCODE='23514'; END IF;
 IF OLD.state='posted' AND ((to_jsonb(NEW)-ARRAY['version','state','or_number']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['version','state','or_number']) OR NEW.state NOT IN ('posted','void')) THEN
 RAISE EXCEPTION 'Posted invoice terms are immutable' USING ERRCODE='23514'; END IF;
 IF NEW.state='void' AND EXISTS(SELECT 1 FROM pos_payments WHERE invoice_id=NEW.id) THEN
 RAISE EXCEPTION 'Paid invoices cannot be voided' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pos_invoice_history BEFORE UPDATE OR DELETE ON pos_invoices FOR EACH ROW EXECUTE FUNCTION pos_protect_history();
CREATE TRIGGER pos_item_history BEFORE INSERT OR UPDATE OR DELETE ON pos_invoice_items FOR EACH ROW EXECUTE FUNCTION pos_protect_history();
CREATE TRIGGER pos_payment_history BEFORE UPDATE OR DELETE ON pos_payments FOR EACH ROW EXECUTE FUNCTION pos_protect_history();
CREATE TRIGGER pos_event_history BEFORE UPDATE OR DELETE ON pos_events FOR EACH ROW EXECUTE FUNCTION pos_protect_history();
CREATE TRIGGER pos_package_history BEFORE UPDATE OR DELETE ON pos_package_purchases FOR EACH ROW EXECUTE FUNCTION pos_protect_history();
CREATE FUNCTION pos_payment_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invoice pos_invoices; paid bigint;
BEGIN
 SELECT * INTO invoice FROM pos_invoices WHERE id=NEW.invoice_id FOR UPDATE;
 SELECT COALESCE(sum(amount_cents),0) INTO paid FROM pos_payments WHERE invoice_id=NEW.invoice_id;
 IF invoice.state<>'posted' OR paid+NEW.amount_cents>invoice.total_cents THEN
 RAISE EXCEPTION 'Payment exceeds outstanding posted balance' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pos_payment_limit BEFORE INSERT ON pos_payments FOR EACH ROW EXECUTE FUNCTION pos_payment_balance();
COMMIT;
