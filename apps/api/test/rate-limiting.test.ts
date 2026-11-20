import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { ApiClient, startTestApi, stopTestApi } from "./helpers/server.js";

let baseUrl = "";
let server: Server;

beforeAll(async () => {
  const setup = await startTestApi();
  baseUrl = setup.baseUrl;
  server = setup.server;
});

afterAll(async () => {
  if (server) await stopTestApi(server);
});

describe("Authentication rate limiting", () => {
  it("does not count successful sign-ins toward the limit", async () => {
    // Staff behind one shared IP must be able to sign in more than ten times.
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      const client = new ApiClient(baseUrl);
      await client.initializeCsrf();
      const response = await client.post("/api/v1/auth/login", {
        employeeId: "TEST-EMP-001",
        password: "Employee-temp-Password-123",
      });
      expect(response.status, `successful login ${attempt}`).toBe(200);
    }
  });

  it("allows ten failed login attempts and blocks the eleventh from the same IP", async () => {
    const client = new ApiClient(baseUrl);
    await client.initializeCsrf();

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const response = await client.post("/api/v1/auth/login", {
        employeeId: `UNKNOWN-${attempt}`,
        password: "incorrect-password",
      });
      expect(response.status, `login attempt ${attempt}`).toBe(401);
    }

    const blocked = await client.post("/api/v1/auth/login", {
      employeeId: "UNKNOWN-11",
      password: "incorrect-password",
    });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error?.code).toBe("LOGIN_RATE_LIMITED");
  });
});
