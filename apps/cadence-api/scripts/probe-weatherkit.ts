/**
 * Probe the WeatherKit credentials end-to-end and say WHICH field is wrong.
 *
 * Apple answers every credential mistake with the same opaque 401, and the four values come from
 * three different portal screens, so "it returns 401" is not a diagnosis. This checks the things
 * that are checkable locally FIRST (is the p8 parseable? does the Services ID look like a bundle
 * id? is the team id the right shape?), then makes one real call and maps the status to the
 * specific thing to go fix.
 *
 * Run: node --import tsx apps/cadence-api/scripts/probe-weatherkit.ts [lat] [lon]
 */
import { config as dotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv({ path: path.join(root, 'apps/cadence-api/.env') });

const LAT = Number(process.argv[2] ?? 51.5074);
const LON = Number(process.argv[3] ?? -0.1278);

const ok = (m: string) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m: string) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const warn = (m: string) => console.log(`  \x1b[33m!\x1b[0m ${m}`);

function preflight(): boolean {
  const keyId = process.env.WEATHERKIT_KEY_ID ?? '';
  const teamId = process.env.WEATHERKIT_TEAM_ID ?? '';
  const serviceId = process.env.WEATHERKIT_SERVICE_ID ?? '';
  const privateKey = process.env.WEATHERKIT_PRIVATE_KEY ?? '';
  let fatal = false;

  console.log('\nLocal checks (no network):');

  const missing = [
    ['WEATHERKIT_KEY_ID', keyId],
    ['WEATHERKIT_TEAM_ID', teamId],
    ['WEATHERKIT_SERVICE_ID', serviceId],
    ['WEATHERKIT_PRIVATE_KEY', privateKey],
  ].filter(([, v]) => !v);
  if (missing.length) {
    for (const [k] of missing) bad(`${k} is not set in apps/cadence-api/.env`);
    return false;
  }
  ok('all four WEATHERKIT_* vars are set');

  if (/^[A-Z0-9]{10}$/.test(keyId)) ok(`key id looks right (${keyId})`);
  else warn(`key id "${keyId}" is not the usual 10-char form — it is in the .p8 filename, AuthKey_<KEYID>.p8`);

  if (/^[A-Z0-9]{10}$/.test(teamId)) ok(`team id looks right (${teamId})`);
  else warn(`team id "${teamId}" is not the usual 10-char form — Account → Membership details`);

  // The single most common mistake: pasting the bundle id as the Services ID.
  const bundleId = process.env.APNS_BUNDLE_ID ?? '';
  if (bundleId && serviceId === bundleId) {
    bad(`WEATHERKIT_SERVICE_ID is your BUNDLE ID (${serviceId}). It must be the Services ID:`);
    console.log('     Identifiers → switch the top-right dropdown from "App IDs" to "Services IDs" → ＋');
    fatal = true;
  } else {
    ok(`services id is distinct from the bundle id (${serviceId})`);
  }

  try {
    const parsed = createPrivateKey(privateKey.replace(/\\n/g, '\n'));
    if (parsed.asymmetricKeyType === 'ec') ok('private key parses and is an EC (P-256) key');
    else {
      bad(`private key parsed but is "${parsed.asymmetricKeyType}", not ec — is this the right .p8?`);
      fatal = true;
    }
  } catch (e) {
    bad(`private key will not parse: ${(e as Error).message}`);
    console.log('     It must be the .p8 PEM contents, newlines as literal \\n, wrapped in quotes.');
    fatal = true;
  }

  return !fatal;
}

async function main() {
  console.log('WeatherKit credential probe');
  if (!preflight()) {
    console.log('\nStopped before calling Apple — fix the above first.\n');
    process.exit(1);
  }

  // Imported late: the client reads config at call time, and dotenv must have run first.
  const { weatherKitGet, WeatherKitError } = await import('../src/services/weather/weatherkit-http.ts');
  const { mapWeatherKitToSnapshot } = await import('../src/services/weather/weatherkit-map.ts');
  const { formatWeatherLine } = await import('../src/services/weather/weather-map.ts');

  console.log(`\nLive call — ${LAT}, ${LON}:`);
  try {
    const raw = await weatherKitGet(LAT, LON, 'UTC');
    const snap = mapWeatherKitToSnapshot(raw as Parameters<typeof mapWeatherKitToSnapshot>[0]);
    if (!snap) {
      bad('Apple answered 200 but the payload had no temperature.');
      console.log(`     Raw: ${JSON.stringify(raw).slice(0, 400)}`);
      process.exit(1);
    }
    ok('Apple returned usable weather');
    console.log(`\n  ${formatWeatherLine(snap)}`);
    console.log(`  source=${snap.source}  fetchedAt=${snap.fetchedAt}`);
    console.log('\nWeatherKit is live. Cadence will now prefer it over OpenWeatherMap.\n');
  } catch (e) {
    const status = e instanceof WeatherKitError ? e.status : 0;
    bad(`call failed (${status || 'network'}): ${(e as Error).message}`);
    if (status === 401 || status === 403) {
      console.log('\n  A 401/403 here is a credential mismatch, in likelihood order:');
      console.log('   1. WEATHERKIT_SERVICE_ID is not the Services ID (Identifiers → Services IDs).');
      console.log('   2. WeatherKit is not ticked on the App ID (Identifiers → App IDs → your bundle id).');
      console.log('   3. The key does not have WeatherKit enabled (Keys → the key → capabilities).');
      console.log('   4. WEATHERKIT_TEAM_ID is not the team that owns the key.');
      console.log('  If you only just changed a capability, give it ~30 min to propagate and retry.');
    } else if (status === 404) {
      console.log('\n  404 means Apple has no data for that coordinate — try a populated one:');
      console.log('   node --import tsx apps/cadence-api/scripts/probe-weatherkit.ts 40.7128 -74.0060');
    }
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
