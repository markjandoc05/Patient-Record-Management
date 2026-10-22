BEGIN;
-- JSONB catalogue, supplier, stock and transfer IDs remain intact. Existing stock
-- is adopted on its first movement; no receipts or legacy dates are fabricated.
CREATE TABLE inventory_accounts (
  id uuid PRIMARY KEY,
  item_id text NOT NULL CHECK (length(item_id) BETWEEN 1 AND 128),
  branch_id text NOT NULL CHECK (length(branch_id) BETWEEN 1 AND 128),
  stock_record_id text NOT NULL UNIQUE,
  quantity numeric(15,3) NOT NULL CHECK (quantity BETWEEN 0 AND 1000000000),
  version integer NOT NULL CHECK (version >= 0),
  opening_source jsonb NOT NULL CHECK (jsonb_typeof(opening_source)='object'),
  UNIQUE(item_id,branch_id)
);
CREATE TABLE inventory_movements (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES inventory_accounts(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('opening','receive','use','adjust','transfer_in','transfer_out')),
  quantity numeric(15,3) NOT NULL CHECK (quantity BETWEEN -1000000000 AND 1000000000),
  balance_after numeric(15,3) NOT NULL CHECK (balance_after BETWEEN 0 AND 1000000000),
  version integer NOT NULL CHECK (version >= 0),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor jsonb NOT NULL CHECK (jsonb_typeof(actor)='object' AND actor ? 'uid'),
  notes text NOT NULL CHECK (length(notes) <= 2000),
  reference text NOT NULL CHECK (length(reference) <= 160),
  supplier_id text,
  supplier_name text,
  transfer_id text,
  UNIQUE(account_id,version),
  CHECK ((kind='opening' AND version=0 AND quantity=balance_after)
    OR (kind IN ('receive','transfer_in') AND version>0 AND quantity>0)
    OR (kind IN ('use','transfer_out') AND version>0 AND quantity<0)
    OR (kind='adjust' AND version>0 AND quantity<>0 AND length(btrim(notes))>0)),
  CHECK ((kind IN ('transfer_in','transfer_out') AND transfer_id IS NOT NULL)
    OR (kind NOT IN ('transfer_in','transfer_out') AND transfer_id IS NULL))
);
CREATE INDEX inventory_movements_history_idx ON inventory_movements(account_id,version DESC);
CREATE UNIQUE INDEX inventory_movements_transfer_idx ON inventory_movements(transfer_id,kind) WHERE transfer_id IS NOT NULL;
CREATE TABLE inventory_commands (
  command_id uuid PRIMARY KEY,
  actor jsonb NOT NULL CHECK (jsonb_typeof(actor)='object' AND actor ? 'uid'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  action text NOT NULL,
  result jsonb NOT NULL CHECK (jsonb_typeof(result)='object'),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION inventory_protect_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a inventory_accounts%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME IN ('inventory_movements','inventory_commands') AND TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'Inventory history is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='inventory_accounts' THEN
    IF TG_OP='DELETE' OR (TG_OP='UPDATE' AND
      (NEW.version<>OLD.version+1 OR (to_jsonb(NEW)-ARRAY['quantity','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['quantity','version']))) THEN
      RAISE EXCEPTION 'Inventory balance changes require the next movement' USING ERRCODE='23514';
    END IF;
    IF TG_OP='INSERT' AND NEW.version<>0 THEN RAISE EXCEPTION 'Inventory accounts start at version zero' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='inventory_movements' THEN
    SELECT * INTO a FROM inventory_accounts WHERE id=NEW.account_id FOR UPDATE;
    IF a.id IS NULL OR
      (NEW.kind='opening' AND (a.version<>0 OR NEW.version<>0 OR NEW.balance_after<>a.quantity)) OR
      (NEW.kind<>'opening' AND (NEW.version<>a.version+1 OR NEW.balance_after<>a.quantity+NEW.quantity)) THEN
      RAISE EXCEPTION 'Inventory movement does not match its balance' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_accounts_history BEFORE INSERT OR UPDATE OR DELETE ON inventory_accounts FOR EACH ROW EXECUTE FUNCTION inventory_protect_history();
CREATE TRIGGER inventory_movements_history BEFORE INSERT OR UPDATE OR DELETE ON inventory_movements FOR EACH ROW EXECUTE FUNCTION inventory_protect_history();
CREATE TRIGGER inventory_commands_history BEFORE UPDATE OR DELETE ON inventory_commands FOR EACH ROW EXECUTE FUNCTION inventory_protect_history();

CREATE FUNCTION inventory_check_account() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner uuid; a inventory_accounts%ROWTYPE; m inventory_movements%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='inventory_accounts' THEN owner := NEW.id; ELSE owner := NEW.account_id; END IF;
  SELECT * INTO a FROM inventory_accounts WHERE id=owner;
  SELECT * INTO m FROM inventory_movements WHERE account_id=a.id ORDER BY version DESC LIMIT 1;
  IF m.id IS NULL OR m.version<>a.version OR m.balance_after<>a.quantity OR NOT EXISTS (
    SELECT 1 FROM inventory_movements WHERE account_id=a.id AND kind='opening' AND version=0) OR NOT EXISTS (
    SELECT 1 FROM app_records WHERE collection_path='inventory_stocks' AND id=a.stock_record_id
      AND data->>'itemId'=a.item_id AND data->>'branchId'=a.branch_id AND data->'quantity'=to_jsonb(a.quantity)) THEN
    RAISE EXCEPTION 'Inventory balance requires a matching movement' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER inventory_accounts_complete AFTER INSERT OR UPDATE ON inventory_accounts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory_check_account();
CREATE CONSTRAINT TRIGGER inventory_movements_complete AFTER INSERT ON inventory_movements DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION inventory_check_account();

-- Guard adopted JSONB balances as well: old writers cannot silently diverge
-- from movement history. Malformed/duplicate historical records remain present
-- and are refused by the API instead of silently merged or repaired.
CREATE FUNCTION inventory_protect_stock_mirror() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a inventory_accounts%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.collection_path='inventory_stocks' AND EXISTS (SELECT 1 FROM inventory_accounts WHERE stock_record_id=OLD.id) THEN
      RAISE EXCEPTION 'Accounted inventory stock cannot be deleted' USING ERRCODE='23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='UPDATE' AND OLD.collection_path='inventory_stocks' AND EXISTS (
    SELECT 1 FROM inventory_accounts WHERE stock_record_id=OLD.id) AND
    (NEW.id<>OLD.id OR NEW.collection_path<>OLD.collection_path OR
      NEW.data->>'itemId' IS DISTINCT FROM OLD.data->>'itemId' OR NEW.data->>'branchId' IS DISTINCT FROM OLD.data->>'branchId') THEN
    RAISE EXCEPTION 'Accounted inventory identity cannot change' USING ERRCODE='23514';
  END IF;
  IF NEW.collection_path='inventory_stocks' THEN
    SELECT * INTO a FROM inventory_accounts WHERE stock_record_id=NEW.id OR (item_id=NEW.data->>'itemId' AND branch_id=NEW.data->>'branchId') LIMIT 1;
    IF a.id IS NOT NULL AND (a.stock_record_id<>NEW.id OR a.item_id IS DISTINCT FROM NEW.data->>'itemId' OR
      a.branch_id IS DISTINCT FROM NEW.data->>'branchId' OR jsonb_typeof(NEW.data->'quantity') IS DISTINCT FROM 'number' OR
      (NEW.data->>'quantity')::numeric IS DISTINCT FROM a.quantity) THEN
      RAISE EXCEPTION 'Use inventory movements to change accounted stock' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_stock_mirror BEFORE INSERT OR UPDATE OR DELETE ON app_records FOR EACH ROW EXECUTE FUNCTION inventory_protect_stock_mirror();
COMMIT;
