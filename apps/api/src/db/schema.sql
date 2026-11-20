-- EMS initial demo schema. This is a one-time local setup script, not a migration.
-- PostgreSQL 13+ provides gen_random_uuid() natively.

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name_en VARCHAR(150) NOT NULL UNIQUE,
  name_bn VARCHAR(150),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  official_employee_id VARCHAR(50) NOT NULL UNIQUE,
  department_id UUID REFERENCES departments(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  employment_status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE'
    CHECK (employment_status IN ('ACTIVE', 'TRANSFERRED_OUT', 'RETIRED', 'RESIGNED', 'SUSPENDED', 'DECEASED')),
  first_name_en VARCHAR(100) NOT NULL,
  last_name_en VARCHAR(100),
  full_name_bn VARCHAR(200),
  date_of_birth DATE,
  gender VARCHAR(30),
  blood_group VARCHAR(5),
  national_id VARCHAR(30),
  phone VARCHAR(30),
  email VARCHAR(254),
  present_address TEXT,
  permanent_address TEXT,
  designation VARCHAR(150),
  joining_date DATE,
  profile_image_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS employees_department_id_idx ON employees(department_id);
CREATE INDEX IF NOT EXISTS employees_employment_status_idx ON employees(employment_status);
CREATE INDEX IF NOT EXISTS employees_name_idx ON employees(first_name_en, last_name_en);

-- Existing local databases were created with an older status list. Re-apply the
-- blueprint's list (idempotent). This fails if a row still holds a removed status
-- such as ON_LEAVE or TERMINATED; update those rows first.
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_employment_status_check;
ALTER TABLE employees ADD CONSTRAINT employees_employment_status_check
  CHECK (employment_status IN ('ACTIVE', 'TRANSFERRED_OUT', 'RETIRED', 'RESIGNED', 'SUSPENDED', 'DECEASED'));

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID UNIQUE REFERENCES employees(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'EMPLOYEE')),
  account_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (account_status IN ('ACTIVE', 'DISABLED', 'LOCKED')),
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

ALTER TABLE employees ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- Phase 3 Part 2b: remaining PDS personal fields. Idempotent so existing local databases pick them up.
-- Father's and mother's names are Admin-only fields (blueprint section 5.1).
ALTER TABLE employees ADD COLUMN IF NOT EXISTS father_name VARCHAR(200);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS mother_name VARCHAR(200);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS religion VARCHAR(50);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS marital_status VARCHAR(20);
ALTER TABLE employees DROP CONSTRAINT IF EXISTS employees_marital_status_check;
ALTER TABLE employees ADD CONSTRAINT employees_marital_status_check
  CHECK (marital_status IS NULL OR marital_status IN ('SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED'));

-- Run manually before deploying the scoped-admin API. Transactional and repeatable.
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
-- The root administrator is the single owner account that alone grants and changes
-- administrator access (like a cloud root user). Existing databases get it from
-- migrations/002_root_admin.sql, which also chooses the root account.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_root BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_admin_scope_check;
ALTER TABLE users ADD CONSTRAINT users_admin_scope_check CHECK (
  (role = 'EMPLOYEE' AND admin_scope IS NULL AND administered_department_id IS NULL)
  OR (role = 'ADMIN' AND admin_scope IS NOT NULL AND (
    (admin_scope = 'FULL' AND administered_department_id IS NULL)
    OR (admin_scope = 'DEPARTMENT' AND administered_department_id IS NOT NULL)
  ))
);


ALTER TABLE users DROP CONSTRAINT IF EXISTS users_root_check;
ALTER TABLE users ADD CONSTRAINT users_root_check CHECK (
  NOT is_root OR (role = 'ADMIN' AND admin_scope = 'FULL' AND administered_department_id IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS users_single_root_idx ON users ((TRUE)) WHERE is_root;

CREATE TABLE IF NOT EXISTS employee_spouse (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL UNIQUE REFERENCES employees(id) ON DELETE CASCADE,
  spouse_name VARCHAR(200) NOT NULL,
  spouse_occupation VARCHAR(150),
  spouse_date_of_birth DATE,
  spouse_national_id VARCHAR(30),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS academic_qualifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  institution VARCHAR(200) NOT NULL,
  degree VARCHAR(150) NOT NULL,
  subject VARCHAR(150),
  passing_year SMALLINT,
  result VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS training_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  provider VARCHAR(200),
  location VARCHAR(200),
  start_date DATE,
  end_date DATE,
  remarks TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS service_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  organization VARCHAR(200) NOT NULL,
  designation VARCHAR(150) NOT NULL,
  start_date DATE,
  end_date DATE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS posting_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  office_name VARCHAR(200),
  designation VARCHAR(150),
  start_date DATE,
  end_date DATE,
  order_reference VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS professional_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  organization VARCHAR(200) NOT NULL,
  membership_number VARCHAR(100),
  membership_type VARCHAR(100),
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS publications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title VARCHAR(300) NOT NULL,
  publication_name VARCHAR(200),
  publication_date DATE,
  reference_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(30) NOT NULL UNIQUE,
  name_en VARCHAR(120) NOT NULL,
  name_bn VARCHAR(120),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public_holidays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date DATE NOT NULL UNIQUE,
  name_en VARCHAR(200) NOT NULL,
  name_bn VARCHAR(200),
  source_note TEXT,
  year SMALLINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  leave_type_id UUID NOT NULL REFERENCES leave_types(id) ON DELETE RESTRICT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  day_count NUMERIC(6, 2) NOT NULL CHECK (day_count > 0),
  remarks TEXT,
  recorded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  last_correction_reason TEXT,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS leave_records_employee_dates_idx ON leave_records(employee_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE RESTRICT,
  submitted_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  field_key VARCHAR(150) NOT NULL,
  target_record_type VARCHAR(80),
  target_record_id UUID,
  operation VARCHAR(20) NOT NULL CHECK (operation IN ('UPDATE', 'CREATE', 'DELETE')),
  old_value_snapshot JSONB,
  proposed_value JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  rejection_reason TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  withdrawn_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS change_requests_status_submitted_idx ON change_requests(status, submitted_at);
CREATE INDEX IF NOT EXISTS change_requests_employee_idx ON change_requests(employee_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  actor_role VARCHAR(20),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID,
  field_key VARCHAR(150),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_id VARCHAR(100),
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS audit_logs_entity_idx ON audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS audit_logs_occurred_at_idx ON audit_logs(occurred_at);

-- connect-pg-simple creates and maintains its PostgreSQL `session` table on first use.

-- Short-lived, owner-bound import previews; consumed atomically on commit.
CREATE TABLE IF NOT EXISTS import_previews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rows_data JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '20 minutes'),
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS import_previews_expiry_idx ON import_previews(expires_at);

-- Preserve holidays used in a leave calculation independently of later calendar edits.
CREATE TABLE IF NOT EXISTS leave_holiday_snapshots (
  leave_record_id UUID NOT NULL REFERENCES leave_records(id) ON DELETE CASCADE,
  holiday_date DATE NOT NULL,
  PRIMARY KEY (leave_record_id, holiday_date)
);
