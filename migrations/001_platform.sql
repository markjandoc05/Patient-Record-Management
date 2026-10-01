BEGIN;
CREATE TABLE IF NOT EXISTS app_records (
  collection_path text NOT NULL,
  id text NOT NULL,
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_path, id)
);
CREATE INDEX IF NOT EXISTS app_records_data_idx ON app_records USING gin (data);
CREATE INDEX IF NOT EXISTS app_records_patient_idx ON app_records (collection_path, (data ->> 'patientId'));
CREATE INDEX IF NOT EXISTS app_records_branch_idx ON app_records (collection_path, (data ->> 'branchId'));
CREATE INDEX IF NOT EXISTS app_records_email_idx ON app_records (collection_path, lower(data ->> 'email'));
CREATE TABLE IF NOT EXISTS auth_identities (
  google_subject text PRIMARY KEY,
  user_id text NOT NULL UNIQUE,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL,
  csrf_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions (user_id);
CREATE TABLE IF NOT EXISTS oauth_attempts (
  state_hash text PRIMARY KEY,
  verifier text NOT NULL,
  nonce text NOT NULL,
  expires_at timestamptz NOT NULL
);
COMMIT;
