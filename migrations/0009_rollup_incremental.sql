-- Incremental daily rollup.
-- Additive. Does not update or delete uptime_hourly or uptime_daily.
-- Existing daily rows stay until a later cron rewrites a day from its hourly rows.
-- rollup_dirty records UTC days whose hourly rows changed.
-- rollup_watermark.pending_before walks history one day per cron:
--   0  backfill has not started
--   >0 exclusive upper bound of hours still to backfill
--   -1 backfill is finished

CREATE TABLE IF NOT EXISTS rollup_dirty (
  monitor_id TEXT NOT NULL,
  day_start INTEGER NOT NULL,
  PRIMARY KEY (monitor_id, day_start)
);

CREATE INDEX IF NOT EXISTS rollup_dirty_day_idx ON rollup_dirty (day_start);

CREATE TABLE IF NOT EXISTS rollup_watermark (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  pending_before INTEGER NOT NULL DEFAULT 0
);

INSERT INTO rollup_watermark (id, pending_before)
SELECT 1, 0
WHERE NOT EXISTS (SELECT 1 FROM rollup_watermark WHERE id = 1);
