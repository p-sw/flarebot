-- SPDX-License-Identifier: MIT
-- Additive: existing rows default to 0, so no status page moves to `/`.
-- The partial unique index allows many zeros and at most one 1.
ALTER TABLE status_pages ADD COLUMN serve_at_root INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX status_pages_one_root
  ON status_pages(serve_at_root)
  WHERE serve_at_root = 1;
