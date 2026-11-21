import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { createTestHarness } from "wrangler";

const server = createTestHarness({
  workers: [{ configPath: new URL("wrangler.jsonc", import.meta.url) }],
});
let url;
let db;
const worker = server.getWorker("dumb-ems");

before(async () => {
  ({ url } = await server.listen());
  await worker.applyD1Migrations("DB");
  ({ DB: db } = await worker.getEnv());
});
after(() => server.close());

const fixtureId = (n) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const templateId = "00000000-0000-0000-0000-000000000000";
let clientAddress = 10;

function visitor(address = `192.0.2.${clientAddress++}`) {
  let cookie;
  let csrf;
  return {
    credentials: () => ({ cookie, csrf }),
    request(
      path,
      {
        method = "GET",
        body,
        version,
        raw,
        mime,
        credentials = { cookie, csrf },
        origin = url.origin,
      } = {},
    ) {
      const headers = { "CF-Connecting-IP": address };
      if (credentials.cookie) headers.Cookie = credentials.cookie;
      if (credentials.csrf && method !== "GET")
        headers["X-CSRF-Token"] = credentials.csrf;
      if (method !== "GET" && origin) headers.Origin = origin;
      if (body !== undefined) headers["Content-Type"] = "application/json";
      if (version !== undefined) headers["If-Match"] = String(version);
      if (raw) headers["Content-Type"] = mime;
      return server.fetch(`/api/v1${path}`, {
        method,
        headers,
        ...(raw
          ? { body: raw }
          : body !== undefined && { body: JSON.stringify(body) }),
      });
    },
    async select(persona) {
      return this.adopt(
        await this.request("/demo/session", {
          method: "POST",
          body: { persona },
        }),
      );
    },
    async adopt(response) {
      if (response.status !== 200)
        assert.fail(
          `Unexpected status ${response.status}: ${await response.text()}`,
        );
      const header = response.headers.getSetCookie()[0];
      assert.match(header, /^__Host-ems-demo=[A-Za-z0-9_-]{43};/);
      for (const attribute of [
        "Path=/",
        "HttpOnly",
        "Secure",
        "SameSite=Lax",
      ]) {
        assert.ok(header.split("; ").includes(attribute), attribute);
      }
      assert.doesNotMatch(header, /Domain=/i);
      cookie = header.split(";")[0];
      const body = await response.json();
      csrf = body.csrfToken;
      return body;
    },
  };
}

async function verifyError(response, status, code) {
  assert.equal(
    response.status,
    status,
    status === response.status ? undefined : await response.text(),
  );
  if (code) assert.equal((await response.json()).error.code, code);
}

function hashCredential(visitor) {
  const { cookie } = visitor.credentials();
  return createHash("sha256").update(cookie.split("=")[1]).digest("hex");
}

async function workspaceOf(visitor) {
  return db
    .prepare("SELECT workspace_id FROM sessions WHERE token_hash=?")
    .bind(hashCredential(visitor))
    .first("workspace_id");
}

const employeePath = (n) => `/admin/employees/${fixtureId(n)}`;
const assignmentPath = (n) => employeePath(n) + "/admin-access";
const rootEdit = { method: "PUT", body: { accessLevel: "FULL", version: 1 } };

test("Express responds with JSON and readiness verifies the migrated D1 and seed", async () => {
  for (const [route, status] of [
    ["health", "ok"],
    ["ready", "ready"],
  ]) {
    const response = await server.fetch(`/api/v1/${route}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.get("x-powered-by"), null);
    assert.equal(response.headers.get("set-cookie"), null);
    assert.deepEqual(await response.json(), { status });
  }
});

test("Static Assets serves the SPA on deep links and applies static security headers", async () => {
  const response = await server.fetch("/employees/example", {
    headers: { "Sec-Fetch-Mode": "navigate", Accept: "text/html" },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  const html = await response.text();
  assert.match(html, /<title>Employee Management System<\/title>/);
  assert.match(html, /<html lang="en">/);
  const assetPath = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
  assert.ok(assetPath);
  const script = await server.fetch(assetPath);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type"), /javascript/);
  assert.doesNotMatch(await script.text(), /\/auth\/(login|csrf)/);
});

test("API routes use Express instead of the SPA even on browser navigation", async () => {
  for (const path of ["/api", "/api/v1/missing", "/api/v1/auth/login"]) {
    const response = await server.fetch(path, {
      headers: { "Sec-Fetch-Mode": "navigate", Accept: "text/html" },
    });
    assert.equal(response.status, 404);
    assert.match(response.headers.get("content-type"), /application\/json/);
    assert.equal((await response.json()).error.code, "NOT_FOUND");
  }
});

test("the Workers HTTP adapter preserves JSON parsing errors and body limits", async () => {
  for (const [body, status, code] of [
    ["{", 400, "VALIDATION_ERROR"],
    [
      JSON.stringify({ value: "x".repeat(64 * 1024) }),
      413,
      "PAYLOAD_TOO_LARGE",
    ],
    ["{}", 404, "NOT_FOUND"],
  ]) {
    const response = await server.fetch("/api/v1/missing", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: url.origin },
      body,
    });
    assert.equal(response.status, status);
    assert.equal((await response.json()).error.code, code);
  }
});

test("cross-origin writes and preflight requests are rejected before parsing", async () => {
  for (const method of ["POST", "OPTIONS"]) {
    const response = await server.fetch("/api/v1/missing", {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.invalid",
      },
    });
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal((await response.json()).error.code, "ORIGIN_NOT_ALLOWED");
  }
});

test("the Workers HTTP adapter transports raw uploads and secure cookie headers", async () => {
  const probe = createTestHarness({
    workers: [
      {
        config: {
          name: "http-adapter-probe",
          main: fileURLToPath(
            new URL("test-fixtures/http-adapter.mjs", import.meta.url),
          ),
          compatibility_date: "2026-10-23",
          compatibility_flags: [
            "nodejs_compat",
            "nodejs_compat_do_not_populate_process_env",
          ],
        },
      },
    ],
  });

  try {
    await probe.listen();
    const response = await probe.fetch("/", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: new Uint8Array([0, 127, 255]),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { bytes: [0, 127, 255] });
    const cookies = response.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    assert.match(cookies[0], /^__Host-bridge-probe=ok;/);
    for (const attribute of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax"]) {
      assert.ok(cookies[0].split("; ").includes(attribute), attribute);
    }
    const cookie = cookies.map((value) => value.split(";")[0]).join("; ");
    const followUp = await probe.fetch("/", { headers: { Cookie: cookie } });
    assert.deepEqual(await followUp.json(), { cookie });
  } finally {
    await probe.close();
  }
});

test("passwordless entry validates origin and persona; switching rotates the server-side session and CSRF", async () => {
  const client = visitor();
  assert.deepEqual(await (await client.request("/demo/session")).json(), {
    user: null,
  });
  await verifyError(
    await client.request("/demo/session", {
      method: "POST",
      body: { persona: "employee" },
      origin: null,
    }),
    403,
    "ORIGIN_NOT_ALLOWED",
  );
  await verifyError(
    await client.request("/demo/session", {
      method: "POST",
      body: { persona: "employee", role: "ADMIN" },
    }),
    400,
    "VALIDATION_ERROR",
  );
  const initial = await client.select("employee");
  assert.equal(initial.user.role, "EMPLOYEE");
  assert.equal(initial.user.employeeId, "DEMO-005");
  assert.equal(initial.user.isRoot, false);
  assert.equal("workspaceId" in initial, false);
  const old = client.credentials();
  const workspace = await workspaceOf(client);
  assert.notEqual(workspace, templateId);
  assert.equal(
    await db
      .prepare("SELECT token_hash FROM sessions WHERE workspace_id=?")
      .bind(workspace)
      .first("token_hash"),
    hashCredential(client),
  );

  const invalid = { ...old, csrf: "x".repeat(32) };
  await verifyError(
    await client.request("/demo/session", {
      method: "POST",
      body: { persona: "root" },
      credentials: invalid,
    }),
    403,
    "CSRF_TOKEN_INVALID",
  );
  const switched = await client.select("root");
  assert.equal(switched.user.isRoot, true);
  assert.equal(await workspaceOf(client), workspace);
  assert.equal(switched.expiresAt, initial.expiresAt);
  assert.notEqual(client.credentials().cookie, old.cookie);
  assert.notEqual(client.credentials().csrf, old.csrf);
  await verifyError(
    await client.request("/overview/stats", { credentials: old }),
    401,
    "UNAUTHENTICATED",
  );
  await verifyError(
    await client.request(assignmentPath(206), {
      ...rootEdit,
      credentials: { ...client.credentials(), csrf: old.csrf },
    }),
    403,
    "CSRF_TOKEN_INVALID",
  );
  const bootstrap = await client.request("/demo/session");
  assert.equal(bootstrap.headers.get("set-cookie"), null);
  assert.equal((await bootstrap.json()).persona, "root");
});

test("department and employee sessions are scoped before counts, records and history", async () => {
  const client = visitor();
  const initial = await client.select("operations-admin");
  assert.equal(initial.user.administeredDepartmentId, fixtureId(101));
  const directory = await (
    await client.request("/admin/employees?pageSize=2&page=1")
  ).json();
  assert.equal(directory.pagination.total, 3);
  assert.equal(directory.items.length, 2);
  assert.ok(
    directory.items.every((item) => item.department.id === fixtureId(101)),
  );
  const scoped = await (await client.request("/overview/stats")).json();
  assert.equal(scoped.departments, 1);
  assert.equal(scoped.employees, 3);
  assert.equal(scoped.requests, 1);
  assert.equal(scoped.onLeave, 1);
  const departments = await (await client.request("/departments")).json();
  assert.deepEqual(
    departments.departments.map((item) => item.id),
    [fixtureId(101)],
  );
  await verifyError(
    await client.request(`/admin/employees?departmentId=${fixtureId(103)}`),
    403,
    "FORBIDDEN",
  );
  await verifyError(await client.request(employeePath(208)), 403, "FORBIDDEN");
  await verifyError(await client.request(employeePath(203)), 403, "FORBIDDEN");
  await verifyError(
    await client.request("/admin/departments"),
    403,
    "FORBIDDEN",
  );
  await verifyError(
    await client.request(assignmentPath(206), rootEdit),
    403,
    "FORBIDDEN",
  );
  const requestList = await (
    await client.request("/admin/change-requests?status=ALL")
  ).json();
  assert.ok(requestList.items.length >= 2);
  assert.ok(
    requestList.items.every((item) => item.employeeId !== fixtureId(208)),
  );
  const leaves = await (await client.request("/admin/leaves")).json();
  assert.deepEqual(leaves.items.map((item) => item.employeeId).sort(), [
    fixtureId(205),
    fixtureId(206),
  ]);
  const matched = await (
    await client.request("/admin/employees?q=" + encodeURIComponent("তাহমিনা"))
  ).json();
  assert.deepEqual(
    matched.items.map((item) => item.id),
    [fixtureId(205)],
  );

  await client.select("people-admin");
  const people = await (await client.request("/admin/employees")).json();
  assert.deepEqual(
    people.items.map((item) => item.id),
    [fixtureId(207)],
  );

  await client.select("employee");
  await verifyError(await client.request("/admin/employees"), 403, "FORBIDDEN");
  await verifyError(await client.request(employeePath(205)), 403, "FORBIDDEN");
  await verifyError(await client.request("/admin/leaves"), 403, "FORBIDDEN");
  const own = await (
    await client.request(`/me/profile?employeeId=${fixtureId(208)}`)
  ).json();
  assert.equal(own.profile.id, fixtureId(205));
  assert.equal("account" in own.profile, false);
  assert.equal(own.records.academicQualifications.length, 1);
  assert.ok(own.spouse);
  const history = await (await client.request("/me/change-requests")).json();
  assert.equal(history.items.length, 3);
  assert.deepEqual(history.items.map((r) => r.status).sort(), [
    "APPROVED",
    "PENDING",
    "WITHDRAWN",
  ]);
  assert.deepEqual(await (await client.request("/overview/stats")).json(), {
    requests: 1,
    leaves: 1,
    onLeave: true,
  });
  const otherLeave = await (
    await client.request(`/me/leaves?employeeId=${fixtureId(208)}`)
  ).json();
  assert.deepEqual(
    otherLeave.items.map((item) => item.employeeId),
    [fixtureId(205)],
  );
});

test("concurrent switches yield one replacement session for the same workspace", async () => {
  const client = visitor();
  await client.select("employee");
  const workspace = await workspaceOf(client);
  const previous = client.credentials();
  const attempts = await Promise.all(
    ["full-admin", "operations-admin"].map((persona) =>
      client.request("/demo/session", { method: "POST", body: { persona } }),
    ),
  );
  const winner = attempts.find((result) => result.ok);
  const loser = attempts.find((result) => !result.ok);
  assert.ok(winner);
  assert.ok(loser && [401, 409].includes(loser.status));
  await client.adopt(winner);
  assert.equal(await workspaceOf(client), workspace);
  await verifyError(
    await client.request("/overview/stats", { credentials: previous }),
    401,
    "UNAUTHENTICATED",
  );
  assert.equal(
    await db
      .prepare("SELECT COUNT(*) AS count FROM sessions WHERE workspace_id=?")
      .bind(workspace)
      .first("count"),
    1,
  );
});

test("root-only assignments are atomic with audit and preview invalidation and stay within the workspace", async () => {
  const primary = visitor();
  const other = visitor();
  await primary.select("full-admin");
  assert.equal(
    (await (await primary.request("/admin/employees")).json()).pagination.total,
    10,
  );
  await verifyError(
    await primary.request(assignmentPath(206), rootEdit),
    403,
    "FORBIDDEN",
  );
  await primary.select("root");
  await other.select("root");
  const workspace = await workspaceOf(primary);
  assert.notEqual(workspace, await workspaceOf(other));
  await verifyError(
    await primary.request(assignmentPath(201), rootEdit),
    409,
    "ROOT_ADMIN_PROTECTED",
  );
  await verifyError(
    await primary.request(assignmentPath(203), {
      method: "PUT",
      body: { accessLevel: "NONE", version: 1 },
    }),
    409,
    "ENTRY_PERSONA_PROTECTED",
  );
  await verifyError(
    await primary.request(assignmentPath(206), {
      method: "PUT",
      body: {
        accessLevel: "DEPARTMENT",
        departmentId: fixtureId(999),
        version: 1,
      },
    }),
    400,
    "DEPARTMENT_INVALID",
  );
  await db
    .prepare(
      "INSERT INTO import_previews (workspace_id,id,actor_user_id,rows_data) VALUES (?,?,?,'[]')",
    )
    .bind(workspace, fixtureId(999), fixtureId(306))
    .run();
  const accessBody = {
    accessLevel: "DEPARTMENT",
    departmentId: fixtureId(102),
    version: 1,
  };
  const outcomes = await Promise.all([
    primary.request(assignmentPath(206), { method: "PUT", body: accessBody }),
    primary.request(assignmentPath(206), rootEdit),
  ]);
  assert.deepEqual(outcomes.map((r) => r.status).sort(), [200, 409]);
  const updated = (await outcomes.find((r) => r.ok).json()).account;
  assert.equal(updated.role, "ADMIN");
  assert.equal(updated.version, 2);
  await verifyError(
    await primary.request(assignmentPath(206), rootEdit),
    409,
    "WORKSPACE_CONFLICT",
  );
  const accountInPrimary = (
    await (await primary.request(employeePath(206))).json()
  ).employee.account;
  const accountInOther = (await (await other.request(employeePath(206))).json())
    .employee.account;
  assert.equal(accountInPrimary.adminScope, updated.adminScope);
  assert.equal(accountInOther.adminScope, null);
  assert.equal(accountInOther.version, 1);
  assert.equal(
    await db
      .prepare(
        "SELECT count(*) AS count FROM import_previews WHERE workspace_id=?",
      )
      .bind(workspace)
      .first("count"),
    0,
  );
  const audit = await db
    .prepare(
      "SELECT actor_user_id,metadata FROM audit_logs WHERE workspace_id=? AND action='ADMIN_ACCESS_CHANGED'",
    )
    .bind(workspace)
    .all();
  assert.equal(audit.results.length, 1);
  assert.equal(audit.results[0].actor_user_id, fixtureId(301));
  assert.equal(
    JSON.parse(audit.results[0].metadata).previousAccessLevel,
    "NONE",
  );
});

test("D1 enforces scoped foreign keys, root uniqueness, duplicate pending requests and leave overlap", async () => {
  const owner = visitor();
  const other = visitor();
  await owner.select("root");
  await other.select("root");
  const a = await workspaceOf(owner);
  const b = await workspaceOf(other);
  await db
    .prepare("INSERT INTO departments (workspace_id,id,name_en) VALUES (?,?,?)")
    .bind(b, fixtureId(991), "Other workspace only")
    .run();
  await assert.rejects(
    db
      .prepare(
        `INSERT INTO employees (workspace_id,id,official_employee_id,department_id,first_name_en)
    VALUES (?,?,?,?,?)`,
      )
      .bind(a, fixtureId(992), "DEMO-X", fixtureId(991), "Fictional")
      .run(),
  );
  await assert.rejects(
    db
      .prepare(
        `INSERT INTO users (workspace_id,id,role,admin_scope,is_root)
    VALUES (?,?,'ADMIN','FULL',1)`,
      )
      .bind(a, fixtureId(993))
      .run(),
  );
  await assert.rejects(
    db
      .prepare(
        `INSERT INTO change_requests
    (workspace_id,id,employee_id,submitted_by_user_id,field_key,target_record_type,operation,proposed_value)
    VALUES (?,?,?,?,'designation','PROFILE','UPDATE','"Another title"')`,
      )
      .bind(a, fixtureId(994), fixtureId(205), fixtureId(305))
      .run(),
  );
  await assert.rejects(
    db.batch([
      db
        .prepare(
          "UPDATE employees SET designation='Temporary' WHERE workspace_id=? AND id=?",
        )
        .bind(a, fixtureId(205)),
      db
        .prepare(
          `INSERT INTO leave_records (workspace_id,id,employee_id,leave_type_id,start_date,end_date,day_count)
      SELECT workspace_id,?,employee_id,leave_type_id,start_date,end_date,day_count
      FROM leave_records WHERE workspace_id=? AND id=?`,
        )
        .bind(fixtureId(995), a, fixtureId(701)),
    ]),
  );
  // The harness redacts RPC error text. Check the durable outcome of each rejected write.
  for (const [table, id] of [
    ["employees", 992],
    ["users", 993],
    ["change_requests", 994],
    ["leave_records", 995],
  ]) {
    assert.equal(
      await db
        .prepare(`SELECT id FROM ${table} WHERE workspace_id=? AND id=?`)
        .bind(a, fixtureId(id))
        .first(),
      null,
    );
  }
  assert.equal(
    await db
      .prepare(
        "SELECT designation FROM employees WHERE workspace_id=? AND id=?",
      )
      .bind(a, fixtureId(205))
      .first("designation"),
    "Operations Coordinator",
  );
  await db
    .prepare("INSERT INTO departments (workspace_id,id,name_en) VALUES (?,?,?)")
    .bind(a, fixtureId(996), "Demo project office")
    .run();
  await db
    .prepare(
      "INSERT INTO posting_history (workspace_id,id,employee_id,department_id) VALUES (?,?,?,?)",
    )
    .bind(a, fixtureId(997), fixtureId(205), fixtureId(996))
    .run();
  await db
    .prepare("DELETE FROM departments WHERE workspace_id=? AND id=?")
    .bind(a, fixtureId(996))
    .run();
  assert.deepEqual(
    await db
      .prepare(
        "SELECT department_id FROM posting_history WHERE workspace_id=? AND id=?",
      )
      .bind(a, fixtureId(997))
      .first(),
    { department_id: null },
  );
});

test("reset replaces only the authenticated workspace and expiration is enforced before bounded cleanup", async () => {
  const client = visitor();
  const other = visitor();
  await client.select("root");
  await other.select("employee");
  const oldWorkspace = await workspaceOf(client);
  const otherWorkspace = await workspaceOf(other);
  const previous = client.credentials();
  assert.ok((await client.request(assignmentPath(206), rootEdit)).ok);
  const resets = await Promise.all([
    client.request("/demo/reset", { method: "POST" }),
    client.request("/demo/reset", { method: "POST" }),
  ]);
  assert.equal(resets.filter((r) => r.ok).length, 1);
  assert.ok([401, 409].includes(resets.find((r) => !r.ok).status));
  await client.adopt(resets.find((r) => r.ok));
  const replacement = await workspaceOf(client);
  assert.notEqual(replacement, oldWorkspace);
  assert.equal(
    (await (await client.request(employeePath(206))).json()).employee.account
      .version,
    1,
  );
  await verifyError(
    await client.request("/overview/stats", { credentials: previous }),
    401,
    "UNAUTHENTICATED",
  );
  assert.equal(
    await db
      .prepare("SELECT id FROM workspaces WHERE id=?")
      .bind(oldWorkspace)
      .first(),
    null,
  );

  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare("UPDATE workspaces SET expires_at=? WHERE id=?")
    .bind(now - 100, replacement)
    .run();
  await db.batch(
    Array.from({ length: 12 }, (_, i) =>
      db
        .prepare("INSERT INTO workspaces (id,expires_at) VALUES (?,?)")
        .bind(`expired-${i}`, now - 50),
    ),
  );
  await verifyError(
    await client.request("/overview/stats"),
    401,
    "UNAUTHENTICATED",
  );
  await verifyError(
    await client.request("/demo/reset", { method: "POST" }),
    401,
    "UNAUTHENTICATED",
  );
  await worker.scheduled({ cron: "*/15 * * * *", scheduledTime: new Date() });
  assert.equal(
    await db
      .prepare("SELECT id FROM workspaces WHERE id=?")
      .bind(replacement)
      .first(),
    null,
  );
  assert.equal(
    await db
      .prepare(
        "SELECT count(*) AS count FROM workspaces WHERE id LIKE 'expired-%'",
      )
      .first("count"),
    1,
  );
  assert.ok(
    await db
      .prepare("SELECT id FROM workspaces WHERE id=?")
      .bind(templateId)
      .first(),
  );
  const logout = await other.request("/demo/logout", { method: "POST" });
  assert.equal(logout.status, 204);
  assert.equal(
    await db
      .prepare("SELECT id FROM workspaces WHERE id=?")
      .bind(otherWorkspace)
      .first(),
    null,
  );
  await verifyError(
    await other.request("/overview/stats"),
    401,
    "UNAUTHENTICATED",
  );
});

const post = (body) => ({ method: "POST", body });
const patch = (body, version) => ({ method: "PATCH", body, version });
const personnel = (code, departmentId = fixtureId(101)) => ({
  officialEmployeeId: code,
  departmentId,
  firstNameEn: "Raisa",
  lastNameEn: "Khan",
  gender: "FEMALE",
  bloodGroup: "O+",
});
const checkedJson = async (response, status = 200) => {
  assert.equal(
    response.status,
    status,
    response.status === status ? "" : await response.text(),
  );
  return response.json();
};

test("employee creation, editing, status and department writes preserve scope and versions", async () => {
  const client = visitor(),
    outsider = visitor();
  await client.select("operations-admin");
  await outsider.select("root");
  await verifyError(
    await client.request(
      "/admin/employees",
      post(personnel("P4-NO", fixtureId(103))),
    ),
    403,
    "FORBIDDEN",
  );
  await verifyError(
    await client.request(
      "/admin/departments",
      post({ nameEn: "Test department" }),
    ),
    403,
    "FORBIDDEN",
  );
  const { employee } = await checkedJson(
    await client.request("/admin/employees", post(personnel("P4-MANUAL"))),
    201,
  );
  const path = "/admin/employees/" + employee.id;
  await verifyError(await outsider.request(path), 404, "EMPLOYEE_NOT_FOUND");
  await verifyError(
    await client.request(path, patch({ departmentId: fixtureId(103) }, 1)),
    403,
    "FORBIDDEN",
  );
  const results = await Promise.all(
    ["Coordinator", "Officer"].map((designation) =>
      client.request(path, patch({ designation }, 1)),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const edited = (await checkedJson(await client.request(path))).employee;
  assert.equal(edited.version, 2);
  assert.ok(["Coordinator", "Officer"].includes(edited.designation));
  await checkedJson(
    await client.request(
      path + "/status",
      patch({ employmentStatus: "RETIRED" }, 2),
    ),
  );
  const disabled = (await checkedJson(await client.request(path))).employee;
  assert.equal(disabled.employmentStatus, "RETIRED");
  assert.equal(disabled.account.accountStatus, "DISABLED");
  await client.select("full-admin");
  const { department } = await checkedJson(
    await client.request(
      "/admin/departments",
      post({ nameEn: "Project Office", nameBn: "প্রকল্প কার্যালয়" }),
    ),
    201,
  );
  await checkedJson(
    await client.request(
      "/admin/departments/" + department.id,
      patch({ isActive: false }, 1),
    ),
  );
  await verifyError(
    await client.request(
      "/admin/employees",
      post(personnel("P4-INACTIVE", department.id)),
    ),
    400,
    "DEPARTMENT_INVALID",
  );
  await client.adopt(await client.request("/demo/reset", { method: "POST" }));
  await verifyError(await client.request(path), 404, "EMPLOYEE_NOT_FOUND");
});

test("profile, spouse and PDS operations preserve authorization, duplicate and stale approvals", async () => {
  const client = visitor();
  await client.select("employee");
  const input = {
    targetRecordType: "PROFILE",
    operation: "UPDATE",
    fieldKey: "email",
    proposedValue: "raisa.demo@example.invalid",
  };
  const first = await checkedJson(
    await client.request("/me/change-requests", post(input)),
    201,
  );
  await verifyError(
    await client.request("/me/change-requests", post(input)),
    409,
    "DUPLICATE_REQUEST",
  );
  const pds = await checkedJson(
    await client.request(
      "/me/change-requests",
      post({
        targetRecordType: "PDS",
        section: "training",
        operation: "CREATE",
        proposedValue: { title: "Demo audit training" },
      }),
    ),
    201,
  );
  const spouse = await checkedJson(
    await client.request(
      "/me/change-requests",
      post({
        targetRecordType: "SPOUSE",
        operation: "UPDATE",
        fieldKey: "spouseOccupation",
        proposedValue: "Fictional researcher",
      }),
    ),
    201,
  );
  await client.select("people-admin");
  const decide = (id, body = { action: "APPROVE" }) =>
    client.request("/admin/change-requests/" + id + "/decision", post(body));
  await verifyError(await decide(first.id), 403, "FORBIDDEN");
  await client.select("operations-admin");
  const decisions = await Promise.all([decide(first.id), decide(first.id)]);
  assert.deepEqual(decisions.map((r) => r.status).sort(), [200, 409]);
  await checkedJson(await decide(pds.id));
  await checkedJson(await decide(spouse.id));
  await checkedJson(
    await client.request(
      employeePath(205),
      patch({ designation: "Changed after submission" }),
    ),
  );
  await verifyError(await decide(fixtureId(801)), 409, "CHANGE_CONFLICT");
  await checkedJson(
    await decide(fixtureId(801), { action: "REJECT", reason: "Sample reason" }),
  );
  const profile = await checkedJson(await client.request(employeePath(205)));
  assert.equal(profile.employee.email, input.proposedValue);
  assert.ok(
    profile.records.trainingRecords.some(
      (r) => r.title === "Demo audit training",
    ),
  );
  assert.equal(profile.spouse.spouseOccupation, "Fictional researcher");
  const record = profile.records.trainingRecords.find(
    (r) => r.title === "Demo audit training",
  );
  const path = employeePath(205) + "/records/training/" + record.id;
  await checkedJson(
    await client.request(
      path,
      patch({ title: "Revised demo workshop" }, record.version),
    ),
  );
  await verifyError(
    await client.request(
      path,
      patch({ title: "Stale workshop" }, record.version),
    ),
    409,
    "CHANGE_CONFLICT",
  );
  assert.equal((await client.request(path, { method: "DELETE" })).status, 204);
});

test("leave records, corrections, holidays and employee review update atomically", async () => {
  const client = visitor();
  await client.select("root");
  const type = fixtureId(501);
  const holiday = await checkedJson(
    await client.request(
      "/admin/holidays",
      post({ holidayDate: "2030-01-07", nameEn: "Fictional closure" }),
    ),
    201,
  );
  const input = {
    employeeId: fixtureId(205),
    leaveTypeId: type,
    startDate: "2030-01-06",
    endDate: "2030-01-08",
  };
  const created = await checkedJson(
    await client.request("/admin/leaves", post(input)),
    201,
  );
  assert.equal(created.dayCount, 2);
  assert.deepEqual(created.excludedHolidays, ["2030-01-07"]);
  await verifyError(
    await client.request("/admin/leaves", post(input)),
    409,
    "LEAVE_OVERLAP",
  );
  const path = "/admin/leaves/" + created.id;
  assert.equal(
    (
      await client.request("/admin/holidays/" + holiday.id, {
        method: "DELETE",
      })
    ).status,
    204,
  );
  const saved = (
    await checkedJson(await client.request("/admin/leaves"))
  ).items.find((r) => r.id === created.id);
  assert.equal(saved.dayCount, 2);
  const correction = {
    leaveTypeId: type,
    startDate: "2030-01-06",
    endDate: "2030-01-09",
    reason: "Fictional correction",
  };
  assert.equal(
    (await checkedJson(await client.request(path, patch(correction, 1))))
      .dayCount,
    4,
  );
  await verifyError(
    await client.request(path, patch(correction, 1)),
    409,
    "CHANGE_CONFLICT",
  );
  await checkedJson(
    await client.request(
      path + "/cancel",
      post({ reason: "Fictional cancellation" }),
    ),
  );
  await client.select("employee");
  const request = {
    leaveTypeId: type,
    startDate: "2030-01-06",
    endDate: "2030-01-08",
  };
  const pending = await checkedJson(
    await client.request("/me/leave-requests", post(request)),
    201,
  );
  await verifyError(
    await client.request("/me/leave-requests", post(request)),
    409,
    "DUPLICATE_REQUEST",
  );
  const rejected = await checkedJson(
    await client.request(
      "/me/leave-requests",
      post({ ...request, startDate: "2030-01-13", endDate: "2030-01-14" }),
    ),
    201,
  );
  const balance = (
    await checkedJson(await client.request("/me/day-off-balance"))
  ).balance;
  assert.ok(balance.workedDays > 0);
  await client.select("people-admin");
  const decision = "/admin/leave-requests/" + pending.id + "/decision";
  await verifyError(
    await client.request(decision, post({ action: "APPROVE" })),
    403,
    "FORBIDDEN",
  );
  await client.select("operations-admin");
  const races = await Promise.all([
    client.request(decision, post({ action: "APPROVE" })),
    client.request(decision, post({ action: "APPROVE" })),
  ]);
  assert.equal(races.filter((r) => r.status === 200).length, 1);
  await checkedJson(
    await client.request(
      "/admin/leave-requests/" + rejected.id + "/decision",
      post({ action: "REJECT", reason: "Fictional rejection" }),
    ),
  );
  await client.select("employee");
  const entries = await checkedJson(await client.request("/me/leave-requests"));
  assert.deepEqual(entries.items.map((r) => r.status).sort(), [
    "APPROVED",
    "REJECTED",
  ]);
  assert.equal(
    (await checkedJson(await client.request("/me/leaves"))).items.filter(
      (r) => r.startDate === request.startDate && !r.cancelledAt,
    ).length,
    1,
  );
});

test("profile image upload, replacement and removal are scoped and format bounded", async () => {
  const client = visitor(),
    other = visitor();
  await client.select("employee");
  await other.select("root");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=",
    "base64",
  );
  const upload = (bytes, mime = "image/png") =>
    client.request("/me/profile-image", { method: "POST", raw: bytes, mime });
  await verifyError(
    await upload(Buffer.alloc(192 * 1024 + 1)),
    413,
    "PAYLOAD_TOO_LARGE",
  );
  await verifyError(await upload(png, "image/jpeg"), 415, "INVALID_IMAGE");
  const first = await checkedJson(await upload(png));
  const readPath = first.profileImageUrl.replace("/api/v1", "");
  const photo = await client.request(readPath);
  assert.equal(photo.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await photo.arrayBuffer()), png);
  await verifyError(await other.request(readPath), 404, "IMAGE_NOT_FOUND");
  await client.select("people-admin");
  await verifyError(await client.request(readPath), 404, "IMAGE_NOT_FOUND");
  await client.select("employee");
  const replacement = await checkedJson(await upload(png));
  assert.notEqual(replacement.profileImageUrl, first.profileImageUrl);
  await verifyError(await client.request(readPath), 404, "IMAGE_NOT_FOUND");
  assert.equal(
    (await client.request("/me/profile-image", { method: "DELETE" })).status,
    204,
  );
  await verifyError(
    await client.request(replacement.profileImageUrl.replace("/api/v1", "")),
    404,
    "IMAGE_NOT_FOUND",
  );
});

test("workbook preview, batch commit and exports preserve masking, scope and rollback", async () => {
  const client = visitor(),
    other = visitor();
  await client.select("root");
  await other.select("root");
  const template = await checkedJson(
    await client.request("/admin/data/template?format=xlsx"),
  );
  assert.ok(template.sheets.length > 3);
  const csv = await checkedJson(
    await client.request("/admin/data/template?format=csv"),
  );
  assert.ok(csv.columns.includes("officialEmployeeId"));
  const create = {
    rowType: "PROFILE",
    action: "CREATE",
    ...personnel("P4-IMPORT"),
  };
  const pds = {
    rowType: "training",
    action: "CREATE",
    officialEmployeeId: "P4-IMPORT",
    title: "Workbook workshop",
  };
  const endpoint = "/admin/data/files";
  const preview = await checkedJson(
    await client.request(endpoint + "/preview", post({ rows: [pds, create] })),
  );
  assert.ok(
    preview.results.every((r) => r.valid),
    JSON.stringify(preview.results),
  );
  const commit = post({ previewId: preview.previewId, selected: [2, 3] });
  await verifyError(
    await other.request(endpoint + "/commit", commit),
    409,
    "PREVIEW_UNAVAILABLE",
  );
  const results = await Promise.all([
    client.request(endpoint + "/commit", commit),
    client.request(endpoint + "/commit", commit),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const out = await checkedJson(
    await client.request("/admin/data/pds", post({ format: "csv" })),
  );
  const own = out.rows.find(
    (r) => r.rowType === "PROFILE" && r.officialEmployeeId === "DEMO-005",
  );
  assert.equal(own.email, "[MASKED]");
  assert.ok(out.rows.some((r) => r.title === "Workbook workshop"));
  const xlsx = await checkedJson(
    await client.request(
      "/admin/data/pds",
      post({ format: "xlsx", sensitive: "true" }),
    ),
  );
  assert.equal(
    xlsx.sheets
      .find((s) => s.name === "PROFILE")
      .rows.find((r) => r.officialEmployeeId === "DEMO-005").email,
    "tahmina.islam@example.invalid",
  );
  const stale = await checkedJson(
    await client.request(
      endpoint + "/preview",
      post({
        rows: [
          { ...create, officialEmployeeId: "P4-ROLLBACK" },
          {
            rowType: "PROFILE",
            action: "UPDATE",
            officialEmployeeId: "DEMO-005",
            expectedUpdatedAt: own.expectedUpdatedAt,
            email: "test@example.invalid",
          },
        ],
      }),
    ),
  );
  assert.ok(stale.results.every((r) => r.valid));
  await checkedJson(
    await client.request(
      employeePath(205),
      patch({ email: "new.demo@example.invalid" }),
    ),
  );
  await verifyError(
    await client.request(
      endpoint + "/commit",
      post({ previewId: stale.previewId, selected: [2, 3] }),
    ),
    409,
    "IMPORT_CONFLICT",
  );
  assert.equal(
    (await checkedJson(await client.request("/admin/employees?q=P4-ROLLBACK")))
      .pagination.total,
    0,
  );
  await client.select("operations-admin");
  await verifyError(
    await client.request(
      "/admin/data/pds",
      post({ format: "csv", departmentId: fixtureId(103) }),
    ),
    403,
    "FORBIDDEN",
  );
  await client.select("employee");
  await verifyError(
    await client.request("/admin/data/pds", post({ format: "csv" })),
    403,
    "FORBIDDEN",
  );
  await verifyError(
    await client.request(
      "/me/data/pds",
      post({ format: "csv", sensitive: "true" }),
    ),
    403,
    "FORBIDDEN",
  );
  assert.ok(
    (
      await checkedJson(
        await client.request("/me/data/pds", post({ format: "csv" })),
      )
    ).rows.every((r) => r.officialEmployeeId === "DEMO-005"),
  );
});

test("the Worker rate limiter and D1 daily budget bound workspace creation", async () => {
  const client = visitor();
  for (let i = 0; i < 8; i++) {
    await verifyError(
      await client.request("/demo/session", {
        method: "POST",
        body: { persona: "unknown" },
      }),
      400,
      "VALIDATION_ERROR",
    );
  }
  await verifyError(
    await client.request("/demo/session", {
      method: "POST",
      body: { persona: "employee" },
    }),
    429,
    "DEMO_LIMIT_REACHED",
  );

  const owner = visitor();
  await owner.select("employee");
  const workspace = await workspaceOf(owner);
  const before = await db
    .prepare("SELECT count(*) AS count FROM workspaces")
    .first("count");
  await db
    .prepare("UPDATE workspace_issuance SET issued=119 WHERE day=date('now')")
    .run();
  const contenders = await Promise.all(
    [visitor(), visitor()].map((candidate) =>
      candidate.request("/demo/session", {
        method: "POST",
        body: { persona: "employee" },
      }),
    ),
  );
  assert.deepEqual(
    contenders.map((result) => result.status).sort(),
    [200, 429],
  );
  await verifyError(
    await owner.request("/demo/reset", { method: "POST" }),
    429,
    "DEMO_LIMIT_REACHED",
  );
  assert.equal(await workspaceOf(owner), workspace);
  assert.equal(
    await db.prepare("SELECT count(*) AS count FROM workspaces").first("count"),
    before + 1,
  );
});

test("retained workspace capacity includes expired workspaces and still permits an atomic reset", async () => {
  // Leave room in the UTC issuance budget to isolate the retained-workspace gate.
  await db
    .prepare("UPDATE workspace_issuance SET issued=1 WHERE day=date('now')")
    .run();
  const owner = visitor();
  await owner.select("employee");
  const first = await workspaceOf(owner);
  await db
    .prepare(
      `WITH RECURSIVE pending(n) AS (
    SELECT 1 UNION ALL SELECT n+1 FROM pending
    WHERE n < 143-(SELECT count(*) FROM workspaces WHERE expires_at>0)
  )
  INSERT INTO workspaces (id,expires_at)
    SELECT printf('00000000-0000-4000-8000-%012d', 100000+n),1 FROM pending`,
    )
    .run();

  const requests = await Promise.all(
    [visitor(), visitor()].map((candidate) =>
      candidate.request("/demo/session", post({ persona: "employee" })),
    ),
  );
  assert.deepEqual(requests.map(({ status }) => status).sort(), [200, 429]);
  await verifyError(
    requests.find(({ status }) => status === 429),
    429,
    "DEMO_LIMIT_REACHED",
  );

  await owner.adopt(await owner.request("/demo/reset", { method: "POST" }));
  assert.notEqual(await workspaceOf(owner), first);
  assert.equal(
    await db
      .prepare("SELECT count(*) AS count FROM workspaces WHERE expires_at>0")
      .first("count"),
    144,
  );
});
