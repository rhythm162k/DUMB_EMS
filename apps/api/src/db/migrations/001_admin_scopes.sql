-- Run manually before deploying the scoped-admin API. Transactional and repeatable.
BEGIN;
-- Fail fast instead of queueing behind (and blocking) live sign-in traffic; just rerun.
SET LOCAL lock_timeout = '10s';
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_scope VARCHAR(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS administered_department_id UUID
  REFERENCES departments(id) ON UPDATE RESTRICT ON DELETE RESTRICT;
UPDATE users SET admin_scope = 'FULL' WHERE role = 'ADMIN' AND admin_scope IS NULL;
-- Remove the single-administrator restriction whatever it is called. A unique
-- index or constraint whose definition mentions "role" can only be a
-- one-administrator rule (many EMPLOYEE rows share a role), so this does not
-- depend on the original object's name. The primary key and the unique
-- employee_id link do not mention "role" and are never touched.
DROP INDEX IF EXISTS users_single_admin_idx;
DO $$
DECLARE restriction record;
BEGIN
  FOR restriction IN
    SELECT n.nspname AS index_schema, c.relname AS index_name, con.conname AS constraint_name
    FROM pg_index x
    JOIN pg_class c ON c.oid = x.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_constraint con
      ON con.conindid = x.indexrelid AND con.conrelid = x.indrelid AND con.contype IN ('u', 'x')
    WHERE x.indrelid = to_regclass('users') AND x.indisunique AND NOT x.indisprimary
      AND split_part(pg_get_indexdef(x.indexrelid), ' USING ', 2) ILIKE '%role%'
  LOOP
    IF restriction.constraint_name IS NOT NULL THEN
      EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', restriction.constraint_name);
    ELSE
      EXECUTE format('DROP INDEX %I.%I', restriction.index_schema, restriction.index_name);
    END IF;
    RAISE NOTICE 'Removed single-administrator restriction: %', restriction.index_name;
  END LOOP;
END $$;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_admin_scope_check;
ALTER TABLE users ADD CONSTRAINT users_admin_scope_check CHECK (
  (role = 'EMPLOYEE' AND admin_scope IS NULL AND administered_department_id IS NULL)
  OR (role = 'ADMIN' AND admin_scope IS NOT NULL AND (
    (admin_scope = 'FULL' AND administered_department_id IS NULL)
    OR (admin_scope = 'DEPARTMENT' AND administered_department_id IS NOT NULL)
  ))
);
-- Tables this release reads/writes that older production databases may lack because
-- schema.sql is never applied automatically. Idempotent: existing tables and data are
-- left untouched. import_previews is cleared whenever administrator access changes, so
-- its absence makes every assignment fail.
CREATE TABLE IF NOT EXISTS import_previews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rows_data JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '20 minutes'),
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS import_previews_expiry_idx ON import_previews(expires_at);
DO $$
BEGIN
  IF to_regclass('leave_records') IS NOT NULL THEN
    CREATE TABLE IF NOT EXISTS leave_holiday_snapshots (
      leave_record_id UUID NOT NULL REFERENCES leave_records(id) ON DELETE CASCADE,
      holiday_date DATE NOT NULL,
      PRIMARY KEY (leave_record_id, holiday_date)
    );
  END IF;
END $$;
COMMIT;
