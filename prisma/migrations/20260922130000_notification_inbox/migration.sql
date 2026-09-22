-- Notification inbox — persistent history + unread state for every push
-- notification we send. sendPushToUser writes here in the same call that
-- fires the browser push, so the mobile bell in the bottom nav can show
-- accurate unread counts + scrollable history even when the user missed
-- the push itself. Additive; existing pushes keep firing whether the
-- insert lands or not (best-effort try/catch in the wrapper).

CREATE TABLE IF NOT EXISTS "Notification" (
  "id"        TEXT PRIMARY KEY,
  "userId"    TEXT NOT NULL,
  "title"     TEXT NOT NULL,
  "body"      TEXT NOT NULL,
  "url"       TEXT,
  "tag"       TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt"    TIMESTAMP(3)
);

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Compound index covers the badge count (userId + readAt NULL) plus the
-- inbox list (userId + createdAt DESC). Postgres uses either the first
-- column alone or the pair.
CREATE INDEX IF NOT EXISTS "Notification_userId_readAt_idx"
  ON "Notification"("userId", "readAt");

CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx"
  ON "Notification"("userId", "createdAt");
