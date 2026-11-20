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

const spousePath = (id = employeeRecordId) =>
  `/api/v1/admin/employees/${id}/spouse`;
const employeePath = () => `/api/v1/admin/employees/${employeeRecordId}`;

beforeAll(async () => {
  const setup = await startTestApi();
  baseUrl = setup.baseUrl;
  server = setup.server;
  employeeRecordId = setup.fixtures.employeeRecordId;
  admin = await signInAndCompleteAdminPasswordChange(baseUrl);
});

afterAll(async () => {
  if (server) await stopTestApi(server);
});

describe("Spouse record", () => {
  it("is refused until the employee's marital status is MARRIED", async () => {
    const response = await admin.put(spousePath(), {
      spouseName: "Fictional Spouse",
    });
    expect(response.status).toBe(409);
    expect(response.body.error?.code).toBe("SPOUSE_REQUIRES_MARRIED");
  });

  it("returns null when the employee has no spouse record", async () => {
    const response = await admin.get(spousePath());
    expect(response.status).toBe(200);
    expect(response.body.spouse).toBeNull();
  });

  it("creates the spouse record (201) once the employee is MARRIED", async () => {
    expect(
      (await admin.patch(employeePath(), { maritalStatus: "MARRIED" })).status,
    ).toBe(200);
    const response = await admin.put(spousePath(), {
      spouseName: "Fictional Spouse",
      spouseOccupation: "Teacher",
      spouseDateOfBirth: "1992-05-06",
      spouseNationalId: "9876543210123",
    });
    expect(response.status).toBe(201);
    expect(response.body.changed).toBe(true);
    expect(response.body.spouse?.spouseName).toBe("Fictional Spouse");
    expect(response.body.spouse?.spouseDateOfBirth).toBe("1992-05-06");
  });

  it("is shown in the admin detail and in the employee's own profile", async () => {
    const detail = await admin.get(employeePath());
    expect(detail.body.spouse?.spouseName).toBe("Fictional Spouse");

    const client = new ApiClient(baseUrl);
    await client.initializeCsrf();
    await client.post("/api/v1/auth/login", {
      employeeId: "TEST-EMP-001",
      password: "Employee-temp-Password-123",
    });
    const profile = await client.get("/api/v1/me/profile");
    expect(profile.status).toBe(200);
    expect(profile.body.spouse?.spouseOccupation).toBe("Teacher");
  });

  it("keeps a single record: a second PUT updates it, and an identical PUT is a no-op", async () => {
    const same = await admin.put(spousePath(), {
      spouseName: "Fictional Spouse",
      spouseOccupation: "Teacher",
      spouseDateOfBirth: "1992-05-06",
      spouseNationalId: "9876543210123",
    });
    expect(same.status).toBe(200);
    expect(same.body.changed).toBe(false);

    const updated = await admin.put(spousePath(), {
      spouseName: "Fictional Spouse",
      spouseOccupation: "Engineer",
    });
    expect(updated.status).toBe(200);
    expect(updated.body.changed).toBe(true);
    // PUT replaces the record: omitted optional fields are cleared.
    expect(updated.body.spouse?.spouseOccupation).toBe("Engineer");
    expect(updated.body.spouse?.spouseDateOfBirth).toBeNull();
    expect(updated.body.spouse?.spouseNationalId).toBeNull();

    const count = await testPool.query(
      "SELECT count(*)::int AS count FROM employee_spouse WHERE employee_id = $1",
      [employeeRecordId],
    );
    expect(count.rows[0].count).toBe(1);
  });

  it("audits create and update without writing spouse values", async () => {
    const audit = await testPool.query(
      "SELECT action, metadata FROM audit_logs WHERE entity_type = 'employee_spouse' ORDER BY occurred_at",
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      "EMPLOYEE_SPOUSE_CREATED",
      "EMPLOYEE_SPOUSE_UPDATED",
    ]);
    expect([...audit.rows[1].metadata.changedFields].sort()).toEqual([
      "spouseDateOfBirth",
      "spouseNationalId",
      "spouseOccupation",
    ]);
    const serialized = JSON.stringify(audit.rows);
    expect(serialized).not.toContain("9876543210123");
    expect(serialized).not.toContain("Fictional Spouse");
  });

  it("validates the body: name required, unknown keys rejected, no future birth date", async () => {
    expect(
      (await admin.put(spousePath(), { spouseOccupation: "x" })).status,
    ).toBe(400);
    expect(
      (
        await admin.put(spousePath(), {
          spouseName: "A",
          employeeId: employeeRecordId,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin.put(spousePath(), {
          spouseName: "A",
          spouseDateOfBirth: "2999-01-01",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin.put(spousePath(), {
          spouseName: "A",
          spouseDateOfBirth: "not-a-date",
        })
      ).status,
    ).toBe(400);
  });

  it("blocks changing the marital status away from MARRIED while a spouse record exists", async () => {
    const blocked = await admin.patch(employeePath(), {
      maritalStatus: "SINGLE",
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error?.code).toBe("SPOUSE_RECORD_EXISTS");

    const deleted = await admin.delete(spousePath());
    expect(deleted.status).toBe(200);
    expect(deleted.body.deleted).toBe(true);

    const allowed = await admin.patch(employeePath(), {
      maritalStatus: "SINGLE",
    });
    expect(allowed.status).toBe(200);
    expect(allowed.body.employee?.maritalStatus).toBe("SINGLE");
  });

  it("returns 404 when deleting a missing spouse record or addressing an unknown employee", async () => {
    expect((await admin.delete(spousePath())).status).toBe(404);
    const unknown = "00000000-0000-4000-8000-000000000000";
    expect((await admin.get(spousePath(unknown))).status).toBe(404);
    expect(
      (await admin.put(spousePath(unknown), { spouseName: "A" })).status,
    ).toBe(404);
    expect((await admin.get(spousePath("not-a-uuid"))).status).toBe(400);
  });

  it("is Admin-only", async () => {
    const client = new ApiClient(baseUrl);
    await client.initializeCsrf();
    await client.post("/api/v1/auth/login", {
      employeeId: "TEST-EMP-001",
      password: "Employee-temp-Password-123",
    });
    expect((await client.get(spousePath())).status).toBe(403);
    expect((await client.put(spousePath(), { spouseName: "A" })).status).toBe(
      403,
    );
    expect((await client.delete(spousePath())).status).toBe(403);

    const anonymous = new ApiClient(baseUrl);
    await anonymous.initializeCsrf();
    expect((await anonymous.get(spousePath())).status).toBe(401);
  });
});
