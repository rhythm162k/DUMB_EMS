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
let baseUrl = "";
let employeeId = "";
let admin: ApiClient;
let owner: ApiClient;
let leaveTypeId = "";
const submit = (body: object) => owner.post("/api/v1/me/change-requests", body);
const decide = (id: unknown, action: string, reason?: string) =>
  admin.post(`/api/v1/admin/change-requests/${id}/decision`, {
    action,
    ...(reason ? { reason } : {}),
  });
beforeAll(async () => {
  const setup = await startTestApi();
  server = setup.server;
  baseUrl = setup.baseUrl;
  employeeId = setup.fixtures.employeeRecordId;
  admin = await signInAndCompleteAdminPasswordChange(baseUrl);
  owner = new ApiClient(baseUrl);
  await owner.initializeCsrf();
  expect(
    (
      await owner.post("/api/v1/auth/login", {
        employeeId: "TEST-EMP-001",
        password: "Employee-temp-Password-123",
      })
    ).status,
  ).toBe(200);
  leaveTypeId = (
    await admin.post("/api/v1/admin/leave-types", {
      code: "DEMO",
      nameEn: "Demo leave",
    })
  ).body.id as string;
});
afterAll(async () => {
  if (server) await stopTestApi(server);
});
describe("Change approval workflow", () => {
  it("keeps proposals separate until approval and prevents a second decision", async () => {
    const p = await submit({
      targetRecordType: "PROFILE",
      operation: "UPDATE",
      fieldKey: "phone",
      proposedValue: "0123456789",
    });
    expect(p.status).toBe(201);
    expect(
      (await owner.get("/api/v1/me/profile")).body.profile?.phone,
    ).toBeNull();
    expect((await decide(p.body.id, "APPROVE")).status).toBe(200);
    expect((await owner.get("/api/v1/me/profile")).body.profile?.phone).toBe(
      "0123456789",
    );
    expect((await decide(p.body.id, "APPROVE")).status).toBe(409);
    const listed = await admin.get(
      "/api/v1/admin/change-requests?status=APPROVED",
    );
    const reviewed = listed.body.items?.find(
      (item: { id: string }) => item.id === p.body.id,
    );
    expect(reviewed?.reviewedAt).toBeTruthy();
    expect(typeof reviewed?.reviewedByName).toBe("string");
    expect(typeof reviewed?.reviewedByOfficialId).toBe("string");
  });
  it("protects identity fields and rejects stale proposals without overwriting", async () => {
    expect(
      (
        await submit({
          targetRecordType: "PROFILE",
          operation: "UPDATE",
          fieldKey: "nationalId",
          proposedValue: "forbidden",
        })
      ).status,
    ).toBe(400);
    const p = await submit({
      targetRecordType: "PROFILE",
      operation: "UPDATE",
      fieldKey: "designation",
      proposedValue: "Proposed",
    });
    expect(p.status).toBe(201);
    await testPool.query(
      "UPDATE employees SET designation='New official value' WHERE id=$1",
      [employeeId],
    );
    expect((await decide(p.body.id, "APPROVE")).status).toBe(409);
    expect((await decide(p.body.id, "REJECT")).status).toBe(400);
    expect(
      (await decide(p.body.id, "REJECT", "Record changed; submit again."))
        .status,
    ).toBe(200);
    expect(
      (await owner.get("/api/v1/me/profile")).body.profile?.designation,
    ).toBe("New official value");
  });
  it("supports withdrawal and blocks employee review endpoints", async () => {
    const p = await submit({
      targetRecordType: "PROFILE",
      operation: "UPDATE",
      fieldKey: "religion",
      proposedValue: "Demo value",
    });
    expect(p.status).toBe(201);
    expect(
      (
        await owner.post(
          `/api/v1/admin/change-requests/${p.body.id}/decision`,
          { action: "APPROVE" },
        )
      ).status,
    ).toBe(403);
    expect(
      (await owner.post(`/api/v1/me/change-requests/${p.body.id}/withdraw`))
        .status,
    ).toBe(200);
    expect((await decide(p.body.id, "APPROVE")).status).toBe(409);
  });
  it("creates a spouse through approval and refuses overwriting an existing spouse", async () => {
    const p = await submit({
      targetRecordType: "SPOUSE",
      operation: "CREATE",
      proposedValue: { spouseName: "Fictional spouse" },
    });
    expect(p.status).toBe(201);
    expect((await owner.get("/api/v1/me/profile")).body.spouse).toBeNull();
    expect((await decide(p.body.id, "APPROVE")).status).toBe(200);
    expect(
      (await owner.get("/api/v1/me/profile")).body.spouse?.spouseName,
    ).toBe("Fictional spouse");
    expect(
      (
        await submit({
          targetRecordType: "SPOUSE",
          operation: "CREATE",
          proposedValue: { spouseName: "Other" },
        })
      ).status,
    ).toBe(409);
  });
  it("approves field-based PDS requests and enforces record ownership", async () => {
    const p = await submit({
      targetRecordType: "PDS",
      section: "qualifications",
      operation: "CREATE",
      proposedValue: {
        institution: "Full institution name longer than ten characters",
        degree: "Bachelor degree",
      },
    });
    expect(p.status).toBe(201);
    expect((await decide(p.body.id, "APPROVE")).status).toBe(200);
    const records =
      (await owner.get("/api/v1/me/profile")).body.records
        ?.academicQualifications ?? [];
    expect(records[0]?.institution).toBe(
      "Full institution name longer than ten characters",
    );
    expect(
      (
        await submit({
          targetRecordType: "PDS",
          section: "qualifications",
          operation: "UPDATE",
          targetRecordId: "00000000-0000-4000-8000-000000000000",
          fieldKey: "degree",
          proposedValue: "Other",
        })
      ).status,
    ).toBe(404);
  });
});
describe("Leave calculation and isolation", () => {
  it("counts inclusive days, excludes configured holidays and preserves their snapshot", async () => {
    const holiday = await admin.post("/api/v1/admin/holidays", {
      holidayDate: "2030-04-02",
      nameEn: "Fictional test holiday",
      sourceNote: "Automated test only",
    });
    expect(holiday.status).toBe(201);
    const r = await admin.post("/api/v1/admin/leaves", {
      employeeId,
      leaveTypeId,
      startDate: "2030-04-01",
      endDate: "2030-04-03",
    });
    expect(r.status).toBe(201);
    expect(r.body.dayCount).toBe(2);
    expect(r.body.excludedHolidays).toEqual(["2030-04-02"]);
    expect(
      (await admin.delete(`/api/v1/admin/holidays/${holiday.body.id}`)).status,
    ).toBe(200);
    expect(
      (
        await testPool.query(
          "SELECT day_count::int AS days FROM leave_records WHERE id=$1",
          [r.body.id],
        )
      ).rows[0]?.days,
    ).toBe(2);
    expect(
      (
        await testPool.query(
          "SELECT * FROM leave_holiday_snapshots WHERE leave_record_id=$1",
          [r.body.id],
        )
      ).rowCount,
    ).toBe(1);
  });
  it("blocks overlap and employee writes; requires reasons for corrections and cancellations", async () => {
    const body = {
      employeeId,
      leaveTypeId,
      startDate: "2030-04-01",
      endDate: "2030-04-02",
    };
    expect((await admin.post("/api/v1/admin/leaves", body)).status).toBe(409);
    expect((await owner.post("/api/v1/admin/leaves", body)).status).toBe(403);
    const id = (
      await testPool.query(
        "SELECT id FROM leave_records WHERE employee_id=$1",
        [employeeId],
      )
    ).rows[0].id;
    expect(
      (
        await admin.patch(`/api/v1/admin/leaves/${id}`, {
          leaveTypeId,
          startDate: "2030-04-07",
          endDate: "2030-04-08",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin.patch(`/api/v1/admin/leaves/${id}`, {
          leaveTypeId,
          startDate: "2030-04-07",
          endDate: "2030-04-08",
          reason: "Corrected demo dates",
        })
      ).status,
    ).toBe(200);
    expect(
      (await admin.post(`/api/v1/admin/leaves/${id}/cancel`, {})).status,
    ).toBe(400);
    expect(
      (
        await admin.post(`/api/v1/admin/leaves/${id}/cancel`, {
          reason: "Cancelled demo record",
        })
      ).status,
    ).toBe(200);
    const audit = await testPool.query(
      "SELECT action FROM audit_logs WHERE action IN ('LEAVE_CREATED','LEAVE_CORRECTED','LEAVE_CANCELLED') ORDER BY occurred_at",
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "LEAVE_CREATED",
      "LEAVE_CORRECTED",
      "LEAVE_CANCELLED",
    ]);
  });
  it("returns only the signed-in employee’s leave records regardless of supplied IDs", async () => {
    const r = await owner.get(
      "/api/v1/me/leaves?employeeId=00000000-0000-4000-8000-000000000000",
    );
    expect(r.status).toBe(200);
    expect(r.body.items?.every((item) => item.employeeId === employeeId)).toBe(
      true,
    );
  });
});
