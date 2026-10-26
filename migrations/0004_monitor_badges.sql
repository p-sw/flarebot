-- SPDX-License-Identifier: MIT
-- Additive. Existing monitors stay private to badges (badges_enabled = 0).
-- A monitor on a published status page is still badge-public without this flag.
-- The index serves the public-page lookup without scanning every status item.

ALTER TABLE monitors ADD COLUMN badges_enabled INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS status_page_items_monitor_idx ON status_page_items (monitor_id);
