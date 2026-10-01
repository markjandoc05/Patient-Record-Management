BEGIN;
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_identity_fk
  FOREIGN KEY (user_id) REFERENCES auth_identities(user_id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions (expires_at);
CREATE INDEX IF NOT EXISTS oauth_attempts_expiry_idx ON oauth_attempts (expires_at);
COMMIT;
