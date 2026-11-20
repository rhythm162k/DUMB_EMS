import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../config/env.js";

// Profile photos are the only uploaded file type in scope (blueprint section 8).
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const IMAGE_FORMATS = {
  jpeg: { extension: "jpg", contentType: "image/jpeg" },
  png: { extension: "png", contentType: "image/png" },
  webp: { extension: "webp", contentType: "image/webp" },
} as const;
export type ImageFormat = keyof typeof IMAGE_FORMATS;

export const ACCEPTED_CONTENT_TYPES = Object.values(IMAGE_FORMATS).map(
  (format) => format.contentType,
);

// Storage keys are random hex plus a fixed extension. Anything else is rejected before it can
// reach the filesystem, which rules out path traversal.
export const IMAGE_KEY_PATTERN = /^[a-f0-9]{32}\.(jpg|png|webp)$/;

// Identify the real format from the file's own bytes; the browser-declared type and any file
// name are never trusted. SVG, GIF, PDF and everything else return null.
export function detectImageFormat(bytes: Buffer): ImageFormat | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return "jpeg";
  if (
    bytes.length >= 33 &&
    bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    // A PNG must start with an IHDR chunk right after the signature.
    bytes.subarray(12, 16).toString("latin1") === "IHDR"
  ) {
    return "png";
  }
  if (
    bytes.length >= 16 &&
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

export function formatForContentType(
  contentType: string | undefined,
): ImageFormat | null {
  const base = contentType?.split(";")[0]?.trim().toLowerCase();
  for (const [name, format] of Object.entries(IMAGE_FORMATS)) {
    if (format.contentType === base) return name as ImageFormat;
  }
  return null;
}

export function contentTypeForKey(key: string): string {
  if (key.endsWith(".png")) return IMAGE_FORMATS.png.contentType;
  if (key.endsWith(".webp")) return IMAGE_FORMATS.webp.contentType;
  return IMAGE_FORMATS.jpeg.contentType;
}

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
