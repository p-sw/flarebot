-- SPDX-License-Identifier: MIT
-- Single sign-on tables. Existing users, sessions, passwords, and passkeys
-- are not rewritten. Cloudflare Access policy lives in the settings table.

CREATE TABLE sso_providers (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  display_name TEXT NOT NULL,
  button_label TEXT NOT NULL,
  issuer_url TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret_encrypted TEXT,
  scopes TEXT NOT NULL,
  groups_claim TEXT NOT NULL DEFAULT 'groups',
  jit_enabled INTEGER NOT NULL DEFAULT 0,
  jit_role TEXT NOT NULL DEFAULT 'viewer',
  allowed_domains_json TEXT NOT NULL DEFAULT '[]',
  role_mappings_json TEXT NOT NULL DEFAULT '[]',
  discovery_json TEXT,
  discovery_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sso_identities (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (provider_id, subject)
);

CREATE INDEX sso_identities_user_idx ON sso_identities (user_id);

CREATE TABLE oidc_transactions (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  state_hash TEXT NOT NULL UNIQUE,
  nonce_hash TEXT NOT NULL,
  code_verifier_encrypted TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE sso_jwks_cache (
  url TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
