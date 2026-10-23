BEGIN;
-- A correction reverses one complete recorded payment. Original payment terms,
-- invoice terms and Treatment Ledger history remain immutable.
CREATE TABLE pos_payment_reversals (
  id uuid PRIMARY KEY,
  payment_id uuid NOT NULL UNIQUE REFERENCES pos_payments(id) ON DELETE RESTRICT,
  command_id uuid NOT NULL UNIQUE,
  reason text NOT NULL CHECK (length(reason)<=1000 AND length(btrim(reason))>0),
  actor jsonb NOT NULL CHECK (jsonb_typeof(actor)='object'),
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pos_payment_reversals_recorded ON pos_payment_reversals(recorded_at,id);

CREATE FUNCTION pos_paid_cents(target_invoice uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT COALESCE(sum(p.amount_cents),0)::bigint FROM pos_payments p
  WHERE p.invoice_id=target_invoice
    AND NOT EXISTS (SELECT 1 FROM pos_payment_reversals r WHERE r.payment_id=p.id)
$$;

CREATE FUNCTION pos_guard_payment_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invoice pos_invoices;
BEGIN
  -- The same invoice lock serializes collections, corrections and new package
  -- redemptions. Do not acquire ledger-line locks here: Visit usage locks its
  -- line first and must be able to finish before this history check is made.
  SELECT i.* INTO invoice FROM pos_invoices i JOIN pos_payments p ON p.invoice_id=i.id
    WHERE p.id=NEW.payment_id FOR UPDATE OF i;
  IF NOT FOUND OR invoice.state<>'posted' THEN
    RAISE EXCEPTION 'Only posted invoice payments may be corrected' USING ERRCODE='23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pos_package_purchases p JOIN pos_invoice_items i ON i.id=p.item_id
    JOIN treatment_ledger_events e ON e.purchase_id=p.purchase_id
    WHERE i.invoice_id=invoice.id AND e.type IN ('usage','adjustment')
  ) THEN
    RAISE EXCEPTION 'Package usage or adjustment history prevents payment correction' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER pos_payment_reversal_guard BEFORE INSERT ON pos_payment_reversals
  FOR EACH ROW EXECUTE FUNCTION pos_guard_payment_reversal();

CREATE FUNCTION pos_protect_payment_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'POS payment correction history is immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER pos_payment_reversal_history BEFORE UPDATE OR DELETE ON pos_payment_reversals
  FOR EACH ROW EXECUTE FUNCTION pos_protect_payment_reversal();

CREATE OR REPLACE FUNCTION pos_purchase_usable(purchase uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM pos_package_purchases link JOIN pos_invoice_items item ON item.id=link.item_id
    JOIN pos_invoices invoice ON invoice.id=item.invoice_id WHERE link.purchase_id=purchase
      AND (invoice.state<>'posted' OR invoice.total_cents>pos_paid_cents(invoice.id)))
$$;

CREATE OR REPLACE FUNCTION pos_guard_ledger_usage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type IN ('usage','adjustment') THEN
    -- A correction cannot pass its package-history check while a redemption is
    -- committing, and a waiting redemption rechecks funding after the lock.
    PERFORM invoice.id FROM pos_package_purchases link
      JOIN pos_invoice_items item ON item.id=link.item_id
      JOIN pos_invoices invoice ON invoice.id=item.invoice_id
      WHERE link.purchase_id=NEW.purchase_id FOR UPDATE OF invoice;
    IF NOT pos_purchase_usable(NEW.purchase_id) THEN
      RAISE EXCEPTION 'Package awaits full invoice payment' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION pos_payment_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE invoice pos_invoices; paid bigint;
BEGIN
  SELECT * INTO invoice FROM pos_invoices WHERE id=NEW.invoice_id FOR UPDATE;
  paid := pos_paid_cents(NEW.invoice_id);
  IF invoice.state<>'posted' OR paid+NEW.amount_cents>invoice.total_cents THEN
    RAISE EXCEPTION 'Payment exceeds outstanding posted balance' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
COMMIT;
