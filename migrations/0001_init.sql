-- Saved reports, addressed by an unguessable id so a report can be shared.
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  payload TEXT NOT NULL
);

CREATE INDEX reports_created_at ON reports (created_at);

-- Which packages people actually look up. Drives the browse index and tells
-- the cron job what is worth pre-warming.
CREATE TABLE package_lookups (
  name TEXT PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 0,
  last_seen INTEGER NOT NULL
);

CREATE INDEX package_lookups_hits ON package_lookups (hits DESC);
