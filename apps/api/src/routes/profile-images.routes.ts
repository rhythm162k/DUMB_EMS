import { canAccessEmployee, assertEmployeeAccess } from "../auth/scope.js";
import express, {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { recordAudit } from "../audit/audit.js";
import {
  requireActiveEmployee,
  requireAuth,
  requirePasswordChangeComplete,
  requireRole,
} from "../auth/middleware.js";
import { employeeIdParamSchema } from "../auth/schemas.js";
import { pool } from "../config/database.js";
import {
  ACCEPTED_CONTENT_TYPES,
  IMAGE_KEY_PATTERN,
  MAX_IMAGE_BYTES,
  contentTypeForKey,
  detectImageFormat,
  formatForContentType,
  readImage,
  removeImage,
  storeImage,
} from "../images/profile-images.js";

// Mounted at /api/v1 because it serves /me, /admin and /files paths. Headers are set per route
// so this router does not touch responses for other paths.
const router = Router();

// The image is sent as the raw request body (Content-Type: image/jpeg | image/png | image/webp),
// so no multipart parser dependency is needed. The parser is placed after authentication so an
// unauthenticated client cannot make the server buffer a 5 MB body. A larger body is rejected
// with 413 PAYLOAD_TOO_LARGE by the application error handler.
const imageBody = express.raw({
  type: ACCEPTED_CONTENT_TYPES,
  limit: MAX_IMAGE_BYTES,
});

const invalidEmployeeId = {
  error: { code: "VALIDATION_ERROR", message: "Employee ID is invalid." },
};
const employeeNotFound = {
  error: { code: "EMPLOYEE_NOT_FOUND", message: "Employee was not found." },
};
const noImage = {
  error: {
    code: "NO_PROFILE_IMAGE",
    message: "This employee has no profile image.",
  },
};
const imageNotFound = {
  error: { code: "IMAGE_NOT_FOUND", message: "The image was not found." },
};
const unauthenticated = {
  error: { code: "UNAUTHENTICATED", message: "Sign in is required." },
};

function noStore(res: Response) {
  res.setHeader("Cache-Control", "no-store");
}

// Shared by the employee (own image) and Admin (any employee) upload routes.
async function uploadImage(
  req: Request,
  res: Response,
  next: NextFunction,
  employeeId: string,
) {
  noStore(res);
  const actor = req.authUser;
  if (!actor) {
    res.status(401).json(unauthenticated);
    return;
  }

  const bytes: unknown = req.body;
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    res.status(415).json({
      error: {
        code: "UNSUPPORTED_MEDIA_TYPE",
        message:
          "Send the image as the request body with Content-Type image/jpeg, image/png or image/webp.",
      },
    });
    return;
  }

  // The real format comes from the file's bytes. It must also match the declared type, so a
  // renamed or mislabelled file (for example an SVG sent as image/png) is refused.
  const format = detectImageFormat(bytes);
  if (!format || format !== formatForContentType(req.get("content-type"))) {
    res.status(415).json({
      error: {
        code: "INVALID_IMAGE",
        message: "The file is not a valid JPEG, PNG or WebP image.",
      },
    });
    return;
  }

  const key = await storeImage(bytes, format);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM employees WHERE id=$1 FOR UPDATE", [
      employeeId,
    ]);
    if (req.originalUrl.includes("/admin/"))
      await assertEmployeeAccess(actor, employeeId, client);
    const current = await client.query<{ profile_image_key: string | null }>(
      "SELECT profile_image_key FROM employees WHERE id = $1 FOR UPDATE",
      [employeeId],
    );
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      await removeImage(key);
      res.status(404).json(employeeNotFound);
      return;
    }
    const previousKey = current.rows[0]?.profile_image_key ?? null;

    await client.query(
      "UPDATE employees SET profile_image_key = $1, updated_at = NOW(), updated_by = $2 WHERE id = $3",
      [key, actor.userId, employeeId],
    );
    // Audit holds the format only: no file name, file contents or image metadata.
    await recordAudit(client, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "PROFILE_IMAGE_UPLOADED",
      entityType: "employee",
      entityId: employeeId,
      fieldKey: "profileImage",
      metadata: { format, replaced: previousKey !== null },
    });
    await client.query("COMMIT");

    // The old file is unreferenced once the new key is committed.
    await removeImage(previousKey);
    res
      .status(200)
      .json({ profileImageUrl: `/api/v1/files/profile-images/${key}` });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    await removeImage(key);
    next(error);
  } finally {
    client.release();
  }
}

async function deleteImage(
  req: Request,
  res: Response,
  next: NextFunction,
  employeeId: string,
) {
  noStore(res);
  const actor = req.authUser;
  if (!actor) {
    res.status(401).json(unauthenticated);
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT id FROM employees WHERE id=$1 FOR UPDATE", [
      employeeId,
    ]);
    if (req.originalUrl.includes("/admin/"))
      await assertEmployeeAccess(actor, employeeId, client);
    const current = await client.query<{ profile_image_key: string | null }>(
      "SELECT profile_image_key FROM employees WHERE id = $1 FOR UPDATE",
      [employeeId],
    );
    if (!current.rowCount) {
      await client.query("ROLLBACK");
      res.status(404).json(employeeNotFound);
      return;
    }
    const previousKey = current.rows[0]?.profile_image_key ?? null;
    if (!previousKey) {
      await client.query("ROLLBACK");
      res.status(404).json(noImage);
      return;
    }

    await client.query(
      "UPDATE employees SET profile_image_key = NULL, updated_at = NOW(), updated_by = $1 WHERE id = $2",
      [actor.userId, employeeId],
    );
    await recordAudit(client, {
      actorUserId: actor.userId,
      actorRole: actor.role,
      action: "PROFILE_IMAGE_REMOVED",
      entityType: "employee",
      entityId: employeeId,
      fieldKey: "profileImage",
    });
    await client.query("COMMIT");

    await removeImage(previousKey);
    res.status(200).json({ deleted: true });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    next(error);
  } finally {
    client.release();
  }
}

// ---- Employee: own image only. The employee is resolved from the session, never from the request. ----
router.post(
  "/me/profile-image",
  requireAuth,
  requireActiveEmployee,
  imageBody,
  async (req, res, next) => {
    const employeeRecordId = req.authUser?.employeeRecordId;
    if (!employeeRecordId) {
      res.status(404).json(employeeNotFound);
      return;
    }
    await uploadImage(req, res, next, employeeRecordId);
  },
);

router.delete(
  "/me/profile-image",
  requireAuth,
  requireActiveEmployee,
  async (req, res, next) => {
    const employeeRecordId = req.authUser?.employeeRecordId;
    if (!employeeRecordId) {
      res.status(404).json(employeeNotFound);
      return;
    }
    await deleteImage(req, res, next, employeeRecordId);
  },
);

// ---- Admin: any employee's image ----
router.post(
  "/admin/employees/:employeeId/profile-image",
  requireAuth,
  requireRole("ADMIN"),
  imageBody,
  async (req, res, next) => {
    const params = employeeIdParamSchema.safeParse(req.params);
    if (!params.success) {
      noStore(res);
      res.status(400).json(invalidEmployeeId);
      return;
    }
    await uploadImage(req, res, next, params.data.employeeId);
  },
);

router.delete(
  "/admin/employees/:employeeId/profile-image",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res, next) => {
    const params = employeeIdParamSchema.safeParse(req.params);
    if (!params.success) {
      noStore(res);
      res.status(400).json(invalidEmployeeId);
      return;
    }
    await deleteImage(req, res, next, params.data.employeeId);
  },
);

// ---- Authorized delivery. Admin can read any image; an employee only the image on their own record. ----
router.get(
  "/files/profile-images/:fileKey",
  requireAuth,
  requirePasswordChangeComplete,
  async (req, res, next) => {
    try {
      const fileKey = String(req.params.fileKey ?? "");
      // Not-found is returned for a malformed key, an unknown key and another employee's key alike.
      if (!IMAGE_KEY_PATTERN.test(fileKey)) {
        res.status(404).json(imageNotFound);
        return;
      }

      const owner = await pool.query<{ id: string }>(
        "SELECT id FROM employees WHERE profile_image_key = $1",
        [fileKey],
      );
      const ownerId = owner.rows[0]?.id;
      const user = req.authUser;
      if (
        !ownerId ||
        !user ||
        (user.employeeRecordId !== ownerId &&
          !(await canAccessEmployee(user, ownerId)))
      ) {
        res.status(404).json(imageNotFound);
        return;
      }

      const bytes = await readImage(fileKey);
      if (!bytes) {
        res.status(404).json(imageNotFound);
        return;
      }
      res.setHeader("Content-Type", contentTypeForKey(fileKey));
      res.setHeader("Content-Length", String(bytes.length));
      res.setHeader("Content-Disposition", "inline");
      res.setHeader("X-Content-Type-Options", "nosniff");
      // Personal data: cacheable only by this browser, and always revalidated.
      res.setHeader("Cache-Control", "private, no-cache");
      res.status(200).end(bytes);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
