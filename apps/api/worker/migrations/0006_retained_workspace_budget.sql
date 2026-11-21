-- Bound storage across UTC day rollover and while expired workspaces await cleanup.
CREATE TRIGGER demo_retained_workspace_budget BEFORE INSERT ON workspaces
WHEN NEW.expires_at > unixepoch() AND EXISTS (
  SELECT 1 FROM workspaces WHERE expires_at > 0 ORDER BY expires_at, id LIMIT 1 OFFSET 143
)
BEGIN
  SELECT RAISE(ABORT, 'workspace_retention_limit');
END;
