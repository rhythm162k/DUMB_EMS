import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import {
  ApiClient,
  signInAndCompleteAdminPasswordChange,
  startTestApi,
  stopTestApi,
} from "./helpers/server.js";
import { testPool } from "./helpers/database.js";
import JSZip from "jszip";
import {
  readCsv,
  readXlsx,
  readXlsxSheets,
  writeCsv,
  writeXlsx,
  type DataRow,
} from "../src/data/spreadsheets.js";
import { controls, profileFields } from "../src/data/records.js";
import {
  DEPARTMENT_COLUMNS,
  csvTemplateColumns,
} from "../src/data/import-template.js";
import { SAMPLE_EMPLOYEE_ID } from "../src/data/sample.js";
import { RECORD_SECTIONS } from "../src/records/sections.js";
let server: Server;
let baseUrl = "";
let employeeId = "";
let departmentId = "";
let employeeUserId = "";
let admin: ApiClient;
const csvType = "text/csv";
const xlsxType =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
async function employee() {
  const c = new ApiClient(baseUrl);
  await c.initializeCsrf();
  expect(
    (
      await c.post("/api/v1/auth/login", {
        employeeId: "TEST-EMP-001",
        password: "Employee-temp-Password-123",
      })
    ).status,
  ).toBe(200);
  return c;
}
const createRow = (code: string): DataRow => ({
  rowType: "PROFILE",
  action: "CREATE",
  officialEmployeeId: code,
  firstNameEn: "Workbook Demo",
  departmentId,
  gender: "FEMALE",
  bloodGroup: "B+",
});
async function preview(rows: DataRow[]) {
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  return admin.postBinary(
    "/api/v1/admin/data/files/preview",
    writeCsv(columns, rows),
    csvType,
  );
}
beforeAll(async () => {
  const setup = await startTestApi();
  server = setup.server;
  baseUrl = setup.baseUrl;
  employeeId = setup.fixtures.employeeRecordId;
  employeeUserId = setup.fixtures.employeeUserId;
  admin = await signInAndCompleteAdminPasswordChange(baseUrl);
  departmentId = (
    await testPool.query(
      "SELECT id FROM departments WHERE name_en='Operations'",
    )
  ).rows[0].id;
  await testPool.query(
    "UPDATE employees SET department_id=$1,national_id='PRIVATE-NID',phone='0123456789' WHERE id=$2",
    [departmentId, employeeId],
  );
  await testPool.query(
    "INSERT INTO academic_qualifications(employee_id,institution,degree) VALUES($1,'Demo Academy','Demo Degree')",
    [employeeId],
  );
});
afterAll(async () => {
  if (server) await stopTestApi(server);
});
describe("Full PDS data tools", () => {
  it("exports only the employee profile/PDS and masks sensitive data in CSV and XLSX", async () => {
    const owner = await employee();
    for (const format of ["csv", "xlsx"]) {
      const response = await owner.getBinary(
        `/api/v1/me/data/pds?format=${format}`,
      );
      expect(response.status).toBe(200);
      const rows =
        format === "csv"
          ? readCsv(response.bytes.toString())
          : await readXlsx(response.bytes);
      expect(new Set(rows.map((r) => r.officialEmployeeId))).toEqual(
        new Set(["TEST-EMP-001"]),
      );
      expect(
        rows.some(
          (r) =>
            r.rowType === "qualifications" && r.institution === "Demo Academy",
        ),
      ).toBe(true);
      expect(rows.find((r) => r.rowType === "PROFILE")?.nationalId).toBe(
        "[MASKED]",
      );
      expect(JSON.stringify(rows)).not.toContain("PRIVATE-NID");
    }
    expect((await owner.get("/api/v1/me/data/pds?sensitive=true")).status).toBe(
      400,
    );
    expect(
      (await owner.get(`/api/v1/me/data/pds?ids=${employeeId}`)).status,
    ).toBe(400);
  });
  it("supports deliberate Admin unmasking, selection and filtering and audits scope", async () => {
    const response = await admin.getBinary(
      `/api/v1/admin/data/pds?format=csv&ids=${employeeId}&sensitive=true`,
    );
    expect(
      (
        await admin.post("/api/v1/admin/data/pds", {
          format: "csv",
          ids: employeeId,
          sensitive: "true",
        })
      ).status,
    ).toBe(200);
    expect(response.status).toBe(200);
    const rows = readCsv(response.bytes.toString());
    expect(new Set(rows.map((r) => r.officialEmployeeId))).toEqual(
      new Set(["TEST-EMP-001"]),
    );
    expect(rows[0]?.nationalId).toBe("PRIVATE-NID");
    const filtered = await admin.getBinary(
      `/api/v1/admin/data/pds?format=csv&departmentId=${departmentId}&q=TEST-EMP`,
    );
    expect(filtered.status).toBe(200);
    expect(readCsv(filtered.bytes.toString())[0]?.nationalId).toBe("[MASKED]");
    const audit = await testPool.query(
      "SELECT metadata FROM audit_logs WHERE action='PDS_ADMIN_EXPORTED' AND metadata->>'scope'='selected'",
    );
    expect(audit.rows[0]?.metadata).toMatchObject({
      format: "csv",
      scope: "selected",
      employeeCount: 1,
      unmasked: true,
    });
    expect(JSON.stringify(audit.rows)).not.toContain("PRIVATE-NID");
  });
  it("rejects an invalid template format", async () => {
    expect(
      (await admin.get("/api/v1/admin/data/template?format=exe")).status,
    ).toBe(400);
  });
  it("keeps anonymous, employee and temporary-password sessions out of Admin tools", async () => {
    expect(
      (await new ApiClient(baseUrl).get("/api/v1/admin/data/pds")).status,
    ).toBe(401);
    const owner = await employee();
    expect((await owner.get("/api/v1/admin/data/pds")).status).toBe(403);
    expect(
      (
        await owner.postBinary(
          "/api/v1/admin/data/files/preview",
          "rowType\nPROFILE",
          csvType,
        )
      ).status,
    ).toBe(403);
    expect(
      (await owner.post("/api/v1/admin/data/files/commit", {})).status,
    ).toBe(403);
    await testPool.query(
      "UPDATE users SET must_change_password=TRUE WHERE employee_id=$1",
      [employeeId],
    );
    try {
      expect((await owner.get("/api/v1/me/data/pds")).status).toBe(403);
      expect((await owner.get("/api/v1/me/leaves")).status).toBe(403);
      expect((await owner.get("/api/v1/overview/stats")).status).toBe(403);
    } finally {
      await testPool.query(
        "UPDATE users SET must_change_password=FALSE WHERE employee_id=$1",
        [employeeId],
      );
    }
  });
  it("previews without mutation, commits selected rows, and blocks replay", async () => {
    const p = await preview([createRow("WB-001"), createRow("WB-002")]);
    expect(p.status).toBe(200);
    expect(
      (
        await testPool.query(
          "SELECT id FROM employees WHERE official_employee_id LIKE 'WB-%'",
        )
      ).rowCount,
    ).toBe(0);
    const committed = await admin.post("/api/v1/admin/data/files/commit", {
      previewId: p.body.previewId,
      selected: [2],
    });
    expect(committed.status).toBe(200);
    expect(committed.body.count).toBe(1);
    expect(
      (committed.body.credentials as { employeeId: string }[])[0]?.employeeId,
    ).toBe("WB-001");
    expect(
      (
        await testPool.query(
          "SELECT id FROM employees WHERE official_employee_id='WB-002'",
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await admin.post("/api/v1/admin/data/files/commit", {
          previewId: p.body.previewId,
          selected: [3],
        })
      ).status,
    ).toBe(409);
  });
  it("imports XLSX profile and child records transactionally, without JSON entry", async () => {
    const profile = createRow("WB-003");
    const child = {
      rowType: "qualifications",
      action: "CREATE",
      officialEmployeeId: "WB-003",
      institution: "Workbook Institute",
      degree: "Degree",
    };
    const buffer = await writeXlsx([
      {
        name: "PROFILE",
        columns: [...controls, ...profileFields],
        rows: [profile],
      },
      { name: "qualifications", columns: Object.keys(child), rows: [child] },
    ]);
    const p = await admin.postBinary(
      "/api/v1/admin/data/files/preview",
      buffer,
      xlsxType,
    );
    expect(p.status).toBe(200);
    expect(
      (
        await admin.post("/api/v1/admin/data/files/commit", {
          previewId: p.body.previewId,
          selected: [2, 3],
        })
      ).status,
    ).toBe(200);
    const records = await testPool.query(
      "SELECT q.institution FROM academic_qualifications q JOIN employees e ON e.id=q.employee_id WHERE e.official_employee_id='WB-003'",
    );
    expect(records.rows[0]?.institution).toBe("Workbook Institute");
  });
  it("rejects an invalid selected row without partially creating valid rows", async () => {
    const p = await preview([
      createRow("WB-004"),
      { ...createRow("WB-005"), gender: "INVALID" },
    ]);
    expect(p.status).toBe(200);
    expect(
      (
        await admin.post("/api/v1/admin/data/files/commit", {
          previewId: p.body.previewId,
          selected: [2, 3],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await testPool.query(
          "SELECT id FROM employees WHERE official_employee_id IN ('WB-004','WB-005')",
        )
      ).rowCount,
    ).toBe(0);
  });
  it("rejects stale updates and applies valid selected updates", async () => {
    const exportResponse = await admin.getBinary(
      `/api/v1/admin/data/pds?format=csv&ids=${employeeId}`,
    );
    const row = readCsv(exportResponse.bytes.toString()).find(
      (r) => r.rowType === "PROFILE",
    )!;
    row.designation = "Workbook updated";
    const p = await preview([row]);
    expect(p.status).toBe(200);
    await testPool.query(
      "UPDATE employees SET designation='Newer value',updated_at=updated_at+interval '1 second' WHERE id=$1",
      [employeeId],
    );
    expect(
      (
        await admin.post("/api/v1/admin/data/files/commit", {
          previewId: p.body.previewId,
          selected: [2],
        })
      ).status,
    ).toBe(409);
    const fresh = readCsv(
      (
        await admin.getBinary(
          `/api/v1/admin/data/pds?format=csv&ids=${employeeId}`,
        )
      ).bytes.toString(),
    ).find((r) => r.rowType === "PROFILE")!;
    fresh.designation = "Final value";
    const second = await preview([fresh]);
    expect(
      (
        await admin.post("/api/v1/admin/data/files/commit", {
          previewId: second.body.previewId,
          selected: [2],
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await testPool.query(
          "SELECT designation,national_id FROM employees WHERE id=$1",
          [employeeId],
        )
      ).rows[0],
    ).toEqual({ designation: "Final value", national_id: "PRIVATE-NID" });
  });
  it("rejects invalid record UUIDs and unavailable child targets with row errors", async () => {
    const p = await preview([
      {
        rowType: "qualifications",
        action: "UPDATE",
        officialEmployeeId: "TEST-EMP-001",
        recordId: "-".repeat(36),
        expectedUpdatedAt: "2020-01-01",
        institution: "Demo",
        degree: "Demo",
      },
    ]);
    expect(p.status).toBe(200);
    expect((p.body.results as { valid: boolean }[])[0]?.valid).toBe(false);
  });
  it("rejects expired previews and untrusted uploads", async () => {
    const p = await preview([createRow("WB-006")]);
    await testPool.query(
      "UPDATE import_previews SET expires_at=NOW()-interval '1 minute' WHERE id=$1",
      [p.body.previewId],
    );
    expect(
      (
        await admin.post("/api/v1/admin/data/files/commit", {
          previewId: p.body.previewId,
          selected: [2],
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await admin.postBinary(
          "/api/v1/admin/data/files/preview",
          "bad workbook",
          xlsxType,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await admin.postBinary(
          "/api/v1/admin/data/files/preview",
          Buffer.alloc(2 * 1024 * 1024 + 1),
          csvType,
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await admin.postBinary(
          "/api/v1/admin/data/files/preview",
          "{}",
          "application/json",
        )
      ).status,
    ).toBe(415);
  });
});

const templateUrl = (format: string) =>
  `/api/v1/admin/data/template?format=${format}`;
const dataSheetNames = [
  "PROFILE",
  "SPOUSE",
  ...RECORD_SECTIONS.map((section) => section.slug),
];
async function templateSheets(client: ApiClient) {
  const response = await client.getBinary(templateUrl("xlsx"));
  expect(response.status).toBe(200);
  return {
    bytes: response.bytes,
    sheets: Object.fromEntries(
      (await readXlsxSheets(response.bytes)).map((s) => [s.name, s.rows]),
    ) as Record<string, DataRow[]>,
  };
}
async function loginAs(code: string) {
  const client = new ApiClient(baseUrl);
  await client.initializeCsrf();
  expect(
    (
      await client.post("/api/v1/auth/login", {
        employeeId: code,
        password: "Employee-temp-Password-123",
      })
    ).status,
  ).toBe(200);
  return client;
}
const validity = (body: Record<string, unknown>) =>
  (body.results as { valid: boolean }[]).map((r) => r.valid);

describe("Import template download", () => {
  it("has the Departments sheet and one sample row per data sheet, and no instructions or rules sheets", async () => {
    const { sheets } = await templateSheets(admin);
    expect(Object.keys(sheets)).toEqual(["Departments", ...dataSheetNames]);
    for (const name of dataSheetNames) {
      expect(sheets[name], name).toHaveLength(1);
      expect(sheets[name]![0]).toMatchObject({
        officialEmployeeId: SAMPLE_EMPLOYEE_ID,
        rowType: name,
        action: "CREATE",
      });
    }
    // Only fields the importer reads: no export-only columns.
    expect(Object.keys(sheets.PROFILE![0]!)).toEqual([
      ...controls,
      ...profileFields,
    ]);
    expect(sheets.PROFILE![0]).toMatchObject({
      gender: "FEMALE",
      bloodGroup: "O+",
      dateOfBirth: "1990-05-15",
      phone: "01712345678",
    });
  });
  it("stores employee ID and phone columns as text", async () => {
    const { bytes } = await templateSheets(admin);
    const zip = await JSZip.loadAsync(bytes);
    const styles = await zip.file("xl/styles.xml")!.async("string");
    expect(styles).toContain('numFmtId="49"');
    const profile = await zip.file("xl/worksheets/sheet2.xml")!.async("string");
    const columns = [...controls, ...profileFields];
    for (const name of ["officialEmployeeId", "phone"]) {
      const n = columns.indexOf(name) + 1;
      expect(profile).toMatch(
        new RegExp(`<col min="${n}" max="${n}"[^>]*style="1"`),
      );
    }
    expect(profile).toContain(
      `<t xml:space="preserve">${SAMPLE_EMPLOYEE_ID}</t>`,
    );
    expect(profile).toContain(">01712345678</t>");
  });
  it("lists the active departments from the database", async () => {
    await testPool.query(
      "INSERT INTO departments(name_en,is_active) VALUES('Template Inactive Department',FALSE)",
    );
    try {
      const expected = (
        await testPool.query(
          "SELECT id,name_en FROM departments WHERE is_active=TRUE ORDER BY name_en",
        )
      ).rows;
      expect(expected.length).toBeGreaterThan(0);
      const { sheets } = await templateSheets(admin);
      expect(sheets.Departments).toEqual(
        expected.map((d) => ({
          [DEPARTMENT_COLUMNS[0]!]: d.name_en,
          [DEPARTMENT_COLUMNS[1]!]: d.id,
        })),
      );
      expect(JSON.stringify(sheets.Departments)).not.toContain(
        "Template Inactive Department",
      );
      // The sample rows use a real department from this list.
      expect(sheets.PROFILE![0]!.departmentId).toBe(expected[0].id);
      expect(sheets["posting-history"]![0]!.departmentId).toBe(expected[0].id);
    } finally {
      await testPool.query(
        "DELETE FROM departments WHERE name_en='Template Inactive Department'",
      );
    }
  });
  it("has a CSV header and one sample row in the same column order", async () => {
    const response = await admin.getBinary(templateUrl("csv"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    const text = response.bytes.toString();
    expect(text.replace(/^\uFEFF/, "").split("\r\n")[0]).toBe(
      csvTemplateColumns()
        .map((c) => `"${c}"`)
        .join(","),
    );
    expect(
      csvTemplateColumns().slice(0, controls.length + profileFields.length),
    ).toEqual([...controls, ...profileFields]);
    const rows = readCsv(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      rowType: "PROFILE",
      action: "CREATE",
      officialEmployeeId: SAMPLE_EMPLOYEE_ID,
      phone: "01712345678",
    });
  });
  it("never imports the sample rows, but accepts them once the ID is replaced", async () => {
    const { bytes } = await templateSheets(admin);
    const untouched = await admin.postBinary(
      "/api/v1/admin/data/files/preview",
      bytes,
      xlsxType,
    );
    expect(untouched.status).toBe(200);
    expect(validity(untouched.body)).toEqual(Array(8).fill(false));
    expect(JSON.stringify(untouched.body.results)).toContain("sample row");
    const committed = await admin.post("/api/v1/admin/data/files/commit", {
      previewId: untouched.body.previewId,
      selected: [2],
    });
    expect(committed.status).toBe(409);
    expect(
      (
        await testPool.query(
          "SELECT 1 FROM employees WHERE official_employee_id LIKE 'SAMPLE-%'",
        )
      ).rowCount,
    ).toBe(0);
    const edited = (await readXlsx(bytes)).map((row) => ({
      ...row,
      officialEmployeeId: "TPL-001",
    }));
    const columns = [...new Set(edited.flatMap((row) => Object.keys(row)))];
    const preview = await admin.postBinary(
      "/api/v1/admin/data/files/preview",
      writeCsv(columns, edited),
      csvType,
    );
    expect(validity(preview.body)).toEqual(Array(8).fill(true));
  });
  it("gives a department administrator only their own department", async () => {
    const created = (
      await testPool.query(
        "INSERT INTO employees(official_employee_id,first_name_en,department_id,joining_date) VALUES('TPL-SCOPED','Template Scoped',$1,'2026-01-01') RETURNING id",
        [departmentId],
      )
    ).rows[0];
    await testPool.query(
      "INSERT INTO users(employee_id,password_hash,role,must_change_password) SELECT $1,password_hash,'EMPLOYEE',FALSE FROM users WHERE id=$2",
      [created.id, employeeUserId],
    );
    const accessPath = `/api/v1/admin/employees/${created.id}/admin-access`;
    try {
      expect(
        (
          await admin.put(accessPath, {
            accessLevel: "DEPARTMENT",
            departmentId,
          })
        ).status,
      ).toBe(200);
      const scoped = await loginAs("TPL-SCOPED");
      const { sheets } = await templateSheets(scoped);
      const name = (
        await testPool.query("SELECT name_en FROM departments WHERE id=$1", [
          departmentId,
        ])
      ).rows[0].name_en;
      expect(sheets.Departments).toEqual([
        { Department: name, "Department UUID": departmentId },
      ]);
      expect(sheets.PROFILE![0]!.departmentId).toBe(departmentId);
      const csv = readCsv(
        (await scoped.getBinary(templateUrl("csv"))).bytes.toString(),
      );
      expect(csv[0]!.departmentId).toBe(departmentId);
      // The sample department is inside the scope, so only the sample ID blocks the row.
      const row = { ...csv[0]!, officialEmployeeId: "TPL-SCOPED-NEW" };
      const preview = await scoped.postBinary(
        "/api/v1/admin/data/files/preview",
        writeCsv(Object.keys(row), [row]),
        csvType,
      );
      expect(validity(preview.body)).toEqual([true]);
      // A full administrator still sees every active department.
      const { sheets: full } = await templateSheets(admin);
      expect(full.Departments!.length).toBeGreaterThan(1);
    } finally {
      await admin.put(accessPath, { accessLevel: "NONE" });
    }
  });
  it("keeps the template out of reach of employees and anonymous users", async () => {
    expect((await new ApiClient(baseUrl).get(templateUrl("xlsx"))).status).toBe(
      401,
    );
    expect((await (await employee()).get(templateUrl("xlsx"))).status).toBe(
      403,
    );
  });
});
