import app from "./app.js";
import { env } from "./config/env.js";
import { inspectSchema, pool } from "./config/database.js";

const server = app.listen(env.PORT, () => {
  console.log(`EMS API running on http://localhost:${env.PORT}`);
});

// Surface schema/release mismatches in the very first log lines. The process stays
// up so /ready reports 503 and recovers by itself once the migration is applied.
void inspectSchema()
  .then((schema) => {
    if (schema.missing.length)
      console.error(
        `STARTUP CHECK FAILED: database schema is behind this release (missing: ${schema.missing.join(", ")}). ` +
          "Sign-in and data requests will fail until apps/api/src/db/migrations/001_admin_scopes.sql is applied.",
      );
    for (const warning of schema.warnings)
      console.warn(`Startup schema warning: ${warning}.`);
  })
  .catch((error: unknown) =>
    console.error("Startup schema check could not run:", error),
  );

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received. Shutting down EMS API...`);

  server.close(async (error) => {
    if (error) {
      console.error("Error while closing the HTTP server:", error);
      process.exitCode = 1;
    }

    try {
      await pool.end();
    } catch (poolError) {
      console.error("Error while closing PostgreSQL connections:", poolError);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
