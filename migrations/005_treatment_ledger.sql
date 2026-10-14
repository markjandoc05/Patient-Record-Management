BEGIN;
-- Patient-owned packages are additive: legacy patient and Visit JSONB is untouched.
CREATE TABLE treatment_ledger_purchases (
  id uuid PRIMARY KEY,
  command_id uuid NOT NULL UNIQUE,
  patient_collection_path text NOT NULL DEFAULT 'patients' CHECK (patient_collection_path='patients'),
  patient_id text NOT NULL,
  branch_collection_path text NOT NULL DEFAULT 'branches' CHECK (branch_collection_path='branches'),
  branch_id text NOT NULL,
  package_name text NOT NULL CHECK (length(btrim(package_name)) BETWEEN 1 AND 160),
  purchase_date date NOT NULL,
  branch_name_snapshot text NOT NULL,
  timezone_snapshot text NOT NULL,
  notes text NOT NULL DEFAULT '' CHECK (length(notes)<=3000),
  or_number text CHECK (or_number IS NULL OR length(btrim(or_number)) BETWEEN 1 AND 120),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  actor jsonb NOT NULL CHECK (jsonb_typeof(actor)='object'),
  FOREIGN KEY(patient_collection_path,patient_id) REFERENCES app_records(collection_path,id) ON DELETE RESTRICT,
  FOREIGN KEY(branch_collection_path,branch_id) REFERENCES app_records(collection_path,id) ON DELETE RESTRICT
);
CREATE INDEX treatment_ledger_purchases_patient_idx ON treatment_ledger_purchases(patient_id,purchase_date,id);
CREATE INDEX treatment_ledger_purchases_branch_idx ON treatment_ledger_purchases(branch_id,patient_id);
CREATE TABLE treatment_ledger_lines (
  id uuid PRIMARY KEY,
  purchase_id uuid NOT NULL REFERENCES treatment_ledger_purchases(id) ON DELETE RESTRICT,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  service_name_snapshot text NOT NULL,
  service_catalogue_version integer NOT NULL CHECK (service_catalogue_version>0),
  purchased_sessions integer NOT NULL CHECK (purchased_sessions BETWEEN 1 AND 10000),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  UNIQUE(purchase_id,service_id)
);
CREATE TABLE treatment_ledger_events (
  id uuid PRIMARY KEY,
  command_id uuid NOT NULL UNIQUE,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  type text NOT NULL CHECK (type IN ('purchase','usage','reversal','adjustment','metadata')),
  purchase_id uuid NOT NULL REFERENCES treatment_ledger_purchases(id) ON DELETE RESTRICT,
  line_id uuid REFERENCES treatment_ledger_lines(id) ON DELETE RESTRICT,
  visit_id text,
  branch_id text NOT NULL,
  sessions_delta integer NOT NULL DEFAULT 0,
  used_delta integer NOT NULL DEFAULT 0,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  treatment_date text,
  actor jsonb NOT NULL CHECK (jsonb_typeof(actor)='object'),
  reason text CHECK (reason IS NULL OR length(btrim(reason)) BETWEEN 1 AND 1000),
  visit_snapshot jsonb CHECK (visit_snapshot IS NULL OR jsonb_typeof(visit_snapshot)='object'),
  metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata)='object'),
  balance_after jsonb CHECK (balance_after IS NULL OR jsonb_typeof(balance_after)='object'),
  reverses_event_id uuid UNIQUE REFERENCES treatment_ledger_events(id) ON DELETE RESTRICT,
  CHECK ((type IN ('purchase','metadata') AND line_id IS NULL AND visit_id IS NULL AND sessions_delta=0 AND used_delta=0 AND reverses_event_id IS NULL)
    OR (type='adjustment' AND line_id IS NOT NULL AND visit_id IS NULL AND sessions_delta<>0 AND abs(sessions_delta)<=10000 AND used_delta=0 AND reason IS NOT NULL AND reverses_event_id IS NULL)
    OR (type='usage' AND line_id IS NOT NULL AND visit_id IS NOT NULL AND sessions_delta=0 AND used_delta BETWEEN 1 AND 10000 AND visit_snapshot IS NOT NULL AND treatment_date IS NOT NULL AND reverses_event_id IS NULL)
    OR (type='reversal' AND line_id IS NOT NULL AND visit_id IS NOT NULL AND sessions_delta=0 AND used_delta BETWEEN -10000 AND -1 AND reason IS NOT NULL AND reverses_event_id IS NOT NULL))
);
CREATE INDEX treatment_ledger_events_purchase_idx ON treatment_ledger_events(purchase_id,recorded_at,id);
CREATE INDEX treatment_ledger_events_line_idx ON treatment_ledger_events(line_id);
CREATE INDEX treatment_ledger_events_visit_idx ON treatment_ledger_events(visit_id);
CREATE TABLE treatment_ledger_visit_usage (
  visit_collection_path text NOT NULL DEFAULT 'visits' CHECK (visit_collection_path='visits'),
  visit_id text PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE REFERENCES treatment_ledger_events(id) ON DELETE RESTRICT,
  line_id uuid NOT NULL REFERENCES treatment_ledger_lines(id) ON DELETE RESTRICT,
  sessions integer NOT NULL CHECK (sessions BETWEEN 1 AND 10000),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  visit_snapshot jsonb NOT NULL CHECK (jsonb_typeof(visit_snapshot)='object'),
  FOREIGN KEY(visit_collection_path,visit_id) REFERENCES app_records(collection_path,id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX treatment_ledger_visit_usage_line_idx ON treatment_ledger_visit_usage(line_id);
CREATE FUNCTION treatment_ledger_protect_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='treatment_ledger_events' OR TG_OP='DELETE' THEN
    RAISE EXCEPTION 'Treatment ledger history is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='treatment_ledger_purchases' THEN
    IF (to_jsonb(NEW)-ARRAY['notes','or_number','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['notes','or_number','version']) OR NEW.version<>OLD.version+1 THEN
      RAISE EXCEPTION 'Only revisioned treatment package metadata may change' USING ERRCODE='23514';
    END IF;
  ELSIF (to_jsonb(NEW)-'version') IS DISTINCT FROM (to_jsonb(OLD)-'version') OR NEW.version<>OLD.version+1 THEN
    RAISE EXCEPTION 'Treatment Service lines are immutable except their version' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER treatment_ledger_purchases_history BEFORE UPDATE OR DELETE ON treatment_ledger_purchases FOR EACH ROW EXECUTE FUNCTION treatment_ledger_protect_history();
CREATE TRIGGER treatment_ledger_lines_history BEFORE UPDATE OR DELETE ON treatment_ledger_lines FOR EACH ROW EXECUTE FUNCTION treatment_ledger_protect_history();
CREATE TRIGGER treatment_ledger_events_history BEFORE UPDATE OR DELETE ON treatment_ledger_events FOR EACH ROW EXECUTE FUNCTION treatment_ledger_protect_history();
CREATE FUNCTION treatment_ledger_check_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE purchased integer; adjustment bigint; used bigint; owner uuid;
BEGIN
  IF NEW.line_id IS NULL THEN
    IF NEW.balance_after IS NOT NULL THEN RAISE EXCEPTION 'Package metadata has no Service balance' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  SELECT purchased_sessions,purchase_id INTO purchased,owner FROM treatment_ledger_lines WHERE id=NEW.line_id FOR UPDATE;
  IF owner IS DISTINCT FROM NEW.purchase_id THEN RAISE EXCEPTION 'Treatment line belongs to another purchase' USING ERRCODE='23514'; END IF;
  SELECT COALESCE(sum(sessions_delta),0)+NEW.sessions_delta,COALESCE(sum(used_delta),0)+NEW.used_delta INTO adjustment,used FROM treatment_ledger_events WHERE line_id=NEW.line_id;
  IF purchased+adjustment<0 OR purchased+adjustment>10000 OR used<0 OR purchased+adjustment-used<0 THEN
    RAISE EXCEPTION 'Treatment session balance must remain nonnegative and bounded' USING ERRCODE='23514';
  END IF;
  IF NEW.balance_after IS DISTINCT FROM jsonb_build_object('purchasedSessions',purchased,'adjustmentSessions',adjustment,'usedSessions',used,'remainingSessions',purchased+adjustment-used) THEN
    RAISE EXCEPTION 'Treatment event balance snapshot does not match its immutable history' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER treatment_ledger_event_balance BEFORE INSERT ON treatment_ledger_events FOR EACH ROW EXECUTE FUNCTION treatment_ledger_check_balance();
COMMIT;
