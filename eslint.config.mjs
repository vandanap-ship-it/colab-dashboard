import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Prisma's generated client is machine-written; linting it adds noise and
    // can break CI on generator-version changes we don't control.
    "src/generated/**",
  ]),
  {
    rules: {
      // Resetting state at the top of a data-fetch effect (e.g. setError(null)
      // before re-fetching) is the accepted idiom in this codebase, not a bug.
      // Keep it a visible warning rather than a build-breaker. Genuine
      // hook-correctness rules (rules-of-hooks, refs, exhaustive-deps) stay as
      // errors so real mistakes still fail CI.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
]);

export default eslintConfig;
