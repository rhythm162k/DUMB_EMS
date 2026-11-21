-- Deterministic, entirely fictional template. The Worker clones this workspace with INSERT ... SELECT.

-- Leave examples are anchored to 2025-07-21 and shifted to the visitor's Dhaka date on provisioning.

INSERT INTO workspaces (id, expires_at) VALUES ('00000000-0000-0000-0000-000000000000', 0);

INSERT INTO departments (workspace_id, id, name_en, name_bn) VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000101', 'Operations', 'পরিচালনা'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000102', 'People and Administration', 'জনবল ও প্রশাসন'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000103', 'Finance and Procurement', 'অর্থ ও ক্রয়');

INSERT INTO employees (workspace_id, id, official_employee_id, department_id, first_name_en, last_name_en, full_name_bn, designation, marital_status, joining_date, email, employment_status) VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000201', 'DEMO-001', '00000000-0000-4000-8000-000000000102', 'Nusrat', 'Rahman', 'নুসরাত রহমান', 'Director of Administration', NULL, '2019-01-10', 'nusrat.rahman@example.invalid', 'ACTIVE'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000202', 'DEMO-002', '00000000-0000-4000-8000-000000000103', 'Arif', 'Hossain', 'আরিফ হোসেন', 'Finance Manager', NULL, '2020-02-10', 'arif.hossain@example.invalid', 'ACTIVE'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000203', 'DEMO-003', '00000000-0000-4000-8000-000000000101', 'Farhana', 'Karim', 'ফারহানা করিম', 'Operations Lead', NULL, '2021-03-10', 'farhana.karim@example.invalid', 'ACTIVE'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000204', 'DEMO-004', '00000000-0000-4000-8000-000000000102', 'Mahmud', 'Chowdhury', 'মাহমুদ চৌধুরী', 'People Operations Lead', NULL, '2022-04-10', 'mahmud.chowdhury@example.invalid', 'ACTIVE'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000205', 'DEMO-005', '00000000-0000-4000-8000-000000000101', 'Tahmina', 'Islam', 'তাহমিনা ইসলাম', 'Operations Coordinator', 'MARRIED', '2023-05-10', 'tahmina.islam@example.invalid', 'ACTIVE'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000206', 'DEMO-006', '00000000-0000-4000-8000-000000000101', 'Sajid', 'Ahmed', 'সাজিদ আহমেদ', 'Logistics Officer', 'SINGLE', '2019-06-10', 'sajid.ahmed@example.invalid', 'ACTIVE'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000207', 'DEMO-007', '00000000-0000-4000-8000-000000000102', 'Samira', 'Sultana', 'সামিরা সুলতানা', 'HR Officer', 'SINGLE', '2020-07-10', 'samira.sultana@example.invalid', 'ACTIVE'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000208', 'DEMO-008', '00000000-0000-4000-8000-000000000103', 'Tanvir', 'Hasan', 'তানভীর হাসান', 'Procurement Officer', 'SINGLE', '2021-08-10', 'tanvir.hasan@example.invalid', 'ACTIVE'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000209', 'DEMO-009', '00000000-0000-4000-8000-000000000101', 'Rafi', 'Mahmud', 'রাফি মাহমুদ', 'Field Supervisor', NULL, '2022-01-10', 'rafi.mahmud@example.invalid', 'ACTIVE'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000210', 'DEMO-010', '00000000-0000-4000-8000-000000000103', 'Maliha', 'Akter', 'মালিহা আক্তার', 'Accounts Assistant', NULL, '2023-02-10', 'maliha.akter@example.invalid', 'RETIRED');

UPDATE employees SET date_of_birth = '1994-05-08', gender = 'FEMALE', blood_group = 'B+', present_address = 'Sample Road, Demo Quarter, Dhaka', permanent_address = 'Sample Village, Demo Union, Barishal', father_name = 'Fictional Parent One', mother_name = 'Fictional Parent Two' WHERE workspace_id = '00000000-0000-0000-0000-000000000000' AND id = '00000000-0000-4000-8000-000000000205';

INSERT INTO users (workspace_id, id, employee_id, role, admin_scope, administered_department_id, is_root, entry_persona) VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000201', 'ADMIN', 'FULL', NULL, 1, 'root'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000302', '00000000-0000-4000-8000-000000000202', 'ADMIN', 'FULL', NULL, 0, 'full-admin'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000303', '00000000-0000-4000-8000-000000000203', 'ADMIN', 'DEPARTMENT', '00000000-0000-4000-8000-000000000101', 0, 'operations-admin'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000304', '00000000-0000-4000-8000-000000000204', 'ADMIN', 'DEPARTMENT', '00000000-0000-4000-8000-000000000102', 0, 'people-admin'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000305', '00000000-0000-4000-8000-000000000205', 'EMPLOYEE', NULL, NULL, 0, 'employee'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000306', '00000000-0000-4000-8000-000000000206', 'EMPLOYEE', NULL, NULL, 0, NULL),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000307', '00000000-0000-4000-8000-000000000207', 'EMPLOYEE', NULL, NULL, 0, NULL),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000308', '00000000-0000-4000-8000-000000000208', 'EMPLOYEE', NULL, NULL, 0, NULL),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000309', '00000000-0000-4000-8000-000000000209', 'EMPLOYEE', NULL, NULL, 0, NULL);

INSERT INTO employee_spouse (workspace_id, id, employee_id, spouse_name, spouse_occupation) VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000400', '00000000-0000-4000-8000-000000000205', 'Fahim Basu', 'Fictional college lecturer');

INSERT INTO academic_qualifications (workspace_id, id, employee_id, institution, degree, subject, passing_year, result) VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000400', '00000000-0000-4000-8000-000000000205', 'Fictional Bengal Institute', 'BBA', 'Operations Management', 2015, 'Demo grade');

INSERT INTO training_records (workspace_id, id, employee_id, title, provider, start_date, end_date) VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000400', '00000000-0000-4000-8000-000000000205', 'Warehouse safety induction', 'Fictional Skills Centre', '2024-05-12', '2024-05-13');

INSERT INTO service_history (workspace_id, id, employee_id, organization, designation, start_date, end_date) VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000400', '00000000-0000-4000-8000-000000000205', 'Fictional Bengal Logistics', 'Operations Assistant', '2016-05-08', '2020-10-30');

INSERT INTO posting_history (workspace_id, id, employee_id, department_id, office_name, start_date, order_reference) VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000400', '00000000-0000-4000-8000-000000000205', '00000000-0000-4000-8000-000000000101', 'Demo Operations Centre', '2023-03-01', 'DEMO-ORD-013');

INSERT INTO professional_memberships (workspace_id, id, employee_id, organization, membership_number, start_date) VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000400', '00000000-0000-4000-8000-000000000205', 'Fictional Operations Society', 'DEMO-MEM-021', '2022-09-01');

INSERT INTO publications (workspace_id, id, employee_id, title, publication_name, publication_date, reference_url) VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000400', '00000000-0000-4000-8000-000000000205', 'Orientation checklist', 'Demo Operations Notes', '2025-02-14', 'https://example.invalid/demo-publication');

INSERT INTO leave_types (workspace_id, id, code, name_en, name_bn) VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000501', 'CASUAL', 'Casual leave', 'নৈমিত্তিক ছুটি'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000502', 'MEDICAL', 'Medical leave', 'চিকিৎসা ছুটি'),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000503', 'DAY_OFF', 'Day off', 'সাপ্তাহিক ছুটি');

INSERT INTO public_holidays (workspace_id, id, holiday_date, name_en, name_bn, source_note, year) VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000601', '2025-07-19', 'Fictional office holiday', 'কাল্পনিক কার্যালয় ছুটি', 'Fictional demo calendar', 2025);

INSERT INTO leave_records (workspace_id, id, employee_id, leave_type_id, start_date, end_date, day_count, remarks, recorded_by, cancelled_at) VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000205', '00000000-0000-4000-8000-000000000501', '2025-07-13', '2025-07-21', 7, 'Fictional personal leave', '00000000-0000-4000-8000-000000000303', NULL),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-000000000206', '00000000-0000-4000-8000-000000000502', '2025-07-01', '2025-07-03', 3, 'Fictional medical leave', '00000000-0000-4000-8000-000000000303', NULL),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000703', '00000000-0000-4000-8000-000000000207', '00000000-0000-4000-8000-000000000503', '2025-07-25', '2025-07-27', 1, 'Fictional scheduled day off', '00000000-0000-4000-8000-000000000304', NULL),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000704', '00000000-0000-4000-8000-000000000208', '00000000-0000-4000-8000-000000000501', '2025-07-02', '2025-07-04', 2, 'Cancelled example', '00000000-0000-4000-8000-000000000301', '2025-07-01T09:00:00.000Z');

INSERT INTO leave_holiday_snapshots (workspace_id, leave_record_id, holiday_date) VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000701', '2025-07-19');

INSERT INTO change_requests (workspace_id, id, employee_id, submitted_by_user_id, field_key, target_record_type, operation, old_value_snapshot, proposed_value, status, rejection_reason, submitted_at, reviewed_at, reviewed_by_user_id, withdrawn_at) VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000801', '00000000-0000-4000-8000-000000000205', '00000000-0000-4000-8000-000000000305', 'designation', 'PROFILE', 'UPDATE', '"Operations Coordinator"', '"Senior Operations Coordinator"', 'PENDING', NULL, '2025-07-21T08:00:00.000Z', NULL, NULL, NULL),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000802', '00000000-0000-4000-8000-000000000208', '00000000-0000-4000-8000-000000000308', 'designation', 'PROFILE', 'UPDATE', '"Procurement Officer"', '"Senior Procurement Officer"', 'PENDING', NULL, '2025-07-19T08:00:00.000Z', NULL, NULL, NULL),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000803', '00000000-0000-4000-8000-000000000205', '00000000-0000-4000-8000-000000000305', 'presentAddress', 'PROFILE', 'UPDATE', '"Sample Road, Demo Quarter"', '"Sample Road, Demo Quarter, Dhaka"', 'APPROVED', NULL, '2025-07-02T08:00:00.000Z', '2025-07-03T08:00:00.000Z', '00000000-0000-4000-8000-000000000303', NULL),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000804', '00000000-0000-4000-8000-000000000206', '00000000-0000-4000-8000-000000000306', 'designation', 'PROFILE', 'UPDATE', '"Logistics Officer"', '"Operations Director"', 'REJECTED', 'Fictional record requires supporting information', '2025-07-03T08:00:00.000Z', '2025-07-04T08:00:00.000Z', '00000000-0000-4000-8000-000000000303', NULL),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000805', '00000000-0000-4000-8000-000000000205', '00000000-0000-4000-8000-000000000305', 'email', 'PROFILE', 'UPDATE', '"tahmina.islam@example.invalid"', '"tahmina.alt@example.invalid"', 'WITHDRAWN', NULL, '2025-07-05T08:00:00.000Z', NULL, NULL, '2025-07-06T08:00:00.000Z');

INSERT INTO audit_logs (workspace_id, id, actor_user_id, actor_role, action, entity_type, entity_id, occurred_at) VALUES
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-4000-8000-000000000901', '00000000-0000-4000-8000-000000000303', 'ADMIN', 'CHANGE_REQUEST_APPROVED', 'change_request', '00000000-0000-4000-8000-000000000803', '2025-07-03T08:00:00.000Z');
