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
let employeeId = "";
let operationsDepartmentId = "";
let administrationDepartmentId = "";

const path = () => `/api/v1/admin/employees/${employeeId}`;

async function editAuditCount(): Promise<number> {
  const result = await testPool.query(
    "SELECT count(*)::int AS count FROM audit_logs WHERE action = 'EMPLOYEE_UPDATED' AND entity_id = $1",
    [employeeId],
  );
  return result.rows[0].count;
}

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
  admin = await signInAndCompleteAdminPasswordChange(baseUrl);

  const created = await admin.post("/api/v1/admin/employees", {
    officialEmployeeId: "000301",
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
  });
  expect(created.status).toBe(201);
  employeeId = created.body.employee!.id;
});

afterAll(async () => {
  if (server) await stopTestApi(server);
});

describe("Admin direct employee edit", () => {
  it("updates only the submitted fields and leaves the rest untouched", async () => {
    const response = await admin.patch(path(), {
      designation: "Senior Officer",
      phone: "+8801811111111",
      presentAddress: "Fictional Road 1, Demo City",
    });
    expect(response.status).toBe(200);
    expect(response.body.changed).toBe(true);
    expect(response.body.employee?.designation).toBe("Senior Officer");
    expect(response.body.employee?.phone).toBe("+8801811111111");
    expect(response.body.employee?.presentAddress).toBe(
      "Fictional Road 1, Demo City",
    );
    // Untouched fields keep their values.
    expect(response.body.employee?.firstNameEn).toBe("Demo");
    expect(response.body.employee?.nationalId).toBe("1234567890123");
    expect(response.body.employee?.dateOfBirth).toBe("1990-04-15");
    expect(response.body.employee?.department?.nameEn).toBe("Operations");
    expect(response.body.employee?.officialEmployeeId).toBe("000301");

    const stored = await testPool.query(
      "SELECT updated_by FROM employees WHERE id = $1",
      [employeeId],
    );
    expect(stored.rows[0].updated_by).not.toBeNull();
  });

  it("writes an audit event with field names only, never the values", async () => {
    const audit = await testPool.query(
      "SELECT metadata FROM audit_logs WHERE action = 'EMPLOYEE_UPDATED' AND entity_id = $1",
      [employeeId],
    );
    expect(audit.rowCount).toBe(1);
    expect([...audit.rows[0].metadata.changedFields].sort()).toEqual([
      "designation",
      "phone",
      "presentAddress",
    ]);
    const serialized = JSON.stringify(audit.rows[0].metadata);
    expect(serialized).not.toContain("+8801811111111");
    expect(serialized).not.toContain("Fictional Road");
    expect(serialized).not.toContain("Senior Officer");
  });

  it("clears optional fields when null or an empty string is sent", async () => {
    const response = await admin.patch(path(), {
      designation: null,
      email: "",
      presentAddress: "   ",
    });
    expect(response.status).toBe(200);
    expect(response.body.changed).toBe(true);
    expect(response.body.employee?.designation).toBeNull();
    expect(response.body.employee?.email).toBeNull();
    expect(response.body.employee?.presentAddress).toBeNull();
  });

  it("reports no change and writes no audit event for a no-op edit", async () => {
    await admin.patch(path(), { designation: "Officer" });
    const before = await editAuditCount();
    const response = await admin.patch(path(), {
      designation: "Officer",
      firstNameEn: "Demo",
    });
    expect(response.status).toBe(200);
    expect(response.body.changed).toBe(false);
    expect(await editAuditCount()).toBe(before);
  });

  it("changes the department to an active department only", async () => {
    const moved = await admin.patch(path(), {
      departmentId: administrationDepartmentId,
    });
    expect(moved.status).toBe(200);
    expect(moved.body.employee?.department?.nameEn).toBe("Administration");

    const unknown = await admin.patch(path(), {
      departmentId: "00000000-0000-4000-8000-000000000000",
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error?.code).toBe("DEPARTMENT_INVALID");

    await testPool.query(
      "UPDATE departments SET is_active = FALSE WHERE id = $1",
      [operationsDepartmentId],
    );
    const inactive = await admin.patch(path(), {
      departmentId: operationsDepartmentId,
    });
    expect(inactive.status).toBe(400);
    expect(inactive.body.error?.code).toBe("DEPARTMENT_INVALID");
    await testPool.query(
      "UPDATE departments SET is_active = TRUE WHERE id = $1",
      [operationsDepartmentId],
    );

    const stored = await testPool.query(
      "SELECT department_id FROM employees WHERE id = $1",
      [employeeId],
    );
    expect(stored.rows[0].department_id).toBe(administrationDepartmentId);
  });

  it("still allows other edits after the employee's own department is deactivated", async () => {
    await testPool.query(
      "UPDATE departments SET is_active = FALSE WHERE id = $1",
      [administrationDepartmentId],
    );
    const response = await admin.patch(path(), {
      designation: "Officer (Grade 2)",
    });
    await testPool.query(
      "UPDATE departments SET is_active = TRUE WHERE id = $1",
      [administrationDepartmentId],
    );
    expect(response.status).toBe(200);
    expect(response.body.employee?.designation).toBe("Officer (Grade 2)");
  });

  it("rejects any attempt to change the official employee ID", async () => {
    const response = await admin.patch(path(), {
      officialEmployeeId: "999999",
      designation: "Ignored",
    });
    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe("EMPLOYEE_ID_IMMUTABLE");
    const stored = await testPool.query(
      "SELECT official_employee_id, designation FROM employees WHERE id = $1",
      [employeeId],
    );
    expect(stored.rows[0].official_employee_id).toBe("000301");
    expect(stored.rows[0].designation).not.toBe("Ignored");
  });

  it("rejects unknown and protected keys so roles and statuses cannot be mass-assigned", async () => {
    for (const body of [
      { role: "ADMIN" },
      { employmentStatus: "RETIRED" },
      { accountStatus: "DISABLED" },
      { id: "00000000-0000-4000-8000-000000000000" },
      { createdBy: "00000000-0000-4000-8000-000000000000" },
      { designation: "Officer", passwordHash: "x" },
    ]) {
      const response = await admin.patch(path(), body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error?.code).toBe("VALIDATION_ERROR");
    }
    const stored = await testPool.query(
      "SELECT employment_status FROM employees WHERE id = $1",
      [employeeId],
    );
    expect(stored.rows[0].employment_status).toBe("ACTIVE");
  });

  it("validates field values on the server", async () => {
    for (const body of [
      {},
      { firstNameEn: "" },
      { firstNameEn: null },
      { departmentId: null },
      { gender: "ROBOT" },
      { bloodGroup: "Z+" },
      { dateOfBirth: "2999-01-01" },
      { dateOfBirth: "15/04/1990" },
      { joiningDate: "not-a-date" },
      { email: "not-an-email" },
      { phone: "abc" },
      { nationalId: "x".repeat(31) },
    ]) {
      const response = await admin.patch(path(), body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error?.code).toBe("VALIDATION_ERROR");
    }
  });

  it("rejects malformed and unknown employee record IDs", async () => {
    expect(
      (
        await admin.patch("/api/v1/admin/employees/not-a-uuid", {
          designation: "Officer",
        })
      ).status,
    ).toBe(400);
    const missing = await admin.patch(
      "/api/v1/admin/employees/00000000-0000-4000-8000-000000000000",
      {
        designation: "Officer",
      },
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error?.code).toBe("EMPLOYEE_NOT_FOUND");
  });

  it("denies employees and anonymous callers", async () => {
    const anonymous = new ApiClient(baseUrl);
    await anonymous.initializeCsrf();
    expect(
      (await anonymous.patch(path(), { designation: "Hacker" })).status,
    ).toBe(401);

    const employee = new ApiClient(baseUrl);
    await employee.initializeCsrf();
    const login = await employee.post("/api/v1/auth/login", {
      employeeId: "TEST-EMP-001",
      password: "Employee-temp-Password-123",
    });
    expect(login.status).toBe(200);
    const forbidden = await employee.patch(path(), { designation: "Hacker" });
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error?.code).toBe("FORBIDDEN");
  });
});
