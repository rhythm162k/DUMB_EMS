-- Persist assignment audits and invalidate previews in the same statement
-- that changes permissions, including when the update is part of a D1 batch.
CREATE TRIGGER audit_administrator_assignment
AFTER UPDATE OF role, admin_scope, administered_department_id ON users
WHEN OLD.entry_persona IS NULL AND NEW.version = OLD.version + 1
BEGIN
  INSERT INTO audit_logs (workspace_id, id, actor_user_id, actor_role, action, entity_type, entity_id, metadata)
  VALUES (
    NEW.workspace_id,
    lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
      substr(hex(randomblob(2)), 2) || '-8' || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
    (SELECT id FROM users WHERE workspace_id = NEW.workspace_id AND is_root = 1),
    'ADMIN', 'ADMIN_ACCESS_CHANGED', 'user', NEW.id,
    json_object('employeeId', NEW.employee_id, 'accessLevel', coalesce(NEW.admin_scope, 'NONE'),
      'departmentId', NEW.administered_department_id, 'previousAccessLevel', coalesce(OLD.admin_scope, 'NONE'),
      'previousAdministeredDepartmentId', OLD.administered_department_id)
  );
  DELETE FROM import_previews WHERE workspace_id = NEW.workspace_id AND actor_user_id = NEW.id;
END;
