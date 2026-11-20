import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import {
  ApiClient,
  signInAndCompleteAdminPasswordChange,
  startTestApi,
  stopTestApi,
} from "./helpers/server.js";

let server: Server;
let baseUrl: string;
let adminId: string;
let employeeId: string;
let admin: ApiClient;

beforeAll(async () => {
  const setup = await startTestApi();
  server = setup.server;
  baseUrl = setup.baseUrl;
  adminId = setup.fixtures.adminEmployeeRecordId;
  employeeId = setup.fixtures.employeeRecordId;
  admin = await signInAndCompleteAdminPasswordChange(baseUrl);
});
afterAll(async () => {
  if (server) await stopTestApi(server);
});

describe("Admin own profile", () => {
  it("resolves the admin profile from the session and ignores supplied IDs", async () => {
    const result = await admin.get(
      `/api/v1/me/profile?employeeId=${employeeId}`,
    );
    expect(result.status).toBe(200);
    expect(result.body.profile?.id).toBe(adminId);
    expect(result.body.profile).not.toHaveProperty("account");
    expect(result.body.records).toBeDefined();
  });

  it("saves personal details without changing the admin role or login ID", async () => {
    const result = await admin.patch(`/api/v1/admin/employees/${adminId}`, {
      firstNameEn: "Updated Admin",
      phone: "01712345678",
      presentAddress: "Patuakhali",
      designation: "Administrator",
    });
    expect(result.status).toBe(200);
    const profile = await admin.get("/api/v1/me/profile");
    expect(profile.body.profile?.firstNameEn).toBe("Updated Admin");
    expect(profile.body.profile?.phone).toBe("01712345678");
    expect(profile.body.profile?.officialEmployeeId).toBe("TEST-ADMIN-001");
    expect(result.body.employee?.account?.role).toBe("ADMIN");
    expect(
      (
        await admin.patch(`/api/v1/admin/employees/${adminId}/status`, {
          employmentStatus: "RESIGNED",
        })
      ).status,
    ).toBe(409);
  });

  it("uploads and removes the admin photo while denying employee access", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7x8AAAAASUVORK5CYII=",
      "base64",
    );
    const path = `/api/v1/admin/employees/${adminId}/profile-image`;
    const upload = await admin.postBinary(path, png, "image/png");
    expect(upload.status).toBe(200);
    const url = upload.body.profileImageUrl!;
    expect(
      (await admin.get("/api/v1/me/profile")).body.profile?.profileImageUrl,
    ).toBe(url);
    expect((await admin.getBinary(url)).status).toBe(200);
    const employee = new ApiClient(baseUrl);
    await employee.initializeCsrf();
    await employee.post("/api/v1/auth/login", {
      employeeId: "TEST-EMP-001",
      password: "Employee-temp-Password-123",
    });
    expect((await employee.getBinary(url)).status).toBe(404);
    expect(
      (
        await employee.patch(`/api/v1/admin/employees/${adminId}`, {
          firstNameEn: "Forbidden",
        })
      ).status,
    ).toBe(403);
    expect((await employee.get("/api/v1/me/profile")).body.profile?.id).toBe(
      employeeId,
    );
    expect((await admin.delete(path)).status).toBe(200);
    expect(
      (await admin.get("/api/v1/me/profile")).body.profile?.profileImageUrl,
    ).toBeNull();
  });
});
