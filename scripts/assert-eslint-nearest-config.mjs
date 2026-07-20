#!/usr/bin/env node
/**
 * CI-06 — Guard: ESLint flat config resolves the *nearest* eslint.config.js to the
 * linted file, even when invoked from the monorepo root.
 *
 * Why this matters: root `lint-staged` runs `eslint --fix` from repo root on staged
 * paths like `backend/src/…`. There is intentionally **no** root eslint.config.js —
 * each workspace owns its own. If a future ESLint major stopped walking from the file
 * and only looked from cwd, pre-commit lint would break (or silently use the wrong
 * rules) with no other coverage.
 *
 * Run: `npm run test:eslint-nearest-config` (also wired into the format-check CI job).
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ROOT_CONFIG_CANDIDATES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.cjs',
  'eslint.config.ts',
];

function fail(message) {
  console.error(`assert-eslint-nearest-config: ${message}`);
  process.exit(1);
}

function printConfig(relFile) {
  try {
    return execFileSync('npx', ['eslint', '--print-config', relFile], {
      cwd: root,
      encoding: 'utf8',
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const detail = err.stderr?.toString?.() || err.message || String(err);
    fail(`eslint --print-config ${relFile} failed from repo root (nearest-config broken?):\n${detail}`);
  }
}

for (const name of ROOT_CONFIG_CANDIDATES) {
  if (existsSync(path.join(root, name))) {
    fail(
      `unexpected root ${name} — lint-staged relies on per-workspace nearest configs; ` +
        `a root config would change resolution. Move it or update this guard.`,
    );
  }
}

const backendOut = printConfig('backend/src/index.ts');
const frontendOut = printConfig('frontend/src/main.tsx');

if (!backendOut.includes('"max-lines"')) {
  fail('backend print-config missing max-lines — expected backend/eslint.config.js via size gates');
}
if (backendOut.includes('eslint-plugin-react')) {
  fail('backend print-config unexpectedly includes eslint-plugin-react (wrong / merged config?)');
}
if (!frontendOut.includes('eslint-plugin-react')) {
  fail('frontend print-config missing eslint-plugin-react — expected frontend/eslint.config.js');
}
if (!frontendOut.includes('"react"')) {
  fail('frontend print-config missing react settings — expected frontend/eslint.config.js');
}

console.log('assert-eslint-nearest-config: ok (nearest workspace configs from repo root)');
