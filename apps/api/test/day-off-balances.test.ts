import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import {
  ApiClient,
  signInAndCompleteAdminPasswordChange,
  startTestApi,
  stopTestApi,
} from "./helpers/server.js";
import { testPool } from "./helpers/database.js";
import { summarizeDayOff } from "../src/leave/balance.js";

let server: Server;
let admin: ApiClient;
let owner: ApiClient;
let anonymous: ApiClient;
let employeeId: string;
let typeId: string;
let asOf: string;
let joining: string;
let weekdayDates: string[];
let leaveId: string;
const balancePath = "/api/v1/me/day-off-balance";
const adminPath = "/api/v1/admin/day-off-balances";
const readBalance = async () =>
  (await owner.get(balancePath)).body.balance as Record<string, unknown>;

beforeAll(async () => {
  const setup = await startTestApi();
  server = setup.server;
  employeeId = setup.fixtures.employeeRecordId;
  admin = await signInAndCompleteAdminPasswordChange(setup.baseUrl);
  owner = new ApiClient(setup.baseUrl);
  anonymous = new ApiClient(setup.baseUrl);
  await owner.initializeCsrf();
  expect(
    (
      await owner.post("/api/v1/auth/login", {
        employeeId: "TEST-EMP-001",
        password: "Employee-temp-Password-123",
      })
    ).status,
  ).toBe(200);
  typeId = (
    await admin.post("/api/v1/admin/leave-types", {
      code: "DAYOFF",
      nameEn: "Day off",
    })
  ).body.id as string;
  const clock = await testPool.query<{ today: string; joining: string }>(
    `SELECT to_char((NOW() AT TIME ZONE 'Asia/Dhaka')::date, 'YYYY-MM-DD') AS today, to_char((NOW() AT TIME ZONE 'Asia/Dhaka')::date - 60, 'YYYY-MM-DD') AS joining`,
  );
  asOf = clock.rows[0].today;
  joining = clock.rows[0].joining;
  weekdayDates = [];
  for (
    let d = Date.parse(joining + "T00:00:00Z");
    d <= Date.parse(asOf + "T00:00:00Z");
    d += 86400000
  ) {
    const day = new Date(d);
    if (![5, 6].includes(day.getUTCDay()))
      weekdayDates.push(day.toISOString().slice(0, 10));
  }
});
afterAll(async () => {
  if (server) await stopTestApi(server);
});

describe("Day-off accrual", () => {
  it("earns only whole credits, carries progress and allows borrowing", () => {
    expect(summarizeDayOff(0, 0)).toMatchObject({
      earnedDays: 0,
      workdaysUntilNext: 11,
    });
    expect(summarizeDayOff(10, 0)).toMatchObject({
      earnedDays: 0,
      progressDays: 10,
      workdaysUntilNext: 1,
    });
    expect(summarizeDayOff(11, 0)).toMatchObject({
      earnedDays: 1,
      progressDays: 0,
    });
    expect(summarizeDayOff(33, 0)).toMatchObject({
      earnedDays: 3,
      balanceDays: 3,
    });
    expect(summarizeDayOff(33, 5)).toMatchObject({
      earnedDays: 3,
      takenDays: 5,
      balanceDays: -2,
      advanceDays: 2,
    });
  });
  it("protects admin access and scopes employee data regardless of supplied IDs", async () => {
    expect((await anonymous.get(balancePath)).status).toBe(401);
    expect((await anonymous.get(adminPath)).status).toBe(401);
    expect((await owner.get(adminPath)).status).toBe(403);
    const response = await owner.get(
      balancePath + "?employeeId=00000000-0000-4000-8000-000000000000",
    );
    expect(response.status).toBe(200);
    expect(response.body.balance).toMatchObject({
      employeeId,
      joiningDate: null,
      earnedDays: null,
      balanceDays: null,
    });
    expect((await admin.get(adminPath + "?page=0")).status).toBe(400);
  });
  it("counts from joining across calendar months, excluding Fridays/Saturdays and public holidays", async () => {
    await testPool.query("UPDATE employees SET joining_date=$2 WHERE id=$1", [
      employeeId,
      joining,
    ]);
    expect(
      (
        await admin.post("/api/v1/admin/holidays", {
          holidayDate: weekdayDates[0],
          nameEn: "Test public holiday",
        })
      ).status,
    ).toBe(201);
    const balance = await readBalance();
    expect(balance).toMatchObject({
      asOf,
      joiningDate: joining,
      ...summarizeDayOff(weekdayDates.length - 1, 0),
    });
    const list = await admin.get(adminPath + "?q=TEST-EMP-001&pageSize=1");
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items?.[0]).toMatchObject(balance);
    expect((await admin.get(adminPath + "?q=no-match")).body.items).toEqual([]);
  });
  it("does not double-exclude holidays on weekends, nor accrue before a future joining date", async () => {
    const start = Date.parse(joining + "T00:00:00Z");
    const friday = new Date(
      start + ((5 - new Date(start).getUTCDay() + 7) % 7) * 86400000,
    )
      .toISOString()
      .slice(0, 10);
    expect(
      (
        await admin.post("/api/v1/admin/holidays", {
          holidayDate: friday,
          nameEn: "Test Friday holiday",
        })
      ).status,
    ).toBe(201);
    expect((await readBalance()).workedDays).toBe(weekdayDates.length - 1);
    await testPool.query(
      "UPDATE employees SET joining_date=$2::date+1 WHERE id=$1",
      [employeeId, asOf],
    );
    expect(await readBalance()).toMatchObject({
      workedDays: 0,
      earnedDays: 0,
      takenDays: 0,
      balanceDays: 0,
    });
    await testPool.query("UPDATE employees SET joining_date=$2 WHERE id=$1", [
      employeeId,
      joining,
    ]);
  });
  it("deducts all leave types, excludes leave from accrual and permits negative credit", async () => {
    const leave = await admin.post("/api/v1/admin/leaves", {
      employeeId,
      leaveTypeId: typeId,
      startDate: weekdayDates[1],
      endDate: weekdayDates[8],
    });
    expect(leave.status).toBe(201);
    expect(leave.body.dayCount).toBe(8);
    leaveId = leave.body.id as string;
    expect(await readBalance()).toMatchObject(
      summarizeDayOff(weekdayDates.length - 9, 8),
    );
    expect(Number((await readBalance()).balanceDays)).toBeLessThan(0);
    const otherType = await admin.post("/api/v1/admin/leave-types", {
      code: "SICKTEST",
      nameEn: "Sick test",
    });
    expect(
      (
        await admin.post("/api/v1/admin/leaves", {
          employeeId,
          leaveTypeId: otherType.body.id,
          startDate: weekdayDates[9],
          endDate: weekdayDates[9],
        })
      ).status,
    ).toBe(201);
    expect((await readBalance()).takenDays).toBe(9);
  });
  it("updates balances after corrections and cancellations", async () => {
    expect(
      (
        await admin.patch(`/api/v1/admin/leaves/${leaveId}`, {
          leaveTypeId: typeId,
          startDate: weekdayDates[1],
          endDate: weekdayDates[1],
          reason: "Correct duration",
        })
      ).status,
    ).toBe(200);
    expect((await readBalance()).takenDays).toBe(2);
    expect(
      (
        await admin.post(`/api/v1/admin/leaves/${leaveId}/cancel`, {
          reason: "Not taken",
        })
      ).status,
    ).toBe(200);
    expect(await readBalance()).toMatchObject(
      summarizeDayOff(weekdayDates.length - 2, 1),
    );
  });
  it("keeps future leave separate and excludes holiday/weekend-only leave", async () => {
    let date = new Date(asOf + "T00:00:00Z");
    date = new Date(date.getTime() + 86400000);
    while ([5, 6].includes(date.getUTCDay()))
      date = new Date(date.getTime() + 86400000);
    const future = date.toISOString().slice(0, 10);
    expect(
      (
        await admin.post("/api/v1/admin/leaves", {
          employeeId,
          leaveTypeId: typeId,
          startDate: future,
          endDate: future,
        })
      ).status,
    ).toBe(201);
    expect(await readBalance()).toMatchObject({
      scheduledDays: 1,
      takenDays: 1,
    });
    expect(
      (
        await admin.post("/api/v1/admin/leaves", {
          employeeId,
          leaveTypeId: typeId,
          startDate: weekdayDates[0],
          endDate: weekdayDates[0],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin.post("/api/v1/admin/leaves", {
          employeeId,
          leaveTypeId: typeId,
          startDate: "2030-04-05",
          endDate: "2030-04-06",
        })
      ).status,
    ).toBe(400);
  });
});
