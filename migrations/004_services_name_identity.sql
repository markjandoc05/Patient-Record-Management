BEGIN;
-- Match the whitespace accepted by JavaScript trim()/\s, independent of SQL locale.
-- Collapse first, trim the resulting spaces, then normalize case. Display names stay intact.
CREATE FUNCTION services_normalized_name(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
RETURN lower(btrim(regexp_replace(value,
  U&'[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+', ' ', 'g')));

LOCK TABLE service_categories, services IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM service_categories GROUP BY services_normalized_name(name) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Services name migration blocked: equivalent category names exist; review records without merging or deleting automatically';
  END IF;
  IF EXISTS (SELECT 1 FROM services GROUP BY services_normalized_name(name) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Services name migration blocked: equivalent service names exist; review records without merging or deleting automatically';
  END IF;
  IF EXISTS (SELECT 1 FROM service_categories WHERE services_normalized_name(name) = '')
     OR EXISTS (SELECT 1 FROM services WHERE services_normalized_name(name) = '') THEN
    RAISE EXCEPTION 'Services name migration blocked: whitespace-only names exist; review records without rewriting automatically';
  END IF;
END $$;

DROP INDEX service_categories_name_unique;
DROP INDEX services_name_unique;
CREATE UNIQUE INDEX service_categories_name_unique ON service_categories (services_normalized_name(name));
CREATE UNIQUE INDEX services_name_unique ON services (services_normalized_name(name));
ALTER TABLE service_categories ADD CONSTRAINT service_categories_name_nonblank CHECK (services_normalized_name(name) <> '');
ALTER TABLE services ADD CONSTRAINT services_name_nonblank CHECK (services_normalized_name(name) <> '');
COMMIT;
