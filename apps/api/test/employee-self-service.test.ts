import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { ApiClient, startTestApi, stopTestApi } from "./helpers/server.js";
import { testPool } from "./helpers/database.js";

let baseUrl = "";
let server: Server;
let employeeRecordId = "";

async function signIn(employeeId: string, password: string) {
  const client = new ApiClient(baseUrl);
  await client.initializeCsrf();
  const login = await client.post("/api/v1/auth/login", {
    employeeId,
    password,
  });
  return { client, login };
}

beforeAll(async () => {
  const setup = await startTestApi();
  baseUrl = setup.baseUrl;
  server = setup.server;
  employeeRecordId = setup.fixtures.employeeRecordId;
});

afterAll(async () => {
  if (server) await stopTestApi(server);
});

describe("Employee self-service profile", () => {
  it("returns only the signed-in employee's own profile", async () => {
    const department = await testPool.query(
      "SELECT id FROM departments WHERE name_en = 'Operations'",
    );
    await testPool.query(
      "UPDATE employees SET department_id = $1, designation = 'Test Officer', date_of_birth = '1991-02-03' WHERE id = $2",
      [department.rows[0].id, employeeRecordId],
    );
    // A second employee exists but must never be reachable from this session.
    const other = await testPool.query<{ id: string }>(
      "INSERT INTO employees (official_employee_id, first_name_en) VALUES ('TEST-EMP-002', 'Other') RETURNING id",
    );
    expect(other.rowCount).toBe(1);

    const { client, login } = await signIn(
      "TEST-EMP-001",
      "Employee-temp-Password-123",
    );
    expect(login.status).toBe(200);
    const response = await client.get("/api/v1/me/profile");
    expect(response.status).toBe(200);
    expect(response.body.profile?.officialEmployeeId).toBe("TEST-EMP-001");
    expect(response.body.profile?.id).toBe(employeeRecordId);
    expect(response.body.profile?.designation).toBe("Test Officer");
    expect(response.body.profile?.dateOfBirth).toBe("1991-02-03");
    expect(response.body.profile?.department?.nameEn).toBe("Operations");
    // Account internals are not part of the employee-facing profile.
    expect(response.body.profile).not.toHaveProperty("account");
    expect(JSON.stringify(response.body)).not.toContain("TEST-EMP-002");
  });

  it("ignores any employee ID the client tries to supply", async () => {
    const { client } = await signIn(
      "TEST-EMP-001",
      "Employee-temp-Password-123",
    );
    const response = await client.get(
      `/api/v1/me/profile?employeeId=${employeeRecordId}&id=00000000-0000-4000-8000-000000000000`,
    );
    expect(response.status).toBe(200);
    expect(response.body.profile?.officialEmployeeId).toBe("TEST-EMP-001");
  });

  it("requires authentication and an active employee", async () => {
    const anonymous = new ApiClient(baseUrl);
    await anonymous.initializeCsrf();
    expect((await anonymous.get("/api/v1/me/profile")).status).toBe(401);

    const admin = await signIn("TEST-ADMIN-001", "Admin-temp-Password-123");
    expect(admin.login.status).toBe(200);
    // The Admin is held at the first-login password change before any other access.
    const held = await admin.client.get("/api/v1/me/profile");
    expect(held.status).toBe(403);
    expect(held.body.error?.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it("blocks the profile when employment is no longer active", async () => {
    const { client } = await signIn(
      "TEST-EMP-001",
      "Employee-temp-Password-123",
    );
    await testPool.query(
      "UPDATE employees SET employment_status = 'RESIGNED' WHERE id = $1",
      [employeeRecordId],
    );
    const response = await client.get("/api/v1/me/profile");
    expect(response.status).toBe(401);
    expect(response.body.error?.code).toBe("ACCOUNT_UNAVAILABLE");
    await testPool.query(
      "UPDATE employees SET employment_status = 'ACTIVE' WHERE id = $1",
      [employeeRecordId],
    );
  });
});

describe("Departments list", () => {
  it("returns active departments to signed-in users only", async () => {
    const anonymous = new ApiClient(baseUrl);
    await anonymous.initializeCsrf();
    expect((await anonymous.get("/api/v1/departments")).status).toBe(401);

    const { client } = await signIn(
      "TEST-EMP-001",
      "Employee-temp-Password-123",
    );
    const response = await client.get("/api/v1/departments");
    expect(response.status).toBe(200);
    expect(response.body.departments?.map((d) => d.nameEn)).toEqual([
      "Administration",
      "Operations",
    ]);

    await testPool.query(
      "UPDATE departments SET is_active = FALSE WHERE name_en = 'Operations'",
    );
    const afterDeactivate = await client.get("/api/v1/departments");
    expect(afterDeactivate.body.departments?.map((d) => d.nameEn)).toEqual([
      "Administration",
    ]);
    await testPool.query(
      "UPDATE departments SET is_active = TRUE WHERE name_en = 'Operations'",
    );
  });
});
