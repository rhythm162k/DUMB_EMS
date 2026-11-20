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
let adminEmployeeRecordId = "";

async function employeeSignIn() {
  const client = new ApiClient(baseUrl);
  await client.initializeCsrf();
  const login = await client.post("/api/v1/auth/login", {
    employeeId: "TEST-EMP-001",
    password: "Employee-temp-Password-123",
  });
  return { client, login };
}

beforeAll(async () => {
  const setup = await startTestApi();
  baseUrl = setup.baseUrl;
  server = setup.server;
  employeeRecordId = setup.fixtures.employeeRecordId;
  adminEmployeeRecordId = setup.fixtures.adminEmployeeRecordId;
  admin = await signInAndCompleteAdminPasswordChange(baseUrl);
});

afterAll(async () => {
  if (server) await stopTestApi(server);
});

describe("Employment and account status management", () => {
  const path = () => `/api/v1/admin/employees/${employeeRecordId}/status`;

  it("suspending an employee disables the account and revokes live sessions", async () => {
    const { client, login } = await employeeSignIn();
    expect(login.status).toBe(200);
    expect((await client.get("/api/v1/auth/me")).status).toBe(200);

    const response = await admin.patch(path(), {
      employmentStatus: "SUSPENDED",
      reason: "Demo suspension",
    });
    expect(response.status).toBe(200);
    expect(response.body.changed).toBe(true);
    expect(response.body.employee?.employmentStatus).toBe("SUSPENDED");
    expect(response.body.employee?.account?.accountStatus).toBe("DISABLED");

    expect((await client.get("/api/v1/auth/me")).status).toBe(401);
    const sessions = await testPool.query(
      "SELECT count(*)::int AS count FROM \"session\" WHERE sess ->> 'userId' = (SELECT id::text FROM users WHERE employee_id = $1)",
      [employeeRecordId],
    );
    expect(sessions.rows[0].count).toBe(0);

    const retry = await employeeSignIn();
    expect(retry.login.status).toBe(401);
    expect(retry.login.body.error?.code).toBe("INVALID_CREDENTIALS");
  });

  it("writes an audit event with the reason and only non-sensitive metadata", async () => {
    const audit = await testPool.query(
      "SELECT reason, metadata FROM audit_logs WHERE action = 'EMPLOYEE_STATUS_CHANGED' AND entity_id = $1",
      [employeeRecordId],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].reason).toBe("Demo suspension");
    expect(audit.rows[0].metadata.employmentStatus).toEqual({
      from: "ACTIVE",
      to: "SUSPENDED",
    });
    expect(audit.rows[0].metadata.accountStatus).toEqual({
      from: "ACTIVE",
      to: "DISABLED",
    });
    expect(audit.rows[0].metadata.sessionsRevoked).toBe(true);
  });

  it("restoring employment does not silently re-enable the account", async () => {
    const response = await admin.patch(path(), { employmentStatus: "ACTIVE" });
    expect(response.status).toBe(200);
    expect(response.body.employee?.employmentStatus).toBe("ACTIVE");
    expect(response.body.employee?.account?.accountStatus).toBe("DISABLED");
    expect((await employeeSignIn()).login.status).toBe(401);
  });

  it("re-enabling the account restores sign-in", async () => {
    const response = await admin.patch(path(), { accountStatus: "ACTIVE" });
    expect(response.status).toBe(200);
    expect(response.body.employee?.account?.accountStatus).toBe("ACTIVE");
    expect((await employeeSignIn()).login.status).toBe(200);
  });

  it("rejects an active account for a non-active employee", async () => {
    const response = await admin.patch(path(), {
      employmentStatus: "RETIRED",
      accountStatus: "ACTIVE",
    });
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("STATUS_CONFLICT");
    const state = await testPool.query(
      "SELECT employment_status FROM employees WHERE id = $1",
      [employeeRecordId],
    );
    expect(state.rows[0].employment_status).toBe("ACTIVE");
  });

  it("reports no change and writes no audit event for a no-op request", async () => {
    const before = await testPool.query(
      "SELECT count(*)::int AS count FROM audit_logs WHERE action = 'EMPLOYEE_STATUS_CHANGED'",
    );
    const response = await admin.patch(path(), { employmentStatus: "ACTIVE" });
    expect(response.status).toBe(200);
    expect(response.body.changed).toBe(false);
    const after = await testPool.query(
      "SELECT count(*)::int AS count FROM audit_logs WHERE action = 'EMPLOYEE_STATUS_CHANGED'",
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("validates the request body", async () => {
    expect((await admin.patch(path(), {})).status).toBe(400);
    expect(
      (await admin.patch(path(), { employmentStatus: "FIRED" })).status,
    ).toBe(400);
    expect(
      (await admin.patch(path(), { employmentStatus: "ACTIVE", role: "ADMIN" }))
        .status,
    ).toBe(400);
    expect(
      (
        await admin.patch("/api/v1/admin/employees/not-a-uuid/status", {
          employmentStatus: "ACTIVE",
        })
      ).status,
    ).toBe(400);
    const missing = await admin.patch(
      "/api/v1/admin/employees/00000000-0000-4000-8000-000000000000/status",
      {
        employmentStatus: "ACTIVE",
      },
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error?.code).toBe("EMPLOYEE_NOT_FOUND");
  });

  it("protects the single Admin account from status changes", async () => {
    const response = await admin.patch(
      `/api/v1/admin/employees/${adminEmployeeRecordId}/status`,
      {
        employmentStatus: "SUSPENDED",
      },
    );
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("ADMIN_ACCOUNT_PROTECTED");
    const state = await testPool.query(
      "SELECT account_status FROM users WHERE role = 'ADMIN'",
    );
    expect(state.rows[0].account_status).toBe("ACTIVE");
  });

  it("denies employees and anonymous callers", async () => {
    const { client } = await employeeSignIn();
    const forbidden = await client.patch(path(), {
      employmentStatus: "SUSPENDED",
    });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error?.code).toBe("FORBIDDEN");

    const anonymous = new ApiClient(baseUrl);
    await anonymous.initializeCsrf();
    expect(
      (await anonymous.patch(path(), { employmentStatus: "SUSPENDED" })).status,
    ).toBe(401);
  });
});
