BEGIN;
CREATE TABLE service_categories (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  updated_by text NOT NULL
);
CREATE UNIQUE INDEX service_categories_name_unique ON service_categories (lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));
CREATE TABLE services (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  category_id uuid REFERENCES service_categories(id) ON DELETE RESTRICT,
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  default_duration_minutes integer NOT NULL CHECK (default_duration_minutes BETWEEN 1 AND 1440),
  standard_price numeric(12,2) CHECK (standard_price IS NULL OR standard_price BETWEEN 0 AND 9999999999.99),
  active boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  updated_by text NOT NULL
);
CREATE UNIQUE INDEX services_name_unique ON services (lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));
CREATE INDEX services_category_idx ON services(category_id);
CREATE TABLE service_branch_settings (
  id uuid PRIMARY KEY,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  branch_collection_path text NOT NULL DEFAULT 'branches' CHECK (branch_collection_path = 'branches'),
  branch_id text NOT NULL,
  available boolean NOT NULL DEFAULT false,
  price_override numeric(12,2) CHECK (price_override IS NULL OR price_override BETWEEN 0 AND 9999999999.99),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  updated_by text NOT NULL,
  UNIQUE(service_id, branch_id),
  FOREIGN KEY(branch_collection_path, branch_id) REFERENCES app_records(collection_path, id) ON DELETE RESTRICT
);
CREATE INDEX service_branch_available_idx ON service_branch_settings(branch_id, available, service_id);
COMMIT;
