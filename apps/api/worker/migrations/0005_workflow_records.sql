ALTER TABLE departments ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE leave_types ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE employee_spouse ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE academic_qualifications ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE training_records ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE service_history ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE posting_history ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE professional_memberships ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);
ALTER TABLE publications ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);

CREATE TABLE profile_images (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL,
  id TEXT NOT NULL,
  mime TEXT NOT NULL CHECK (mime IN ('image/jpeg','image/png','image/webp')),
  encoded TEXT NOT NULL CHECK (length(encoded) BETWEEN 4 AND 262144),
  PRIMARY KEY (workspace_id, employee_id),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id, employee_id) REFERENCES employees(workspace_id, id) ON DELETE CASCADE
) STRICT;

CREATE TABLE leave_requests (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  leave_type_id TEXT NOT NULL,
  start_date TEXT NOT NULL CHECK (date(start_date,'+0 days') IS start_date),
  end_date TEXT NOT NULL CHECK (date(end_date,'+0 days') IS end_date AND end_date>=start_date),
  remarks TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','WITHDRAWN')),
  reviewed_by TEXT,
  reason TEXT,
  submitted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  reviewed_at TEXT,
  leave_record_id TEXT,
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, employee_id) REFERENCES employees(workspace_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workspace_id, leave_type_id) REFERENCES leave_types(workspace_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workspace_id, reviewed_by) REFERENCES users(workspace_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (workspace_id, leave_record_id) REFERENCES leave_records(workspace_id,id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE UNIQUE INDEX leave_requests_pending ON leave_requests(workspace_id,employee_id,start_date,end_date) WHERE status='PENDING';
CREATE INDEX leave_requests_history ON leave_requests(workspace_id,employee_id,submitted_at DESC);
CREATE INDEX leave_requests_queue ON leave_requests(workspace_id,status,submitted_at DESC);

CREATE TRIGGER spouse_requires_marriage BEFORE INSERT ON employee_spouse
WHEN NOT EXISTS (SELECT 1 FROM employees WHERE workspace_id=NEW.workspace_id AND id=NEW.employee_id AND marital_status='MARRIED')
BEGIN
  SELECT RAISE(ABORT,'spouse_requires_married');
END;

CREATE TRIGGER preserve_spouse BEFORE UPDATE OF marital_status ON employees
WHEN NEW.marital_status IS NOT 'MARRIED' AND EXISTS (
  SELECT 1 FROM employee_spouse WHERE workspace_id=OLD.workspace_id AND employee_id=OLD.id
)
BEGIN
  SELECT RAISE(ABORT,'spouse_record_exists');
END;

-- Prevent a visitor from using repeated audited writes or images to exhaust shared D1 storage.
CREATE TRIGGER demo_activity_budget BEFORE INSERT ON audit_logs
WHEN NEW.workspace_id <> '00000000-0000-0000-0000-000000000000' AND
  (SELECT count(*) FROM audit_logs WHERE workspace_id=NEW.workspace_id) >= 100
BEGIN
  SELECT RAISE(ABORT,'workspace_activity_limit');
END;

CREATE TRIGGER demo_image_budget BEFORE INSERT ON profile_images
WHEN NOT EXISTS (SELECT 1 FROM profile_images WHERE workspace_id=NEW.workspace_id AND employee_id=NEW.employee_id)
  AND (SELECT count(*) FROM profile_images WHERE workspace_id=NEW.workspace_id) >= 8
BEGIN
  SELECT RAISE(ABORT,'workspace_image_limit');
END;
