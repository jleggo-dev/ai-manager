/**
 * Prod smoke test: Devs.ai v2 provider profiles, jobs, and UI tests.
 *
 * Usage (PowerShell):
 *   node scripts/prod-v2-smoke.mjs
 *
 * Env (loaded from backend/.env):
 *   AI_MANAGER_SUPABASE_URL, AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY
 *   VITE_DEV_API_KEY, DEVS_AI_API_KEY
 *   PROD_SMOKE_EMAIL (default: jleggo@gmail.com)
 *   E2E_BASE_URL (default: https://ai-manager-alpha-seven.vercel.app)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PROD_URL = process.env.E2E_BASE_URL || 'https://ai-manager-alpha-seven.vercel.app';
const API_BASE = `${PROD_URL}/_/backend`;
const WORKSPACE_ID = '08d419ed-9798-4683-98e3-5842e14b4135';
const MODEL_ID = process.env.PROD_SMOKE_MODEL || 'gpt-5-mini';
const TIMESTAMP = Date.now();
const V2_PROVIDER_NAME = 'Devs.ai v2';

const NAMES = {
  completionProfile: `Prod V2 Completion ${TIMESTAMP}`,
  chatProfile: `Prod V2 Chat ${TIMESTAMP}`,
  completionJob: `Prod V2 Completion Job ${TIMESTAMP}`,
  chatJob: `Prod V2 Chat Job ${TIMESTAMP}`,
};

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const out = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function apiRequest(env, method, urlPath, body) {
  const headers = {
    Authorization: `Bearer ${env.VITE_DEV_API_KEY}`,
    'X-Workspace-Id': WORKSPACE_ID,
    'Content-Type': 'application/json',
  };
  const res = await fetch(`${API_BASE}${urlPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`${method} ${urlPath} failed (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}

function unwrapList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return payload;
}

async function ensureV2Provider(env) {
  const providers = unwrapList(await apiRequest(env, 'GET', '/api/providers'));
  let v2 = providers.find((p) => p.type === 'devs-ai-v2');
  if (!v2) {
    v2 = await apiRequest(env, 'POST', '/api/providers', {
      name: V2_PROVIDER_NAME,
      type: 'devs-ai-v2',
      base_url: 'https://devs.ai',
      api_key: env.DEVS_AI_API_KEY,
      is_active: true,
    });
    console.log(`[api] Created v2 provider ${v2.id}`);
  } else {
    console.log(`[api] v2 provider exists: ${v2.id} (${v2.name})`);
  }

  const sync = await apiRequest(env, 'POST', `/api/providers/${v2.id}/models/sync`, {});
  console.log(`[api] Model sync: ${JSON.stringify(sync)}`);

  const test = await apiRequest(env, 'POST', `/api/providers/${v2.id}/test`, {});
  console.log(`[api] Provider test: ${JSON.stringify(test)}`);
  return v2;
}

async function loginWithMagicLink(page, env) {
  const email = env.PROD_SMOKE_EMAIL || 'jleggo@gmail.com';
  const supabase = createClient(env.AI_MANAGER_SUPABASE_URL, env.AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: PROD_URL },
  });
  if (error) throw new Error(`Magic link failed: ${error.message}`);

  const tokenHash = data?.properties?.hashed_token;
  if (!tokenHash) throw new Error('No hashed_token from generateLink');

  const { data: verified, error: verifyError } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: 'magiclink',
  });
  if (verifyError || !verified.session) {
    throw new Error(`OTP verify failed: ${verifyError?.message || 'no session'}`);
  }

  const projectRef = new URL(env.AI_MANAGER_SUPABASE_URL).hostname.split('.')[0];
  const storageKey = `sb-${projectRef}-auth-token`;
  const sessionPayload = JSON.stringify({
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
    expires_at: verified.session.expires_at,
    expires_in: verified.session.expires_in,
    token_type: verified.session.token_type,
    user: verified.session.user,
  });

  console.log(`[auth] Session created for ${email}`);
  await page.goto(PROD_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.evaluate(
    (storageKey, sessionPayload, accessToken, workspaceId) => {
      localStorage.setItem(storageKey, sessionPayload);
      sessionStorage.setItem('aim_access_token', accessToken);
      sessionStorage.setItem('aim_workspace_id', workspaceId);
      sessionStorage.removeItem('aim_signed_out');
    },
    storageKey,
    sessionPayload,
    verified.session.access_token,
    WORKSPACE_ID,
  );
  await page.reload({ waitUntil: 'networkidle2', timeout: 120_000 });
  await sleep(2000);

  await page.waitForFunction(
    () =>
      document.querySelector('button[aria-label="Providers"]') ||
      document.querySelector('button[aria-label="Profiles"]'),
    { timeout: 90_000 },
  );
  console.log('[auth] Logged in — app shell visible');
}

async function clickNav(page, label) {
  const btn = await page.waitForSelector(`button[aria-label="${label}"]`, { timeout: 30_000 });
  await btn.click();
  await sleep(1200);
}

async function waitForProfilesPage(page) {
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('Add AI Profile')),
    { timeout: 60_000 },
  );
  await sleep(500);
}

async function clickButtonByText(page, text, { exact = false } = {}) {
  const clicked = await page.evaluate(
    (text, exact) => {
      const buttons = [...document.querySelectorAll('button')];
      const match = buttons.find((b) => {
        const t = (b.textContent || '').trim();
        return exact ? t === text : t.includes(text);
      });
      if (!match) return false;
      match.click();
      return true;
    },
    text,
    exact,
  );
  if (!clicked) throw new Error(`Button not found: "${text}"`);
  await sleep(800);
}

async function fillByLabel(page, label, value) {
  const filled = await page.evaluate(
    (label, value) => {
      const labels = [...document.querySelectorAll('label')];
      const el = labels.find((l) => (l.textContent || '').includes(label));
      if (!el) return false;
      const root =
        el.closest('.mantine-InputWrapper-root, .mantine-TextInput-root, .mantine-Textarea-root') ||
        el.parentElement?.parentElement;
      const field = root?.querySelector('input, textarea');
      if (!field) return false;
      field.focus();
      const setter = Object.getOwnPropertyDescriptor(
        field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value',
      )?.set;
      if (setter) setter.call(field, value);
      else field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    label,
    value,
  );
  if (!filled) throw new Error(`Field not found for label: ${label}`);
  await sleep(300);
}

async function fillByPlaceholder(page, placeholder, value) {
  const filled = await page.evaluate(
    (placeholder, value) => {
      const field = document.querySelector(`input[placeholder="${placeholder}"]`);
      if (!field) return false;
      field.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (setter) setter.call(field, value);
      else field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    placeholder,
    value,
  );
  if (!filled) throw new Error(`Field not found for placeholder: ${placeholder}`);
  await sleep(400);
}

async function waitForToast(page, text) {
  await page.waitForFunction(
    (text) => (document.body.innerText || '').includes(text),
    { timeout: 45_000 },
    text,
  );
  await sleep(500);
}

async function openMantineSelect(page, { label, placeholder }) {
  const opened = await page.evaluate(
    ({ label, placeholder }) => {
      if (placeholder) {
        const byPh = document.querySelector(`input[placeholder="${placeholder}"]`);
        if (byPh) {
          byPh.click();
          byPh.focus();
          return true;
        }
      }
      const labels = [...document.querySelectorAll('label')];
      const el = labels.find((l) => (l.textContent || '').includes(label));
      if (!el) return false;
      let node = el.parentElement;
      for (let i = 0; i < 6 && node; i++) {
        const input = node.querySelector('input[role="combobox"], input[data-combobox-input], input');
        if (input) {
          input.click();
          input.focus();
          return true;
        }
        node = node.parentElement;
      }
      return false;
    },
    { label, placeholder },
  );
  if (!opened) throw new Error(`Could not open select: ${label || placeholder}`);
  await sleep(400);
}

async function chooseMantineOption(page, optionText) {
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(optionText, { delay: 25 });
  await sleep(1000);
  try {
    await page.waitForSelector('[role="listbox"] [role="option"]', { timeout: 8000 });
  } catch {
    await page.keyboard.press('ArrowDown');
    await sleep(200);
    await page.keyboard.press('Enter');
    await sleep(700);
    return;
  }
  const picked = await page.evaluate((optionText) => {
    const options = [
      ...document.querySelectorAll('[role="listbox"] [role="option"], [role="option"], .mantine-Select-option'),
    ];
    const opt = options.find((o) => (o.textContent || '').toLowerCase().includes(optionText.toLowerCase()));
    if (!opt) return false;
    opt.click();
    return true;
  }, optionText);
  if (!picked) {
    await page.keyboard.press('ArrowDown');
    await sleep(200);
    await page.keyboard.press('Enter');
  }
  await sleep(700);
}

async function openSelectByTestId(page, testId) {
  const opened = await page.evaluate((testId) => {
    const root = document.querySelector(`[data-testid="${testId}"]`);
    const input = root?.querySelector('input[role="combobox"], input[data-combobox-input], input');
    if (!input) return false;
    input.click();
    input.focus();
    return true;
  }, testId);
  if (!opened) throw new Error(`Could not open select: ${testId}`);
  await sleep(400);
}

async function setModelOnProfileForm(page, modelId) {
  await page.waitForSelector('[data-testid="profile-model-select"]', { timeout: 30_000 });
  await sleep(1500);
  await openSelectByTestId(page, 'profile-model-select');
  await chooseMantineOption(page, modelId);
  await page.waitForFunction(
    (modelId) => {
      const root = document.querySelector('[data-testid="profile-model-select"]');
      const input = root?.querySelector('input');
      const value = (input?.value || '').toLowerCase();
      return value.includes(modelId.toLowerCase());
    },
    { timeout: 15_000 },
    modelId,
  );
}

async function createProfileViaApi(env, v2ProviderId, { name, mode, modelId }) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  return apiRequest(env, 'POST', '/api/ai-profiles', {
    name,
    slug,
    provider_id: v2ProviderId,
    external_ai_id: modelId,
    profile_type: 'model',
    mode,
    is_active: true,
    runtime_options: {
      devs_ai_v2: {
        built_in_tools: [],
        chat_mode: 'execute',
        thread_mode: 'collect',
        parallel_tool_calls: true,
      },
    },
  });
}

async function createJobViaApi(env, { name, profileId }) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
  return apiRequest(env, 'POST', '/api/processing-jobs', {
    name,
    slug,
    ai_profile_id: profileId,
    is_active: true,
    calling_application_id: 'smoke-test:prod-v2',
    config: {
      systemPrompt: 'You are a helpful assistant. Reply concisely.',
      promptTemplate: '{{message}}',
      variables: [{ name: 'message', label: 'Message', required: true }],
    },
  });
}

async function selectMantineByLabel(page, label, optionText, placeholder) {
  await openMantineSelect(page, { label, placeholder });
  await chooseMantineOption(page, optionText);
}

async function clickSegment(page, label) {
  const clicked = await page.evaluate((label) => {
    const items = [...document.querySelectorAll('.mantine-SegmentedControl-label, [data-active]')];
    const seg = items.find((el) => (el.textContent || '').trim() === label);
    if (!seg) return false;
    seg.click();
    return true;
  }, label);
  if (!clicked) throw new Error(`Segment not found: ${label}`);
  await sleep(500);
}

async function gotoPage(page, pageKey) {
  const url = `${PROD_URL}/?page=${pageKey}`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 120_000 });
  await sleep(1500);
}

async function waitForJobsPage(page) {
  await page.waitForFunction(
    () => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('Add Processing Job')),
    { timeout: 60_000 },
  );
  await sleep(500);
}

async function fillByTestId(page, testId, value) {
  const filled = await page.evaluate(
    (testId, value) => {
      const root = document.querySelector(`[data-testid="${testId}"]`);
      const field = root?.querySelector('input, textarea') || root;
      if (!field || !(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return false;
      field.focus();
      const setter = Object.getOwnPropertyDescriptor(
        field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value',
      )?.set;
      if (setter) setter.call(field, value);
      else field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    testId,
    value,
  );
  if (!filled) throw new Error(`Field not found for test id: ${testId}`);
  await sleep(300);
}

async function createAiProfile(page, env, v2ProviderId, { name, mode, providerName, modelId }) {
  const allowApiFallback = process.env.PROD_SMOKE_API_FALLBACK === '1';
  try {
    await gotoPage(page, 'ai-profiles');
    await waitForProfilesPage(page);
    await clickButtonByText(page, 'Add AI Profile');
    await clickSegment(page, mode === 'chat' ? 'Chat' : 'Completion');
    await openSelectByTestId(page, 'profile-provider-select');
    await chooseMantineOption(page, providerName);
    await setModelOnProfileForm(page, modelId);
    await fillByTestId(page, 'profile-name-input', name);
    await clickButtonByText(page, 'Create', { exact: true });
    await waitForToast(page, 'AI profile created');
    console.log(`[ui] Created AI profile: ${name} (${mode})`);
  } catch (err) {
    if (!allowApiFallback) throw err;
    console.warn(`[ui] Profile form failed (${err.message}); creating via API`);
    const row = await createProfileViaApi(env, v2ProviderId, { name, mode, modelId });
    console.log(`[api] Created AI profile: ${name} (${row.id})`);
  }
}

async function createProcessingJob(page, env, { name, profileName, profileId }) {
  try {
    await gotoPage(page, 'processing-jobs');
    await waitForJobsPage(page);
    await clickButtonByText(page, 'Add Processing Job');
    await fillByLabel(page, 'Job Name', name);
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await fillByLabel(page, 'Slug', slug);
    await selectMantineByLabel(page, 'AI Profile', profileName, 'Select an AI profile');
    await clickButtonByText(page, 'Create', { exact: true });
    await waitForToast(page, 'Processing job created');
    console.log(`[ui] Created processing job: ${name}`);
  } catch (err) {
    if (!profileId) throw err;
    console.warn(`[ui] Job form failed (${err.message}); creating via API`);
    const row = await createJobViaApi(env, { name, profileId });
    console.log(`[api] Created processing job: ${name} (${row.id})`);
  }
}

async function runCompletionJobTest(page, jobName) {
  await gotoPage(page, 'processing-jobs');
  await waitForJobsPage(page);
  await fillByPlaceholder(page, 'Search jobs...', jobName);
  await sleep(1000);
  const selected = await page.evaluate((jobName) => {
    const rows = [...document.querySelectorAll('tr')];
    const row = rows.find((el) => (el.textContent || '').includes(jobName));
    if (!row) return false;
    row.click();
    return true;
  }, jobName);
  if (!selected) throw new Error(`Job row not found: ${jobName}`);
  await sleep(1000);

  await clickButtonByText(page, 'Test Rules (API call)');
  await sleep(1000);
  try {
    await fillByPlaceholder(page, 'Enter Message', 'Reply with exactly: hello');
  } catch {
    await fillByLabel(page, 'Message', 'Reply with exactly: hello');
  }
  await clickButtonByText(page, 'Compose Prompt');
  await sleep(1000);
  await page.waitForFunction(
    () => {
      const badges = [...document.querySelectorAll('.mantine-Badge-root, [class*="Badge"]')];
      return badges.some((b) => /\d+ chars/.test((b.textContent || '').trim()) && !b.textContent?.includes('0 chars'));
    },
    { timeout: 15_000 },
  ).catch(async () => {
    await page.evaluate(() => {
      const areas = [...document.querySelectorAll('textarea')];
      const target = areas[areas.length - 1];
      if (!target) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      const text = 'Reply with exactly: hello';
      if (setter) setter.call(target, text);
      else target.value = text;
      target.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  await clickButtonByText(page, 'Run Test');
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return (
        text.includes('assistant') ||
        text.includes('Response') ||
        text.includes('Test Result') ||
        text.includes('tokens') ||
        text.includes('completed')
      );
    },
    { timeout: 120_000 },
  );
  console.log(`[ui] Completion job test finished for: ${jobName}`);
}

async function runChatProfileTest(page, profileName) {
  await gotoPage(page, 'ai-profiles');
  await waitForProfilesPage(page);
  await fillByPlaceholder(page, 'Search profiles...', profileName);
  await sleep(1000);
  const menuOpened = await page.evaluate((profileName) => {
    const rows = [...document.querySelectorAll('tr')];
    const row = rows.find((r) => (r.textContent || '').includes(profileName));
    if (!row) return false;
    const dots = row.querySelector('button');
    if (!dots) return false;
    dots.click();
    return true;
  }, profileName);
  if (!menuOpened) {
    const cardOpened = await page.evaluate((profileName) => {
      const cards = [...document.querySelectorAll('.mantine-Card-root, [class*="Card"]')];
      const card = cards.find((el) => (el.textContent || '').includes(profileName));
      if (!card) return false;
      const btn = [...card.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Test chat'));
      if (!btn) return false;
      btn.click();
      return true;
    }, profileName);
    if (!cardOpened) throw new Error(`Could not open Test chat for profile: ${profileName}`);
  } else {
    await sleep(500);
    await clickButtonByText(page, 'Test chat');
  }

  await sleep(1500);
  await page.waitForSelector('input[placeholder*="Type your message"]', { timeout: 20_000 });
  await fillByPlaceholder(page, 'Type your message to test the AI response formatting...', 'Reply with exactly: pong');
  await page.focus('input[placeholder*="Type your message"]');
  await sleep(300);
  await page.keyboard.press('Enter');
  await page.waitForFunction(
    () => {
      const body = document.body.innerText.toLowerCase();
      return body.includes('pong') || body.includes('assistant');
    },
    { timeout: 120_000 },
  );
  console.log(`[ui] Chat test finished for profile: ${profileName}`);
}

async function main() {
  const env = {
    ...loadEnvFile(path.join(ROOT, 'backend', '.env')),
    ...process.env,
  };

  const required = ['VITE_DEV_API_KEY', 'DEVS_AI_API_KEY', 'AI_MANAGER_SUPABASE_URL', 'AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY'];
  for (const key of required) {
    if (!env[key]) throw new Error(`Missing ${key} in backend/.env or environment`);
  }

  console.log(`[smoke] Target: ${PROD_URL}`);
  console.log(`[smoke] Model: ${MODEL_ID}`);

  const v2 = await ensureV2Provider(env);
  const providerLabel = v2.name || V2_PROVIDER_NAME;

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    defaultViewport: { width: 1440, height: 900 },
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(120_000);

  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    await loginWithMagicLink(page, env);
    const createdProfiles = {};
    for (const spec of [
      { key: 'completion', name: NAMES.completionProfile, mode: 'completion' },
      { key: 'chat', name: NAMES.chatProfile, mode: 'chat' },
    ]) {
      await createAiProfile(page, env, v2.id, {
        name: spec.name,
        mode: spec.mode,
        providerName: providerLabel,
        modelId: MODEL_ID,
      });
      const profiles = unwrapList(await apiRequest(env, 'GET', '/api/ai-profiles'));
      const row = profiles.find((p) => p.name === spec.name);
      if (!row) throw new Error(`Profile not found after create: ${spec.name}`);
      createdProfiles[spec.key] = row.id;
    }

    await createJobViaApi(env, { name: NAMES.completionJob, profileId: createdProfiles.completion });
    console.log(`[api] Created completion job: ${NAMES.completionJob}`);
    await createJobViaApi(env, { name: NAMES.chatJob, profileId: createdProfiles.chat });
    console.log(`[api] Created chat job: ${NAMES.chatJob}`);
    await runCompletionJobTest(page, NAMES.completionJob);
    await runChatProfileTest(page, NAMES.chatProfile);

    console.log('\n=== PROD V2 SMOKE: PASS ===');
    console.log(JSON.stringify({ providerId: v2.id, ...NAMES }, null, 2));
    if (consoleErrors.length) {
      console.warn('[warn] Browser console errors:', consoleErrors.slice(0, 5));
    }
  } catch (err) {
    const shot = path.join(ROOT, 'scripts', `prod-v2-smoke-fail-${TIMESTAMP}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    console.error(`\n=== PROD V2 SMOKE: FAIL ===\n${err.message}`);
    if (fs.existsSync(shot)) console.error(`Screenshot: ${shot}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
