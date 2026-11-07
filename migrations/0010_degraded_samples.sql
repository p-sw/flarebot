-- SPDX-License-Identifier: MIT
-- Additive. Existing rows are not rewritten and read as zero degraded checks.
-- degraded_count is successful checks that matched a degraded condition.
-- They are already counted in ok_count, so uptime does not change.
-- The history bars use the count to paint a bucket yellow.
-- monitor_state.degraded_notified is 1 once a monitor entered degraded with
-- degraded alerts on and has not cleared. A reload reads it as stored instead
-- of deriving it from the current config. Existing rows read as 0.

ALTER TABLE uptime_slots ADD COLUMN degraded_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE uptime_hourly ADD COLUMN degraded_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE uptime_daily ADD COLUMN degraded_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE monitor_state ADD COLUMN degraded_notified INTEGER NOT NULL DEFAULT 0;
