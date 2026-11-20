import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import {
  ApiClient,
  signInAndCompleteAdminPasswordChange,
  startTestApi,
  stopTestApi,
} from "./helpers/server.js";
import { testPool } from "./helpers/database.js";
import {
  readCsv,
  readXlsx,
  writeCsv,
  writeXlsx,
  type DataRow,
} from "../src/data/spreadsheets.js";

let server: Server;
let full: ApiClient, scoped: ApiClient, employee: ApiClient;
let baseUrl: string,
  a: string,
  b: string,
  scopedId: string,
  fullId: string,
  aId: string,
  bId: string;
let aRequest: string, bRequest: string, aLeave: string, bLeave: string;
const accessPath = () => `/api/v1/admin/employees/${scopedId}/admin-access`;
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7x8AAAAASUVORK5CYII=",
  "base64",
);
async function login(code: string) {
  const client = new ApiClient(baseUrl);
  await client.initializeCsrf();
  expect(
    (
      await client.post("/api/v1/auth/login", {
        employeeId: code,
        password: "Employee-temp-Password-123",
      })
    ).status,
  ).toBe(200);
  return client;
}
const create = (code: string, departmentId: string) => ({
  officialEmployeeId: code,
  firstNameEn: code,
  departmentId,
  gender: "MALE",
  bloodGroup: "O+",
});
async function preview(client: ApiClient, rows: DataRow[], xlsx = false) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return client.postBinary(
    "/api/v1/admin/data/files/preview",
    xlsx
      ? await writeXlsx([{ name: "PROFILE", columns, rows }])
      : writeCsv(columns, rows),
    xlsx
      ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : "text/csv",
  );
}
beforeAll(async () => {
  const setup = await startTestApi();
  server = setup.server;
  baseUrl = setup.baseUrl;
  scopedId = setup.fixtures.employeeRecordId;
  fullId = setup.fixtures.adminEmployeeRecordId;
  full = await signInAndCompleteAdminPasswordChange(baseUrl);
  const departments = (
    await testPool.query("SELECT id FROM departments ORDER BY name_en")
  ).rows;
  a = departments[0].id;
  b = departments[1].id;
  // Administrator's own employee department deliberately differs from administered department.
  await testPool.query("UPDATE employees SET department_id=$1 WHERE id=$2", [
    b,
    scopedId,
  ]);
  for (const [code, department] of [
    ["SCOPE-A", a],
    ["SCOPE-B", b],
  ]) {
    const row = (
      await testPool.query(
        "INSERT INTO employees(official_employee_id,first_name_en,department_id,joining_date) VALUES($1,$1,$2,'2026-01-01') RETURNING id",
        [code, department],
      )
    ).rows[0];
    await testPool.query(
      "INSERT INTO users(employee_id,password_hash,role,must_change_password) SELECT $1,password_hash,'EMPLOYEE',FALSE FROM users WHERE id=$2",
      [row.id, setup.fixtures.employeeUserId],
    );
    if (code === "SCOPE-A") aId = row.id;
    else bId = row.id;
  }
  scoped = await login("TEST-EMP-001");
  employee = await login("SCOPE-A");
  const leaveType = (
    await testPool.query(
      "INSERT INTO leave_types(code,name_en) VALUES('SCOPE','Scope leave') RETURNING id",
    )
  ).rows[0].id;
  for (const id of [aId, bId]) {
    const request = (
      await testPool.query(
        "INSERT INTO change_requests(employee_id,submitted_by_user_id,field_key,target_record_type,operation,proposed_value) SELECT $1,id,'phone','PROFILE','UPDATE','\"01234567890\"'::jsonb FROM users WHERE employee_id=$1 RETURNING id",
        [id],
      )
    ).rows[0].id;
    const leave = (
      await testPool.query(
        "INSERT INTO leave_records(employee_id,leave_type_id,start_date,end_date,day_count) VALUES($1,$2,CURRENT_DATE,CURRENT_DATE,1) RETURNING id",
        [id, leaveType],
      )
    ).rows[0].id;
    await testPool.query(
      "INSERT INTO academic_qualifications(employee_id,institution,degree) VALUES($1,$2,'Degree')",
      [id, id === aId ? "Visible Academy" : "Hidden Academy"],
    );
    if (id === aId) {
      aRequest = request;
      aLeave = leave;
    } else {
      bRequest = request;
      bLeave = leave;
    }
  }
});
afterAll(async () => {
  if (server) await stopTestApi(server);
});

describe("Administrator scopes", () => {
  it("preserves the existing full admin, validates assignment and audits actor/target/scope", async () => {
    expect((await full.get("/api/v1/auth/me")).body.user).toMatchObject({
      role: "ADMIN",
      adminScope: "FULL",
      administeredDepartmentId: null,
    });
    expect(
      (await employee.put(accessPath(), { accessLevel: "FULL" })).status,
    ).toBe(403);
    expect(
      (await full.put(accessPath(), { accessLevel: "DEPARTMENT" })).status,
    ).toBe(400);
    expect(
      (
        await full.put(accessPath(), {
          accessLevel: "DEPARTMENT",
          departmentId: "00000000-0000-4000-8000-000000000000",
        })
      ).status,
    ).toBe(400);
    expect(
      (await full.put(accessPath(), { accessLevel: "FULL", departmentId: a }))
        .status,
    ).toBe(400);
    expect(
      (
        await full.put(accessPath(), {
          accessLevel: "DEPARTMENT",
          departmentId: a,
        })
      ).status,
    ).toBe(200);
    // This client signed in BEFORE promotion; no new login required.
    expect((await scoped.get("/api/v1/auth/me")).body.user).toMatchObject({
      role: "ADMIN",
      adminScope: "DEPARTMENT",
      administeredDepartmentId: a,
    });
    const audit = (
      await testPool.query(
        "SELECT actor_user_id,entity_id,metadata FROM audit_logs WHERE action='ADMIN_ACCESS_CHANGED'",
      )
    ).rows;
    expect(audit).toHaveLength(1);
    expect(audit[0].metadata).toMatchObject({
      employeeId: scopedId,
      accessLevel: "DEPARTMENT",
      administeredDepartmentId: a,
      previousAccessLevel: "NONE",
    });
    expect(audit[0].actor_user_id).not.toBe(audit[0].entity_id);
    expect(
      (await scoped.get("/api/v1/me/profile")).body.profile?.department?.id,
    ).toBe(b);
  });
  it("lets only the root administrator manage administrator access; delegated full admins keep operational power", async () => {
    expect((await full.get("/api/v1/auth/me")).body.user).toMatchObject({
      isRoot: true,
    });
    // Full-access administrators edit their own record directly: no change requests.
    expect(
      (await full.post("/api/v1/me/change-requests", { fieldKey: "phone" }))
        .status,
    ).toBe(403);
    expect((await full.put(accessPath(), { accessLevel: "FULL" })).status).toBe(
      200,
    );
    try {
      expect((await scoped.get("/api/v1/auth/me")).body.user).toMatchObject({
        adminScope: "FULL",
        isRoot: false,
      });
      const auditBefore = (
        await testPool.query(
          "SELECT count(*)::int AS n FROM audit_logs WHERE action='ADMIN_ACCESS_CHANGED'",
        )
      ).rows[0].n;
      const targets = [
        `/api/v1/admin/employees/${aId}/admin-access`,
        accessPath(),
        `/api/v1/admin/employees/${fullId}/admin-access`,
      ];
      for (const path of targets)
        for (const body of [
          { accessLevel: "FULL" },
          { accessLevel: "DEPARTMENT", departmentId: a },
          { accessLevel: "NONE" },
        ])
          expect((await scoped.put(path, body)).status).toBe(403);
      expect(
        (
          await testPool.query(
            "SELECT count(*)::int AS n FROM audit_logs WHERE action='ADMIN_ACCESS_CHANGED'",
          )
        ).rows[0].n,
      ).toBe(auditBefore);
      // Operational power is intact: all departments, employees, global settings.
      expect((await scoped.get("/api/v1/admin/employees")).status).toBe(200);
      expect((await scoped.get(`/api/v1/admin/employees/${bId}`)).status).toBe(
        200,
      );
      expect((await scoped.get("/api/v1/admin/departments")).status).toBe(200);
      // The root account cannot be modified by a delegated admin, or by anyone through this form.
      expect(
        (
          await scoped.patch(`/api/v1/admin/employees/${fullId}/status`, {
            accountStatus: "DISABLED",
          })
        ).status,
      ).toBe(409);
      expect(
        (
          await scoped.post(
            `/api/v1/admin/employees/${fullId}/password-reset`,
            {},
          )
        ).status,
      ).toBe(409);
      // Every other write to the root account is refused for a delegated admin...
      const rootPatch = await scoped.patch(
        `/api/v1/admin/employees/${fullId}`,
        {
          designation: "Changed by delegated admin",
        },
      );
      expect(rootPatch.status).toBe(409);
      expect(rootPatch.body.error?.code).toBe("ROOT_ADMIN_PROTECTED");
      expect(
        (
          await scoped.postBinary(
            `/api/v1/admin/employees/${fullId}/profile-image`,
            png,
            "image/png",
          )
        ).status,
      ).toBe(409);
      // ...while other accounts stay fully editable, and the root can edit itself.
      expect(
        (
          await scoped.patch(`/api/v1/admin/employees/${bId}`, {
            designation: "Delegated edit",
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await full.patch(`/api/v1/admin/employees/${fullId}`, {
            designation: "Root edit",
          })
        ).status,
      ).toBe(200);
      const protectedRoot = await full.put(
        `/api/v1/admin/employees/${fullId}/admin-access`,
        { accessLevel: "NONE" },
      );
      expect(protectedRoot.status).toBe(409);
      expect(protectedRoot.body.error?.code).toBe("ROOT_ADMIN_PROTECTED");
      expect(
        (await full.get(`/api/v1/admin/employees/${fullId}`)).body.employee
          ?.account,
      ).toMatchObject({ isRoot: true });
    } finally {
      // Always restore the department assignment the following tests rely on.
      await full.put(accessPath(), {
        accessLevel: "DEPARTMENT",
        departmentId: a,
      });
    }
  });
  it("lets root and full-access administrators change a department administrator's status, never their own or the root's", async () => {
    const statusPath = (id: string) => `/api/v1/admin/employees/${id}/status`;
    // `scoped` is a department administrator here (the previous test restores that).
    const disabled = await full.patch(statusPath(scopedId), {
      accountStatus: "DISABLED",
    });
    expect(disabled.status).toBe(200);
    expect(disabled.body.employee?.account?.accountStatus).toBe("DISABLED");
    try {
      const restored = await full.patch(statusPath(scopedId), {
        accountStatus: "ACTIVE",
      });
      expect(restored.status).toBe(200);
      expect(restored.body.employee?.account?.accountStatus).toBe("ACTIVE");
      // Disabling an account revokes its sessions by design; sign in again.
      scoped = await login("TEST-EMP-001");
      // The root cannot lock itself out.
      const self = await full.patch(statusPath(fullId), {
        accountStatus: "DISABLED",
      });
      expect(self.status).toBe(409);
      expect(self.body.error?.code).toBe("ADMIN_ACCOUNT_PROTECTED");
      // A delegated full-access administrator may change the department administrator,
      // but not the root.
      expect(
        (await full.put(accessPath(), { accessLevel: "FULL" })).status,
      ).toBe(200);
      const root = await scoped.patch(statusPath(fullId), {
        accountStatus: "DISABLED",
      });
      expect(root.status).toBe(409);
      expect(root.body.error?.code).toBe("ROOT_ADMIN_PROTECTED");
    } finally {
      await testPool.query(
        "UPDATE users SET account_status='ACTIVE' WHERE employee_id=$1",
        [scopedId],
      );
      await full.put(accessPath(), {
        accessLevel: "DEPARTMENT",
        departmentId: a,
      });
    }
  });
  it("scopes pagination, searches, totals, dashboards and balances before aggregation", async () => {
    const list = await scoped.get("/api/v1/admin/employees?pageSize=1");
    expect(list.body.pagination?.total).toBe(1);
    expect(list.body.items?.[0]?.id).toBe(aId);
    expect(
      (await scoped.get("/api/v1/admin/employees?q=SCOPE-B")).body.pagination
        ?.total,
    ).toBe(0);
    expect(
      (await scoped.get(`/api/v1/admin/employees?departmentId=${b}`)).status,
    ).toBe(403);
    expect((await scoped.get("/api/v1/overview/stats")).body).toMatchObject({
      employees: 1,
      active: 1,
      departments: 1,
      departmentName: expect.any(String),
      requests: 1,
      requesters: 1,
      onLeave: 1,
    });
    expect(
      (await scoped.get("/api/v1/admin/day-off-balances")).body.items?.map(
        (x) => x.employeeId,
      ),
    ).toEqual([aId]);
    expect(
      (await full.get("/api/v1/admin/employees")).body.pagination?.total,
    ).toBe(4);
  });
  it("blocks ID tampering, other administrators, global settings, transfers and role changes", async () => {
    for (const id of [bId, fullId, scopedId]) {
      expect((await scoped.get(`/api/v1/admin/employees/${id}`)).status).toBe(
        403,
      );
      expect(
        (
          await scoped.patch(`/api/v1/admin/employees/${id}`, {
            firstNameEn: "Forbidden",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await scoped.patch(`/api/v1/admin/employees/${id}/status`, {
            accountStatus: "DISABLED",
          })
        ).status,
      ).toBe(403);
      expect(
        (await scoped.post(`/api/v1/admin/employees/${id}/password-reset`, {}))
          .status,
      ).toBe(403);
      expect(
        (
          await scoped.get(
            `/api/v1/admin/employees/${id}/records/qualifications`,
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await scoped.put(`/api/v1/admin/employees/${id}/spouse`, {
            spouseName: "Forbidden",
          })
        ).status,
      ).toBe(403);
    }
    for (const accessLevel of ["FULL", "DEPARTMENT", "NONE"])
      expect(
        (
          await scoped.put(accessPath(), {
            accessLevel,
            ...(accessLevel === "DEPARTMENT" ? { departmentId: b } : {}),
          })
        ).status,
      ).toBe(403);
    expect(
      (
        await scoped.patch(`/api/v1/admin/employees/${aId}`, {
          departmentId: b,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await scoped.patch(`/api/v1/admin/employees/${aId}`, {
          firstNameEn: "Allowed",
        })
      ).status,
    ).toBe(200);
    for (const path of ["departments", "data/audit"])
      expect((await scoped.get(`/api/v1/admin/${path}`)).status).toBe(403);
    expect(
      (await scoped.post("/api/v1/admin/departments", { nameEn: "Forbidden" }))
        .status,
    ).toBe(403);
    expect(
      (
        await scoped.post("/api/v1/admin/leave-types", {
          code: "BAD",
          nameEn: "Forbidden",
        })
      ).status,
    ).toBe(403);
  });
  it("scopes related records, leave, change requests and image delivery", async () => {
    expect(
      (await scoped.get("/api/v1/admin/leaves")).body.items?.map((x) => x.id),
    ).toEqual([aLeave]);
    expect(
      (await scoped.get(`/api/v1/admin/leaves?employeeId=${bId}`)).body.items,
    ).toEqual([]);
    expect(
      (await scoped.get("/api/v1/admin/change-requests")).body.items?.map(
        (x) => x.id,
      ),
    ).toEqual([aRequest]);
    expect(
      (
        await scoped.post(
          `/api/v1/admin/change-requests/${bRequest}/decision`,
          { action: "REJECT", reason: "No" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await scoped.post(`/api/v1/admin/leaves/${bLeave}/cancel`, {
          reason: "No",
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await scoped.post(
          `/api/v1/admin/employees/${aId}/records/qualifications`,
          { institution: "Allowed", degree: "Degree" },
        )
      ).status,
    ).toBe(201);
    const image = await full.postBinary(
      `/api/v1/admin/employees/${bId}/profile-image`,
      png,
      "image/png",
    );
    expect(image.status).toBe(200);
    expect((await scoped.getBinary(image.body.profileImageUrl!)).status).toBe(
      404,
    );
    expect(
      (
        await scoped.postBinary(
          `/api/v1/admin/employees/${bId}/profile-image`,
          png,
          "image/png",
        )
      ).status,
    ).toBe(403);
    const own = await scoped.postBinary(
      "/api/v1/me/profile-image",
      png,
      "image/png",
    );
    expect(own.status).toBe(200);
    expect((await scoped.getBinary(own.body.profileImageUrl!)).status).toBe(
      200,
    );
    expect((await scoped.get("/api/v1/me/leaves")).status).toBe(200);
    expect((await scoped.get("/api/v1/me/change-requests")).status).toBe(200);
  });
  it("exports only scoped employees and related records in CSV and Excel, and keeps self export separate", async () => {
    const basic = await scoped.getBinary("/api/v1/admin/data/employees.csv");
    expect(basic.bytes.toString()).toContain("SCOPE-A");
    expect(basic.bytes.toString()).not.toContain("SCOPE-B");
    for (const format of ["csv", "xlsx"]) {
      const result = await scoped.getBinary(
        `/api/v1/admin/data/pds?format=${format}&ids=${aId},${bId},${fullId}&sensitive=true`,
      );
      expect(result.status).toBe(200);
      const rows =
        format === "csv"
          ? readCsv(result.bytes.toString())
          : await readXlsx(result.bytes);
      expect(new Set(rows.map((row) => row.officialEmployeeId))).toEqual(
        new Set(["SCOPE-A"]),
      );
      expect(rows.some((row) => row.institution === "Visible Academy")).toBe(
        true,
      );
      const own = await scoped.getBinary(
        `/api/v1/me/data/pds?format=${format}`,
      );
      expect(own.status).toBe(200);
      const ownRows =
        format === "csv"
          ? readCsv(own.bytes.toString())
          : await readXlsx(own.bytes);
      expect(new Set(ownRows.map((row) => row.officialEmployeeId))).toEqual(
        new Set(["TEST-EMP-001"]),
      );
    }
  });
  it("rejects cross-department creation/imports/updates and rechecks previews at commit", async () => {
    expect(
      (await scoped.post("/api/v1/admin/employees", create("BAD-CREATE", b)))
        .status,
    ).toBe(403);
    for (const action of ["preview", "commit"])
      expect(
        (
          await scoped.post(`/api/v1/admin/data/import/${action}`, {
            rows: [create("BAD-JSON", b)],
          })
        ).status,
      ).toBe(403);
    for (const xlsx of [false, true]) {
      const result = await preview(
        scoped,
        [{ rowType: "PROFILE", action: "CREATE", ...create(`BAD-${xlsx}`, b) }],
        xlsx,
      );
      expect(result.status).toBe(200);
      expect(result.body.results).toMatchObject([{ valid: false }]);
      expect(
        (
          await scoped.post("/api/v1/admin/data/files/commit", {
            previewId: result.body.previewId,
            selected: [2],
          })
        ).status,
      ).toBe(409);
    }
    const hidden = await preview(scoped, [
      {
        rowType: "PROFILE",
        action: "UPDATE",
        officialEmployeeId: "SCOPE-B",
        firstNameEn: "Forbidden",
      },
    ]);
    expect(hidden.body.results).toMatchObject([{ valid: false }]);
    const transfer = await preview(scoped, [
      {
        rowType: "PROFILE",
        action: "UPDATE",
        officialEmployeeId: "SCOPE-A",
        departmentId: b,
      },
    ]);
    expect(transfer.body.results).toMatchObject([{ valid: false }]);
    const good = await preview(
      scoped,
      [{ rowType: "PROFILE", action: "CREATE", ...create("GOOD-IMPORT", a) }],
      true,
    );
    expect(good.body.results).toMatchObject([{ valid: true }]);
    expect(
      (
        await scoped.post("/api/v1/admin/data/files/commit", {
          previewId: good.body.previewId,
          selected: [2],
        })
      ).status,
    ).toBe(200);
    const stale = await preview(scoped, [
      { rowType: "PROFILE", action: "CREATE", ...create("STALE-IMPORT", a) },
    ]);
    expect(
      (
        await full.put(accessPath(), {
          accessLevel: "DEPARTMENT",
          departmentId: b,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await scoped.post("/api/v1/admin/data/files/commit", {
          previewId: stale.body.previewId,
          selected: [2],
        })
      ).status,
    ).toBe(409);
    expect((await scoped.get(`/api/v1/admin/employees/${aId}`)).status).toBe(
      403,
    );
    expect((await scoped.get(`/api/v1/admin/employees/${bId}`)).status).toBe(
      200,
    );
    expect(
      (
        await full.put(accessPath(), {
          accessLevel: "DEPARTMENT",
          departmentId: a,
        })
      ).status,
    ).toBe(200);
  });
  it("follows current department for historical records and existing sessions", async () => {
    expect(
      (await full.patch(`/api/v1/admin/employees/${aId}`, { departmentId: b }))
        .status,
    ).toBe(200);
    expect((await scoped.get(`/api/v1/admin/employees/${aId}`)).status).toBe(
      403,
    );
    expect((await scoped.get("/api/v1/admin/leaves")).body.items).toEqual([]);
    expect(
      (await scoped.get("/api/v1/admin/change-requests")).body.items,
    ).toEqual([]);
    expect((await scoped.get("/api/v1/overview/stats")).body).toMatchObject({
      requests: 0,
      onLeave: 0,
    });
    expect((await full.put(accessPath(), { accessLevel: "FULL" })).status).toBe(
      200,
    );
    expect((await scoped.get(`/api/v1/admin/employees/${aId}`)).status).toBe(
      200,
    );
    // A granted full-access admin cannot even change their own access; only the root can.
    expect(
      (await scoped.put(accessPath(), { accessLevel: "NONE" })).status,
    ).toBe(403);
    expect((await scoped.get("/api/v1/admin/employees")).status).toBe(200);
    expect((await full.put(accessPath(), { accessLevel: "NONE" })).status).toBe(
      200,
    );
    expect((await scoped.get("/api/v1/admin/employees")).status).toBe(403);
    expect((await scoped.get("/api/v1/me/profile")).status).toBe(200);
    expect(
      (
        await full.put(`/api/v1/admin/employees/${fullId}/admin-access`, {
          accessLevel: "NONE",
        })
      ).status,
    ).toBe(409);
  });
  it("enforces role/scope consistency and the department foreign key in PostgreSQL", async () => {
    for (const sql of [
      "UPDATE users SET role='ADMIN',admin_scope=NULL WHERE employee_id=$1",
      "UPDATE users SET role='EMPLOYEE',admin_scope='FULL' WHERE employee_id=$1",
      "UPDATE users SET role='ADMIN',admin_scope='DEPARTMENT',administered_department_id=NULL WHERE employee_id=$1",
      "UPDATE users SET role='ADMIN',admin_scope='FULL',administered_department_id='00000000-0000-4000-8000-000000000000' WHERE employee_id=$1",
      "UPDATE users SET role='ADMIN',admin_scope='DEPARTMENT',administered_department_id='00000000-0000-4000-8000-000000000000' WHERE employee_id=$1",
    ])
      await expect(testPool.query(sql, [scopedId])).rejects.toThrow();
  });
});
