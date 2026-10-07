import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  // legacy/ is the old prototype kept for reference; supabase/functions/ is
  // Deno TypeScript, which this config doesn't parse.
  { ignores: ["dist/", "legacy/", "supabase/functions/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{js,ts,tsx}", "tests/**/*.{js,ts,tsx}", "*.{js,ts}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser },
    },
  },
  {
    files: ["scripts/**/*.js", "*.config.js"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
];
