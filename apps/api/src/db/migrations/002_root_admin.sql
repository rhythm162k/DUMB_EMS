-- Run manually (CI/CD does not run migrations) AFTER 001_admin_scopes.sql and BEFORE
-- deploying the root-administrator release. Transactional and repeatable.
--
-- Adds users.is_root: the single owner account that alone grants, changes and revokes
-- administrator access. Full-access administrators it creates keep every operational
-- permission but cannot manage administrator access or touch the root account.
BEGIN;
SET LOCAL lock_timeout = '10s';
-- Serialize with any concurrent access assignment from an older API instance.
SELECT pg_advisory_xact_lock(734613);

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_root BOOLEAN NOT NULL DEFAULT FALSE;

-- Choose the root only when none exists yet: the OLDEST active full-access administrator,
-- i.e. the original administrator created before access could be delegated. Rerunning
-- never moves the root. Verify the result below and fix it by hand if it is wrong.
DO $$
DECLARE chosen uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE is_root) THEN
    RAISE NOTICE 'Root administrator already set; leaving it unchanged.';
  ELSE
    SELECT id INTO chosen FROM users
      WHERE role = 'ADMIN' AND admin_scope = 'FULL' AND administered_department_id IS NULL
        AND account_status = 'ACTIVE'
      ORDER BY created_at ASC, id ASC LIMIT 1;
    IF chosen IS NULL THEN
      RAISE NOTICE 'No active full-access administrator found; no root was set. Set one manually.';
    ELSE
      UPDATE users SET is_root = TRUE WHERE id = chosen;
      RAISE NOTICE 'Root administrator set to user %', chosen;
    END IF;
  END IF;
END $$;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_root_check;
ALTER TABLE users ADD CONSTRAINT users_root_check CHECK (
  NOT is_root OR (role = 'ADMIN' AND admin_scope = 'FULL' AND administered_department_id IS NULL)
);
-- At most one root. (This is not a limit on administrators: any number may hold access.)
CREATE UNIQUE INDEX IF NOT EXISTS users_single_root_idx ON users ((TRUE)) WHERE is_root;
COMMIT;
