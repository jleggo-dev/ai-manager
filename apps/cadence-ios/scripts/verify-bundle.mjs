#!/usr/bin/env node
/**
 * Refuse to ship a phone build that cannot reach the API.
 *
 * Cost of not having this: a full debugging round on 2026-08-15. The bundle was built with a
 * plain `vite build` instead of `--mode ios`, so `VITE_CADENCE_API_BASE` came from `.env`
 * (`/api`) rather than `.env.ios` (the deployed host). Inside the Capacitor shell there is no
 * Vercel rewrite, so every call went to the webview's own localhost origin, came back as a
 * 65-byte non-JSON body, and `res.json()` threw. On screen that reads "Something hiccuped on my
 * end" on every single turn — indistinguishable from a broken coach, and it survived an uninstall
 * and three reinstalls because the bundle was wrong, not the device.
 *
 * CI cannot catch this: it never builds the iOS bundle (correctly — that artifact is only ever
 * produced here, on the machine holding the phone), and nothing in code is wrong in either mode.
 * The only place the mistake is visible is immediately after the build, which is here.
 *
 * Three assertions, all about the ARTIFACT rather than the source, because the source was fine:
 *  1. `.env.ios` declares an absolute API base (a relative one cannot work in the shell).
 *  2. That host actually appears in the built JS — proving the ios-mode env reached the bundle.
 *  3. Every local package path in the generated `CapApp-SPM/Package.swift` resolves. See below.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = join(here, '../../cadence-web/.env.ios');
const assetsDir = join(here, '../ios/App/App/public/assets');
const packageSwift = join(here, '../ios/App/CapApp-SPM/Package.swift');

const fail = (msg) => {
  console.error(`\n✖ iOS bundle check failed\n\n  ${msg}\n`);
  console.error('  Build it with the shell script, which selects the right Vite mode:\n');
  console.error('      cd apps/cadence-ios && npm run sync\n');
  process.exit(1);
};

const env = readFileSync(envPath, 'utf8');
const base = env.match(/^VITE_CADENCE_API_BASE=(.+)$/m)?.[1]?.trim();
if (!base) fail('.env.ios does not set VITE_CADENCE_API_BASE.');
if (!/^https?:\/\//.test(base)) {
  fail(`.env.ios sets VITE_CADENCE_API_BASE="${base}", which is relative. The native shell has no
  rewrite to resolve it against, so it must be an absolute URL.`);
}

const host = new URL(base).host;
const js = readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
if (!js.length) fail(`No built JS in ${assetsDir} — did the build run?`);
const found = js.some((f) => readFileSync(join(assetsDir, f), 'utf8').includes(host));
if (!found) {
  fail(`The built bundle never mentions ${host}, so it is not pointed at the API. This is what a
  plain \`npm run build\` produces: the default mode reads .env, where the base is "/api", and in
  the shell that resolves to the webview's own origin.`);
}

console.log(`✓ iOS bundle points at ${host}`);

/**
 * `cap sync` writes the plugin paths in Package.swift RELATIVE to that file, so the correct depth
 * depends on where it was run. An agent worktree under `.claude/worktrees/<name>/` sits three
 * levels deeper than the primary checkout and carries no `node_modules` of its own, so a sync run
 * there resolves back to the real one eight levels up and writes `../` × 8. Committed from there,
 * the file points at `/Users/node_modules` for everyone else, and a plain `xcodebuild` dies at
 * package resolution before it compiles a line.
 *
 * That is survivable only because `npm run sync` regenerates the file first, which is precisely
 * why it went unnoticed on main for weeks: the normal flow never reads the committed version.
 * Checked here rather than in CI for the same reason as the assertions above — CI never builds
 * the iOS project, so this is the last place the mistake is visible.
 */
const pkg = readFileSync(packageSwift, 'utf8');
const pkgDir = dirname(packageSwift);
const localPaths = [...pkg.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]);
if (!localPaths.length) fail(`No local package paths found in ${packageSwift} — did cap sync run?`);

const unresolved = localPaths.filter((p) => !existsSync(resolve(pkgDir, p)));
if (unresolved.length) {
  fail(`CapApp-SPM/Package.swift points at packages that do not exist, e.g.
      ${resolve(pkgDir, unresolved[0])}

  These paths are relative to Package.swift, so this is what \`cap sync\` writes when it is run
  from a different depth than the primary checkout — an agent worktree under .claude/worktrees/ is
  the usual culprit. Re-run the sync from the primary checkout and commit the result.`);
}

console.log(`✓ ${localPaths.length} SPM plugin paths resolve`);
