import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { existsSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
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
let employeeRecordId = "";
let operationsDepartmentId = "";

const imageDir = () => process.env.PROFILE_IMAGE_DIR ?? "";
const filesOnDisk = () =>
  existsSync(imageDir()) ? readdirSync(imageDir()) : [];
const keyOf = (url: string | null | undefined) =>
  (url ?? "").split("/").pop() ?? "";

// Minimal but structurally valid images (fictional, 1x1 pixel).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from("JFIF\0"),
  Buffer.alloc(32),
  Buffer.from([0xff, 0xd9]),
]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF"),
  Buffer.from([0x20, 0, 0, 0]),
  Buffer.from("WEBPVP8 "),
  Buffer.alloc(24),
]);

async function employeeSignIn() {
  const client = new ApiClient(baseUrl);
  await client.initializeCsrf();
  const login = await client.post("/api/v1/auth/login", {
    employeeId: "TEST-EMP-001",
    password: "Employee-temp-Password-123",
  });
  expect(login.status).toBe(200);
  return client;
}

beforeAll(async () => {
  const setup = await startTestApi();
  baseUrl = setup.baseUrl;
  server = setup.server;
  employeeRecordId = setup.fixtures.employeeRecordId;
  const departments = await testPool.query<{ id: string; name_en: string }>(
    "SELECT id, name_en FROM departments",
  );
  operationsDepartmentId = departments.rows.find(
    (row) => row.name_en === "Operations",
  )!.id;
  admin = await signInAndCompleteAdminPasswordChange(baseUrl);
});

afterAll(async () => {
  if (server) await stopTestApi(server);
  await rm(imageDir(), { recursive: true, force: true });
});

describe("Employee profile image", () => {
  let firstUrl = "";
  let secondUrl = "";

  it("lets an employee upload their own PNG and serves it back unchanged", async () => {
    const client = await employeeSignIn();
    const upload = await client.postBinary(
      "/api/v1/me/profile-image",
      PNG,
      "image/png",
    );
    expect(upload.status).toBe(200);
    firstUrl = upload.body.profileImageUrl ?? "";
    expect(firstUrl).toMatch(
      /^\/api\/v1\/files\/profile-images\/[a-f0-9]{32}\.png$/,
    );

    const image = await client.getBinary(firstUrl);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    expect(image.headers.get("x-content-type-options")).toBe("nosniff");
    expect(image.headers.get("cache-control")).toContain("private");
    expect(image.bytes.equals(PNG)).toBe(true);

    const profile = await client.get("/api/v1/me/profile");
    expect(profile.body.profile?.profileImageUrl).toBe(firstUrl);
    expect(filesOnDisk()).toEqual([keyOf(firstUrl)]);
  });

  it("replaces the image, deletes the old file and revokes the old URL", async () => {
    const client = await employeeSignIn();
    const upload = await client.postBinary(
      "/api/v1/me/profile-image",
      JPEG,
      "image/jpeg",
    );
    expect(upload.status).toBe(200);
    secondUrl = upload.body.profileImageUrl ?? "";
    expect(secondUrl).toMatch(/\.jpg$/);
    expect(secondUrl).not.toBe(firstUrl);

    expect((await client.getBinary(firstUrl)).status).toBe(404);
    expect(
      (await client.getBinary(secondUrl)).headers.get("content-type"),
    ).toBe("image/jpeg");
    expect(filesOnDisk()).toEqual([keyOf(secondUrl)]);
  });

  it("accepts WebP", async () => {
    const client = await employeeSignIn();
    const upload = await client.postBinary(
      "/api/v1/me/profile-image",
      WEBP,
      "image/webp",
    );
    expect(upload.status).toBe(200);
    expect(upload.body.profileImageUrl).toMatch(/\.webp$/);
    secondUrl = upload.body.profileImageUrl ?? "";
  });

  it("rejects SVG, mislabelled files, empty bodies and non-image types without storing anything", async () => {
    const client = await employeeSignIn();
    const before = filesOnDisk();
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");

    const svgByType = await client.postBinary(
      "/api/v1/me/profile-image",
      svg,
      "image/svg+xml",
    );
    expect(svgByType.status).toBe(415);
    expect(svgByType.body.error?.code).toBe("UNSUPPORTED_MEDIA_TYPE");

    for (const [bytes, type] of [
      [svg, "image/png"],
      [pdf, "image/jpeg"],
      [Buffer.from("MZ executable"), "image/webp"],
      [JPEG, "image/png"], // real JPEG labelled as PNG
      [Buffer.from("GIF89a" + "x".repeat(40)), "image/png"],
    ] as const) {
      const response = await client.postBinary(
        "/api/v1/me/profile-image",
        bytes,
        type,
      );
      expect(response.status).toBe(415);
      expect(response.body.error?.code).toBe("INVALID_IMAGE");
    }

    expect(
      (
        await client.postBinary(
          "/api/v1/me/profile-image",
          Buffer.alloc(0),
          "image/png",
        )
      ).status,
    ).toBe(415);
    expect(
      (
        await client.postBinary(
          "/api/v1/me/profile-image",
          "{}",
          "application/json",
        )
      ).status,
    ).toBe(415);
    expect(filesOnDisk()).toEqual(before);
  });

  it("rejects an image over 5 MB with 413 and accepts one of exactly 5 MB", async () => {
    const client = await employeeSignIn();
    const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const tooLarge = Buffer.concat([
      header,
      Buffer.alloc(5 * 1024 * 1024 + 1 - header.length),
    ]);
    const rejected = await client.postBinary(
      "/api/v1/me/profile-image",
      tooLarge,
      "image/jpeg",
    );
    expect(rejected.status).toBe(413);
    expect(rejected.body.error?.code).toBe("PAYLOAD_TOO_LARGE");

    const exact = Buffer.concat([
      header,
      Buffer.alloc(5 * 1024 * 1024 - header.length),
    ]);
    const accepted = await client.postBinary(
      "/api/v1/me/profile-image",
      exact,
      "image/jpeg",
    );
    expect(accepted.status).toBe(200);
    secondUrl = accepted.body.profileImageUrl ?? "";
  });

  it("requires sign-in, a CSRF token and an active employee account", async () => {
    const anonymous = new ApiClient(baseUrl);
    await anonymous.initializeCsrf();
    expect(
      (await anonymous.postBinary("/api/v1/me/profile-image", PNG, "image/png"))
        .status,
    ).toBe(401);
    expect((await anonymous.getBinary(secondUrl)).status).toBe(401);

    const client = await employeeSignIn();
    const noCsrf = await client.postBinary(
      "/api/v1/me/profile-image",
      PNG,
      "image/png",
      false,
    );
    expect(noCsrf.status).toBe(403);

    // Administrators retain personal employee features on their linked record.
    expect(
      (await admin.postBinary("/api/v1/me/profile-image", PNG, "image/png"))
        .status,
    ).toBe(200);
    expect((await admin.delete("/api/v1/me/profile-image")).status).toBe(200);
  });

  it("is only readable by the owner and the Admin; other employees and odd keys get 404", async () => {
    const created = await admin.post("/api/v1/admin/employees", {
      officialEmployeeId: "000501",
      firstNameEn: "Other",
      departmentId: operationsDepartmentId,
      gender: "FEMALE",
      bloodGroup: "B+",
    });
    expect(created.status).toBe(201);
    const other = new ApiClient(baseUrl);
    await other.initializeCsrf();
    await other.post("/api/v1/auth/login", {
      employeeId: "000501",
      password: created.body.temporaryPassword,
    });
    const changed = await other.post(
      "/api/v1/auth/first-login/change-password",
      {
        newPassword: "Other-new-Password-789",
      },
    );
    expect(changed.status).toBe(200);

    expect((await other.getBinary(secondUrl)).status).toBe(404);
    expect((await admin.getBinary(secondUrl)).status).toBe(200);

    const owner = await employeeSignIn();
    expect((await owner.getBinary(secondUrl)).status).toBe(200);
    expect(
      (
        await owner.getBinary(
          "/api/v1/files/profile-images/..%2F..%2Fetc%2Fpasswd",
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await owner.getBinary(
          "/api/v1/files/profile-images/" + "a".repeat(32) + ".png",
        )
      ).status,
    ).toBe(404);
  });

  it("audits uploads and removals with the format only", async () => {
    const audit = await testPool.query(
      "SELECT action, metadata FROM audit_logs WHERE action LIKE 'PROFILE_IMAGE_%' AND entity_id = $1 ORDER BY occurred_at",
      [employeeRecordId],
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(3);
    expect(audit.rows[0].action).toBe("PROFILE_IMAGE_UPLOADED");
    expect(audit.rows[0].metadata).toEqual({ format: "png", replaced: false });
    expect(audit.rows[1].metadata).toEqual({ format: "jpeg", replaced: true });
  });

  it("lets the employee remove their image; a second removal is 404", async () => {
    const client = await employeeSignIn();
    const removed = await client.delete("/api/v1/me/profile-image");
    expect(removed.status).toBe(200);
    expect(removed.body.deleted).toBe(true);
    expect((await client.getBinary(secondUrl)).status).toBe(404);
    expect(filesOnDisk()).toEqual([]);
    expect(
      (await client.get("/api/v1/me/profile")).body.profile?.profileImageUrl,
    ).toBeNull();

    const again = await client.delete("/api/v1/me/profile-image");
    expect(again.status).toBe(404);
    expect(again.body.error?.code).toBe("NO_PROFILE_IMAGE");
  });
});

describe("Admin profile image management", () => {
  const adminPath = (id = employeeRecordId) =>
    `/api/v1/admin/employees/${id}/profile-image`;

  it("lets the Admin upload and remove any employee's image", async () => {
    const upload = await admin.postBinary(adminPath(), PNG, "image/png");
    expect(upload.status).toBe(200);
    const url = upload.body.profileImageUrl ?? "";

    const detail = await admin.get(
      `/api/v1/admin/employees/${employeeRecordId}`,
    );
    expect(detail.body.employee?.profileImageUrl).toBe(url);
    expect((await admin.getBinary(url)).bytes.equals(PNG)).toBe(true);

    const removed = await admin.delete(adminPath());
    expect(removed.status).toBe(200);
    expect((await admin.getBinary(url)).status).toBe(404);
  });

  it("returns 404 for an unknown employee and stores nothing, and 400 for a malformed ID", async () => {
    const before = filesOnDisk();
    const unknown = await admin.postBinary(
      adminPath("00000000-0000-4000-8000-000000000000"),
      PNG,
      "image/png",
    );
    expect(unknown.status).toBe(404);
    expect(filesOnDisk()).toEqual(before);
    expect(
      (await admin.postBinary(adminPath("not-a-uuid"), PNG, "image/png"))
        .status,
    ).toBe(400);
  });

  it("is not available to employees", async () => {
    const client = await employeeSignIn();
    expect(
      (await client.postBinary(adminPath(), PNG, "image/png")).status,
    ).toBe(403);
    expect((await client.delete(adminPath())).status).toBe(403);
  });
});
