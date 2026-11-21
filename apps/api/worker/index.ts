import { createServer } from "node:http";
import { handleAsNodeRequest } from "cloudflare:node";
import { env } from "cloudflare:workers";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import {
  protectErrorResponses,
  publicErrorMessage,
  respondToBodyParserError,
} from "../src/http/public-errors.js";
import accessRoutes from "./administrator-access.js";
import personnelRoutes from "./personnel.js";
import pdsRoutes from "./pds.js";
import changeRoutes from "./change-decisions.js";
import leaveRoutes from "./leave.js";
import workbookRoutes from "./workbooks.js";
import imageRoutes from "./profile-images.js";
import recordRoutes from "./records.js";
import sessionRoutes, { DemoHttpError } from "./session.js";
import { cleanupWorkspaces } from "./workspaces.js";

const app = express();
app.disable("x-powered-by");
app.set("etag", false);
app.use(helmet());
app.use(protectErrorResponses);
app.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
app.use(express.json({ limit: "64kb", inflate: false }));

app.get("/api/v1/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/v1/ready", async (_req, res) => {
  try {
    const result = await env.DB.prepare(
      `SELECT (
      (SELECT count(*) FROM users WHERE workspace_id=? AND entry_persona IS NOT NULL)=5
      AND EXISTS (SELECT 1 FROM sqlite_schema WHERE name='audit_administrator_assignment' AND type='trigger')
      AND EXISTS (SELECT 1 FROM write_assertion WHERE ok=1)
      AND EXISTS (SELECT 1 FROM sqlite_schema WHERE name='provision_fictional_workspace')
      AND EXISTS (SELECT 1 FROM sqlite_schema WHERE name='leave_requests')
      AND EXISTS (SELECT 1 FROM sqlite_schema WHERE name='demo_retained_workspace_budget' AND type='trigger')
    ) AS ready`,
    )
      .bind("00000000-0000-0000-0000-000000000000")
      .first<number>("ready");
    if (result !== 1) throw new Error("Unexpected D1 readiness result");
    res.json({ status: "ready" });
  } catch {
    console.error("Demo D1 readiness check failed.");
    res.status(503).json({
      status: "not_ready",
      error: { code: "INTERNAL_ERROR" },
    });
  }
});

app.use("/api/v1/demo", sessionRoutes);
app.use(
  "/api/v1",
  accessRoutes,
  recordRoutes,
  personnelRoutes,
  pdsRoutes,
  changeRoutes,
  leaveRoutes,
  imageRoutes,
  workbookRoutes,
);

app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND" } });
});

const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  if (respondToBodyParserError(error, res)) return;
  if (error instanceof DemoHttpError) {
    res.status(error.status).json({ error: { code: error.code } });
    return;
  }
  if (error instanceof Error) {
    const message = error.message;
    if (
      message.includes("workspace_activity_limit") ||
      message.includes("workspace_image_limit")
    ) {
      res.status(429).json({ error: { code: "DEMO_LIMIT_REACHED" } });
      return;
    }
    const mapped = [
      ["leave_overlap", "LEAVE_OVERLAP"],
      ["spouse_requires_married", "SPOUSE_REQUIRES_MARRIED"],
      ["spouse_record_exists", "SPOUSE_RECORD_EXISTS"],
      ["entry_persona_protected", "ENTRY_PERSONA_PROTECTED"],
      [
        "employees.workspace_id, employees.official_employee_id",
        "EMPLOYEE_ID_TAKEN",
      ],
      [
        "departments.workspace_id, departments.name_en",
        "DEPARTMENT_NAME_TAKEN",
      ],
      ["changes_pending_target", "DUPLICATE_REQUEST"],
      [
        "leave_requests.workspace_id, leave_requests.employee_id",
        "DUPLICATE_REQUEST",
      ],
      ["CHECK constraint failed: ok = 1", "CHANGE_CONFLICT"],
      ["UNIQUE constraint failed", "CHANGE_CONFLICT"],
      ["FOREIGN KEY constraint failed", "CHANGE_CONFLICT"],
    ].find(([match]) => message.includes(match!));
    if (mapped) {
      res.status(409).json({
        error: {
          code: mapped[1],
          ...(mapped[1] === "LEAVE_OVERLAP"
            ? { message: "This employee has an overlapping leave record." }
            : {}),
        },
      });
      return;
    }
  }
  console.error("Unhandled demo API error.");
  res.status(500).json({ error: { code: "INTERNAL_ERROR" } });
};
app.use(errorHandler);

// Workers uses this port to identify the Node handler within the isolate.
const port = 3000;
createServer(app).listen(port);

export default {
  async fetch(request, bindings) {
    const origin = request.headers.get("Origin");
    if (
      origin &&
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      origin !== new URL(request.url).origin
    ) {
      return Response.json(
        {
          error: {
            code: "ORIGIN_NOT_ALLOWED",
            message: publicErrorMessage(403),
          },
        },
        {
          status: 403,
          headers: {
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          },
        },
      );
    }
    if (
      request.method !== "GET" &&
      request.method !== "HEAD" &&
      request.method !== "OPTIONS"
    ) {
      const address = request.headers.get("CF-Connecting-IP") ?? "local";
      const path = new URL(request.url).pathname
        .toLowerCase()
        .replace(/\/+$/, "");
      const limit =
        path === "/api/v1/demo/session" || path === "/api/v1/demo/reset"
          ? bindings.DEMO_ENTRY_LIMIT
          : bindings.DEMO_WRITE_LIMIT;
      if (!(await limit.limit({ key: address })).success) {
        return Response.json(
          {
            error: {
              code: "DEMO_LIMIT_REACHED",
              message: publicErrorMessage(429),
            },
          },
          {
            status: 429,
            headers: { "Cache-Control": "no-store", "Retry-After": "60" },
          },
        );
      }
    }
    return handleAsNodeRequest(port, request);
  },
  async scheduled(controller, bindings) {
    await cleanupWorkspaces(
      bindings.DB,
      Math.floor(controller.scheduledTime / 1000),
    );
  },
} satisfies ExportedHandler<Cloudflare.Env>;
