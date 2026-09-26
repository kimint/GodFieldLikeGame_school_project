import js from "@eslint/js";
import globals from "globals";

export default [
  // legacy/ is the old prototype kept for reference; supabase/functions/ is
  // Deno TypeScript, which this config doesn't parse.
  { ignores: ["dist/", "legacy/", "supabase/functions/"] },
  js.configs.recommended,
  {
    files: ["src/**/*.js", "tests/**/*.js", "*.js"],
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
