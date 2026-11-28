-- SAYLESS STUDIO : connexion par passkey (Face ID), sessions révocables, codes de secours.
-- Aucun secret en clair : jetons de session et codes de secours sont stockés sous forme d'empreinte.

INSERT INTO settings (key, value) VALUES
  ('studio_setup_used_at', ''),
  ('studio_enrollment_open_until', '0'),
  ('studio_user_handle', '');
--> statement-breakpoint
CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  alg INTEGER NOT NULL CHECK (alg IN (-7, -257)),
  sign_count INTEGER NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  backed_up INTEGER NOT NULL DEFAULT 0 CHECK (backed_up IN (0, 1)),
  transports TEXT,
  label TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
--> statement-breakpoint
-- Défi à usage unique, valable 5 minutes, lié à un usage précis.
CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('register', 'login', 'stepup')),
  challenge TEXT NOT NULL,
  session_hash TEXT,
  created_at INTEGER NOT NULL,
  used_at INTEGER
);
--> statement-breakpoint
CREATE TABLE auth_sessions (
  token_hash TEXT PRIMARY KEY,
  passkey_id TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  stepup_at INTEGER,
  revoked_at INTEGER
);
--> statement-breakpoint
CREATE TABLE recovery_codes (
  code_hash TEXT PRIMARY KEY,
  batch TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER
);
--> statement-breakpoint
CREATE INDEX idx_sessions_active ON auth_sessions (revoked_at, expires_at);
