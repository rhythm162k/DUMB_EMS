import { randomUUID } from "node:crypto";
import { env } from "cloudflare:workers";

const lifetimeSeconds = 45 * 60;

export const nowSeconds = () => Math.floor(Date.now() / 1000);

export async function provisionWorkspace<T>({
  persona,
  tokenHash,
  csrf,
  readBack,
  previous,
}: {
  persona: string;
  tokenHash: string;
  csrf: string;
  readBack: D1PreparedStatement;
  previous?: { workspaceId: string; tokenHash: string };
}): Promise<T | null> {
  const db = env.DB;
  const workspaceId = randomUUID();
  const now = nowSeconds();
  const expiresAt = now + lifetimeSeconds;
  const statements = [
    db
      .prepare("INSERT INTO workspaces (id, expires_at) VALUES (?, ?)")
      .bind(workspaceId, expiresAt),
    // NULL here is a failed invariant, so a missing persona rolls back provisioning.
    db
      .prepare(
        `INSERT INTO sessions (workspace_id, token_hash, csrf_token, user_id)
      VALUES (?1, ?2, ?3, (SELECT id FROM users WHERE workspace_id=?1 AND entry_persona=?4))`,
      )
      .bind(workspaceId, tokenHash, csrf, persona),
  ];

  if (previous) {
    // The assertion checks ownership inside the same batch that replaces the workspace.
    // ON CONFLICT handles the existing success row only; CHECK failures abort the batch.
    statements.unshift(
      db
        .prepare(
          `INSERT INTO write_assertion (ok) VALUES (
      EXISTS (SELECT 1 FROM sessions s JOIN workspaces w ON w.id=s.workspace_id
        WHERE s.workspace_id=? AND s.token_hash=? AND w.expires_at>?)
      ) ON CONFLICT(ok) DO NOTHING`,
        )
        .bind(previous.workspaceId, previous.tokenHash, now),
      // Free the slot before inserting. A failed replacement rolls this delete back.
      db
        .prepare("DELETE FROM workspaces WHERE id=?")
        .bind(previous.workspaceId),
    );
  }
  statements.push(readBack);
  const results = await db.batch<T>(statements);
  return results.at(-1)?.results[0] ?? null;
}

export async function cleanupWorkspaces(
  database: D1Database,
  now = nowSeconds(),
) {
  await database.batch([
    database
      .prepare(
        `DELETE FROM workspaces WHERE id IN (
      SELECT id FROM workspaces WHERE expires_at BETWEEN 1 AND ?
      ORDER BY expires_at, id LIMIT 12
    )`,
      )
      .bind(now),
    database
      .prepare(
        `DELETE FROM workspace_issuance WHERE day IN (
      SELECT day FROM workspace_issuance WHERE day<date(?, 'unixepoch', '-2 days') ORDER BY day LIMIT 7
    )`,
      )
      .bind(now),
  ]);
}
