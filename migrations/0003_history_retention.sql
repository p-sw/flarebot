-- SPDX-License-Identifier: MIT
-- Additive. Existing status pages show the last 24 hours.
-- Existing uptime and outage rows are not rewritten or deleted here.
-- The indexes let the hourly prune find old buckets without a full scan.

ALTER TABLE status_pages ADD COLUMN display_range TEXT NOT NULL DEFAULT '24h';

CREATE INDEX IF NOT EXISTS uptime_hourly_hour_idx ON uptime_hourly (hour_start);
CREATE INDEX IF NOT EXISTS uptime_daily_day_idx ON uptime_daily (day_start);
CREATE INDEX IF NOT EXISTS outages_ended_idx ON outages (ended_at);
