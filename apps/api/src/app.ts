import { RootProtectedError, ScopeError } from "./auth/scope.js";
import { protectErrorResponses } from "./http/public-errors.js";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { csrfProtection } from "./auth/security.js";
import { sessionMiddleware } from "./auth/session.js";
import { env } from "./config/env.js";
import { checkDatabaseConnection, inspectSchema } from "./config/database.js";
import adminAccessRoutes from "./routes/admin-access.routes.js";
import adminAuthRoutes from "./routes/admin-auth.routes.js";
import adminDepartmentsRoutes from "./routes/admin-departments.routes.js";
import adminEmployeeRecordsRoutes from "./routes/admin-employee-records.routes.js";
import adminEmployeesRoutes from "./routes/admin-employees.routes.js";
import authRoutes from "./routes/auth.routes.js";
import departmentsRoutes from "./routes/departments.routes.js";
import adminSpouseRoutes from "./routes/admin-spouse.routes.js";
import meRoutes from "./routes/me.routes.js";
import profileImageRoutes from "./routes/profile-images.routes.js";
import changeRequestRoutes from "./routes/change-requests.routes.js";
import leaveRoutes from "./routes/leave.routes.js";
import dataToolsRoutes from "./routes/data-tools.routes.js";
import dataWorkbookRoutes from "./routes/data-workbooks.routes.js";
import overviewRoutes from "./routes/overview.routes.js";

const app = express();

app.use(protectErrorResponses);
app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || origin === env.WEB_ORIGIN) {
        callback(null, true);
        return;
      }
      callback(new Error("Request origin is not allowed."));
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-CSRF-Token"],
  }),
);
app.use(express.json({ limit: "64kb" }));

// Liveness: confirms that the API process is responding.
app.get("/api/v1/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

// Readiness: confirms that the API can reach PostgreSQL AND that the schema has
// the columns this release needs. Deployment does not run migrations, so a
// release that reaches production before its migration must fail here instead of
// reporting ready while every sign-in and data request fails.
app.get("/api/v1/ready", async (_req, res) => {
  try {
    await checkDatabaseConnection();
    const schema = await inspectSchema();
    if (schema.missing.length) {
      console.error(
        `Database schema is behind this release (missing: ${schema.missing.join(", ")}). ` +
          "Apply apps/api/src/db/migrations/001_admin_scopes.sql; see docs/OPERATIONS.md.",
      );
      res.status(503).json({
        status: "not_ready",
        error: { message: "Service unavailable." },
      });
      return;
    }
    res.status(200).json({
      status: "ready",
    });
  } catch (error) {
    console.error("Database readiness check failed:", error);
    res.status(503).json({
      status: "not_ready",
      error: { message: "Service unavailable." },
    });
  }
});

app.set("trust proxy", env.NODE_ENV === "production" ? 1 : false);
app.use(sessionMiddleware);
app.use(csrfProtection);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/admin", adminAccessRoutes);
app.use("/api/v1/admin", adminAuthRoutes);
app.use("/api/v1/admin", adminEmployeesRoutes);
app.use("/api/v1/admin", adminEmployeeRecordsRoutes);
app.use("/api/v1/admin", adminDepartmentsRoutes);
app.use("/api/v1/admin", adminSpouseRoutes);
app.use("/api/v1/me", meRoutes);
app.use("/api/v1/departments", departmentsRoutes);
app.use("/api/v1", profileImageRoutes);
app.use("/api/v1", changeRequestRoutes);
app.use("/api/v1", leaveRoutes);
app.use("/api/v1", dataToolsRoutes);
app.use("/api/v1", dataWorkbookRoutes);
app.use("/api/v1", overviewRoutes);

app.use((_req, res) => {
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message: "The requested resource was not found.",
    },
  });
});

const errorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  void next;
  if (res.headersSent) return;

  if (error instanceof RootProtectedError) {
    res.status(409).json({
      error: { code: "ROOT_ADMIN_PROTECTED", message: error.message },
    });
    return;
  }
  if (error instanceof ScopeError) {
    res
      .status(403)
      .json({ error: { code: "FORBIDDEN", message: error.message } });
    return;
  }

  // Body-parser errors are client mistakes, not server faults.
  const parserError = error as { type?: string };
  if (parserError.type === "entity.parse.failed") {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "The request body must be valid JSON.",
      },
    });
    return;
  }
  if (parserError.type === "entity.too.large") {
    res.status(413).json({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "The request body is too large.",
      },
    });
    return;
  }

  if (
    error instanceof Error &&
    error.message === "Request origin is not allowed."
  ) {
    res.status(403).json({
      error: {
        code: "ORIGIN_NOT_ALLOWED",
        message: "Request origin is not allowed.",
      },
    });
    return;
  }
  console.error("Unhandled API error:", error);
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected server error occurred.",
    },
  });
};
app.use(errorHandler);

export default app;
