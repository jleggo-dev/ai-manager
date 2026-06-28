#!/usr/bin/env node
/**
 * Sync docs/ sources into frontend/public/ for static serving.
 * Stamps manifest version from root package.json.
 * Usage: node scripts/sync-docs.mjs [--check]
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const PUBLIC = join(ROOT, 'frontend', 'public');

const checkOnly = process.argv.includes('--check');

/** @type {Array<{ src: string; dest: string }>} */
const FILE_MAPPINGS = [
  { src: 'docs/API.md', dest: 'frontend/public/docs/API.md' },
  { src: 'docs/CONCEPTS.md', dest: 'frontend/public/docs/CONCEPTS.md' },
  { src: 'docs/INTEGRATION.md', dest: 'frontend/public/docs/INTEGRATION.md' },
  { src: 'CHANGELOG.md', dest: 'frontend/public/docs/CHANGELOG.md' },
  { src: 'docs/manifest.json', dest: 'frontend/public/docs/manifest.json' },
  { src: 'docs/llms.txt', dest: 'frontend/public/llms.txt' },
  { src: 'docs/integration/AI_ADMIN_LOVABLE_INTEGRATION.md', dest: 'frontend/public/integration/AI_ADMIN_LOVABLE_INTEGRATION.md' },
  { src: 'docs/integration/ai-admin-supabase-edge-function.ts', dest: 'frontend/public/integration/ai-admin-supabase-edge-function.ts' },
  { src: 'docs/integration/AI_ADMIN_TEST_PAGE_SPEC.md', dest: 'frontend/public/integration/AI_ADMIN_TEST_PAGE_SPEC.md' },
  { src: 'docs/integration/WORKFLOW_BUILDER_PROMPT.md', dest: 'frontend/public/integration/WORKFLOW_BUILDER_PROMPT.md' },
  // Skills — published so any coding agent can download them
  { src: '.cursor/skills/ai-admin-integration/SKILL.md', dest: 'frontend/public/skills/ai-admin-integration/SKILL.md' },
  { src: '.cursor/skills/prompt-engineering/SKILL.md', dest: 'frontend/public/skills/prompt-engineering/SKILL.md' },
  { src: '.cursor/skills/prompt-engineering/references/frameworks.md', dest: 'frontend/public/skills/prompt-engineering/references/frameworks.md' },
  { src: '.cursor/skills/prompt-engineering/references/audit-checklist.md', dest: 'frontend/public/skills/prompt-engineering/references/audit-checklist.md' },
  { src: '.cursor/skills/prompt-engineering/references/grounding.md', dest: 'frontend/public/skills/prompt-engineering/references/grounding.md' },
  { src: '.cursor/skills/prompt-engineering/references/extraction-schemas.md', dest: 'frontend/public/skills/prompt-engineering/references/extraction-schemas.md' },
  { src: '.cursor/skills/prompt-engineering/references/output-verification.md', dest: 'frontend/public/skills/prompt-engineering/references/output-verification.md' },
  { src: '.cursor/skills/prompt-engineering/references/model-selection.md', dest: 'frontend/public/skills/prompt-engineering/references/model-selection.md' },
  { src: '.cursor/skills/prompt-engineering/references/evaluation.md', dest: 'frontend/public/skills/prompt-engineering/references/evaluation.md' },
];

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function ensureDirForFile(destPath) {
  mkdirSync(dirname(destPath), { recursive: true });
}

function copyMappedFile(mapping) {
  const srcPath = join(ROOT, mapping.src);
  const destPath = join(ROOT, mapping.dest);
  ensureDirForFile(destPath);
  copyFileSync(srcPath, destPath);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function stampManifest() {
  const pkg = readJson(join(ROOT, 'package.json'));
  const manifestPath = join(ROOT, 'docs', 'manifest.json');
  const manifest = readJson(manifestPath);
  manifest.version = pkg.version;
  manifest.lastUpdated = new Date().toISOString().slice(0, 10);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function validateManifest(manifest) {
  const warnings = [];
  const manifestPaths = new Set();

  for (const doc of manifest.documents ?? []) {
    if (!doc.path) continue;
    const servedPath = doc.path.startsWith('/') ? doc.path.slice(1) : doc.path;
    const normalized = join(PUBLIC, ...servedPath.split('/'));

    manifestPaths.add(servedPath);

    if (!statSync(normalized, { throwIfNoEntry: false })) {
      warnings.push(`manifest references missing file: ${doc.path} (${doc.id})`);
    }

    for (const section of doc.sections ?? []) {
      if (!section.anchor) {
        warnings.push(`section "${section.id}" in ${doc.id} missing anchor`);
      }
    }
  }

  const integrationDir = join(PUBLIC, 'integration');
  if (statSync(integrationDir, { throwIfNoEntry: false })) {
    for (const name of readdirSync(integrationDir)) {
      const rel = `integration/${name}`;
      if (!manifestPaths.has(rel)) {
        warnings.push(`served file not in manifest: /${rel}`);
      }
    }
  }

  return warnings;
}

function main() {
  stampManifest();

  let stale = false;
  for (const mapping of FILE_MAPPINGS) {
    const srcPath = join(ROOT, mapping.src);
    const destPath = join(ROOT, mapping.dest);

    if (!statSync(srcPath, { throwIfNoEntry: false })) {
      console.error(`[sync-docs] missing source: ${mapping.src}`);
      process.exit(1);
    }

    if (checkOnly) {
      const destExists = statSync(destPath, { throwIfNoEntry: false });
      if (!destExists || sha256(srcPath) !== sha256(destPath)) {
        console.error(`[sync-docs] stale or missing: ${mapping.dest}`);
        stale = true;
      }
      continue;
    }

    copyMappedFile(mapping);
    console.log(`[sync-docs] ${mapping.src} -> ${mapping.dest}`);
  }

  if (checkOnly) {
    if (stale) process.exit(1);
    console.log('[sync-docs] all public copies are up to date');
    return;
  }

  const manifest = readJson(join(PUBLIC, 'docs', 'manifest.json'));
  const warnings = validateManifest(manifest);
  for (const w of warnings) console.warn(`[sync-docs] warn: ${w}`);

  console.log(`[sync-docs] done (version ${manifest.version})`);
}

main();
