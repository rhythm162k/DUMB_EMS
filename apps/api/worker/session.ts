import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "cloudflare:workers";
import {
  Router,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { z } from "zod";
import { nowSeconds, provisionWorkspace } from "./workspaces.js";

const selection = z.strictObject({
  persona: z.enum([
    "root",
    "full-admin",
    "operations-admin",
    "people-admin",
    "employee",
  ]),
});
export type Persona = z.infer<typeof selection>["persona"];
const cookieName = "__Host-ems-demo";
const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
} as const;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const csrfPattern = /^[A-Za-z0-9_-]{32}$/;

export class DemoHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

type SessionRow = {
  workspaceId: string;
  csrfToken: string;
  expiresAt: number;
  id: string;
  persona: Persona;
  role: "ADMIN" | "EMPLOYEE";
  adminScope: "FULL" | "DEPARTMENT" | null;
  administeredDepartmentId: string | null;
  isRoot: 0 | 1;
  employeeRecordId: string;
  employeeId: string;
  firstName: string;
  lastName: string | null;
  employmentStatus: "ACTIVE";
};

export type DemoSession = SessionRow & { tokenHash: string };
declare global {
  namespace Express {
    interface Request {
      demoSession?: DemoSession;
    }
  }
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function presentedTokenHash(req: Request): string | null {
  const header = req.get("Cookie");
  if (!header || header.length > 8192) return null;
  const prefix = cookieName + "=";
  const matches = header
    .split(";")
    .map((part) => part.trimStart())
    .filter((part) => part.startsWith(prefix));
  const token = matches.length === 1 ? matches[0]!.slice(prefix.length) : "";
  return tokenPattern.test(token) ? digest(token) : null;
}

function sessionQuery(tokenHash: string, now = nowSeconds()) {
  return env.DB.prepare(
    `SELECT s.workspace_id AS workspaceId, s.csrf_token AS csrfToken, w.expires_at AS expiresAt,
      u.id, u.role, u.entry_persona AS persona, u.admin_scope AS adminScope,
      u.administered_department_id AS administeredDepartmentId, u.is_root AS isRoot,
      e.id AS employeeRecordId, e.official_employee_id AS employeeId, e.first_name_en AS firstName,
      e.last_name_en AS lastName, e.employment_status AS employmentStatus
    FROM sessions s JOIN workspaces w ON w.id=s.workspace_id
    JOIN users u ON u.workspace_id=s.workspace_id AND u.id=s.user_id
    JOIN employees e ON e.workspace_id=u.workspace_id AND e.id=u.employee_id
    WHERE s.token_hash=? AND w.expires_at>? AND u.entry_persona IS NOT NULL
      AND u.account_status='ACTIVE' AND e.employment_status='ACTIVE'`,
  ).bind(tokenHash, now);
}

async function getSession(req: Request): Promise<DemoSession | null> {
  const tokenHash = presentedTokenHash(req);
  if (!tokenHash) return null;
  const row = await sessionQuery(tokenHash).first<SessionRow>();
  return row && { ...row, tokenHash };
}

function publicSession(row: SessionRow) {
  return {
    persona: row.persona,
    csrfToken: row.csrfToken,
    expiresAt: row.expiresAt,
    user: {
      id: row.id,
      role: row.role,
      adminScope: row.adminScope,
      administeredDepartmentId: row.administeredDepartmentId,
      isRoot: row.isRoot === 1,
      employeeRecordId: row.employeeRecordId,
      employeeId: row.employeeId,
      firstName: row.firstName,
      lastName: row.lastName,
      employmentStatus: row.employmentStatus,
      mustChangePassword: false,
    },
  };
}

export const requireDemoAuth: RequestHandler = async (req, _res, next) => {
  const session = await getSession(req);
  if (!session) throw new DemoHttpError(401, "UNAUTHENTICATED");
  req.demoSession = session;
  next();
};

export const requireDemoAdmin: RequestHandler = (req, _res, next) => {
  if (req.demoSession?.role !== "ADMIN")
    throw new DemoHttpError(403, "FORBIDDEN");
  next();
};

export const requireDemoRoot: RequestHandler = (req, _res, next) => {
  if (req.demoSession?.isRoot !== 1) throw new DemoHttpError(403, "FORBIDDEN");
  next();
};

function checkOrigin(req: Request) {
  // The Worker fetch entry has already checked a supplied Origin against the request URL.
  if (!req.get("Origin")) throw new DemoHttpError(403, "ORIGIN_NOT_ALLOWED");
}

function checkCsrf(req: Request, session: DemoSession) {
  checkOrigin(req);
  const supplied = req.get("X-CSRF-Token") ?? "";
  if (
    !csrfPattern.test(supplied) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(session.csrfToken))
  ) {
    throw new DemoHttpError(403, "CSRF_TOKEN_INVALID");
  }
}

export const requireDemoCsrf: RequestHandler = (req, _res, next) => {
  checkCsrf(req, req.demoSession!);
  next();
};

function newCredentials() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    hash: digest(token),
    csrf: randomBytes(24).toString("base64url"),
  };
}

function respondSession(res: Response, row: SessionRow, token: string) {
  res.cookie(cookieName, token, {
    ...cookieOptions,
    maxAge: Math.max(0, row.expiresAt - nowSeconds()) * 1000,
  });
  res.json(publicSession(row));
}

function workspaceError(error: unknown): never {
  if (error instanceof Error) {
    // D1 includes the names of the violated CHECK constraints.
    if (
      error.message.includes("issued BETWEEN") ||
      error.message.includes("workspace_retention_limit")
    )
      throw new DemoHttpError(429, "DEMO_LIMIT_REACHED");
    if (error.message.includes("CHECK constraint failed: ok = 1")) {
      throw new DemoHttpError(409, "WORKSPACE_CONFLICT");
    }
  }
  throw error;
}

const router = Router();

router.get("/session", async (req, res) => {
  const current = await getSession(req);
  res.json(current ? publicSession(current) : { user: null });
});

router.post("/session", async (req, res) => {
  checkOrigin(req);
  if (!req.is("application/json"))
    throw new DemoHttpError(415, "UNSUPPORTED_MEDIA_TYPE");
  const input = selection.safeParse(req.body);
  if (!input.success) throw new DemoHttpError(400, "VALIDATION_ERROR");

  const current = await getSession(req);
  const credentials = newCredentials();
  let row: SessionRow | null;
  if (current) {
    checkCsrf(req, current);
    const now = nowSeconds();
    const db = env.DB;
    const [updated, selected] = await db.batch<SessionRow>([
      db
        .prepare(
          `UPDATE sessions SET token_hash=?1, csrf_token=?2,
        user_id=(SELECT id FROM users WHERE workspace_id=?3 AND entry_persona=?4)
        WHERE workspace_id=?3 AND token_hash=?5
          AND EXISTS (SELECT 1 FROM workspaces WHERE id=?3 AND expires_at>?6)`,
        )
        .bind(
          credentials.hash,
          credentials.csrf,
          current.workspaceId,
          input.data.persona,
          current.tokenHash,
          now,
        ),
      sessionQuery(credentials.hash, now),
    ]);
    if (updated?.meta.changes !== 1)
      throw new DemoHttpError(409, "WORKSPACE_CONFLICT");
    row = selected?.results[0] ?? null;
  } else {
    // A request carrying a stale CSRF token cannot silently replace a workspace.
    if (req.get("X-CSRF-Token"))
      throw new DemoHttpError(401, "UNAUTHENTICATED");
    row = await provisionWorkspace<SessionRow>({
      persona: input.data.persona,
      tokenHash: credentials.hash,
      csrf: credentials.csrf,
      readBack: sessionQuery(credentials.hash),
    }).catch(workspaceError);
  }
  if (!row) throw new Error("Provisioned session could not be loaded");
  respondSession(res, row, credentials.token);
});

router.post("/reset", requireDemoAuth, requireDemoCsrf, async (req, res) => {
  const current = req.demoSession!;
  const credentials = newCredentials();
  const row = await provisionWorkspace<SessionRow>({
    persona: current.persona,
    tokenHash: credentials.hash,
    csrf: credentials.csrf,
    readBack: sessionQuery(credentials.hash),
    previous: current,
  }).catch(workspaceError);
  if (!row) throw new Error("Reset session could not be loaded");
  respondSession(res, row, credentials.token);
});

router.post("/logout", requireDemoAuth, requireDemoCsrf, async (req, res) => {
  const current = req.demoSession!;
  const result = await env.DB.prepare(
    `DELETE FROM workspaces WHERE id=?1 AND EXISTS
    (SELECT 1 FROM sessions WHERE workspace_id=?1 AND token_hash=?2)`,
  )
    .bind(current.workspaceId, current.tokenHash)
    .run();
  if (!result.meta.changes) throw new DemoHttpError(409, "WORKSPACE_CONFLICT");
  res.clearCookie(cookieName, cookieOptions).status(204).end();
});

export default router;
