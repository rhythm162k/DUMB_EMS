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
let createdDepartmentId = "";

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
  admin = await signInAndCompleteAdminPasswordChange(baseUrl);
});

afterAll(async () => {
  if (server) await stopTestApi(server);
});

describe("Admin department management", () => {
  it("lists all departments with employee counts", async () => {
    const created = await admin.post("/api/v1/admin/employees", {
      officialEmployeeId: "000501",
      firstNameEn: "Counted",
      lastNameEn: "Person",
      departmentId: operationsDepartmentId,
      gender: "MALE",
      bloodGroup: "A+",
    });
    expect(created.status).toBe(201);

    const response = await admin.get("/api/v1/admin/departments");
    expect(response.status).toBe(200);
    const names = response.body.departments?.map(
      (department) => department.nameEn,
    );
    expect(names).toEqual(["Administration", "Operations"]);
    const operations = response.body.departments?.find(
      (department) => department.nameEn === "Operations",
    );
    expect(operations?.employeeCount).toBe(1);
    expect(operations?.isActive).toBe(true);
  });

  it("creates a department and writes an audit event", async () => {
    const response = await admin.post("/api/v1/admin/departments", {
      nameEn: "Engineering",
      nameBn: "প্রকৌশল",
    });
    expect(response.status).toBe(201);
    expect(response.body.department?.nameEn).toBe("Engineering");
    expect(response.body.department?.nameBn).toBe("প্রকৌশল");
    expect(response.body.department?.isActive).toBe(true);
    expect(response.body.department?.employeeCount).toBe(0);
    createdDepartmentId = response.body.department!.id;

    const audit = await testPool.query(
      "SELECT count(*)::int AS count FROM audit_logs WHERE action = 'DEPARTMENT_CREATED' AND entity_id = $1",
      [createdDepartmentId],
    );
    expect(audit.rows[0].count).toBe(1);
  });

  it("rejects a duplicate English name", async () => {
    const response = await admin.post("/api/v1/admin/departments", {
      nameEn: "Engineering",
    });
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("DEPARTMENT_NAME_TAKEN");
  });

  it("validates the create body", async () => {
    for (const body of [
      {},
      { nameEn: "" },
      { nameEn: "   " },
      { nameEn: "x".repeat(151) },
      { nameEn: "Valid", isActive: false },
    ]) {
      const response = await admin.post("/api/v1/admin/departments", body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error?.code).toBe("VALIDATION_ERROR");
    }
  });

  it("renames a department and clears its Bangla name", async () => {
    const renamed = await admin.patch(
      `/api/v1/admin/departments/${createdDepartmentId}`,
      {
        nameEn: "Civil Engineering",
        nameBn: null,
      },
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body.changed).toBe(true);
    expect(renamed.body.department?.nameEn).toBe("Civil Engineering");
    expect(renamed.body.department?.nameBn).toBeNull();

    const audit = await testPool.query(
      "SELECT metadata FROM audit_logs WHERE action = 'DEPARTMENT_UPDATED' AND entity_id = $1",
      [createdDepartmentId],
    );
    expect(audit.rowCount).toBe(1);
    expect([...audit.rows[0].metadata.changedFields].sort()).toEqual([
      "nameBn",
      "nameEn",
    ]);
  });

  it("rejects renaming to an existing name", async () => {
    const response = await admin.patch(
      `/api/v1/admin/departments/${createdDepartmentId}`,
      { nameEn: "Operations" },
    );
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("DEPARTMENT_NAME_TAKEN");
  });

  it("reports no change and writes no audit event for a no-op update", async () => {
    const before = await testPool.query(
      "SELECT count(*)::int AS count FROM audit_logs WHERE action = 'DEPARTMENT_UPDATED'",
    );
    const response = await admin.patch(
      `/api/v1/admin/departments/${createdDepartmentId}`,
      {
        nameEn: "Civil Engineering",
        isActive: true,
      },
    );
    expect(response.status).toBe(200);
    expect(response.body.changed).toBe(false);
    const after = await testPool.query(
      "SELECT count(*)::int AS count FROM audit_logs WHERE action = 'DEPARTMENT_UPDATED'",
    );
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("deactivating hides a department from dropdowns and new assignments, and reactivating restores it", async () => {
    const deactivated = await admin.patch(
      `/api/v1/admin/departments/${createdDepartmentId}`,
      { isActive: false },
    );
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.department?.isActive).toBe(false);

    const publicList = await admin.get("/api/v1/departments");
    expect(
      publicList.body.departments?.map((department) => department.nameEn),
    ).not.toContain("Civil Engineering");
    const adminList = await admin.get("/api/v1/admin/departments");
    expect(
      adminList.body.departments?.map((department) => department.nameEn),
    ).toContain("Civil Engineering");

    const rejected = await admin.post("/api/v1/admin/employees", {
      officialEmployeeId: "000502",
      firstNameEn: "Blocked",
      departmentId: createdDepartmentId,
      gender: "MALE",
      bloodGroup: "B+",
    });
    expect(rejected.status).toBe(400);
    expect(rejected.body.error?.code).toBe("DEPARTMENT_INVALID");

    const audit = await testPool.query(
      "SELECT metadata FROM audit_logs WHERE action = 'DEPARTMENT_UPDATED' AND metadata ? 'isActive'",
    );
    expect(audit.rows[0].metadata.isActive).toEqual({ from: true, to: false });

    const reactivated = await admin.patch(
      `/api/v1/admin/departments/${createdDepartmentId}`,
      { isActive: true },
    );
    expect(reactivated.body.department?.isActive).toBe(true);
    const publicAgain = await admin.get("/api/v1/departments");
    expect(
      publicAgain.body.departments?.map((department) => department.nameEn),
    ).toContain("Civil Engineering");
  });

  it("validates the update body and IDs", async () => {
    const url = `/api/v1/admin/departments/${createdDepartmentId}`;
    for (const body of [
      {},
      { nameEn: "" },
      { nameEn: null },
      { isActive: "yes" },
      { id: "x" },
    ]) {
      const response = await admin.patch(url, body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error?.code).toBe("VALIDATION_ERROR");
    }
    expect(
      (
        await admin.patch("/api/v1/admin/departments/not-a-uuid", {
          isActive: false,
        })
      ).status,
    ).toBe(400);
    const missing = await admin.patch(
      "/api/v1/admin/departments/00000000-0000-4000-8000-000000000000",
      {
        isActive: false,
      },
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error?.code).toBe("DEPARTMENT_NOT_FOUND");
  });

  it("denies employees and anonymous callers", async () => {
    const anonymous = new ApiClient(baseUrl);
    await anonymous.initializeCsrf();
    expect((await anonymous.get("/api/v1/admin/departments")).status).toBe(401);
    expect(
      (await anonymous.post("/api/v1/admin/departments", { nameEn: "Anon" }))
        .status,
    ).toBe(401);

    const employee = new ApiClient(baseUrl);
    await employee.initializeCsrf();
    const login = await employee.post("/api/v1/auth/login", {
      employeeId: "TEST-EMP-001",
      password: "Employee-temp-Password-123",
    });
    expect(login.status).toBe(200);
    expect((await employee.get("/api/v1/admin/departments")).status).toBe(403);
    const create = await employee.post("/api/v1/admin/departments", {
      nameEn: "Sneaky",
    });
    expect(create.status).toBe(403);
    expect(create.body.error?.code).toBe("FORBIDDEN");
    expect(
      (
        await employee.patch(
          `/api/v1/admin/departments/${createdDepartmentId}`,
          { isActive: false },
        )
      ).status,
    ).toBe(403);

    const unchanged = await testPool.query(
      "SELECT is_active FROM departments WHERE id = $1",
      [createdDepartmentId],
    );
    expect(unchanged.rows[0].is_active).toBe(true);
    const sneaky = await testPool.query(
      "SELECT 1 FROM departments WHERE name_en IN ('Sneaky', 'Anon')",
    );
    expect(sneaky.rowCount).toBe(0);
  });
});
