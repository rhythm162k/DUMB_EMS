-- All domain keys are scoped to a workspace. Timestamps are UTC and dates ISO YYYY-MM-DD.
-- The all-zero workspace is the read-only seed template, excluded from sessions and cleanup.
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;
CREATE INDEX workspaces_expiry ON workspaces(expires_at, id);

CREATE TABLE workspace_issuance (
  day TEXT PRIMARY KEY NOT NULL,
  issued INTEGER NOT NULL CHECK (issued BETWEEN 1 AND 120)
) STRICT;

-- A failed invariant can abort an entire D1 batch. A successful assertion does not write.
CREATE TABLE write_assertion (ok INTEGER PRIMARY KEY CHECK (ok = 1)) STRICT;
INSERT INTO write_assertion VALUES (1);

CREATE TABLE departments (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name_en TEXT NOT NULL CHECK (length(name_en) <= 150),
  name_bn TEXT CHECK (length(name_bn) <= 150),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (workspace_id, name_en),
  PRIMARY KEY (workspace_id, id)
) STRICT;

CREATE TABLE employees (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  official_employee_id TEXT NOT NULL CHECK (length(official_employee_id) <= 50),
  department_id TEXT,
  employment_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (length(employment_status) <= 30)
    CHECK (employment_status IN ('ACTIVE', 'TRANSFERRED_OUT', 'RETIRED', 'RESIGNED', 'SUSPENDED', 'DECEASED')),
  first_name_en TEXT NOT NULL CHECK (length(first_name_en) <= 100),
  last_name_en TEXT CHECK (length(last_name_en) <= 100),
  full_name_bn TEXT CHECK (length(full_name_bn) <= 200),
  date_of_birth TEXT CHECK (date(date_of_birth, '+0 days') IS date_of_birth),
  gender TEXT CHECK (length(gender) <= 30),
  blood_group TEXT CHECK (length(blood_group) <= 5),
  national_id TEXT CHECK (length(national_id) <= 30),
  phone TEXT CHECK (length(phone) <= 30),
  email TEXT CHECK (length(email) <= 254),
  present_address TEXT,
  permanent_address TEXT,
  designation TEXT CHECK (length(designation) <= 150),
  joining_date TEXT CHECK (date(joining_date, '+0 days') IS joining_date),
  profile_image_key TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_by TEXT,
  updated_by TEXT,
  father_name TEXT CHECK (length(father_name) <= 200),
  mother_name TEXT CHECK (length(mother_name) <= 200),
  religion TEXT CHECK (length(religion) <= 50),
  marital_status TEXT CHECK (marital_status IN ('SINGLE','MARRIED','DIVORCED','WIDOWED')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (workspace_id, official_employee_id),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, department_id) REFERENCES departments(workspace_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workspace_id, created_by) REFERENCES users(workspace_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workspace_id, updated_by) REFERENCES users(workspace_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE users (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  employee_id TEXT,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'EMPLOYEE')),
  account_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (length(account_status) <= 20)
    CHECK (account_status IN ('ACTIVE', 'DISABLED', 'LOCKED')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_login_at TEXT,
  admin_scope TEXT,
  administered_department_id TEXT,
  is_root INTEGER NOT NULL DEFAULT 0 CHECK (is_root IN (0,1)),
  entry_persona TEXT CHECK (entry_persona IN ('root','full-admin','operations-admin','people-admin','employee')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  UNIQUE (workspace_id, entry_persona),
  CHECK ((role = 'EMPLOYEE' AND admin_scope IS NULL AND administered_department_id IS NULL)
    OR (role = 'ADMIN' AND admin_scope IS NOT NULL AND
      ((admin_scope = 'FULL' AND administered_department_id IS NULL)
       OR (admin_scope = 'DEPARTMENT' AND administered_department_id IS NOT NULL)))),
  CHECK (is_root = 0 OR (role = 'ADMIN' AND admin_scope = 'FULL' AND account_status = 'ACTIVE')),
  CHECK (entry_persona IS NULL OR (employee_id IS NOT NULL AND account_status = 'ACTIVE' AND
    ((entry_persona = 'root' AND is_root = 1)
      OR (entry_persona = 'full-admin' AND is_root = 0 AND admin_scope IS 'FULL')
      OR (entry_persona IN ('operations-admin','people-admin') AND is_root = 0 AND admin_scope IS 'DEPARTMENT')
      OR (entry_persona = 'employee' AND role = 'EMPLOYEE')))),
  UNIQUE (workspace_id, employee_id),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, employee_id) REFERENCES employees(workspace_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workspace_id, administered_department_id) REFERENCES departments(workspace_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE employee_spouse (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  spouse_name TEXT NOT NULL CHECK (length(spouse_name) <= 200),
  spouse_occupation TEXT CHECK (length(spouse_occupation) <= 150),
  spouse_date_of_birth TEXT CHECK (date(spouse_date_of_birth, '+0 days') IS spouse_date_of_birth),
  spouse_national_id TEXT CHECK (length(spouse_national_id) <= 30),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (workspace_id, employee_id),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, employee_id) REFERENCES employees(workspace_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE academic_qualifications (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  institution TEXT NOT NULL CHECK (length(institution) <= 200),
  degree TEXT NOT NULL CHECK (length(degree) <= 150),
  subject TEXT CHECK (length(subject) <= 150),
  passing_year INTEGER,
  result TEXT CHECK (length(result) <= 100),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, employee_id) REFERENCES employees(workspace_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE training_records (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) <= 200),
  provider TEXT CHECK (length(provider) <= 200),
  location TEXT CHECK (length(location) <= 200),
  start_date TEXT CHECK (date(start_date, '+0 days') IS start_date),
  end_date TEXT CHECK (date(end_date, '+0 days') IS end_date),
  remarks TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, employee_id) REFERENCES employees(workspace_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE service_history (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  organization TEXT NOT NULL CHECK (length(organization) <= 200),
  designation TEXT NOT NULL CHECK (length(designation) <= 150),
  start_date TEXT CHECK (date(start_date, '+0 days') IS start_date),
  end_date TEXT CHECK (date(end_date, '+0 days') IS end_date),
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, employee_id) REFERENCES employees(workspace_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE posting_history (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  department_id TEXT,
  office_name TEXT CHECK (length(office_name) <= 200),
  designation TEXT CHECK (length(designation) <= 150),
  start_date TEXT CHECK (date(start_date, '+0 days') IS start_date),
  end_date TEXT CHECK (date(end_date, '+0 days') IS end_date),
  order_reference TEXT CHECK (length(order_reference) <= 100),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, employee_id) REFERENCES employees(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, department_id) REFERENCES departments(workspace_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE professional_memberships (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  organization TEXT NOT NULL CHECK (length(organization) <= 200),
  membership_number TEXT CHECK (length(membership_number) <= 100),
  membership_type TEXT CHECK (length(membership_type) <= 100),
  start_date TEXT CHECK (date(start_date, '+0 days') IS start_date),
  end_date TEXT CHECK (date(end_date, '+0 days') IS end_date),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, employee_id) REFERENCES employees(workspace_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE publications (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(title) <= 300),
  publication_name TEXT CHECK (length(publication_name) <= 200),
  publication_date TEXT CHECK (date(publication_date, '+0 days') IS publication_date),
  reference_url TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, employee_id) REFERENCES employees(workspace_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE leave_types (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  code TEXT NOT NULL CHECK (length(code) <= 30),
  name_en TEXT NOT NULL CHECK (length(name_en) <= 120),
  name_bn TEXT CHECK (length(name_bn) <= 120),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (workspace_id, code),
  PRIMARY KEY (workspace_id, id)
) STRICT;

CREATE TABLE public_holidays (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  holiday_date TEXT NOT NULL CHECK (date(holiday_date, '+0 days') IS holiday_date),
  name_en TEXT NOT NULL CHECK (length(name_en) <= 200),
  name_bn TEXT CHECK (length(name_bn) <= 200),
  source_note TEXT,
  year INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (workspace_id, holiday_date),
  PRIMARY KEY (workspace_id, id)
) STRICT;

CREATE TABLE leave_records (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  leave_type_id TEXT NOT NULL,
  start_date TEXT NOT NULL CHECK (date(start_date, '+0 days') IS start_date),
  end_date TEXT NOT NULL CHECK (date(end_date, '+0 days') IS end_date),
  day_count REAL NOT NULL CHECK (day_count > 0 AND day_count <= 9999.99 AND round(day_count, 2) = day_count),
  remarks TEXT,
  recorded_by TEXT,
  last_correction_reason TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  CHECK (end_date >= start_date),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, employee_id) REFERENCES employees(workspace_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workspace_id, leave_type_id) REFERENCES leave_types(workspace_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workspace_id, recorded_by) REFERENCES users(workspace_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE change_requests (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  submitted_by_user_id TEXT NOT NULL,
  field_key TEXT NOT NULL CHECK (length(field_key) <= 150),
  target_record_type TEXT CHECK (length(target_record_type) <= 80),
  target_record_id TEXT,
  operation TEXT NOT NULL CHECK (operation IN ('UPDATE', 'CREATE', 'DELETE')),
  old_value_snapshot TEXT CHECK (old_value_snapshot IS NULL OR json_valid(old_value_snapshot)),
  proposed_value TEXT NOT NULL CHECK (proposed_value IS NULL OR json_valid(proposed_value)),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (length(status) <= 20)
    CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  rejection_reason TEXT,
  submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_at TEXT,
  reviewed_by_user_id TEXT,
  withdrawn_at TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, employee_id) REFERENCES employees(workspace_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workspace_id, submitted_by_user_id) REFERENCES users(workspace_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workspace_id, reviewed_by_user_id) REFERENCES users(workspace_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE audit_logs (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  actor_user_id TEXT,
  actor_role TEXT CHECK (length(actor_role) <= 20),
  action TEXT NOT NULL CHECK (length(action) <= 100),
  entity_type TEXT NOT NULL CHECK (length(entity_type) <= 100),
  entity_id TEXT,
  field_key TEXT CHECK (length(field_key) <= 150),
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  request_id TEXT CHECK (length(request_id) <= 100),
  reason TEXT,
  metadata TEXT NOT NULL DEFAULT '{}' CHECK (metadata IS NULL OR json_valid(metadata)),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, actor_user_id) REFERENCES users(workspace_id, id) DEFERRABLE INITIALLY DEFERRED
) STRICT;

CREATE TABLE import_previews (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  rows_data TEXT NOT NULL CHECK (rows_data IS NULL OR json_valid(rows_data)),
  expires_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now','+20 minutes')),
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, actor_user_id) REFERENCES users(workspace_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE leave_holiday_snapshots (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  leave_record_id TEXT NOT NULL,
  holiday_date TEXT NOT NULL CHECK (date(holiday_date, '+0 days') IS holiday_date),
  PRIMARY KEY (workspace_id, leave_record_id, holiday_date),
  FOREIGN KEY (workspace_id, leave_record_id) REFERENCES leave_records(workspace_id, id) ON DELETE CASCADE
) STRICT;

CREATE UNIQUE INDEX users_single_root ON users(workspace_id) WHERE is_root = 1;
CREATE INDEX users_administered_department ON users(workspace_id, administered_department_id);
CREATE INDEX employees_department ON employees(workspace_id, department_id, official_employee_id);
CREATE INDEX employees_status ON employees(workspace_id, employment_status);
CREATE INDEX employees_name ON employees(workspace_id, first_name_en, last_name_en);
CREATE INDEX leave_employee_dates ON leave_records(workspace_id, employee_id, start_date, end_date) WHERE cancelled_at IS NULL;
CREATE INDEX leave_employee_history ON leave_records(workspace_id, employee_id, start_date DESC, id);
CREATE INDEX changes_status ON change_requests(workspace_id, status, submitted_at DESC, id);
CREATE INDEX changes_employee ON change_requests(workspace_id, employee_id, submitted_at DESC, id);
CREATE UNIQUE INDEX changes_pending_target ON change_requests(workspace_id, employee_id, coalesce(target_record_type,''), coalesce(target_record_id,''), field_key, operation) WHERE status = 'PENDING';
CREATE INDEX audit_entity ON audit_logs(workspace_id, entity_type, entity_id);
CREATE INDEX audit_time ON audit_logs(workspace_id, occurred_at DESC, id);
CREATE INDEX import_previews_actor ON import_previews(workspace_id, actor_user_id);
CREATE INDEX import_previews_expiry ON import_previews(workspace_id, expires_at);

CREATE TABLE sessions (
  workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE
    CHECK (workspace_id <> '00000000-0000-0000-0000-000000000000'),
  token_hash TEXT NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  csrf_token TEXT NOT NULL CHECK (length(csrf_token) = 32),
  user_id TEXT NOT NULL,
  FOREIGN KEY (workspace_id, user_id) REFERENCES users(workspace_id, id) ON DELETE CASCADE
) STRICT;

CREATE INDEX academic_qualifications_employee ON academic_qualifications(workspace_id, employee_id);
CREATE INDEX training_records_employee ON training_records(workspace_id, employee_id);
CREATE INDEX service_history_employee ON service_history(workspace_id, employee_id);
CREATE INDEX posting_history_employee ON posting_history(workspace_id, employee_id);
CREATE INDEX professional_memberships_employee ON professional_memberships(workspace_id, employee_id);
CREATE INDEX publications_employee ON publications(workspace_id, employee_id);

CREATE TRIGGER leave_no_overlap_insert BEFORE INSERT ON leave_records
WHEN NEW.cancelled_at IS NULL AND EXISTS (
  SELECT 1 FROM leave_records
  WHERE workspace_id = NEW.workspace_id AND employee_id = NEW.employee_id
    AND cancelled_at IS NULL AND start_date <= NEW.end_date AND end_date >= NEW.start_date
)
BEGIN
  SELECT RAISE(ABORT, 'leave_overlap');
END;

CREATE TRIGGER leave_no_overlap_update BEFORE UPDATE OF employee_id, start_date, end_date, cancelled_at ON leave_records
WHEN NEW.cancelled_at IS NULL AND EXISTS (
  SELECT 1 FROM leave_records
  WHERE workspace_id = NEW.workspace_id AND employee_id = NEW.employee_id AND id <> OLD.id
    AND cancelled_at IS NULL AND start_date <= NEW.end_date AND end_date >= NEW.start_date
)
BEGIN
  SELECT RAISE(ABORT, 'leave_overlap');
END;

CREATE TRIGGER users_entry_persona_immutable BEFORE UPDATE OF entry_persona, role, admin_scope, administered_department_id, is_root, account_status, employee_id ON users
WHEN OLD.entry_persona IS NOT NULL AND
  (NEW.entry_persona IS NOT OLD.entry_persona OR NEW.role IS NOT OLD.role OR NEW.admin_scope IS NOT OLD.admin_scope
   OR NEW.administered_department_id IS NOT OLD.administered_department_id OR NEW.is_root IS NOT OLD.is_root
   OR NEW.account_status IS NOT OLD.account_status OR NEW.employee_id IS NOT OLD.employee_id)
BEGIN
  SELECT RAISE(ABORT, 'entry_persona_protected');
END;

CREATE TRIGGER employee_entry_status_immutable BEFORE UPDATE OF employment_status ON employees
WHEN NEW.employment_status <> 'ACTIVE' AND EXISTS (
  SELECT 1 FROM users WHERE workspace_id = OLD.workspace_id AND employee_id = OLD.id AND entry_persona IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'entry_persona_protected');
END;

-- SQLite SET NULL would also clear the non-null workspace column in a composite key.
-- Match the original optional relationships when deleting an individual parent.
CREATE TRIGGER users_clear_optional_references BEFORE DELETE ON users
WHEN EXISTS (SELECT 1 FROM workspaces WHERE id=OLD.workspace_id)
BEGIN
  UPDATE employees SET created_by=NULL WHERE workspace_id=OLD.workspace_id AND created_by=OLD.id;
  UPDATE employees SET updated_by=NULL WHERE workspace_id=OLD.workspace_id AND updated_by=OLD.id;
  UPDATE leave_records SET recorded_by=NULL WHERE workspace_id=OLD.workspace_id AND recorded_by=OLD.id;
  UPDATE audit_logs SET actor_user_id=NULL WHERE workspace_id=OLD.workspace_id AND actor_user_id=OLD.id;
END;

CREATE TRIGGER departments_clear_optional_references BEFORE DELETE ON departments
WHEN EXISTS (SELECT 1 FROM workspaces WHERE id=OLD.workspace_id)
BEGIN
  UPDATE posting_history SET department_id=NULL WHERE workspace_id=OLD.workspace_id AND department_id=OLD.id;
END;
