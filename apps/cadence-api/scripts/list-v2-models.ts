/** Query the devs-ai-v2 provider's model catalog from the AI Admin API. */
import { config as dotenv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv({ path: path.join(root, 'backend/.env') });

const KEY = process.env.AI_ADMIN_API_KEY || process.env.VITE_DEV_API_KEY || '';
const rawBase = process.env.AI_ADMIN_BASE_URL || 'https://ai-manager-alpha-seven.vercel.app';
const BASE =
  rawBase.includes('/_/backend') || rawBase.includes('localhost')
    ? rawBase.replace(/\/+$/, '')
    : rawBase.replace(/\/+$/, '') + '/_/backend';
const V2 = '497b0910-b210-4694-855b-67e3ed8a3601';

async function tryPath(method: string, p: string) {
  try {
    const res = await fetch(`${BASE}${p}`, { method, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' } });
    const text = await res.text();
    console.log(`\n${method} ${p} → ${res.status}\n${text.slice(0, 1500)}`);
  } catch (e) {
    console.log(`\n${method} ${p} → ERROR ${(e as Error).message}`);
  }
}

async function main() {
  if (!KEY) throw new Error('no AI Admin API key in backend/.env');
  void tryPath;
  const res = await fetch(`${BASE}/api/providers/${V2}/models`, { headers: { Authorization: `Bearer ${KEY}` } });
  const arr = (await res.json()) as Array<{ model_id: string; category?: string }>;
  const ids = arr.map((m) => m.model_id).sort();
  console.log(`${ids.length} models on devs-ai-v2:`);
  for (const id of ids) console.log('  ' + id);
  console.log('\nGEMINI :', ids.filter((i) => /gemini/i.test(i)).join(', ') || '(none)');
  console.log('GPT    :', ids.filter((i) => /gpt/i.test(i)).join(', ') || '(none)');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
