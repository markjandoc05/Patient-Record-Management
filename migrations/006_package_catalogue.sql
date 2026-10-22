BEGIN;
CREATE TABLE package_catalogue (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  active boolean NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX package_catalogue_name_idx ON package_catalogue
  (lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g')));
CREATE TABLE package_catalogue_versions (
  package_id uuid NOT NULL REFERENCES package_catalogue(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 160),
  description text NOT NULL CHECK (length(description) <= 2000),
  active boolean NOT NULL,
  command_id uuid NOT NULL UNIQUE,
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  actor jsonb NOT NULL CHECK (jsonb_typeof(actor)='object'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  sealed boolean NOT NULL DEFAULT false,
  PRIMARY KEY(package_id,version)
);
CREATE TABLE package_catalogue_lines (
  package_id uuid NOT NULL,
  version integer NOT NULL,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  service_name_snapshot text NOT NULL,
  service_catalogue_version integer NOT NULL CHECK (service_catalogue_version > 0),
  sessions integer NOT NULL CHECK (sessions BETWEEN 1 AND 10000),
  PRIMARY KEY(package_id,version,service_id),
  FOREIGN KEY(package_id,version) REFERENCES package_catalogue_versions(package_id,version) ON DELETE RESTRICT
);
ALTER TABLE package_catalogue ADD CONSTRAINT package_catalogue_current_version_fk
  FOREIGN KEY(id,version) REFERENCES package_catalogue_versions(package_id,version)
  DEFERRABLE INITIALLY DEFERRED;

-- A version is assembled and sealed in one transaction, then cannot be edited
-- or gain extra Service lines. No draft/publish workflow is exposed to users.
CREATE FUNCTION package_catalogue_protect_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Package history is immutable' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='package_catalogue' THEN
    IF TG_OP='INSERT' THEN
      IF NEW.version<>1 THEN RAISE EXCEPTION 'Packages start at version one' USING ERRCODE='23514'; END IF;
    ELSIF NEW.version<>OLD.version+1 OR (to_jsonb(NEW)-ARRAY['name','active','version']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['name','active','version']) THEN
      RAISE EXCEPTION 'Package changes require the next version' USING ERRCODE='23514';
    END IF;
  ELSIF TG_TABLE_NAME='package_catalogue_versions' THEN
    IF TG_OP='UPDATE' AND (OLD.sealed OR NOT NEW.sealed OR (to_jsonb(NEW)-'sealed') IS DISTINCT FROM (to_jsonb(OLD)-'sealed')) THEN
      RAISE EXCEPTION 'Package versions are immutable once sealed' USING ERRCODE='23514';
    END IF;
  ELSIF TG_OP<>'INSERT' OR (SELECT sealed FROM package_catalogue_versions WHERE package_id=NEW.package_id AND version=NEW.version) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Package Service lines are immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER package_catalogue_history BEFORE INSERT OR UPDATE OR DELETE ON package_catalogue FOR EACH ROW EXECUTE FUNCTION package_catalogue_protect_history();
CREATE TRIGGER package_catalogue_versions_history BEFORE UPDATE OR DELETE ON package_catalogue_versions FOR EACH ROW EXECUTE FUNCTION package_catalogue_protect_history();
CREATE TRIGGER package_catalogue_lines_history BEFORE INSERT OR UPDATE OR DELETE ON package_catalogue_lines FOR EACH ROW EXECUTE FUNCTION package_catalogue_protect_history();

CREATE FUNCTION package_catalogue_check_version() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner uuid; p package_catalogue%ROWTYPE; v package_catalogue_versions%ROWTYPE;
BEGIN
  IF TG_TABLE_NAME='package_catalogue' THEN owner := NEW.id; ELSE owner := NEW.package_id; END IF;
  SELECT * INTO p FROM package_catalogue WHERE id=owner;
  SELECT * INTO v FROM package_catalogue_versions WHERE package_id=owner AND version=p.version;
  IF v.package_id IS NULL OR NOT v.sealed OR v.name<>p.name OR v.active<>p.active
    OR (SELECT count(*) FROM package_catalogue_versions WHERE package_id=owner)<>p.version
    OR EXISTS (SELECT 1 FROM package_catalogue_versions r WHERE r.package_id=owner AND
      (NOT r.sealed OR (SELECT count(*) FROM package_catalogue_lines l WHERE l.package_id=r.package_id AND l.version=r.version) NOT BETWEEN 1 AND 20)) THEN
    RAISE EXCEPTION 'A package requires complete, sealed, ordered versions' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER package_catalogue_complete AFTER INSERT OR UPDATE ON package_catalogue DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION package_catalogue_check_version();
CREATE CONSTRAINT TRIGGER package_catalogue_version_complete AFTER INSERT OR UPDATE ON package_catalogue_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION package_catalogue_check_version();

-- Existing manual purchases receive only NULL references. Their terms, events,
-- balances and Visit bindings are neither rewritten nor backfilled.
ALTER TABLE treatment_ledger_purchases
  ADD COLUMN catalogue_package_id uuid,
  ADD COLUMN catalogue_package_version integer,
  ADD CONSTRAINT treatment_ledger_catalogue_pair CHECK ((catalogue_package_id IS NULL AND catalogue_package_version IS NULL)
    OR (catalogue_package_id IS NOT NULL AND catalogue_package_version IS NOT NULL AND catalogue_package_version>0)),
  ADD CONSTRAINT treatment_ledger_catalogue_version_fk FOREIGN KEY(catalogue_package_id,catalogue_package_version)
    REFERENCES package_catalogue_versions(package_id,version) ON DELETE RESTRICT;
COMMIT;
