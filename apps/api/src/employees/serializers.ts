import type { EmployeeDetailRow, EmployeeListRow } from "./types.js";

type EmployeePresentationRow = Omit<
  EmployeeDetailRow,
  "created_at" | "updated_at" | "last_login_at"
> & {
  created_at: Date | string;
  updated_at: Date | string;
  last_login_at: Date | string | null;
};

function departmentOf(row: {
  department_id: string | null;
  department_name_en: string | null;
  department_name_bn: string | null;
}) {
  return row.department_id
    ? {
        id: row.department_id,
        nameEn: row.department_name_en,
        nameBn: row.department_name_bn,
      }
    : null;
}

// The employee-facing profile: the person's own record, without account internals.
export function toEmployeeProfile(row: EmployeePresentationRow) {
  return {
    id: row.id,
    officialEmployeeId: row.official_employee_id,
    employmentStatus: row.employment_status,
    firstNameEn: row.first_name_en,
    lastNameEn: row.last_name_en,
    fullNameBn: row.full_name_bn,
    dateOfBirth: row.date_of_birth,
    gender: row.gender,
    bloodGroup: row.blood_group,
    nationalId: row.national_id,
    phone: row.phone,
    email: row.email,
    presentAddress: row.present_address,
    permanentAddress: row.permanent_address,
    designation: row.designation,
    joiningDate: row.joining_date,
    fatherName: row.father_name,
    motherName: row.mother_name,
    religion: row.religion,
    maritalStatus: row.marital_status,
    // Served only through the authorized image endpoint; the key itself is random and unguessable.
    profileImageUrl: row.profile_image_key
      ? `/api/v1/files/profile-images/${row.profile_image_key}`
      : null,
    department: departmentOf(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// The admin-facing detail adds account state. Never include password hashes.
export function toAdminEmployeeDetail(row: EmployeePresentationRow) {
  return {
    ...toEmployeeProfile(row),
    account: row.account_role
      ? {
          role: row.account_role,
          adminScope: row.admin_scope,
          isRoot: row.account_is_root === true,
          administeredDepartmentId: row.administered_department_id,
          accountStatus: row.account_status,
          mustChangePassword: row.must_change_password,
          lastLoginAt: row.last_login_at,
        }
      : null,
  };
}

// The list intentionally omits NID, contact details and addresses.
export function toEmployeeListItem(row: EmployeeListRow) {
  return {
    id: row.id,
    officialEmployeeId: row.official_employee_id,
    firstNameEn: row.first_name_en,
    lastNameEn: row.last_name_en,
    fullNameBn: row.full_name_bn,
    designation: row.designation,
    employmentStatus: row.employment_status,
    accountStatus: row.account_status,
    role: row.account_role,
    department: departmentOf(row),
  };
}
