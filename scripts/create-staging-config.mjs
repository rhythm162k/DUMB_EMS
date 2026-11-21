import { readFile, writeFile } from "node:fs/promises";
import ts from "typescript";

const [databaseId, ...rest] = process.argv.slice(2);
if (
  rest.length ||
  !databaseId ||
  !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
    databaseId,
  ) ||
  databaseId === "00000000-0000-4000-8000-000000000000"
) {
  console.error(
    "Usage: node scripts/create-staging-config.mjs <staging D1 UUID>",
  );
  process.exit(1);
}

const source = new URL("../apps/api/worker/wrangler.jsonc", import.meta.url);
const output = new URL("wrangler.staging.generated.json", source);
const parsed = ts.parseConfigFileTextToJson(
  source.pathname,
  await readFile(source, "utf8"),
);
if (parsed.error) throw new Error("Invalid local Wrangler configuration");

const config = {
  ...parsed.config,
  name: "ems-portfolio-staging",
  workers_dev: false,
  preview_urls: false,
  observability: {
    logs: {
      enabled: true,
      head_sampling_rate: 1,
      invocation_logs: true,
    },
  },
  d1_databases: [
    {
      binding: "DB",
      database_name: "ems-portfolio-staging",
      database_id: databaseId,
      migrations_dir: "migrations",
      remote: false,
    },
  ],
};

await writeFile(output, JSON.stringify(config, null, 2) + "\n", { flag: "wx" });
console.log(
  "Created apps/api/worker/wrangler.staging.generated.json with routes disabled.",
);
