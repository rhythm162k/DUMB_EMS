import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApiClient, startTestApi, stopTestApi } from "./helpers/server.js";
import type { Server } from "node:http";

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

describe("API foundations and request security", () => {
  it("reports a live API from the health endpoint", async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("confirms PostgreSQL connectivity from the readiness endpoint", async () => {
    const response = await fetch(`${baseUrl}/api/v1/ready`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
  });

  it("returns a consistent 404 for unknown routes", async () => {
    const response = await fetch(`${baseUrl}/api/v1/not-a-route`);
    expect(response.status).toBe(404);
    expect(
      ((await response.json()) as { error?: { code?: string } }).error?.code,
    ).toBe("NOT_FOUND");
  });

  it("rejects requests from an unapproved browser origin", async () => {
    const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: {
        Origin: "https://untrusted.example",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        employeeId: "TEST-ADMIN-001",
        password: "incorrect-password",
      }),
    });
    expect(response.status).toBe(403);
    expect(
      ((await response.json()) as { error?: { code?: string } }).error?.code,
    ).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("rejects unauthenticated access to protected account endpoints", async () => {
    const client = new ApiClient(baseUrl);
    await client.initializeCsrf();
    const me = await client.get("/api/v1/auth/me");
    expect(me.status).toBe(401);
    expect(me.body.error?.code).toBe("UNAUTHENTICATED");
    const logout = await client.post("/api/v1/auth/logout");
    expect(logout.status).toBe(401);
    expect(logout.body.error?.code).toBe("UNAUTHENTICATED");
  });

  it("issues a CSRF token and rejects unsafe requests without it", async () => {
    const client = new ApiClient(baseUrl);
    const csrf = await client.initializeCsrf();
    expect(typeof csrf.body.csrfToken).toBe("string");
    const missing = await client.post(
      "/api/v1/auth/login",
      {
        employeeId: "TEST-ADMIN-001",
        password: "wrong",
      },
      false,
    );
    expect(missing.status).toBe(403);
    expect(missing.body.error?.code).toBe("CSRF_TOKEN_MISSING");
    const invalid = await client.post("/api/v1/auth/login", {
      employeeId: "TEST-ADMIN-001",
      password: "wrong",
    });
    expect(invalid.status).toBe(401);
    expect(invalid.body.error?.code).toBe("INVALID_CREDENTIALS");
  });

  it("answers malformed and oversized JSON bodies with client errors", async () => {
    const malformed = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not valid json",
    });
    expect(malformed.status).toBe(400);
    expect(
      ((await malformed.json()) as { error?: { code?: string } }).error?.code,
    ).toBe("VALIDATION_ERROR");

    const oversized = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId: "x", password: "y".repeat(70_000) }),
    });
    expect(oversized.status).toBe(413);
    expect(
      ((await oversized.json()) as { error?: { code?: string } }).error?.code,
    ).toBe("PAYLOAD_TOO_LARGE");
  });

  it("validates login input without revealing whether an account exists", async () => {
    const client = new ApiClient(baseUrl);
    await client.initializeCsrf();
    const malformed = await client.post("/api/v1/auth/login", {
      employeeId: "",
      password: "",
    });
    expect(malformed.status).toBe(400);
    expect(malformed.body.error?.code).toBe("VALIDATION_ERROR");
    const unknown = await client.post("/api/v1/auth/login", {
      employeeId: "NO-SUCH-ID",
      password: "incorrect-password",
    });
    const wrong = await client.post("/api/v1/auth/login", {
      employeeId: "TEST-ADMIN-001",
      password: "incorrect-password",
    });
    expect(unknown.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(unknown.body.error?.code).toBe("INVALID_CREDENTIALS");
  });
});
