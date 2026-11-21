-- Minimal, non-personal demo reference data. No employee or login accounts are seeded here.
-- These departments are illustrative examples for local development.
-- Admin can rename or deactivate any of these through the department management API.
INSERT INTO departments (name_en, name_bn)
VALUES
  ('Administration', 'প্রশাসন'),
  ('Finance & Accounts', 'অর্থ ও হিসাব'),
  ('Engineering', 'প্রকৌশল'),
  ('Information Technology (IT)', 'তথ্য প্রযুক্তি (আইটি)'),
  ('Health / Medical', 'স্বাস্থ্য / চিকিৎসা'),
  ('Security', 'নিরাপত্তা'),
  ('Port Operations', 'বন্দর পরিচালনা'),
  ('Marine Operations', 'মেরিন অপারেশনস'),
  ('Human Resources', 'মানবসম্পদ'),
  ('Procurement & Stores', 'ক্রয় ও ভান্ডার')
ON CONFLICT (name_en) DO NOTHING;

INSERT INTO leave_types (code, name_en, name_bn)
VALUES
  ('CASUAL', 'Casual Leave', 'নৈমিত্তিক ছুটি'),
  ('EARNED', 'Earned Leave', 'অর্জিত ছুটি'),
  ('MEDICAL', 'Medical Leave', 'চিকিৎসা ছুটি'),
  ('MATERNITY', 'Maternity Leave', 'মাতৃত্বকালীন ছুটি'),
  ('PATERNITY', 'Paternity Leave', 'পিতৃত্বকালীন ছুটি'),
  ('SICK', 'Sick Leave', 'অসুস্থতাজনিত ছুটি'),
  ('SPECIAL', 'Special Leave', 'বিশেষ ছুটি'),
  ('OTHER', 'Other Leave', 'অন্যান্য ছুটি')
ON CONFLICT (code) DO NOTHING;

-- Public holidays are intentionally not fabricated. Add dates from an approved
-- official holiday calendar when that source is available.
