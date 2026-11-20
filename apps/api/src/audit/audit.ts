import type { PoolClient } from "pg";

export type AuditEntry = {
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  fieldKey?: string | null;
  reason?: string | null;
  // Non-sensitive context only. Never put passwords, NID values, session data
  // or old/new personal field values here (blueprint section 10 and 15).
  metadata?: Record<string, unknown>;
};

// Always call this with the transaction's client so the audit event commits or
// rolls back together with the change it describes.
export async function recordAudit(
  client: PoolClient,
  entry: AuditEntry,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs (actor_user_id, actor_role, action, entity_type, entity_id, field_key, reason, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      entry.actorUserId,
      entry.actorRole,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.fieldKey ?? null,
      entry.reason ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ],
  );
}
