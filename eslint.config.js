import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["**/dist/**", "**/node_modules/**", "**/coverage/**"]),

  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },

  {
    files: ["apps/api/**/*.ts"],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        project: "./apps/api/tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-namespace": "off",
    },
  },

  {
    files: ["apps/api/test/**/*.ts"],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        project: "./apps/api/tsconfig.test.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ["packages/shared/**/*.ts"],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        project: "./packages/shared/tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        project: "./apps/web/tsconfig.app.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
  },

  {
    files: ["apps/web/vite.config.ts"],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        project: "./apps/web/tsconfig.node.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
]);
