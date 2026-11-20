import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import {
  ApiClient,
  signInAndCompleteAdminPasswordChange,
  startTestApi,
  stopTestApi,
} from "./helpers/server.js";
import { testPool } from "./helpers/database.js";

let server: Server;
let baseUrl: string;
let employeeRecordId: string;
let employeeUserId: string;
let otherId: string;
async function employeeSignIn() {
  const client = new ApiClient(baseUrl);
  await client.initializeCsrf();
  expect(
    (
      await client.post("/api/v1/auth/login", {
        employeeId: "TEST-EMP-001",
        password: "Employee-temp-Password-123",
      })
    ).status,
  ).toBe(200);
  return client;
}
beforeAll(async () => {
  const setup = await startTestApi();
  server = setup.server;
  baseUrl = setup.baseUrl;
  employeeRecordId = setup.fixtures.employeeRecordId;
  employeeUserId = setup.fixtures.employeeUserId;
  const other = await testPool.query<{ id: string }>(
    "INSERT INTO employees (official_employee_id, first_name_en) VALUES ('OTHER-EXPORT-002', 'Hidden person') RETURNING id",
  );
  otherId = other.rows[0]!.id;
});
afterAll(async () => {
  if (server) await stopTestApi(server);
});

describe("Employee CSV export", () => {
  it("downloads only the session owner's basic columns, ignoring supplied IDs, and audits the export", async () => {
    const client = await employeeSignIn();
    const response = await client.getBinary(
      `/api/v1/me/data/profile.csv?employeeId=${otherId}&id=${otherId}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain(
      "my-ems-profile.csv",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const text = response.bytes.toString("utf8");
    expect(text).toContain('"TEST-EMP-001"');
    expect(text).not.toContain("OTHER-EXPORT-002");
    expect(text).not.toContain("Hidden person");
    expect(text.trim().split("\r\n")).toHaveLength(2);
    expect(text.split("\r\n")[0]).toBe(
      "officialEmployeeId,firstNameEn,lastNameEn,departmentId,gender,bloodGroup,designation,joiningDate,email,phone",
    );
    const audit = await testPool.query(
      "SELECT actor_user_id, entity_id, metadata FROM audit_logs WHERE action='EMPLOYEE_SELF_EXPORTED'",
    );
    expect(audit.rows).toEqual([
      {
        actor_user_id: employeeUserId,
        entity_id: employeeRecordId,
        metadata: { format: "csv", scope: "self", rowCount: 1 },
      },
    ]);
  });
  it("quotes CSV values and neutralizes spreadsheet formulas", async () => {
    await testPool.query(
      "UPDATE employees SET designation=$1, phone=$2, last_name_en='=SUM(A1)' WHERE id=$3",
      ['Officer, "Demo"', "+880100000000", employeeRecordId],
    );
    const response = await (
      await employeeSignIn()
    ).getBinary("/api/v1/me/data/profile.csv");
    const text = response.bytes.toString("utf8");
    expect(text).toContain('"Officer, ""Demo"""');
    expect(text).toContain('"\'=SUM(A1)"');
    expect(text).not.toContain("+880100000000");
    expect(text).toContain("[MASKED]");
  });
  it("blocks anonymous access and employees accessing admin data tools", async () => {
    expect(
      (await new ApiClient(baseUrl).getBinary("/api/v1/me/data/profile.csv"))
        .status,
    ).toBe(401);
    const client = await employeeSignIn();
    for (const path of [
      "/admin/data/employees.csv",
      "/admin/data/template.csv",
      "/admin/data/audit",
    ]) {
      expect((await client.get(`/api/v1${path}`)).status).toBe(403);
    }
    for (const action of ["preview", "commit"]) {
      expect(
        (await client.post(`/api/v1/admin/data/import/${action}`, { rows: [] }))
          .status,
      ).toBe(403);
    }
  });
  it("blocks self-export until the temporary password has been changed", async () => {
    const client = await employeeSignIn();
    await testPool.query(
      "UPDATE users SET must_change_password=TRUE WHERE id=$1",
      [employeeUserId],
    );
    try {
      const result = await client.get("/api/v1/me/data/profile.csv");
      expect(result.status).toBe(403);
      expect(result.body.error?.code).toBe("PASSWORD_CHANGE_REQUIRED");
    } finally {
      await testPool.query(
        "UPDATE users SET must_change_password=FALSE WHERE id=$1",
        [employeeUserId],
      );
    }
  });
  it("blocks a disabled account or inactive employee", async () => {
    for (const [table, field, value, id] of [
      ["users", "account_status", "DISABLED", employeeUserId],
      ["employees", "employment_status", "RESIGNED", employeeRecordId],
    ]) {
      const client = await employeeSignIn();
      await testPool.query(`UPDATE ${table} SET ${field}=$1 WHERE id=$2`, [
        value,
        id,
      ]);
      try {
        expect((await client.get("/api/v1/me/data/profile.csv")).status).toBe(
          401,
        );
      } finally {
        await testPool.query(
          `UPDATE ${table} SET ${field}='ACTIVE' WHERE id=$1`,
          [id],
        );
      }
    }
  });
  it("audits admin exports and allows the linked admin personal export", async () => {
    const admin = await signInAndCompleteAdminPasswordChange(baseUrl);
    expect((await admin.get("/api/v1/me/data/profile.csv")).status).toBe(200);
    expect(
      (await admin.getBinary("/api/v1/admin/data/template.csv")).status,
    ).toBe(200);
    expect((await admin.get("/api/v1/admin/data/audit")).status).toBe(200);
    // Empty batches reach validation (400), not an employee-only guard (403).
    for (const action of ["preview", "commit"]) {
      const invalid = await admin.post(`/api/v1/admin/data/import/${action}`, {
        rows: [],
      });
      expect(invalid.status).toBe(400);
      expect(invalid.body.error?.code).toBe("VALIDATION_ERROR");
    }
    const response = await admin.getBinary("/api/v1/admin/data/employees.csv");
    expect(response.status).toBe(200);
    expect(response.bytes.toString()).toContain("OTHER-EXPORT-002");
    const audit = await testPool.query(
      "SELECT actor_role, metadata FROM audit_logs WHERE action='EMPLOYEES_EXPORTED'",
    );
    expect(audit.rows).toEqual([
      {
        actor_role: "ADMIN",
        metadata: { format: "csv", scope: "admin-list", rowCount: 3 },
      },
    ]);
  });
});
