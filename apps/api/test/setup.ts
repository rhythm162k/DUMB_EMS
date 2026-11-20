import { config } from "dotenv";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Load the dedicated root-level test environment before any API modules are imported.
const result = config({
  path: resolve(process.cwd(), ".env.test"),
  override: true,
});
if (result.error) {
  throw new Error(
    "Unable to load the root .env.test file. Copy .env.test.example to .env.test and configure it.",
  );
}

const required = [
  "NODE_ENV",
  "POSTGRES_DB",
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
];
for (const key of required) {
  if (!process.env[key])
    throw new Error(`Missing ${key} in the root .env.test file.`);
}
if (process.env.NODE_ENV !== "test")
  throw new Error("Tests require NODE_ENV=test.");
if (!/(^|[_-])test($|[_-])/i.test(process.env.POSTGRES_DB ?? "")) {
  throw new Error(
    `Refusing to run tests against database "${process.env.POSTGRES_DB}". The database name must clearly contain "test".`,
  );
}

// Uploaded profile photos go to a throw-away folder, never the development storage folder.
process.env.PROFILE_IMAGE_DIR = join(
  tmpdir(),
  `ems-test-images-${process.pid}`,
);
