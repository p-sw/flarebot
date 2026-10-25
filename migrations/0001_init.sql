-- SPDX-License-Identifier: MIT
-- Flarebot MVP schema. v1 tables (incidents, maintenance, subscribers, Access mappings)
-- are intentionally not created yet; see docs/decisions.md.

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT,
  totp_secret TEXT,
  totp_pending TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  locale TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE memberships (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, organization_id)
);

CREATE TABLE credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL,
  device_name TEXT,
  transports_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE webauthn_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  challenge TEXT NOT NULL,
  type TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  method TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE login_attempts (
  email TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  locked_until INTEGER
);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  email TEXT,
  created_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by TEXT
);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  scopes_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE monitors (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config_json TEXT NOT NULL,
  interval_seconds INTEGER NOT NULL,
  timeout_seconds INTEGER NOT NULL,
  retries INTEGER NOT NULL,
  recovery_threshold INTEGER NOT NULL,
  regions_json TEXT NOT NULL DEFAULT '["default"]',
  shard_id TEXT NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  push_token_hash TEXT,
  push_token_encrypted TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX monitors_shard_idx ON monitors (shard_id);

CREATE TABLE monitor_state (
  monitor_id TEXT PRIMARY KEY REFERENCES monitors(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  since INTEGER NOT NULL,
  last_response_ms INTEGER,
  last_check_at INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  consecutive_successes INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  flapping INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE outages (
  id TEXT PRIMARY KEY,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  cause TEXT,
  acknowledged_by TEXT,
  acknowledged_at INTEGER
);

CREATE INDEX outages_monitor_idx ON outages (monitor_id, started_at);

CREATE TABLE notification_channels (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  config_encrypted TEXT NOT NULL,
  locale TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE monitor_channels (
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  PRIMARY KEY (monitor_id, channel_id)
);

CREATE TABLE status_pages (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  published INTEGER NOT NULL DEFAULT 1,
  default_locale TEXT NOT NULL,
  locales_json TEXT NOT NULL,
  source_locale TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  footer TEXT NOT NULL DEFAULT '',
  banner TEXT NOT NULL DEFAULT '',
  i18n_json TEXT NOT NULL DEFAULT '{}',
  logo_url TEXT,
  accent TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE status_page_items (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  group_name TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  source_locale TEXT NOT NULL,
  i18n_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE uptime_hourly (
  monitor_id TEXT NOT NULL,
  hour_start INTEGER NOT NULL,
  ok_count INTEGER NOT NULL,
  fail_count INTEGER NOT NULL,
  latency_sum INTEGER NOT NULL,
  latency_max INTEGER NOT NULL,
  samples_json TEXT NOT NULL,
  PRIMARY KEY (monitor_id, hour_start)
);

CREATE TABLE uptime_daily (
  monitor_id TEXT NOT NULL,
  day_start INTEGER NOT NULL,
  ok_count INTEGER NOT NULL,
  fail_count INTEGER NOT NULL,
  latency_sum INTEGER NOT NULL,
  latency_max INTEGER NOT NULL,
  PRIMARY KEY (monitor_id, day_start)
);

CREATE TABLE cert_info (
  monitor_id TEXT PRIMARY KEY,
  not_after INTEGER,
  last_checked_at INTEGER NOT NULL,
  source TEXT NOT NULL,
  error TEXT
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE mail_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  driver TEXT NOT NULL,
  host TEXT,
  port INTEGER,
  security TEXT,
  username TEXT,
  password_encrypted TEXT,
  from_name TEXT,
  from_address TEXT,
  last_test_ok INTEGER,
  last_test_at INTEGER,
  last_test_error TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE mail_outbox (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  html_body TEXT,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  message_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);

CREATE INDEX mail_outbox_due_idx ON mail_outbox (status, next_attempt_at);

CREATE TABLE email_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  actor_token_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  before_json TEXT,
  after_json TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX audit_log_created_idx ON audit_log (created_at);
