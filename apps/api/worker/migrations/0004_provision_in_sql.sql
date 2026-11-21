-- Clone the template inside SQLite so the Worker sends one provisioning statement.
CREATE TRIGGER provision_fictional_workspace AFTER INSERT ON workspaces
WHEN NEW.expires_at > unixepoch()
BEGIN
  INSERT INTO workspace_issuance (day, issued) VALUES (date(NEW.expires_at - 2700, 'unixepoch'), 1)
  ON CONFLICT(day) DO UPDATE SET issued = issued + 1;
  INSERT INTO departments (workspace_id, id, name_en, name_bn)
  SELECT NEW.id, id, name_en, name_bn FROM departments WHERE workspace_id='00000000-0000-0000-0000-000000000000';
  INSERT INTO employees (workspace_id, id, official_employee_id, department_id, first_name_en, last_name_en, full_name_bn, designation, marital_status, joining_date, email, employment_status, date_of_birth, gender, blood_group, present_address, permanent_address, father_name, mother_name)
  SELECT NEW.id, id, official_employee_id, department_id, first_name_en, last_name_en, full_name_bn, designation, marital_status, joining_date, email, employment_status, date_of_birth, gender, blood_group, present_address, permanent_address, father_name, mother_name FROM employees WHERE workspace_id='00000000-0000-0000-0000-000000000000';
  INSERT INTO users (workspace_id, id, employee_id, role, admin_scope, administered_department_id, is_root, entry_persona)
  SELECT NEW.id, id, employee_id, role, admin_scope, administered_department_id, is_root, entry_persona FROM users WHERE workspace_id='00000000-0000-0000-0000-000000000000';
  INSERT INTO employee_spouse (workspace_id, id, employee_id, spouse_name, spouse_occupation)
  SELECT NEW.id, id, employee_id, spouse_name, spouse_occupation FROM employee_spouse WHERE workspace_id='00000000-0000-0000-0000-000000000000';
  INSERT INTO academic_qualifications (workspace_id, id, employee_id, institution, degree, subject, passing_year, result)
  SELECT NEW.id, id, employee_id, institution, degree, subject, passing_year, result FROM academic_qualifications WHERE workspace_id='00000000-0000-0000-0000-000000000000';
  INSERT INTO training_records (workspace_id, id, employee_id, title, provider, start_date, end_date)
  SELECT NEW.id, id, employee_id, title, provider, start_date, end_date FROM training_records WHERE workspace_id='00000000-0000-0000-0000-000000000000';
  INSERT INTO service_history (workspace_id, id, employee_id, organization, designation, start_date, end_date)
  SELECT NEW.id, id, employee_id, organization, designation, start_date, end_date FROM service_history WHERE workspace_id='00000000-0000-0000-0000-000000000000';
  INSERT INTO posting_history (workspace_id, id, employee_id, department_id, office_name, start_date, order_reference)
  SELECT NEW.id, id, employee_id, department_id, office_name, start_date, order_reference FROM posting_history WHERE workspace_id='00000000-0000-0000-0000-000000000000';
  INSERT INTO professional_memberships (workspace_id, id, employee_id, organization, membership_number, start_date)
  SELECT NEW.id, id, employee_id, organization, membership_number, start_date FROM professional_memberships WHERE workspace_id='00000000-0000-0000-0000-000000000000';
  INSERT INTO publications (workspace_id, id, employee_id, title, publication_name, publication_date, reference_url)
  SELECT NEW.id, id, employee_id, title, publication_name, publication_date, reference_url FROM publications WHERE workspace_id='00000000-0000-0000-0000-000000000000';
  INSERT INTO leave_types (workspace_id, id, code, name_en, name_bn)
  SELECT NEW.id, id, code, name_en, name_bn FROM leave_types WHERE workspace_id='00000000-0000-0000-0000-000000000000';
  INSERT INTO change_requests (workspace_id, id, employee_id, submitted_by_user_id, field_key, target_record_type, operation, old_value_snapshot, proposed_value, status, rejection_reason, submitted_at, reviewed_at, reviewed_by_user_id, withdrawn_at)
  SELECT NEW.id, id, employee_id, submitted_by_user_id, field_key, target_record_type, operation, old_value_snapshot, proposed_value, status, rejection_reason, submitted_at, reviewed_at, reviewed_by_user_id, withdrawn_at FROM change_requests WHERE workspace_id='00000000-0000-0000-0000-000000000000';
  INSERT INTO audit_logs (workspace_id, id, actor_user_id, actor_role, action, entity_type, entity_id, occurred_at)
  SELECT NEW.id, id, actor_user_id, actor_role, action, entity_type, entity_id, occurred_at FROM audit_logs WHERE workspace_id='00000000-0000-0000-0000-000000000000';
  INSERT INTO public_holidays (workspace_id,id,holiday_date,name_en,name_bn,source_note,year)
      SELECT NEW.id,id,date(julianday(holiday_date) + (julianday(date(NEW.expires_at - 2700, 'unixepoch', '+6 hours')) - julianday('2025-07-21'))),name_en,name_bn,source_note,CAST(strftime('%Y', date(julianday(holiday_date) + (julianday(date(NEW.expires_at - 2700, 'unixepoch', '+6 hours')) - julianday('2025-07-21')))) AS INTEGER)
      FROM public_holidays WHERE workspace_id='00000000-0000-0000-0000-000000000000';
  INSERT INTO leave_records (workspace_id,id,employee_id,leave_type_id,start_date,end_date,day_count,remarks,recorded_by,cancelled_at)
      WITH RECURSIVE sample_dates (id, day, last_day) AS (
        SELECT id,date(julianday(start_date) + (julianday(date(NEW.expires_at - 2700, 'unixepoch', '+6 hours')) - julianday('2025-07-21'))),date(julianday(end_date) + (julianday(date(NEW.expires_at - 2700, 'unixepoch', '+6 hours')) - julianday('2025-07-21'))) FROM leave_records WHERE workspace_id='00000000-0000-0000-0000-000000000000'
        UNION ALL SELECT id,date(day,'+1 day'),last_day FROM sample_dates WHERE day<last_day
      ), chargeable AS (
        SELECT sd.id,count(*) AS days FROM sample_dates sd
        WHERE strftime('%w', sd.day) NOT IN ('5','6') AND NOT EXISTS (
          SELECT 1 FROM public_holidays WHERE workspace_id=NEW.id AND holiday_date=sd.day
        ) GROUP BY sd.id
      )
      SELECT NEW.id,l.id,employee_id,leave_type_id,date(julianday(start_date) + (julianday(date(NEW.expires_at - 2700, 'unixepoch', '+6 hours')) - julianday('2025-07-21'))),date(julianday(end_date) + (julianday(date(NEW.expires_at - 2700, 'unixepoch', '+6 hours')) - julianday('2025-07-21'))),c.days,remarks,recorded_by,strftime('%Y-%m-%dT%H:%M:%fZ', julianday(cancelled_at) + (julianday(date(NEW.expires_at - 2700, 'unixepoch', '+6 hours')) - julianday('2025-07-21')))
      FROM leave_records l JOIN chargeable c ON c.id=l.id WHERE l.workspace_id='00000000-0000-0000-0000-000000000000';
  INSERT INTO leave_holiday_snapshots (workspace_id,leave_record_id,holiday_date)
      SELECT NEW.id,leave_record_id,date(julianday(holiday_date) + (julianday(date(NEW.expires_at - 2700, 'unixepoch', '+6 hours')) - julianday('2025-07-21'))) FROM leave_holiday_snapshots WHERE workspace_id='00000000-0000-0000-0000-000000000000';
END;
