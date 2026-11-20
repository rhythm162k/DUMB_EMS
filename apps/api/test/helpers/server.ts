import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import {
  createFixtures,
  prepareDatabase,
  closeDatabase,
  testPool,
} from "./database.js";

export type EmployeeJson = {
  id: string;
  officialEmployeeId: string;
  employmentStatus: string;
  firstNameEn: string;
  nationalId?: string | null;
  department?: { id: string; nameEn: string | null } | null;
  account?: {
    role: string;
    accountStatus: string | null;
    mustChangePassword: boolean | null;
  } | null;
  [key: string]: unknown;
};

export type JsonResponse = {
  [key: string]: unknown;
  error?: { code?: string; message?: string };
  user?: { id?: string; role?: string; mustChangePassword?: boolean };
  csrfToken?: string;
  temporaryPassword?: string;
  mustChangePassword?: boolean;
  dependencies?: { database?: string };
  employee?: EmployeeJson | null;
  profile?: EmployeeJson;
  items?: Array<
    EmployeeJson & { accountStatus?: string | null; role?: string | null }
  >;
  departments?: Array<{
    id: string;
    nameEn: string;
    nameBn?: string | null;
    isActive?: boolean;
    employeeCount?: number;
  }>;
  department?: {
    id: string;
    nameEn: string;
    nameBn?: string | null;
    isActive: boolean;
    employeeCount: number;
  } | null;
  // Repeatable PDS sections, keyed by section (employee detail and own profile).
  records?: Record<string, Array<Record<string, unknown>>>;
  // A single PDS record (create/update responses).
  record?: Record<string, unknown> | null;
  deleted?: boolean;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  changed?: boolean;
  // Single spouse record (or null) and profile image URL.
  spouse?: Record<string, unknown> | null;
  profileImageUrl?: string | null;
};

export class ApiClient {
  private cookie = "";
  private csrfToken = "";

  constructor(private readonly baseUrl: string) {}

  get(path: string) {
    return this.send("GET", path);
  }

  post(path: string, body?: unknown, includeCsrf = true) {
    return this.send("POST", path, body, includeCsrf);
  }

  put(path: string, body?: unknown, includeCsrf = true) {
    return this.send("PUT", path, body, includeCsrf);
  }

  patch(path: string, body?: unknown, includeCsrf = true) {
    return this.send("PATCH", path, body, includeCsrf);
  }

  delete(path: string, includeCsrf = true) {
    return this.send("DELETE", path, undefined, includeCsrf);
  }

  // Sends a raw (non-JSON) body such as an image.
  async postBinary(
    path: string,
    body: Buffer | string,
    contentType: string,
    includeCsrf = true,
  ) {
    const headers: Record<string, string> = { "Content-Type": contentType };
    if (this.cookie) headers.Cookie = this.cookie;
    if (includeCsrf && this.csrfToken) headers["X-CSRF-Token"] = this.csrfToken;
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: typeof body === "string" ? body : new Uint8Array(body),
    });
    const payload = (await response.json().catch(() => ({}))) as JsonResponse;
    return {
      status: response.status,
      body: payload,
      headers: response.headers,
    };
  }

  // Fetches a binary response such as a profile image.
  async getBinary(path: string) {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.Cookie = this.cookie;
    const response = await fetch(`${this.baseUrl}${path}`, { headers });
    return {
      status: response.status,
      headers: response.headers,
      bytes: Buffer.from(await response.arrayBuffer()),
    };
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
    if (
      response.status !== 200 ||
      typeof response.body.csrfToken !== "string"
    ) {
      throw new Error("Unable to initialize CSRF token for API test client.");
    }
    this.csrfToken = response.body.csrfToken;
    return response;
  }
}

export async function startTestApi() {
  await prepareDatabase();
  const fixtures = await createFixtures();
  const { default: app } = await import("../../src/app.js");
  const server: Server = app.listen(0);
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${address.port}`, fixtures, server };
}

export async function stopTestApi(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await testPool.query('DELETE FROM "session"').catch(() => undefined);
  await closeDatabase();
  const { pool } = await import("../../src/config/database.js");
  await pool.end();
}

export async function signInAndCompleteAdminPasswordChange(baseUrl: string) {
  const client = new ApiClient(baseUrl);
  await client.initializeCsrf();
  let login = await client.post("/api/v1/auth/login", {
    employeeId: "TEST-ADMIN-001",
    password: "Admin-temp-Password-123",
  });
  if (login.status !== 200) {
    login = await client.post("/api/v1/auth/login", {
      employeeId: "TEST-ADMIN-001",
      password: "Admin-new-Password-456",
    });
  }
  if (login.status !== 200) throw new Error("Test admin could not sign in.");
  if (login.body.user?.mustChangePassword) {
    const changed = await client.post(
      "/api/v1/auth/first-login/change-password",
      {
        newPassword: "Admin-new-Password-456",
      },
    );
    if (changed.status !== 200)
      throw new Error(
        "Test admin could not complete first-login password change.",
      );
  }
  return client;
}
