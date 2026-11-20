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
let employeeRecordId = "";
let employeeUserId = "";

beforeAll(async () => {
  const setup = await startTestApi();
  baseUrl = setup.baseUrl;
  server = setup.server;
  employeeRecordId = setup.fixtures.employeeRecordId;
  employeeUserId = setup.fixtures.employeeUserId;
});

afterAll(async () => {
  if (server) await stopTestApi(server);
});

describe("Admin authorization and employee password management", () => {
  it("prevents employee accounts from accessing admin password reset", async () => {
    const client = new ApiClient(baseUrl);
    await client.initializeCsrf();
    const login = await client.post("/api/v1/auth/login", {
      employeeId: "TEST-EMP-001",
      password: "Employee-temp-Password-123",
    });
    expect(login.status).toBe(200);
    const forbidden = await client.post(
      `/api/v1/admin/employees/${employeeRecordId}/password-reset`,
      {},
    );
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error?.code).toBe("FORBIDDEN");
  });

  it("allows an admin to reset an employee password and the employee to change it", async () => {
    const admin = await signInAndCompleteAdminPasswordChange(baseUrl);
    const reset = await admin.post(
      `/api/v1/admin/employees/${employeeRecordId}/password-reset`,
      {},
    );
    expect(reset.status).toBe(200);
    expect(typeof reset.body.temporaryPassword).toBe("string");
    expect(reset.body.mustChangePassword).toBe(true);
    const userState = await testPool.query(
      "SELECT must_change_password FROM users WHERE id = $1",
      [employeeUserId],
    );
    expect(userState.rows[0].must_change_password).toBe(true);
    const audit = await testPool.query(
      "SELECT count(*)::int AS count FROM audit_logs WHERE action = 'EMPLOYEE_PASSWORD_RESET' AND entity_id = $1",
      [employeeUserId],
    );
    expect(audit.rows[0].count).toBe(1);

    const employee = new ApiClient(baseUrl);
    await employee.initializeCsrf();
    const login = await employee.post("/api/v1/auth/login", {
      employeeId: "TEST-EMP-001",
      password: reset.body.temporaryPassword,
    });
    expect(login.status).toBe(200);
    expect(login.body.user?.mustChangePassword).toBe(true);
    const firstChange = await employee.post(
      "/api/v1/auth/first-login/change-password",
      {
        newPassword: "Employee-new-Password-456",
      },
    );
    expect(firstChange.status).toBe(200);
    const normalChange = await employee.post("/api/v1/auth/change-password", {
      currentPassword: "Employee-new-Password-456",
      newPassword: "Employee-final-Password-789",
    });
    expect(normalChange.status).toBe(200);
    const password = await testPool.query(
      "SELECT password_hash, must_change_password FROM users WHERE id = $1",
      [employeeUserId],
    );
    expect(password.rows[0].must_change_password).toBe(false);
    const bcrypt = (await import("bcrypt")).default;
    expect(
      await bcrypt.compare(
        "Employee-final-Password-789",
        password.rows[0].password_hash,
      ),
    ).toBe(true);
  });

  it("does not re-enable a disabled account when issuing a temporary password", async () => {
    const admin = await signInAndCompleteAdminPasswordChange(baseUrl);
    await testPool.query(
      "UPDATE users SET account_status = 'DISABLED' WHERE id = $1",
      [employeeUserId],
    );
    const response = await admin.post(
      `/api/v1/admin/employees/${employeeRecordId}/password-reset`,
      {},
    );
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("ACCOUNT_NOT_ACTIVE");
    const state = await testPool.query(
      "SELECT account_status FROM users WHERE id = $1",
      [employeeUserId],
    );
    expect(state.rows[0].account_status).toBe("DISABLED");
    await testPool.query(
      "UPDATE users SET account_status = 'ACTIVE' WHERE id = $1",
      [employeeUserId],
    );
  });

  it("prevents an admin from resetting a non-active employee", async () => {
    const admin = await signInAndCompleteAdminPasswordChange(baseUrl);
    await testPool.query(
      "UPDATE employees SET employment_status = 'SUSPENDED' WHERE id = $1",
      [employeeRecordId],
    );
    const response = await admin.post(
      `/api/v1/admin/employees/${employeeRecordId}/password-reset`,
      {},
    );
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("EMPLOYEE_NOT_ACTIVE");
  });

  it("rejects malformed and unknown employee record IDs", async () => {
    const admin = await signInAndCompleteAdminPasswordChange(baseUrl);
    const malformed = await admin.post(
      "/api/v1/admin/employees/not-a-uuid/password-reset",
      {},
    );
    expect(malformed.status).toBe(400);
    const missing = await admin.post(
      "/api/v1/admin/employees/00000000-0000-4000-8000-000000000000/password-reset",
      {},
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error?.code).toBe("EMPLOYEE_ACCOUNT_NOT_FOUND");
  });
});
