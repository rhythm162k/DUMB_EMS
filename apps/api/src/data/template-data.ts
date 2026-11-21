import { RECORD_SECTIONS } from "../records/sections.js";
import { controls, profileFields, spouseFields, types } from "./columns.js";
import { SAMPLE_EMPLOYEE_ID } from "./sample.js";
import type { DataRow, Sheet } from "./workbook.js";

export type TemplateDepartment = { id: string; name_en: string };

// The Departments sheet is skipped by the import reader. Keep its name exactly.
export const DEPARTMENTS_SHEET = "Departments";
export const DEPARTMENT_COLUMNS = ["Department", "Department UUID"];

// Columns whose values must keep a starting zero or must not be turned into a number or date.
const TEXT_COLUMNS = [
  "officialEmployeeId",
  "recordId",
  "expectedUpdatedAt",
  "phone",
  "nationalId",
  "spouseNationalId",
  "membershipNumber",
  "orderReference",
];

// Only the columns that the importer reads. The read-only export columns
// (employmentStatus, departmentNameEn, departmentNameBn) are left out.
const sheetColumns = (type: string): string[] => [
  ...controls,
  ...(type === "PROFILE"
    ? profileFields
    : type === "SPOUSE"
      ? spouseFields.map((f) => f[0])
      : RECORD_SECTIONS.find((s) => s.slug === type)!.fields.map((f) => f.key)),
];
// One header row for the CSV: the same order as the Excel sheets, shared keys once.
export const csvTemplateColumns = (): string[] => [
  ...new Set(types.flatMap(sheetColumns)),
];

export function exampleRows(departmentId: string): Record<string, DataRow> {
  const base = (rowType: string): DataRow => ({
    rowType,
    action: "CREATE",
    officialEmployeeId: SAMPLE_EMPLOYEE_ID,
    recordId: "",
    expectedUpdatedAt: "",
  });
  return {
    PROFILE: {
      ...base("PROFILE"),
      firstNameEn: "Sample",
      lastNameEn: "Employee",
      fullNameBn: "নমুনা কর্মচারী",
      departmentId,
      gender: "FEMALE",
      bloodGroup: "O+",
      dateOfBirth: "1990-05-15",
      joiningDate: "2020-01-01",
      nationalId: "1990123456789",
      phone: "01712345678",
      email: "sample.employee@example.com",
      presentAddress: "House 1, Road 1, Chattogram",
      permanentAddress: "Village Sample, Upazila Sample",
      designation: "Assistant Officer",
      fatherName: "Sample Father",
      motherName: "Sample Mother",
      religion: "Islam",
      maritalStatus: "MARRIED",
    },
    SPOUSE: {
      ...base("SPOUSE"),
      spouseName: "Sample Spouse",
      spouseOccupation: "Teacher",
      spouseDateOfBirth: "1992-03-20",
      spouseNationalId: "1992123456789",
    },
    qualifications: {
      ...base("qualifications"),
      institution: "Sample University",
      degree: "BSc",
      subject: "Computer Science",
      passingYear: "2012",
      result: "First class",
    },
    training: {
      ...base("training"),
      title: "Sample Training Course",
      provider: "Sample Training Institute",
      location: "Dhaka",
      startDate: "2024-01-10",
      endDate: "2024-01-15",
      remarks: "Sample remark",
    },
    "service-history": {
      ...base("service-history"),
      organization: "Sample Organization",
      designation: "Officer",
      startDate: "2015-01-01",
      endDate: "2019-12-31",
      description: "Sample description",
    },
    "posting-history": {
      ...base("posting-history"),
      departmentId,
      officeName: "Sample Office",
      designation: "Assistant Officer",
      startDate: "2020-01-01",
      endDate: "2022-12-31",
      orderReference: "ORDER-0001",
    },
    memberships: {
      ...base("memberships"),
      organization: "Sample Professional Association",
      membershipNumber: "M-0001",
      membershipType: "Life member",
      startDate: "2018-01-01",
      endDate: "2024-12-31",
    },
    publications: {
      ...base("publications"),
      title: "Sample Publication",
      publicationName: "Sample Journal",
      publicationDate: "2023-06-01",
      referenceUrl: "https://example.com/sample",
    },
  };
}

// The department the example rows use: the first one the admin may use.
const exampleDepartment = (departments: TemplateDepartment[]) =>
  departments[0]?.id ?? "";

export function templateSheets(departments: TemplateDepartment[]): Sheet[] {
  const examples = exampleRows(exampleDepartment(departments));
  return [
    {
      name: DEPARTMENTS_SHEET,
      columns: DEPARTMENT_COLUMNS,
      rows: departments.map((d) => ({
        [DEPARTMENT_COLUMNS[0]!]: d.name_en,
        [DEPARTMENT_COLUMNS[1]!]: d.id,
      })),
      format: { widths: [40, 42], textColumns: [DEPARTMENT_COLUMNS[1]!] },
    },
    ...types.map((type) => ({
      name: type,
      columns: sheetColumns(type),
      rows: [examples[type]!],
      format: { textColumns: TEXT_COLUMNS },
    })),
  ];
}

export const templateCsvDefinition = (departments: TemplateDepartment[]) => ({
  columns: csvTemplateColumns(),
  rows: [exampleRows(exampleDepartment(departments)).PROFILE!],
});
