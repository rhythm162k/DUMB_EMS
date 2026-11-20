import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import {
  ApiClient,
  signInAndCompleteAdminPasswordChange,
  startTestApi,
  stopTestApi,
} from "./helpers/server.js";
import { testPool } from "./helpers/database.js";

let baseUrl = "";
let server: Server;
let admin: ApiClient;
let employeeRecordId = "";
let operationsDepartmentId = "";

async function employeeClient() {
  const client = new ApiClient(baseUrl);
  await client.initializeCsrf();
  const login = await client.post("/api/v1/auth/login", {
    employeeId: "TEST-EMP-001",
    password: "Employee-temp-Password-123",
  });
  expect(login.status).toBe(200);
  return client;
}

beforeAll(async () => {
  const setup = await startTestApi();
  baseUrl = setup.baseUrl;
  server = setup.server;
  employeeRecordId = setup.fixtures.employeeRecordId;
  const departments = await testPool.query<{ id: string; name_en: string }>(
    "SELECT id, name_en FROM departments",
  );
  operationsDepartmentId = departments.rows.find(
    (row) => row.name_en === "Operations",
  )!.id;
  admin = await signInAndCompleteAdminPasswordChange(baseUrl);
});

afterAll(async () => {
  if (server) await stopTestApi(server);
});

describe("PDS personal fields (father, mother, religion, marital status)", () => {
  it("creates an employee with the new personal fields", async () => {
    const created = await admin.post("/api/v1/admin/employees", {
      officialEmployeeId: "000401",
      firstNameEn: "Personal",
      lastNameEn: "Fields",
      departmentId: operationsDepartmentId,
      gender: "MALE",
      bloodGroup: "A+",
      fatherName: "Fictional Father",
      motherName: "Fictional Mother",
      religion: "Fictional Religion",
      maritalStatus: "SINGLE",
    });
    expect(created.status).toBe(201);
    expect(created.body.employee?.fatherName).toBe("Fictional Father");
    expect(created.body.employee?.motherName).toBe("Fictional Mother");
    expect(created.body.employee?.religion).toBe("Fictional Religion");
    expect(created.body.employee?.maritalStatus).toBe("SINGLE");
  });

  it("leaves the new fields empty when they are not supplied", async () => {
    const response = await admin.get(
      `/api/v1/admin/employees/${employeeRecordId}`,
    );
    expect(response.status).toBe(200);
    expect(response.body.employee?.fatherName).toBeNull();
    expect(response.body.employee?.maritalStatus).toBeNull();
    expect(response.body.employee?.profileImageUrl).toBeNull();
  });

  it("rejects an invalid marital status on create and on edit", async () => {
    const created = await admin.post("/api/v1/admin/employees", {
      officialEmployeeId: "000402",
      firstNameEn: "Bad",
      departmentId: operationsDepartmentId,
      gender: "MALE",
      bloodGroup: "A+",
      maritalStatus: "COMPLICATED",
    });
    expect(created.status).toBe(400);
    expect(created.body.error?.code).toBe("VALIDATION_ERROR");

    const edited = await admin.patch(
      `/api/v1/admin/employees/${employeeRecordId}`,
      { maritalStatus: "COMPLICATED" },
    );
    expect(edited.status).toBe(400);
  });

  it("edits and clears the fields, and the audit event holds field names only", async () => {
    const path = `/api/v1/admin/employees/${employeeRecordId}`;
    const edit = await admin.patch(path, {
      fatherName: "Edited Father",
      motherName: "Edited Mother",
      religion: "Edited Religion",
      maritalStatus: "DIVORCED",
    });
    expect(edit.status).toBe(200);
    expect(edit.body.changed).toBe(true);
    expect(edit.body.employee?.fatherName).toBe("Edited Father");
    expect(edit.body.employee?.maritalStatus).toBe("DIVORCED");

    const clear = await admin.patch(path, { motherName: "", religion: null });
    expect(clear.status).toBe(200);
    expect(clear.body.employee?.motherName).toBeNull();
    expect(clear.body.employee?.religion).toBeNull();
    expect(clear.body.employee?.fatherName).toBe("Edited Father");

    const audit = await testPool.query(
      "SELECT metadata FROM audit_logs WHERE action = 'EMPLOYEE_UPDATED' AND entity_id = $1 ORDER BY occurred_at",
      [employeeRecordId],
    );
    expect([...audit.rows[0].metadata.changedFields].sort()).toEqual([
      "fatherName",
      "maritalStatus",
      "motherName",
      "religion",
    ]);
    expect(JSON.stringify(audit.rows)).not.toContain("Edited Father");
  });

  it("shows the employee their own values, read-only", async () => {
    const client = await employeeClient();
    const profile = await client.get("/api/v1/me/profile");
    expect(profile.status).toBe(200);
    expect(profile.body.profile?.fatherName).toBe("Edited Father");
    expect(profile.body.profile?.maritalStatus).toBe("DIVORCED");

    // The employee cannot write them directly; only the Admin can (change requests come in Phase 4).
    const direct = await client.patch(
      `/api/v1/admin/employees/${employeeRecordId}`,
      { fatherName: "Hacked" },
    );
    expect(direct.status).toBe(403);
  });
});
