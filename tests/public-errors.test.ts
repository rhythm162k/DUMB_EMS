import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express, { type ErrorRequestHandler } from "express";
import type { Server } from "node:http";
import {
  protectErrorResponses,
  publicErrorMessage,
  publicMessages,
} from "../apps/api/src/http/public-errors.js";
import { safeError, responseError } from "../apps/web/src/lib/public-errors.js";
import { plainBn } from "../apps/web/src/i18n/plain-bn.js";
import { changePasswordSchema } from "../apps/api/src/auth/schemas.js";

let server: Server;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(protectErrorResponses);
  app.use(express.json({ limit: "1kb" }));
  app.get("/failure/:status", (req, res) => {
    res.status(Number(req.params.status)).json({
      error: {
        code: "23505",
        message: "SELECT password_hash FROM users at /private/app.ts:10",
        details: [{ field: "password_hash" }],
        stack: "private stack",
      },
      query: "secret",
      results: [{ payload: "private" }],
    });
  });
  app.get("/validation", (_req, res) =>
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: publicMessages[13],
        details: ["internal"],
      },
    }),
  );
  app.get("/success", (_req, res) => res.json({ items: [{ name: "Test" }] }));
  const handle: ErrorRequestHandler = (error, _req, res, _next) => {
    void _next;
    res.status(error.status ?? 500).json({ error });
  };
  app.use(handle);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Test server unavailable");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
});

describe("Public error boundary", () => {
  it.each([400, 401, 403, 404, 409, 413, 415, 429, 500, 503])(
    "does not expose diagnostics for HTTP %i",
    async (status) => {
      const response = await fetch(`${base}/failure/${status}`);
      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body).toEqual({
        error: { code: "REQUEST_FAILED", message: publicErrorMessage(status) },
      });
      expect(JSON.stringify(body)).not.toMatch(
        /SELECT|password_hash|private|stack|23505/,
      );
    },
  );
  it("keeps helpful password feedback without schema details", async () => {
    expect(await (await fetch(`${base}/validation`)).json()).toEqual({
      error: { code: "VALIDATION_ERROR", message: publicMessages[13] },
    });
  });
  it("covers parser failures before routes", async () => {
    for (const body of [
      "{broken",
      JSON.stringify({ text: "a".repeat(2000) }),
    ]) {
      const response = await fetch(`${base}/success`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      expect([400, 413]).toContain(response.status);
      expect(JSON.stringify(await response.json())).not.toMatch(
        /SyntaxError|Unexpected|stack|entity|broken/,
      );
    }
  });
  it("does not change successful data", async () => {
    expect(await (await fetch(`${base}/success`)).json()).toEqual({
      items: [{ name: "Test" }],
    });
  });
  it("rejects raw browser, proxy and parser errors", () => {
    for (const message of [
      "Failed to fetch",
      "Unexpected token < in JSON",
      "nginx/1.28",
      "relation users does not exist",
    ]) {
      expect(safeError(new Error(message))).toBe(publicMessages[0]);
      expect(responseError(500, message)).toBe(publicMessages[0]);
    }
  });
  it("uses reviewed guidance for known conflict codes and ignores unknown details", () => {
    const conflict =
      "This information has changed. Refresh the page and try again.";
    const duplicate = "An employee with this ID already exists.";
    expect(responseError(409, conflict, "EMPLOYEE_ID_TAKEN")).toBe(duplicate);
    expect(safeError(new Error(duplicate))).toBe(duplicate);
    expect(responseError(409, "SQLITE_CONSTRAINT", "private_code")).toBe(
      conflict,
    );
    expect(responseError(500, "SQLITE_CONSTRAINT", "EMPLOYEE_ID_TAKEN")).toBe(
      publicMessages[0],
    );
  });
  it("keeps the browser and API public messages aligned and translated", () => {
    for (const message of publicMessages) {
      expect(safeError(new Error(message))).toBe(message);
      expect(plainBn[message]).toBeTruthy();
    }
  });
  it("preserves password limits for English and Bangla without byte jargon", () => {
    const parse = (newPassword: string) =>
      changePasswordSchema.safeParse({
        currentPassword: "old-password",
        newPassword,
      });
    expect(parse("a".repeat(11)).success).toBe(false);
    expect(parse("a".repeat(12)).success).toBe(true);
    expect(parse("a".repeat(72)).success).toBe(true);
    expect(parse("ক".repeat(24)).success).toBe(true);
    for (const password of ["a".repeat(73), "ক".repeat(25)]) {
      const result = parse(password);
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues[0]?.message).toBe(publicMessages[13]);
    }
  });
});
