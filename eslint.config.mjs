import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "node_modules/",
      ".env",
      ".env.local",
      ".env.production",
      "*.db",
      "*.sqlite",
      "*.log",
      "coverage/",
      ".next/",
      "next-env.d.ts",
      "test-results/",
      "playwright-report/",
      "public/ocr/",
      "dist/",
      "build/",
      "check-schema.js",
      "reset-db.js",
      "reset-test-db.js"
    ]
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        ...globals.jest
      }
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["warn", { 
        "argsIgnorePattern": "^_",
        "varsIgnorePattern": "^_",
        "caughtErrorsIgnorePattern": "^_"
      }],
      "no-undef": "error",
      "prefer-const": "warn",
      "no-var": "warn",
      "semi": ["error", "always"],
      "quotes": ["warn", "single"],
      "indent": ["warn", 4],
      "no-trailing-spaces": "warn",
      "eol-last": "warn"
    }
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.jest,
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly"
      }
    }
  },
  {
    // Playwright specs pass some functions to the browser (page.addInitScript)
    files: ["tests/e2e/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser
      }
    }
  },
  // TypeScript (Next.js app, lib, unit tests): typescript-eslint recommended plus the project's style rules
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: ["**/*.ts", "**/*.tsx"] })),
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "semi": ["error", "always"],
      // Double quotes allowed when they avoid escaping, e.g. "'self'" in CSP directives
      "quotes": ["warn", "single", { "avoidEscape": true }],
      "indent": ["warn", 4],
      "no-trailing-spaces": "warn",
      "eol-last": "warn"
    }
  }
];
