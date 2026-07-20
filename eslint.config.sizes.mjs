// Repo-wide code-size gates — the machine-enforced half of "prevent regrowth, don't just fix size
// once" (refactoring_plan.md §5.1). ProcessingJobManager.tsx proved a one-time file-level fix
// doesn't hold without a guardrail: it grew back 1,420 lines larger. These rules run at `error` in
// every workspace's ESLint config, so CI (`eslint . --max-warnings 0`) and the pre-commit hook
// fail any PR that lands — or regrows — an oversized file or function. No reviewer vigilance needed.
//
// CI-06 (load-bearing for lint-staged): there is no root eslint.config.js. ESLint flat config
// resolves the *nearest* eslint.config.js to each linted file even when `eslint --fix` is
// invoked from the monorepo root (as husky/lint-staged does). Do not add a root config without
// updating lint-staged; guard: `npm run test:eslint-nearest-config`.
//
// HOW TO USE: `import { sizeRules } from '<rel>/eslint.config.sizes.mjs'` in a workspace
// eslint.config.js and spread `...sizeRules` into its main files block. Grandfathered offenders go
// in a SEPARATE block that sets these rules to 'off' for specific files — that allowlist IS the
// refactor backlog: every split PR deletes an entry, and the target is zero. NEVER add a new file
// to an allowlist to make CI pass — split it instead.
//
// Tune the thresholds HERE (one place, all workspaces). 500 file / 150 function chosen 2026-07-19.
// (.mjs so it's unambiguously ESM regardless of the CommonJS repo-root package.json.)
//
// NOTE: cyclomatic `complexity` was evaluated at 15 and deliberately LEFT OUT for now — this
// 5-year-old codebase has dozens of functions at complexity 20-85, so enforcing it would mean
// allowlisting a large share of files and the gate would mean nothing. Size (lines) is the concrete
// "huge files/functions benefit nobody" signal; complexity is a separate, noisier axis to add later
// at a calibrated threshold (its own ticket) once the size backlog is worked down.
// The file-size cap — apply to ALL source (.ts + .tsx). This is the headline "no huge files" gate.
export const fileRule = {
  'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
};

// The function-size cap — apply to LOGIC (.ts) only, NOT React (.tsx): a JSX render body is
// legitimately long, so a component is capped at the FILE level, while a backend/service function
// that runs past 150 lines is a real god-function smell. This split keeps the gate high-signal.
export const functionRule = {
  'max-lines-per-function': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
};

// Both — for non-React workspaces (backend, cadence-api, packages) whose source is all .ts.
export const sizeRules = { ...fileRule, ...functionRule };
