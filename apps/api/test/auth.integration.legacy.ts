import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  createFixtures,
  prepareDatabase,
  closeDatabase,
  testPool,
} from "./helpers/database.js";

type JsonResponse = {
  [key: string]: unknown;
  error?: { code?: string; message?: string };
  user?: { id?: string; role?: string; mustChangePassword?: boolean };
  csrfToken?: string;
  dependencies?: { database?: string };
};

class ApiClient {
  private cookie = "";
  private csrfToken = "";
  constructor(private readonly baseUrl: string) {}

  async get(path: string) {
    return this.send("GET", path);
  }

  async post(path: string, body?: unknown, includeCsrf = true) {
    return this.send("POST", path, body, includeCsrf);
  }

  private async send(
    method: string,
    path: string,
    body?: unknown,
    includeCsrf = true,
  ) {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (this.cookie) headers.Cookie = this.cookie;
    if (includeCsrf && this.csrfToken) headers["X-CSRF-Token"] = this.csrfToken;
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) this.cookie = setCookie.split(";")[0];
    const payload = (await response.json().catch(() => ({}))) as JsonResponse;
    if (payload.csrfToken) this.csrfToken = payload.csrfToken;
    return {
      status: response.status,
      body: payload,
      headers: response.headers,
    };
  }

  async initializeCsrf() {
    const response = await this.get("/api/v1/auth/csrf");
    assert.equal(response.status, 200);
    assert.equal(typeof response.body.csrfToken, "string");
    this.csrfToken = response.body.csrfToken as string;
    return response;
  }
}

let baseUrl = "";
let server: Server;
let fixtures: Awaited<ReturnType<typeof createFixtures>>;

before(async () => {
  await prepareDatabase();
  fixtures = await createFixtures();
  const { default: app } = await import("../src/app.js");
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server)
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  await testPool.query('DELETE FROM "session"').catch(() => undefined);
  await closeDatabase();
});

test("API foundations and authentication lifecycle", async (t) => {
  await t.test("health endpoint reports a live API", async () => {
    const response = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      service: "ems-api",
    });
  });

  await t.test(
    "readiness endpoint confirms PostgreSQL connectivity",
    async () => {
      const response = await fetch(`${baseUrl}/api/v1/ready`);
      assert.equal(response.status, 200);
      assert.equal(
        ((await response.json()) as JsonResponse).dependencies?.database,
        "ok",
      );
    },
  );

  await t.test("unknown routes return a consistent 404", async () => {
    const response = await fetch(`${baseUrl}/api/v1/not-a-route`);
    assert.equal(response.status, 404);
    assert.equal(
      ((await response.json()) as JsonResponse).error?.code,
      "NOT_FOUND",
    );
  });

  await t.test(
    "requests from an unapproved browser origin are rejected",
    async () => {
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
      assert.equal(response.status, 403);
      assert.equal(
        ((await response.json()) as JsonResponse).error?.code,
        "ORIGIN_NOT_ALLOWED",
      );
    },
  );

  await t.test(
    "protected account endpoints reject unauthenticated requests",
    async () => {
      const client = new ApiClient(baseUrl);
      await client.initializeCsrf();
      const me = await client.get("/api/v1/auth/me");
      assert.equal(me.status, 401);
      assert.equal(me.body.error?.code, "UNAUTHENTICATED");
      const logout = await client.post("/api/v1/auth/logout");
      assert.equal(logout.status, 401);
      assert.equal(logout.body.error?.code, "UNAUTHENTICATED");
    },
  );

  await t.test(
    "CSRF endpoint issues a token and unsafe requests require it",
    async () => {
      const client = new ApiClient(baseUrl);
      await client.initializeCsrf();
      const missing = await client.post(
        "/api/v1/auth/login",
        { employeeId: "TEST-ADMIN-001", password: "wrong" },
        false,
      );
      assert.equal(missing.status, 403);
      assert.equal(missing.body.error?.code, "CSRF_TOKEN_MISSING");
      const invalid = await client.post("/api/v1/auth/login", {
        employeeId: "TEST-ADMIN-001",
        password: "wrong",
      });
      // The client has a valid token; the wrong credentials are rejected after CSRF validation.
      assert.equal(invalid.status, 401);
      assert.equal(invalid.body.error?.code, "INVALID_CREDENTIALS");
    },
  );

  await t.test(
    "login rejects malformed and invalid credentials without leaking account existence",
    async () => {
      const client = new ApiClient(baseUrl);
      await client.initializeCsrf();
      const malformed = await client.post("/api/v1/auth/login", {
        employeeId: "",
        password: "",
      });
      assert.equal(malformed.status, 400);
      assert.equal(malformed.body.error?.code, "VALIDATION_ERROR");
      const unknown = await client.post("/api/v1/auth/login", {
        employeeId: "NO-SUCH-ID",
        password: "incorrect-password",
      });
      const wrong = await client.post("/api/v1/auth/login", {
        employeeId: "TEST-ADMIN-001",
        password: "incorrect-password",
      });
      assert.equal(unknown.status, 401);
      assert.deepEqual(unknown.body, wrong.body);
      assert.equal(unknown.body.error?.code, "INVALID_CREDENTIALS");
    },
  );

  let adminClient: ApiClient | undefined;
  await t.test(
    "admin can sign in but is forced to change the seeded temporary password",
    async () => {
      adminClient = new ApiClient(baseUrl);
      await adminClient.initializeCsrf();
      const login = await adminClient.post("/api/v1/auth/login", {
        employeeId: "TEST-ADMIN-001",
        password: "Admin-temp-Password-123",
      });
      assert.equal(login.status, 200);
      assert.equal(login.body.user?.role, "ADMIN");
      assert.equal(login.body.user?.mustChangePassword, true);
      const me = await adminClient.get("/api/v1/auth/me");
      assert.equal(me.status, 200);
      assert.equal(me.body.user?.id, fixtures.adminUserId);
      const logoutBlocked = await adminClient.post("/api/v1/auth/logout");
      assert.equal(logoutBlocked.status, 200);
    },
  );

  await t.test(
    "first-login password change validates and updates the account",
    async () => {
      const client = new ApiClient(baseUrl);
      await client.initializeCsrf();
      const login = await client.post("/api/v1/auth/login", {
        employeeId: "TEST-ADMIN-001",
        password: "Admin-temp-Password-123",
      });
      assert.equal(login.status, 200);
      const invalid = await client.post(
        "/api/v1/auth/first-login/change-password",
        { newPassword: "short" },
      );
      assert.equal(invalid.status, 400);
      assert.equal(invalid.body.error?.code, "VALIDATION_ERROR");
      const changed = await client.post(
        "/api/v1/auth/first-login/change-password",
        {
          newPassword: "Admin-new-Password-456",
        },
      );
      assert.equal(changed.status, 200);
      assert.equal(typeof changed.body.csrfToken, "string");
      const me = await client.get("/api/v1/auth/me");
      assert.equal(me.status, 200);
      assert.equal(me.body.user?.mustChangePassword, false);
      const dbUser = await testPool.query(
        "SELECT must_change_password FROM users WHERE id = $1",
        [fixtures.adminUserId],
      );
      assert.equal(dbUser.rows[0].must_change_password, false);
      const audit = await testPool.query(
        "SELECT count(*)::int AS count FROM audit_logs WHERE actor_user_id = $1 AND action = 'PASSWORD_CHANGED'",
        [fixtures.adminUserId],
      );
      assert.equal(audit.rows[0].count, 1);
      adminClient = client;
    },
  );

  await t.test(
    "employee accounts cannot access admin password reset",
    async () => {
      const client = new ApiClient(baseUrl);
      await client.initializeCsrf();
      const login = await client.post("/api/v1/auth/login", {
        employeeId: "TEST-EMP-001",
        password: "Employee-temp-Password-123",
      });
      assert.equal(login.status, 200);
      const forbidden = await client.post(
        `/api/v1/admin/employees/${fixtures.employeeRecordId}/password-reset`,
        {},
      );
      assert.equal(forbidden.status, 403);
      assert.equal(forbidden.body.error?.code, "FORBIDDEN");
    },
  );

  await t.test(
    "completed-password admin session can reset an employee password",
    async () => {
      assert.ok(adminClient);
      const response = await adminClient.post(
        `/api/v1/admin/employees/${fixtures.employeeRecordId}/password-reset`,
        {},
      );
      assert.equal(response.status, 200);
      assert.equal(typeof response.body.temporaryPassword, "string");
      assert.equal(response.body.mustChangePassword, true);
      const row = await testPool.query(
        "SELECT must_change_password FROM users WHERE id = $1",
        [fixtures.employeeUserId],
      );
      assert.equal(row.rows[0].must_change_password, true);
      const audit = await testPool.query(
        "SELECT count(*)::int AS count FROM audit_logs WHERE action = 'EMPLOYEE_PASSWORD_RESET' AND entity_id = $1",
        [fixtures.employeeUserId],
      );
      assert.equal(audit.rows[0].count, 1);

      const employeeClient = new ApiClient(baseUrl);
      await employeeClient.initializeCsrf();
      const login = await employeeClient.post("/api/v1/auth/login", {
        employeeId: "TEST-EMP-001",
        password: response.body.temporaryPassword,
      });
      assert.equal(login.status, 200);
      assert.equal(login.body.user?.mustChangePassword, true);
      const firstChange = await employeeClient.post(
        "/api/v1/auth/first-login/change-password",
        {
          newPassword: "Employee-new-Password-456",
        },
      );
      assert.equal(firstChange.status, 200);
      const normalChange = await employeeClient.post(
        "/api/v1/auth/change-password",
        {
          currentPassword: "Employee-new-Password-456",
          newPassword: "Employee-final-Password-789",
        },
      );
      assert.equal(normalChange.status, 200);
      const passwordCheck = await testPool.query(
        "SELECT password_hash, must_change_password FROM users WHERE id = $1",
        [fixtures.employeeUserId],
      );
      assert.equal(passwordCheck.rows[0].must_change_password, false);
      assert.equal(
        await (
          await import("bcrypt")
        ).default.compare(
          "Employee-final-Password-789",
          passwordCheck.rows[0].password_hash,
        ),
        true,
      );
    },
  );

  await t.test("admin cannot reset a non-active employee account", async () => {
    assert.ok(adminClient);
    await testPool.query(
      "UPDATE employees SET employment_status = 'SUSPENDED' WHERE id = $1",
      [fixtures.employeeRecordId],
    );
    const response = await adminClient.post(
      `/api/v1/admin/employees/${fixtures.employeeRecordId}/password-reset`,
      {},
    );
    assert.equal(response.status, 409);
    assert.equal(response.body.error?.code, "EMPLOYEE_NOT_ACTIVE");
    await testPool.query(
      "UPDATE employees SET employment_status = 'ACTIVE' WHERE id = $1",
      [fixtures.employeeRecordId],
    );
  });

  await t.test(
    "password reset rejects malformed and unknown employee record IDs",
    async () => {
      assert.ok(adminClient);
      const malformed = await adminClient.post(
        "/api/v1/admin/employees/not-a-uuid/password-reset",
        {},
      );
      assert.equal(malformed.status, 400);
      const missing = await adminClient.post(
        "/api/v1/admin/employees/00000000-0000-4000-8000-000000000000/password-reset",
        {},
      );
      assert.equal(missing.status, 404);
      assert.equal(missing.body.error?.code, "EMPLOYEE_ACCOUNT_NOT_FOUND");
    },
  );

  await t.test(
    "logout destroys the session and protected endpoints reject it",
    async () => {
      const client = new ApiClient(baseUrl);
      await client.initializeCsrf();
      const login = await client.post("/api/v1/auth/login", {
        employeeId: "TEST-ADMIN-001",
        password: "Admin-new-Password-456",
      });
      assert.equal(login.status, 200);
      const logout = await client.post("/api/v1/auth/logout");
      assert.equal(logout.status, 200);
      const me = await client.get("/api/v1/auth/me");
      assert.equal(me.status, 401);
    },
  );

  await t.test(
    "login rate limiter blocks the eleventh request from the same client IP",
    async () => {
      // Nine earlier login requests have already passed through this limiter.
      // The tenth should pass; the eleventh must be blocked.
      const client = new ApiClient(baseUrl);
      await client.initializeCsrf();
      let lastStatus = 0;
      for (let index = 0; index < 2; index += 1) {
        const response = await client.post("/api/v1/auth/login", {
          employeeId: "RATE-LIMIT-UNKNOWN",
          password: "incorrect-password",
        });
        lastStatus = response.status;
        if (index < 1) assert.equal(lastStatus, 401);
      }
      assert.equal(lastStatus, 429);
    },
  );
});
