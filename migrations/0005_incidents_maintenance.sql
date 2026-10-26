-- SPDX-License-Identifier: MIT
-- Additive. Existing monitors, status pages, rollups, and outages are not rewritten.
-- maint_count defaults to 0 so older buckets stay successful/failed samples.
-- Resolved incidents and finished maintenance are pruned later with history retention.
-- The audit log is not touched.

ALTER TABLE uptime_hourly ADD COLUMN maint_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE uptime_daily ADD COLUMN maint_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  title TEXT NOT NULL,
  notify INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER,
  source_outage_id TEXT
);

CREATE INDEX incidents_org_idx ON incidents (organization_id, updated_at);
CREATE INDEX incidents_resolved_idx ON incidents (resolved_at);
CREATE UNIQUE INDEX incidents_source_outage_idx
  ON incidents (source_outage_id)
  WHERE source_outage_id IS NOT NULL;

CREATE TABLE incident_monitors (
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  impact TEXT NOT NULL,
  PRIMARY KEY (incident_id, monitor_id)
);

CREATE TABLE incident_pages (
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
  PRIMARY KEY (incident_id, page_id)
);

CREATE INDEX incident_pages_page_idx ON incident_pages (page_id);

CREATE TABLE incident_updates (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  body TEXT NOT NULL,
  posted_at INTEGER NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX incident_updates_incident_idx ON incident_updates (incident_id, posted_at);

CREATE TABLE incident_channels (
  incident_id TEXT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  PRIMARY KEY (incident_id, channel_id)
);

CREATE TABLE maintenance_windows (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL,
  start_at INTEGER NOT NULL,
  end_at INTEGER NOT NULL,
  recurrence TEXT NOT NULL,
  weekdays_json TEXT NOT NULL DEFAULT '[]',
  notify INTEGER NOT NULL DEFAULT 0,
  cancelled_at INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX maintenance_org_idx ON maintenance_windows (organization_id, start_at);
CREATE INDEX maintenance_active_idx ON maintenance_windows (start_at, cancelled_at);

CREATE TABLE maintenance_monitors (
  maintenance_id TEXT NOT NULL REFERENCES maintenance_windows(id) ON DELETE CASCADE,
  monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
  PRIMARY KEY (maintenance_id, monitor_id)
);

CREATE INDEX maintenance_monitors_monitor_idx ON maintenance_monitors (monitor_id);

CREATE TABLE maintenance_pages (
  maintenance_id TEXT NOT NULL REFERENCES maintenance_windows(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL REFERENCES status_pages(id) ON DELETE CASCADE,
  PRIMARY KEY (maintenance_id, page_id)
);

CREATE INDEX maintenance_pages_page_idx ON maintenance_pages (page_id);

CREATE TABLE maintenance_channels (
  maintenance_id TEXT NOT NULL REFERENCES maintenance_windows(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL REFERENCES notification_channels(id) ON DELETE CASCADE,
  PRIMARY KEY (maintenance_id, channel_id)
);

CREATE TABLE maintenance_signals (
  maintenance_id TEXT NOT NULL REFERENCES maintenance_windows(id) ON DELETE CASCADE,
  occurrence_start INTEGER NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (maintenance_id, occurrence_start, kind)
);

CREATE TABLE announcement_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  href TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX announcement_events_created_idx ON announcement_events (created_at);
CREATE INDEX announcement_events_subject_idx ON announcement_events (subject_type, subject_id);

CREATE TABLE announcement_outbox (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES announcement_events(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER
);

CREATE INDEX announcement_outbox_due_idx ON announcement_outbox (status, next_attempt_at);
