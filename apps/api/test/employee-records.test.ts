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
let employeeId = "";
let otherEmployeeId = "";
let fixtureEmployeeRecordId = "";
let operationsDepartmentId = "";

const sectionPath = (slug: string, id = employeeId) =>
  `/api/v1/admin/employees/${id}/records/${slug}`;

// One valid payload and one valid edit per section. The `responseKey` is where the section
// appears in the employee detail and own-profile `records` object.
const sections = () => [
  {
    slug: "qualifications",
    responseKey: "academicQualifications",
    create: {
      institution: "Demo University",
      degree: "BSc",
      subject: "Marine Studies",
      passingYear: 2012,
      result: "First Class",
    },
    edit: { result: "Second Class" },
    editedField: "result",
    editedValue: "Second Class",
  },
  {
    slug: "training",
    responseKey: "trainingRecords",
    create: {
      title: "Safety Basics",
      provider: "Demo Institute",
      location: "Dhaka",
      startDate: "2020-01-10",
      endDate: "2020-01-15",
      remarks: "Fictional",
    },
    edit: { location: "Chattogram" },
    editedField: "location",
    editedValue: "Chattogram",
  },
  {
    slug: "service-history",
    responseKey: "serviceHistory",
    create: {
      organization: "Demo Shipping Ltd",
      designation: "Clerk",
      startDate: "2010-01-01",
      endDate: "2014-12-31",
      description: "Fictional role",
    },
    edit: { designation: "Senior Clerk" },
    editedField: "designation",
    editedValue: "Senior Clerk",
  },
  {
    slug: "posting-history",
    responseKey: "postingHistory",
    create: {
      departmentId: operationsDepartmentId,
      officeName: "Demo Office",
      designation: "Officer",
      startDate: "2015-01-01",
      endDate: "2016-01-01",
      orderReference: "ORD-1",
    },
    edit: { officeName: "Other Office" },
    editedField: "officeName",
    editedValue: "Other Office",
  },
  {
    slug: "memberships",
    responseKey: "professionalMemberships",
    create: {
      organization: "Demo Society",
      membershipNumber: "M-1",
      membershipType: "Life",
      startDate: "2015-01-01",
    },
    edit: { membershipType: "Annual" },
    editedField: "membershipType",
    editedValue: "Annual",
  },
  {
    slug: "publications",
    responseKey: "publications",
    create: {
      title: "Fictional Paper",
      publicationName: "Demo Journal",
      publicationDate: "2019-05-01",
      referenceUrl: "https://example.test/paper",
    },
    edit: { publicationName: "Another Journal" },
    editedField: "publicationName",
    editedValue: "Another Journal",
  },
];

async function createEmployee(
  officialEmployeeId: string,
  firstNameEn: string,
): Promise<string> {
  const response = await admin.post("/api/v1/admin/employees", {
    officialEmployeeId,
    firstNameEn,
    departmentId: operationsDepartmentId,
    gender: "MALE",
    bloodGroup: "O+",
  });
  expect(response.status).toBe(201);
  return response.body.employee!.id;
}

beforeAll(async () => {
  const setup = await startTestApi();
  baseUrl = setup.baseUrl;
  server = setup.server;
  fixtureEmployeeRecordId = setup.fixtures.employeeRecordId;
  const departments = await testPool.query<{ id: string; name_en: string }>(
    "SELECT id, name_en FROM departments",
  );
  operationsDepartmentId = departments.rows.find(
    (row) => row.name_en === "Operations",
  )!.id;
  admin = await signInAndCompleteAdminPasswordChange(baseUrl);
  employeeId = await createEmployee("000401", "Records");
  otherEmployeeId = await createEmployee("000402", "Other");
});

afterAll(async () => {
  if (server) await stopTestApi(server);
});

describe("Admin PDS record sections: create, read, update, delete", () => {
  for (const name of [
    "qualifications",
    "training",
    "service-history",
    "posting-history",
    "memberships",
    "publications",
  ]) {
    it(`manages ${name} records end to end`, async () => {
      const section = sections().find((entry) => entry.slug === name)!;

      const created = await admin.post(
        sectionPath(section.slug),
        section.create,
      );
      expect(created.status).toBe(201);
      const recordId = created.body.record!.id as string;
      for (const [key, value] of Object.entries(section.create)) {
        expect(created.body.record![key], `${section.slug}.${key}`).toBe(value);
      }

      const list = await admin.get(sectionPath(section.slug));
      expect(list.status).toBe(200);
      expect(list.body.items).toHaveLength(1);

      // The same data appears in the employee detail.
      const detail = await admin.get(`/api/v1/admin/employees/${employeeId}`);
      expect(detail.status).toBe(200);
      expect(detail.body.records?.[section.responseKey]).toHaveLength(1);
      expect(detail.body.records?.[section.responseKey][0].id).toBe(recordId);

      const edited = await admin.patch(
        `${sectionPath(section.slug)}/${recordId}`,
        section.edit,
      );
      expect(edited.status).toBe(200);
      expect(edited.body.changed).toBe(true);
      expect(edited.body.record![section.editedField]).toBe(
        section.editedValue,
      );

      const repeated = await admin.patch(
        `${sectionPath(section.slug)}/${recordId}`,
        section.edit,
      );
      expect(repeated.status).toBe(200);
      expect(repeated.body.changed).toBe(false);

      const removed = await admin.delete(
        `${sectionPath(section.slug)}/${recordId}`,
      );
      expect(removed.status).toBe(200);
      expect(removed.body.deleted).toBe(true);
      const afterDelete = await admin.get(sectionPath(section.slug));
      expect(afterDelete.body.items).toHaveLength(0);
      expect(
        (await admin.delete(`${sectionPath(section.slug)}/${recordId}`)).status,
      ).toBe(404);
    });
  }

  it("clears optional values with null and keeps required values", async () => {
    const created = await admin.post(sectionPath("qualifications"), {
      institution: "Clearing Institute",
      degree: "Diploma",
      subject: "Engineering",
    });
    const recordId = created.body.record!.id as string;
    const cleared = await admin.patch(
      `${sectionPath("qualifications")}/${recordId}`,
      { subject: null, result: "" },
    );
    expect(cleared.status).toBe(200);
    expect(cleared.body.record!.subject).toBeNull();
    expect(cleared.body.record!.institution).toBe("Clearing Institute");
    await admin.delete(`${sectionPath("qualifications")}/${recordId}`);
  });

  it("audits create, update and delete without writing any field values", async () => {
    const created = await admin.post(sectionPath("publications"), {
      title: "Audited Secret Title",
      referenceUrl: "https://example.test/audited",
    });
    const recordId = created.body.record!.id as string;
    await admin.patch(`${sectionPath("publications")}/${recordId}`, {
      publicationName: "Audited Journal Name",
    });
    await admin.delete(`${sectionPath("publications")}/${recordId}`);

    const audit = await testPool.query(
      "SELECT action, entity_type, metadata FROM audit_logs WHERE entity_id = $1 ORDER BY occurred_at ASC, action ASC",
      [recordId],
    );
    expect(audit.rows.map((row) => row.action).sort()).toEqual([
      "EMPLOYEE_RECORD_CREATED",
      "EMPLOYEE_RECORD_DELETED",
      "EMPLOYEE_RECORD_UPDATED",
    ]);
    for (const row of audit.rows) {
      expect(row.entity_type).toBe("publications");
      expect(row.metadata.employeeId).toBe(employeeId);
      expect(row.metadata.section).toBe("publications");
    }
    const serialized = JSON.stringify(audit.rows);
    expect(serialized).not.toContain("Audited Secret Title");
    expect(serialized).not.toContain("Audited Journal Name");
    expect(serialized).not.toContain("example.test");
    const updated = audit.rows.find(
      (row) => row.action === "EMPLOYEE_RECORD_UPDATED",
    );
    expect(updated?.metadata.changedFields).toEqual(["publicationName"]);
  });
});

describe("Admin PDS record validation and isolation", () => {
  it("rejects missing required fields and null for required fields", async () => {
    const missing = await admin.post(sectionPath("qualifications"), {
      degree: "BSc",
    });
    expect(missing.status).toBe(400);
    expect(missing.body.error?.code).toBe("VALIDATION_ERROR");
    expect((await admin.post(sectionPath("training"), {})).status).toBe(400);
    expect(
      (
        await admin.post(sectionPath("service-history"), {
          organization: "Only Org",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin.post(sectionPath("memberships"), {
          membershipNumber: "M-9",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin.post(sectionPath("publications"), {
          publicationName: "No title",
        })
      ).status,
    ).toBe(400);
    // A posting must name something.
    expect(
      (
        await admin.post(sectionPath("posting-history"), {
          orderReference: "ORD-2",
        })
      ).status,
    ).toBe(400);

    const created = await admin.post(sectionPath("qualifications"), {
      institution: "Null Test",
      degree: "BSc",
    });
    const recordId = created.body.record!.id as string;
    const nulled = await admin.patch(
      `${sectionPath("qualifications")}/${recordId}`,
      { institution: null },
    );
    expect(nulled.status).toBe(400);
    const emptyBody = await admin.patch(
      `${sectionPath("qualifications")}/${recordId}`,
      {},
    );
    expect(emptyBody.status).toBe(400);
    await admin.delete(`${sectionPath("qualifications")}/${recordId}`);
  });

  it("rejects unknown keys so ownership and ids cannot be mass-assigned", async () => {
    for (const extra of [
      { employeeId: otherEmployeeId },
      { id: "00000000-0000-4000-8000-000000000000" },
      { createdAt: "2020-01-01" },
    ]) {
      const response = await admin.post(sectionPath("qualifications"), {
        institution: "Mass Assign",
        degree: "BSc",
        ...extra,
      });
      expect(response.status, JSON.stringify(extra)).toBe(400);
    }
    const leftovers = await testPool.query(
      "SELECT 1 FROM academic_qualifications WHERE institution = 'Mass Assign'",
    );
    expect(leftovers.rowCount).toBe(0);
  });

  it("rejects invalid dates, years and URLs", async () => {
    const reversed = await admin.post(sectionPath("training"), {
      title: "Reversed",
      startDate: "2020-02-01",
      endDate: "2020-01-01",
    });
    expect(reversed.status).toBe(400);
    expect(
      (
        await admin.post(sectionPath("training"), {
          title: "Bad date",
          startDate: "01/02/2020",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin.post(sectionPath("qualifications"), {
          institution: "Old",
          degree: "BSc",
          passingYear: 1800,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin.post(sectionPath("qualifications"), {
          institution: "Float",
          degree: "BSc",
          passingYear: 2010.5,
        })
      ).status,
    ).toBe(400);
    for (const referenceUrl of [
      "javascript:alert(1)",
      "ftp://example.test/file",
      "not a url",
    ]) {
      const response = await admin.post(sectionPath("publications"), {
        title: "Bad link",
        referenceUrl,
      });
      expect(response.status, referenceUrl).toBe(400);
    }
  });

  it("checks the date order against the stored value on update", async () => {
    const created = await admin.post(sectionPath("service-history"), {
      organization: "Range Org",
      designation: "Clerk",
      startDate: "2010-01-01",
      endDate: "2012-01-01",
    });
    const recordId = created.body.record!.id as string;
    const tooEarly = await admin.patch(
      `${sectionPath("service-history")}/${recordId}`,
      { endDate: "2009-01-01" },
    );
    expect(tooEarly.status).toBe(400);
    const tooLate = await admin.patch(
      `${sectionPath("service-history")}/${recordId}`,
      { startDate: "2013-01-01" },
    );
    expect(tooLate.status).toBe(400);
    const stored = await testPool.query(
      "SELECT to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date FROM service_history WHERE id = $1",
      [recordId],
    );
    expect(stored.rows[0]).toEqual({
      start_date: "2010-01-01",
      end_date: "2012-01-01",
    });
    await admin.delete(`${sectionPath("service-history")}/${recordId}`);
  });

  it("rejects an unknown department in a posting", async () => {
    const response = await admin.post(sectionPath("posting-history"), {
      departmentId: "00000000-0000-4000-8000-000000000000",
      officeName: "Nowhere",
    });
    expect(response.status).toBe(400);
    expect(response.body.error?.code).toBe("DEPARTMENT_INVALID");
  });

  it("treats another employee's record as not found", async () => {
    const created = await admin.post(
      sectionPath("qualifications", otherEmployeeId),
      {
        institution: "Other Employee Institute",
        degree: "MSc",
      },
    );
    expect(created.status).toBe(201);
    const recordId = created.body.record!.id as string;

    // Addressing the record through the wrong employee must not read, change or delete it.
    const edit = await admin.patch(
      `${sectionPath("qualifications")}/${recordId}`,
      { degree: "PhD" },
    );
    expect(edit.status).toBe(404);
    expect(edit.body.error?.code).toBe("RECORD_NOT_FOUND");
    expect(
      (await admin.delete(`${sectionPath("qualifications")}/${recordId}`))
        .status,
    ).toBe(404);
    const stored = await testPool.query(
      "SELECT degree FROM academic_qualifications WHERE id = $1",
      [recordId],
    );
    expect(stored.rows[0].degree).toBe("MSc");
  });

  it("rejects unknown sections, malformed IDs and unknown employees", async () => {
    expect((await admin.get(sectionPath("hobbies"))).status).toBe(404);
    expect(
      (await admin.post(sectionPath("hobbies"), { title: "x" })).status,
    ).toBe(404);
    expect(
      (await admin.get(sectionPath("qualifications", "not-a-uuid"))).status,
    ).toBe(400);
    expect(
      (
        await admin.patch(`${sectionPath("qualifications")}/not-a-uuid`, {
          degree: "x",
        })
      ).status,
    ).toBe(400);
    expect(
      (await admin.delete(`${sectionPath("qualifications")}/not-a-uuid`))
        .status,
    ).toBe(400);

    const missingEmployee = "00000000-0000-4000-8000-000000000000";
    const create = await admin.post(
      sectionPath("qualifications", missingEmployee),
      { institution: "Ghost", degree: "BSc" },
    );
    expect(create.status).toBe(404);
    expect(create.body.error?.code).toBe("EMPLOYEE_NOT_FOUND");
    expect(
      (await admin.get(sectionPath("qualifications", missingEmployee))).status,
    ).toBe(404);
  });

  it("denies employees and anonymous callers", async () => {
    const anonymous = new ApiClient(baseUrl);
    await anonymous.initializeCsrf();
    expect((await anonymous.get(sectionPath("qualifications"))).status).toBe(
      401,
    );
    expect(
      (
        await anonymous.post(sectionPath("qualifications"), {
          institution: "Anon",
          degree: "BSc",
        })
      ).status,
    ).toBe(401);

    const employee = new ApiClient(baseUrl);
    await employee.initializeCsrf();
    const login = await employee.post("/api/v1/auth/login", {
      employeeId: "TEST-EMP-001",
      password: "Employee-temp-Password-123",
    });
    expect(login.status).toBe(200);
    expect(
      (
        await employee.get(
          sectionPath("qualifications", fixtureEmployeeRecordId),
        )
      ).status,
    ).toBe(403);
    const forbidden = await employee.post(
      sectionPath("qualifications", fixtureEmployeeRecordId),
      {
        institution: "Self Added",
        degree: "BSc",
      },
    );
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error?.code).toBe("FORBIDDEN");
    const leftovers = await testPool.query(
      "SELECT 1 FROM academic_qualifications WHERE institution IN ('Anon', 'Self Added')",
    );
    expect(leftovers.rowCount).toBe(0);
  });
});

describe("Employee sees only their own PDS records", () => {
  it("returns the signed-in employee's records in the own-profile response", async () => {
    const own = await admin.post(
      sectionPath("qualifications", fixtureEmployeeRecordId),
      {
        institution: "Own Institute",
        degree: "BSc",
        passingYear: 2015,
      },
    );
    expect(own.status).toBe(201);
    const training = await admin.post(
      sectionPath("training", fixtureEmployeeRecordId),
      { title: "Own Training" },
    );
    expect(training.status).toBe(201);

    const employee = new ApiClient(baseUrl);
    await employee.initializeCsrf();
    const login = await employee.post("/api/v1/auth/login", {
      employeeId: "TEST-EMP-001",
      password: "Employee-temp-Password-123",
    });
    expect(login.status).toBe(200);

    const profile = await employee.get("/api/v1/me/profile");
    expect(profile.status).toBe(200);
    expect(profile.body.records?.academicQualifications).toHaveLength(1);
    expect(profile.body.records?.academicQualifications[0].institution).toBe(
      "Own Institute",
    );
    expect(profile.body.records?.trainingRecords).toHaveLength(1);
    expect(profile.body.records?.publications).toHaveLength(0);

    // Records created for other employees never appear in this response.
    const serialized = JSON.stringify(profile.body);
    expect(serialized).not.toContain("Other Employee Institute");
    expect(serialized).not.toContain("000402");

    // Employees cannot write records directly; the profile endpoint is read-only.
    expect(
      (await employee.patch("/api/v1/me/profile", { designation: "Boss" }))
        .status,
    ).toBe(404);
  });
});
