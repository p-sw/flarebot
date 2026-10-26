-- SPDX-License-Identifier: MIT
-- Additive. Existing hourly and daily rows are not rewritten.
-- A slot is 15 minutes. The scheduler inserts one row when that bucket
-- closes, so a monitor adds 96 rows a day instead of one row per check.
-- maint_count is checks inside a maintenance window. They stay out of uptime.
-- The index lets the prune job delete old slots without a full scan.

CREATE TABLE uptime_slots (
  monitor_id TEXT NOT NULL,
  slot_start INTEGER NOT NULL,
  ok_count INTEGER NOT NULL,
  fail_count INTEGER NOT NULL,
  latency_sum INTEGER NOT NULL,
  latency_max INTEGER NOT NULL,
  maint_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (monitor_id, slot_start)
);

CREATE INDEX IF NOT EXISTS uptime_slots_slot_idx ON uptime_slots (slot_start);
