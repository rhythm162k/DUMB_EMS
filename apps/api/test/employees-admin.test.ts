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
let operationsDepartmentId = "";
let administrationDepartmentId = "";

const validEmployee = (overrides: Record<string, unknown> = {}) => ({
  officialEmployeeId: "000101",
  firstNameEn: "Demo",
  lastNameEn: "Person",
  departmentId: operationsDepartmentId,
  gender: "FEMALE",
  bloodGroup: "O+",
  dateOfBirth: "1990-04-15",
  designation: "Assistant Officer",
  joiningDate: "2018-07-01",
  nationalId: "1234567890123",
  phone: "+8801700000000",
  email: "demo.person@example.test",
  ...overrides,
});

beforeAll(async () => {
  const setup = await startTestApi();
  baseUrl = setup.baseUrl;
  server = setup.server;
  const departments = await testPool.query<{ id: string; name_en: string }>(
    "SELECT id, name_en FROM departments",
  );
  operationsDepartmentId = departments.rows.find(
    (row) => row.name_en === "Operations",
  )!.id;
  administrationDepartmentId = departments.rows.find(
    (row) => row.name_en === "Administration",
  )!.id;
  // Sign the admin in once: each helper call after the first costs a failed login attempt.
  admin = await signInAndCompleteAdminPasswordChange(baseUrl);
});

afterAll(async () => {
  if (server) await stopTestApi(server);
});

describe("Admin employee creation", () => {
  it("creates an employee and account with a one-time temporary password", async () => {
    const response = await admin.post(
      "/api/v1/admin/employees",
      validEmployee(),
    );
    expect(response.status).toBe(201);
    expect(typeof response.body.temporaryPassword).toBe("string");
    expect(response.body.employee?.officialEmployeeId).toBe("000101");
    expect(response.body.employee?.department?.nameEn).toBe("Operations");
    expect(response.body.employee?.dateOfBirth).toBe("1990-04-15");
    expect(response.body.employee?.account?.role).toBe("EMPLOYEE");
    expect(response.body.employee?.account?.mustChangePassword).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain("password_hash");

    // The stored value is a bcrypt hash, never the plaintext.
    const stored = await testPool.query(
      "SELECT password_hash FROM users u JOIN employees e ON e.id = u.employee_id WHERE e.official_employee_id = '000101'",
    );
    expect(stored.rows[0].password_hash).not.toBe(
      response.body.temporaryPassword,
    );
    expect(stored.rows[0].password_hash.startsWith("$2")).toBe(true);

    const audit = await testPool.query(
      "SELECT metadata FROM audit_logs WHERE action = 'EMPLOYEE_CREATED' AND entity_id = $1",
      [response.body.employee?.id],
    );
    expect(audit.rowCount).toBe(1);
    expect(JSON.stringify(audit.rows[0].metadata)).not.toContain(
      String(response.body.temporaryPassword),
    );

    // The new employee can sign in with it but is held at the first-login password change.
    const employee = new ApiClient(baseUrl);
    await employee.initializeCsrf();
    const login = await employee.post("/api/v1/auth/login", {
      employeeId: "000101",
      password: response.body.temporaryPassword,
    });
    expect(login.status).toBe(200);
    expect(login.body.user?.mustChangePassword).toBe(true);
    const profile = await employee.get("/api/v1/me/profile");
    expect(profile.status).toBe(403);
    expect(profile.body.error?.code).toBe("PASSWORD_CHANGE_REQUIRED");
  });

  it("preserves leading zeros in the employee ID", async () => {
    const response = await admin.post(
      "/api/v1/admin/employees",
      validEmployee({ officialEmployeeId: "000042" }),
    );
    expect(response.status).toBe(201);
    expect(response.body.employee?.officialEmployeeId).toBe("000042");
  });

  it("rejects a duplicate employee ID", async () => {
    const response = await admin.post(
      "/api/v1/admin/employees",
      validEmployee(),
    );
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("EMPLOYEE_ID_TAKEN");
  });

  it("validates required fields on the server", async () => {
    const { gender: _gender, ...withoutGender } = validEmployee({
      officialEmployeeId: "000102",
    });
    void _gender;
    const missing = await admin.post("/api/v1/admin/employees", withoutGender);
    expect(missing.status).toBe(400);
    expect(missing.body.error?.code).toBe("VALIDATION_ERROR");

    const badId = await admin.post(
      "/api/v1/admin/employees",
      validEmployee({ officialEmployeeId: "bad id!" }),
    );
    expect(badId.status).toBe(400);
    const badBlood = await admin.post(
      "/api/v1/admin/employees",
      validEmployee({ officialEmployeeId: "000103", bloodGroup: "Z+" }),
    );
    expect(badBlood.status).toBe(400);
    const futureBirth = await admin.post(
      "/api/v1/admin/employees",
      validEmployee({
        officialEmployeeId: "000104",
        dateOfBirth: "2999-01-01",
      }),
    );
    expect(futureBirth.status).toBe(400);
    const badEmail = await admin.post(
      "/api/v1/admin/employees",
      validEmployee({ officialEmployeeId: "000105", email: "not-an-email" }),
    );
    expect(badEmail.status).toBe(400);
  });

  it("rejects unknown fields so roles and statuses cannot be mass-assigned", async () => {
    const response = await admin.post(
      "/api/v1/admin/employees",
      validEmployee({
        officialEmployeeId: "000106",
        role: "ADMIN",
        employmentStatus: "RETIRED",
      }),
    );
    expect(response.status).toBe(400);
    const created = await testPool.query(
      "SELECT 1 FROM employees WHERE official_employee_id = '000106'",
    );
    expect(created.rowCount).toBe(0);
  });

  it("rejects an unknown or inactive department without creating anything", async () => {
    const unknown = await admin.post(
      "/api/v1/admin/employees",
      validEmployee({
        officialEmployeeId: "000107",
        departmentId: "00000000-0000-4000-8000-000000000000",
      }),
    );
    expect(unknown.status).toBe(400);
    expect(unknown.body.error?.code).toBe("DEPARTMENT_INVALID");

    await testPool.query(
      "UPDATE departments SET is_active = FALSE WHERE id = $1",
      [administrationDepartmentId],
    );
    const inactive = await admin.post(
      "/api/v1/admin/employees",
      validEmployee({
        officialEmployeeId: "000108",
        departmentId: administrationDepartmentId,
      }),
    );
    expect(inactive.status).toBe(400);
    await testPool.query(
      "UPDATE departments SET is_active = TRUE WHERE id = $1",
      [administrationDepartmentId],
    );

    const leftovers = await testPool.query(
      "SELECT 1 FROM employees WHERE official_employee_id IN ('000107','000108')",
    );
    expect(leftovers.rowCount).toBe(0);
  });

  it("denies employees and anonymous callers", async () => {
    const anonymous = new ApiClient(baseUrl);
    await anonymous.initializeCsrf();
    const unauthenticated = await anonymous.post(
      "/api/v1/admin/employees",
      validEmployee({ officialEmployeeId: "000109" }),
    );
    expect(unauthenticated.status).toBe(401);

    const employee = new ApiClient(baseUrl);
    await employee.initializeCsrf();
    await employee.post("/api/v1/auth/login", {
      employeeId: "TEST-EMP-001",
      password: "Employee-temp-Password-123",
    });
    const forbidden = await employee.post(
      "/api/v1/admin/employees",
      validEmployee({ officialEmployeeId: "000109" }),
    );
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error?.code).toBe("FORBIDDEN");
    expect((await employee.get("/api/v1/admin/employees")).status).toBe(403);
  });
});

describe("Admin employee list and detail", () => {
  beforeAll(async () => {
    for (const [id, first, last, dept] of [
      ["000201", "Rahim", "Uddin", operationsDepartmentId],
      ["000202", "Karim", "Hossain", operationsDepartmentId],
      ["000203", "Salma", "Akter", administrationDepartmentId],
    ] as const) {
      const response = await admin.post(
        "/api/v1/admin/employees",
        validEmployee({
          officialEmployeeId: id,
          firstNameEn: first,
          lastNameEn: last,
          departmentId: dept,
        }),
      );
      expect(response.status).toBe(201);
    }
  });

  it("lists employees with pagination metadata and without sensitive fields", async () => {
    const response = await admin.get(
      "/api/v1/admin/employees?pageSize=2&page=1",
    );
    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(2);
    expect(response.body.pagination?.pageSize).toBe(2);
    expect(response.body.pagination!.total).toBeGreaterThanOrEqual(5);
    expect(response.body.pagination!.totalPages).toBe(
      Math.ceil(response.body.pagination!.total / 2),
    );
    expect(JSON.stringify(response.body.items)).not.toContain("nationalId");

    const secondPage = await admin.get(
      "/api/v1/admin/employees?pageSize=2&page=2",
    );
    expect(secondPage.body.items![0].id).not.toBe(response.body.items![0].id);
  });

  it("searches by ID and by name, case-insensitively", async () => {
    const byId = await admin.get("/api/v1/admin/employees?q=000201");
    expect(byId.body.items?.map((item) => item.officialEmployeeId)).toEqual([
      "000201",
    ]);

    const byName = await admin.get("/api/v1/admin/employees?q=hossain");
    expect(byName.body.items?.map((item) => item.officialEmployeeId)).toEqual([
      "000202",
    ]);

    const byFullName = await admin.get(
      "/api/v1/admin/employees?q=" + encodeURIComponent("salma akter"),
    );
    expect(
      byFullName.body.items?.map((item) => item.officialEmployeeId),
    ).toEqual(["000203"]);
  });

  it("treats LIKE wildcards in the search text as literal characters", async () => {
    const percent = await admin.get(
      "/api/v1/admin/employees?q=" + encodeURIComponent("%"),
    );
    expect(percent.status).toBe(200);
    expect(percent.body.pagination?.total).toBe(0);
    const injection = await admin.get(
      "/api/v1/admin/employees?q=" +
        encodeURIComponent("x'; DROP TABLE employees; --"),
    );
    expect(injection.status).toBe(200);
    expect(injection.body.pagination?.total).toBe(0);
  });

  it("filters by department and employment status", async () => {
    const byDepartment = await admin.get(
      `/api/v1/admin/employees?departmentId=${administrationDepartmentId}`,
    );
    expect(
      byDepartment.body.items?.map((item) => item.officialEmployeeId),
    ).toContain("000203");
    expect(
      byDepartment.body.items?.map((item) => item.officialEmployeeId),
    ).not.toContain("000201");

    await testPool.query(
      "UPDATE employees SET employment_status = 'RETIRED' WHERE official_employee_id = '000202'",
    );
    const retired = await admin.get(
      "/api/v1/admin/employees?employmentStatus=RETIRED",
    );
    expect(retired.body.items?.map((item) => item.officialEmployeeId)).toEqual([
      "000202",
    ]);
    await testPool.query(
      "UPDATE employees SET employment_status = 'ACTIVE' WHERE official_employee_id = '000202'",
    );
  });

  it("rejects invalid list filters", async () => {
    for (const query of [
      "pageSize=1000",
      "page=0",
      "employmentStatus=NOPE",
      "departmentId=abc",
    ]) {
      const response = await admin.get(`/api/v1/admin/employees?${query}`);
      expect(response.status, query).toBe(400);
      expect(response.body.error?.code).toBe("VALIDATION_ERROR");
    }
  });

  it("returns the full detail for one employee, including account state", async () => {
    const list = await admin.get("/api/v1/admin/employees?q=000201");
    const id = list.body.items![0].id;
    const detail = await admin.get(`/api/v1/admin/employees/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.employee?.nationalId).toBe("1234567890123");
    expect(detail.body.employee?.joiningDate).toBe("2018-07-01");
    expect(detail.body.employee?.account?.accountStatus).toBe("ACTIVE");
    expect(JSON.stringify(detail.body)).not.toContain("password");
  });

  it("rejects malformed and unknown employee record IDs", async () => {
    expect((await admin.get("/api/v1/admin/employees/not-a-uuid")).status).toBe(
      400,
    );
    const missing = await admin.get(
      "/api/v1/admin/employees/00000000-0000-4000-8000-000000000000",
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error?.code).toBe("EMPLOYEE_NOT_FOUND");
  });
});
