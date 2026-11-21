import { randomBytes } from "node:crypto";
import express, { Router, type Request } from "express";
import {
  IMAGE_FORMATS,
  IMAGE_KEY_PATTERN,
  detectImageFormat,
  formatForContentType,
} from "../src/images/formats.js";
import {
  DemoHttpError,
  requireDemoAdmin,
  requireDemoAuth,
  requireDemoCsrf,
} from "./session.js";
import {
  adminTarget,
  audit,
  changedOne,
  guardTarget,
  parse,
  statement,
  uuid,
  write,
} from "./writes.js";

const router = Router();
const limit = 192 * 1024;
const raw = express.raw({ type: () => true, limit, inflate: false });
const target = (req: Request) =>
  req.params.employeeId
    ? parse(uuid, req.params.employeeId)
    : req.demoSession!.employeeRecordId;

function dimensions(bytes: Buffer, format: string): [number, number] | null {
  if (format === "png") return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  if (format === "webp") {
    if (bytes.length < 30 || bytes.readUInt32LE(4) + 8 !== bytes.length)
      return null;
    const kind = bytes.toString("ascii", 12, 16);
    if (kind === "VP8X") {
      if (bytes[20]! & 0b10) return null; // Animated WebP is outside the profile-photo format.
      return [bytes.readUIntLE(24, 3) + 1, bytes.readUIntLE(27, 3) + 1];
    }
    if (kind === "VP8L" && bytes[20] === 0x2f) {
      const value = bytes.readUInt32LE(21);
      return [(value & 0x3fff) + 1, ((value >>> 14) & 0x3fff) + 1];
    }
    if (
      kind === "VP8 " &&
      bytes[23] === 0x9d &&
      bytes[24] === 1 &&
      bytes[25] === 0x2a
    )
      return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
    return null;
  }
  for (let offset = 2; offset + 8 < bytes.length;) {
    if (bytes[offset++] !== 0xff) return null;
    const marker = bytes[offset++]!;
    if (marker === 0xff) {
      offset--;
      continue;
    }
    const size = bytes.readUInt16BE(offset);
    if (size < 2 || offset + size > bytes.length || marker === 0xda)
      return null;
    if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 8)
      return [bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)];
    offset += size;
  }
  return null;
}

for (const [path, admin] of [
  ["/me/profile-image", false],
  ["/admin/employees/:employeeId/profile-image", true],
] as const) {
  const gates = [
    requireDemoAuth,
    ...(admin ? [requireDemoAdmin] : []),
    requireDemoCsrf,
  ];
  router.post(path, ...gates, raw, async (req, res) => {
    const session = req.demoSession!,
      id = target(req);
    if (admin) await adminTarget(session, id);
    const bytes: unknown = req.body;
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > limit)
      throw new DemoHttpError(400, "INVALID_IMAGE");
    const format = detectImageFormat(bytes);
    const size = format ? dimensions(bytes, format) : null;
    if (
      !format ||
      format !== formatForContentType(req.get("Content-Type")) ||
      !size ||
      size.some((n) => n < 1 || n > 512)
    )
      throw new DemoHttpError(415, "INVALID_IMAGE");
    const mime = IMAGE_FORMATS[format].contentType;
    const key =
      randomBytes(16).toString("hex") + "." + IMAGE_FORMATS[format].extension;
    await write(session, [
      ...(admin ? [guardTarget(session, id)] : []),
      statement(
        `INSERT INTO profile_images (workspace_id,employee_id,id,mime,encoded) VALUES (?,?,?,?,?)
        ON CONFLICT(workspace_id,employee_id) DO UPDATE SET id=excluded.id,mime=excluded.mime,encoded=excluded.encoded`,
        session.workspaceId,
        id,
        key,
        mime,
        bytes.toString("base64"),
      ),
      statement(
        "UPDATE employees SET profile_image_key=? WHERE workspace_id=? AND id=?",
        key,
        session.workspaceId,
        id,
      ),
      changedOne(),
      audit(session, "PROFILE_IMAGE_UPLOADED", "employee", id),
    ]);
    res.json({ profileImageUrl: "/api/v1/files/profile-images/" + key });
  });
  router.delete(path, ...gates, async (req, res) => {
    const session = req.demoSession!,
      id = target(req);
    if (admin) await adminTarget(session, id);
    await write(session, [
      ...(admin ? [guardTarget(session, id)] : []),
      statement(
        "DELETE FROM profile_images WHERE workspace_id=? AND employee_id=?",
        session.workspaceId,
        id,
      ),
      statement(
        "UPDATE employees SET profile_image_key=NULL WHERE workspace_id=? AND id=?",
        session.workspaceId,
        id,
      ),
      changedOne(),
      audit(session, "PROFILE_IMAGE_REMOVED", "employee", id),
    ]);
    res.status(204).end();
  });
}

router.get(
  "/files/profile-images/:fileKey",
  requireDemoAuth,
  async (req, res) => {
    const session = req.demoSession!,
      key = String(req.params.fileKey);
    if (!IMAGE_KEY_PATTERN.test(key))
      throw new DemoHttpError(404, "IMAGE_NOT_FOUND");
    const row = await statement(
      `SELECT p.mime,p.encoded FROM profile_images p
    JOIN employees e ON e.workspace_id=p.workspace_id AND e.id=p.employee_id AND e.profile_image_key=p.id
    WHERE p.workspace_id=?1 AND p.id=?2 AND (e.id=?3 OR (?4='ADMIN' AND
      (?5 IS NULL OR (e.department_id=?5 AND NOT EXISTS (
        SELECT 1 FROM users u WHERE u.workspace_id=e.workspace_id AND u.employee_id=e.id AND u.role='ADMIN'
      )))))`,
      session.workspaceId,
      key,
      session.employeeRecordId,
      session.role,
      session.administeredDepartmentId,
    ).first<{ mime: string; encoded: string }>();
    if (!row) throw new DemoHttpError(404, "IMAGE_NOT_FOUND");
    const bytes = Buffer.from(row.encoded, "base64");
    res
      .set("Content-Type", row.mime)
      .set("Content-Length", String(bytes.length))
      .set("Content-Disposition", "inline")
      .end(bytes);
  },
);
export default router;
