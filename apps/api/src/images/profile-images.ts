import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../config/env.js";

// Profile photos are the only uploaded file type in scope (blueprint section 8).
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

import {
  IMAGE_FORMATS,
  IMAGE_KEY_PATTERN,
  type ImageFormat,
} from "./formats.js";
export * from "./formats.js";

function pathForKey(key: string): string {
  if (!IMAGE_KEY_PATTERN.test(key))
    throw new Error("Invalid image storage key.");
  return join(env.PROFILE_IMAGE_DIR, key);
}

// Writes a new image under a random server-side name. "wx" refuses to overwrite an existing file.
export async function storeImage(
  bytes: Buffer,
  format: ImageFormat,
): Promise<string> {
  const key = `${randomBytes(16).toString("hex")}.${IMAGE_FORMATS[format].extension}`;
  await mkdir(env.PROFILE_IMAGE_DIR, { recursive: true });
  await writeFile(pathForKey(key), bytes, { flag: "wx", mode: 0o640 });
  return key;
}

export async function readImage(key: string): Promise<Buffer | null> {
  try {
    return await readFile(pathForKey(key));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return null;
    throw error;
  }
}

// Best-effort removal: a leftover file is harmless (nothing references it), so failures are logged only.
export async function removeImage(
  key: string | null | undefined,
): Promise<void> {
  if (!key) return;
  try {
    await unlink(pathForKey(key));
  } catch (error) {
    const missing =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT";
    if (!missing)
      console.error("Could not remove a profile image file:", error);
  }
}
