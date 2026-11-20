import { randomBytes, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { pool } from "../config/database.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function createCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

// One-time temporary password for new accounts and admin resets.
// 24 random bytes -> 32 base64url characters (well under bcrypt's 72-byte limit).
export function generateTemporaryPassword(): string {
  return randomBytes(24).toString("base64url");
}

export function csrfProtection(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.get("origin");
  if (origin && origin !== env.WEB_ORIGIN) {
    res.status(403).json({
      error: {
        code: "ORIGIN_NOT_ALLOWED",
        message: "Request origin is not allowed.",
      },
    });
    return;
  }

  const supplied = req.get("x-csrf-token");
  const expected = req.session.csrfToken;
  if (!supplied || !expected) {
    res.status(403).json({
      error: {
        code: "CSRF_TOKEN_MISSING",
        message: "Please refresh the page and try again.",
      },
    });
    return;
  }

  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    res.status(403).json({
      error: {
        code: "CSRF_TOKEN_INVALID",
        message: "Please refresh the page and try again.",
      },
    });
    return;
  }

  next();
}

export function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

export function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

export function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
}

export async function revokeUserSessions(userId: string): Promise<void> {
  // connect-pg-simple stores session data as JSONB in the `sess` column.
  await pool.query("DELETE FROM \"session\" WHERE sess ->> 'userId' = $1", [
    userId,
  ]);
}
