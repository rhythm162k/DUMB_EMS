import { defineConfig } from "vitest/config";

// These regression checks need no database or credentials.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/public-errors.test.ts",
      "tests/import-friendly.test.ts",
      "tests/import-template.test.ts",
      "tests/root-record-access.test.ts",
      "apps/api/test/data-spreadsheets.test.ts",
      "apps/api/test/data-validation.test.ts",
    ],
  },
});
