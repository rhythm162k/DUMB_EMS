import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createTestHarness, unstable_splitSqlQuery } from "wrangler";

process.env.WRANGLER_SEND_METRICS = "false";
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = "false";
const fixture = new URL("./worker-capacity-fixture.sql", import.meta.url);
const template = "00000000-0000-0000-0000-000000000000";

const rounded = (n) => Number(n.toFixed(3));

async function measure(larger) {
  const server = createTestHarness({
    workers: [
      {
        configPath: new URL(
          "../apps/api/worker/wrangler.jsonc",
          import.meta.url,
        ),
      },
    ],
  });
  const worker = server.getWorker("ems-portfolio-demo");
  try {
    await server.listen();
    await worker.applyD1Migrations("DB");
    const { DB: db } = await worker.getEnv();
    if (larger) {
      const sql = await readFile(fixture, "utf8");
      await db.batch(
        unstable_splitSqlQuery(sql).map((query) => db.prepare(query)),
      );
    }
    for (const [table, count] of [
      ["employees", larger ? 30 : 10],
      ["departments", larger ? 6 : 3],
    ]) {
      assert.equal(
        await db
          .prepare(`SELECT count(*) AS n FROM ${table} WHERE workspace_id=?`)
          .bind(template)
          .first("n"),
        count,
      );
    }
    const emitted = [];
    async function batch(operation, queries) {
      const start = performance.now();
      const rows = await db.batch(queries);
      const elapsed = performance.now() - start;
      const total = (pick) =>
        rows.reduce((n, { meta }) => n + (pick(meta) ?? 0), 0);
      emitted.push({
        operation,
        sqlMs: total((m) => m.timings?.sql_duration_ms ?? m.duration),
        bindingElapsedMs: elapsed,
        read: total((m) => m.rows_read),
        written: total((m) => m.rows_written),
        sizeAfter: rows.at(-1).meta.size_after,
      });
      return rows[0].results;
    }
    const size = await db.prepare("SELECT 1").run();
    for (let i = 0; i < 24; i++) {
      const id = randomUUID();
      const expires = Math.floor(Date.now() / 1000) + 2700;
      await batch("provision", [
        db
          .prepare("INSERT INTO workspaces(id,expires_at) VALUES (?,?)")
          .bind(id, expires),
        db
          .prepare(
            `INSERT INTO sessions(workspace_id,token_hash,csrf_token,user_id)
        VALUES (?1,?2,?3,(SELECT id FROM users WHERE workspace_id=?1 AND entry_persona='root'))`,
          )
          .bind(
            id,
            randomUUID().replaceAll("-", "").repeat(2),
            randomUUID().replaceAll("-", ""),
          ),
        db
          .prepare("SELECT user_id FROM sessions WHERE workspace_id=?")
          .bind(id),
      ]);
    }
    const sizeWithWorkspaces = emitted.at(-1).sizeAfter;
    const cutoff = Math.floor(Date.now() / 1000);
    await db
      .prepare("UPDATE workspaces SET expires_at=? WHERE expires_at>0")
      .bind(cutoff)
      .run();
    for (let i = 0; i < 2; i++) {
      await batch("cleanup (12 workspaces)", [
        db
          .prepare(
            `DELETE FROM workspaces WHERE id IN (
          SELECT id FROM workspaces WHERE expires_at BETWEEN 1 AND ? ORDER BY expires_at,id LIMIT 12)`,
          )
          .bind(cutoff),
        db
          .prepare(
            `DELETE FROM workspace_issuance WHERE day IN (
          SELECT day FROM workspace_issuance WHERE day<date(?, 'unixepoch', '-2 days') ORDER BY day LIMIT 7)`,
          )
          .bind(cutoff),
      ]);
    }
    assert.equal(
      await db.prepare("SELECT count(*) AS n FROM workspaces").first("n"),
      1,
    );
    for (const op of new Set(emitted.map((item) => item.operation))) {
      const subset = emitted.filter((item) => item.operation === op);
      const mean = (key) =>
        rounded(
          subset.reduce((sum, sample) => sum + sample[key], 0) / subset.length,
        );
      console.log(
        JSON.stringify({
          fixture: larger ? "30/6" : "10/3",
          operation: op,
          count: subset.length,
          meanSqlMs: mean("sqlMs"),
          meanBindingElapsedMs: mean("bindingElapsedMs"),
          meanRead: mean("read"),
          meanWritten: mean("written"),
          baseBytes: size.meta.size_after,
          peakBytes: sizeWithWorkspaces,
          bytesPerWorkspace: rounded(
            (sizeWithWorkspaces - size.meta.size_after) / 24,
          ),
          finalAllocatedBytes: emitted.at(-1).sizeAfter,
        }),
      );
    }
  } finally {
    await server.close();
  }
}

await measure(false);
await measure(true);
