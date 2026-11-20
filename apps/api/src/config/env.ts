import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { z } from "zod";

// Resolve the project-root .env from both src/ and compiled dist/ paths.
config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  POSTGRES_HOST: z.string().min(1).default("127.0.0.1"),
  POSTGRES_PORT: z.coerce.number().int().min(1).max(65535).default(5433),
  POSTGRES_USER: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_DB: z.string().min(1),
  SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET must contain at least 32 characters")
    .optional(),
  SESSION_COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SESSION_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(168).default(8),
  BCRYPT_COST: z.coerce.number().int().min(10).max(15).default(12),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  // Private folder for profile photos (outside any web root). Defaults to <repo>/storage/profile-images.
  PROFILE_IMAGE_DIR: z
    .string()
    .min(1)
    .default(
      fileURLToPath(
        new URL("../../../../storage/profile-images", import.meta.url),
      ),
    ),
});

const result = envSchema.safeParse(process.env);

if (!result.success) {
  console.error(
    "Invalid environment configuration:",
    z.treeifyError(result.error),
  );
  throw new Error(
    "EMS API environment validation failed. Check the root .env file.",
  );
}

export const env = result.data;
