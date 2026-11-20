import { describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import {
  DEPARTMENT_COLUMNS,
  csvTemplateColumns,
  templateCsv,
  templateSheets,
  type TemplateDepartment,
} from "../apps/api/src/data/import-template.js";
import {
  controls,
  profileFields,
  validateImport,
} from "../apps/api/src/data/records.js";
import { friendlyRowErrors } from "../apps/api/src/data/import-messages.js";
import { SAMPLE_EMPLOYEE_ID } from "../apps/api/src/data/sample.js";
import {
  readCsv,
  readXlsx,
  readXlsxSheets,
  writeXlsx,
} from "../apps/api/src/data/spreadsheets.js";
import { RECORD_SECTIONS } from "../apps/api/src/records/sections.js";

// Fake department list; the real route reads the departments table.
const departments: TemplateDepartment[] = [
  { id: "b3d54683-f223-49be-a2bb-47efbe70aa31", name_en: "Administration" },
  { id: "908c735e-806c-4f40-b53d-bdeef15d467a", name_en: "Finance & Accounts" },
];
const dataSheets = [
  "PROFILE",
  "SPOUSE",
  ...RECORD_SECTIONS.map((section) => section.slug),
];
// Answers the few lookups validateImport makes: no employee exists, every department is active.
const database = {
  query: async (sql: string, params: unknown[] = []) => {
    if (sql.includes("FROM departments"))
      return { rows: [{ id: params[0] }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  },
} as unknown as PoolClient;

describe("Import template content", () => {
  it("has the Departments sheet and one sample row per data sheet, and no instructions or rules sheets", async () => {
    const sheets = await readXlsxSheets(
      await writeXlsx(templateSheets(departments)),
    );
    expect(sheets.map((s) => s.name)).toEqual(["Departments", ...dataSheets]);
    for (const sheet of sheets.filter((s) => dataSheets.includes(s.name))) {
      expect(sheet.rows, sheet.name).toHaveLength(1);
      expect(sheet.rows[0]).toMatchObject({
        rowType: sheet.name,
        action: "CREATE",
        officialEmployeeId: SAMPLE_EMPLOYEE_ID,
      });
    }
    expect(
      Object.keys(sheets.find((s) => s.name === "PROFILE")!.rows[0]!),
    ).toEqual([...controls, ...profileFields]);
  });
  it("lists the given departments and nothing hard-coded", async () => {
    const read = async (list: TemplateDepartment[]) =>
      (await readXlsxSheets(await writeXlsx(templateSheets(list)))).find(
        (s) => s.name === "Departments",
      )!.rows;
    expect(await read(departments)).toEqual(
      departments.map((d) => ({
        [DEPARTMENT_COLUMNS[0]!]: d.name_en,
        [DEPARTMENT_COLUMNS[1]!]: d.id,
      })),
    );
    // A department administrator gets only their own department.
    expect(await read([departments[1]!])).toEqual([
      {
        Department: "Finance & Accounts",
        "Department UUID": departments[1]!.id,
      },
    ]);
    expect(await read([])).toEqual([]);
  });
  it("uses the first available department in the sample rows", async () => {
    const own = await readXlsxSheets(
      await writeXlsx(templateSheets([departments[1]!])),
    );
    const profile = own.find((s) => s.name === "PROFILE")!.rows[0]!;
    expect(profile.departmentId).toBe(departments[1]!.id);
    expect(csvRow([departments[1]!]).departmentId).toBe(departments[1]!.id);
  });
  it("is still skipped by the import reader, apart from the sample rows", async () => {
    const rows = await readXlsx(await writeXlsx(templateSheets(departments)));
    expect(rows).toHaveLength(dataSheets.length);
    expect(rows.every((r) => r.officialEmployeeId === SAMPLE_EMPLOYEE_ID)).toBe(
      true,
    );
  });
});

const csvRow = (list: TemplateDepartment[]) => readCsv(templateCsv(list))[0]!;

describe("CSV template", () => {
  it("has one header row and one sample row in the Excel column order", () => {
    const text = templateCsv(departments).replace(/^\uFEFF/, "");
    expect(text.trimEnd().split("\r\n")).toHaveLength(2);
    const columns = csvTemplateColumns();
    expect(columns.slice(0, controls.length + profileFields.length)).toEqual([
      ...controls,
      ...profileFields,
    ]);
    expect(new Set(columns).size).toBe(columns.length);
    const row = csvRow(departments);
    expect(Object.keys(row)).toEqual(columns);
    expect(row).toMatchObject({
      rowType: "PROFILE",
      action: "CREATE",
      officialEmployeeId: SAMPLE_EMPLOYEE_ID,
      gender: "FEMALE",
      bloodGroup: "O+",
      dateOfBirth: "1990-05-15",
      phone: "01712345678",
    });
  });
});

describe("Sample rows cannot be imported by mistake", () => {
  it("rejects every untouched sample row with a plain message", async () => {
    const rows = await readXlsx(await writeXlsx(templateSheets(departments)));
    const checked = await validateImport(database, rows);
    expect(checked.every((r) => !r.valid)).toBe(true);
    expect(friendlyRowErrors(checked[0]!.errors).errors).toEqual([
      "This is the sample row from the template. Replace the sample employee ID with a real one, or delete the row.",
    ]);
    const csv = await validateImport(database, [csvRow(departments)]);
    expect(csv[0]!.valid).toBe(false);
  });
  it("accepts the sample values once the employee ID is replaced", async () => {
    const rows = (
      await readXlsx(await writeXlsx(templateSheets(departments)))
    ).map((row) => ({ ...row, officialEmployeeId: "000123" }));
    const checked = await validateImport(database, rows);
    expect(checked.map((r) => r.errors)).toEqual(rows.map(() => []));
    const csv = await validateImport(database, [
      { ...csvRow(departments), officialEmployeeId: "000124" },
    ]);
    expect(csv[0]!.errors).toEqual([]);
  });
});
