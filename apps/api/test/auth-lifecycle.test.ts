import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { ApiClient, startTestApi, stopTestApi } from "./helpers/server.js";
import { testPool } from "./helpers/database.js";

let baseUrl = "";
let server: Server;
let adminUserId = "";

beforeAll(async () => {
  const setup = await startTestApi();
  baseUrl = setup.baseUrl;
  server = setup.server;
  adminUserId = setup.fixtures.adminUserId;
});

afterAll(async () => {
  if (server) await stopTestApi(server);
});

describe("Authentication and session lifecycle", () => {
  it("allows an admin to sign in but requires a first-login password change", async () => {
    const client = new ApiClient(baseUrl);
    await client.initializeCsrf();
    const login = await client.post("/api/v1/auth/login", {
      employeeId: "TEST-ADMIN-001",
      password: "Admin-temp-Password-123",
    });
    expect(login.status).toBe(200);
    expect(login.body.user?.role).toBe("ADMIN");
    expect(login.body.user?.mustChangePassword).toBe(true);
    const me = await client.get("/api/v1/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user?.id).toBe(adminUserId);
    const logout = await client.post("/api/v1/auth/logout");
    expect(logout.status).toBe(200);
  });

  it("validates and completes the first-login password change", async () => {
    const client = new ApiClient(baseUrl);
    await client.initializeCsrf();
    const login = await client.post("/api/v1/auth/login", {
      employeeId: "TEST-ADMIN-001",
      password: "Admin-temp-Password-123",
    });
    expect(login.status).toBe(200);
    const invalid = await client.post(
      "/api/v1/auth/first-login/change-password",
      { newPassword: "short" },
    );
    expect(invalid.status).toBe(400);
    expect(invalid.body.error?.code).toBe("VALIDATION_ERROR");
    const changed = await client.post(
      "/api/v1/auth/first-login/change-password",
      {
        newPassword: "Admin-new-Password-456",
      },
    );
    expect(changed.status).toBe(200);
    expect(typeof changed.body.csrfToken).toBe("string");
    const me = await client.get("/api/v1/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user?.mustChangePassword).toBe(false);
    const dbUser = await testPool.query(
      "SELECT must_change_password FROM users WHERE id = $1",
      [adminUserId],
    );
    expect(dbUser.rows[0].must_change_password).toBe(false);
    const audit = await testPool.query(
      "SELECT count(*)::int AS count FROM audit_logs WHERE actor_user_id = $1 AND action = 'PASSWORD_CHANGED'",
      [adminUserId],
    );
    expect(audit.rows[0].count).toBe(1);
  });

  it("destroys the session on logout", async () => {
    const client = new ApiClient(baseUrl);
    await client.initializeCsrf();
    const login = await client.post("/api/v1/auth/login", {
      employeeId: "TEST-ADMIN-001",
      password: "Admin-new-Password-456",
    });
    expect(login.status).toBe(200);
    const logout = await client.post("/api/v1/auth/logout");
    expect(logout.status).toBe(200);
    const me = await client.get("/api/v1/auth/me");
    expect(me.status).toBe(401);
  });
});
