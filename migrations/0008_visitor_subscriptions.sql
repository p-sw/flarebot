-- Visitor subscriptions for public status pages.
-- Additive: existing pages keep every channel off (default 0).
-- Tokens are stored only as SHA-256 hashes. Webhook URLs and signing
-- secrets are encrypted. This migration does not rewrite existing rows.

ALTER TABLE status_pages ADD COLUMN subscribe_email INTEGER NOT NULL DEFAULT 0;
ALTER TABLE status_pages ADD COLUMN subscribe_webhook INTEGER NOT NULL DEFAULT 0;
ALTER TABLE status_pages ADD COLUMN subscribe_rss INTEGER NOT NULL DEFAULT 0;

ALTER TABLE mail_outbox ADD COLUMN headers_json TEXT;

CREATE TABLE subscribers (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  status_page_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  email TEXT,
  address_hash TEXT NOT NULL,
  webhook_url_encrypted TEXT,
  webhook_secret_encrypted TEXT,
  follow_all INTEGER NOT NULL DEFAULT 1,
  monitor_ids_json TEXT NOT NULL DEFAULT '[]',
  confirm_token_hash TEXT,
  manage_token_hash TEXT NOT NULL,
  unsub_token_hash TEXT NOT NULL,
  confirm_expires_at INTEGER,
  fail_count INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  disabled_at INTEGER,
  disabled_reason TEXT
);

CREATE UNIQUE INDEX subscribers_confirm_token
  ON subscribers (confirm_token_hash)
  WHERE confirm_token_hash IS NOT NULL;
CREATE UNIQUE INDEX subscribers_manage_token ON subscribers (manage_token_hash);
CREATE UNIQUE INDEX subscribers_unsub_token ON subscribers (unsub_token_hash);
CREATE INDEX subscribers_page_status ON subscribers (status_page_id, status, created_at);
CREATE INDEX subscribers_address ON subscribers (status_page_id, address_hash);

CREATE TABLE subscription_deliveries (
  id TEXT PRIMARY KEY,
  status_page_id TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);

CREATE UNIQUE INDEX subscription_deliveries_once
  ON subscription_deliveries (subscriber_id, event_id);
CREATE INDEX subscription_deliveries_due
  ON subscription_deliveries (status, next_attempt_at);
CREATE INDEX subscription_deliveries_page
  ON subscription_deliveries (status_page_id, status);

CREATE TABLE subscription_fanout (
  event_id TEXT PRIMARY KEY,
  cursor_created_at INTEGER NOT NULL DEFAULT 0,
  cursor_id TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE subscription_limits (
  bucket TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  window_start INTEGER NOT NULL
);

-- Each email mints new manage and unsubscribe tokens. Older hashes stay
-- valid until retention so a previous message can still unsubscribe.
-- Only the hash is stored.
CREATE TABLE subscription_tokens (
  token_hash TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL,
  purpose TEXT NOT NULL,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX subscription_tokens_subscriber
  ON subscription_tokens (subscriber_id, purpose);
