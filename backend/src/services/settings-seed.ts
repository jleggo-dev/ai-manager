import { getSetting, upsertSetting } from '../models/app-settings.ts';

interface SeedDefinition {
  key: string;
  value: { value: unknown };
  description: string;
  logLabel: (v: unknown) => string;
}

const SEED_DEFINITIONS: SeedDefinition[] = [
  {
    key: 'default_llm_timeout_ms',
    value: { value: 300000 },
    description:
      'System-wide default timeout (ms) for LLM completion API calls. Applied when neither the processing job nor the provider specifies an override. 300 000 ms = 5 minutes.',
    logLabel: (v) => `${String(v)}ms`,
  },
  {
    key: 'rate_limit_global_rpm',
    value: { value: 200 },
    description: 'Maximum requests per minute across all API endpoints per IP address.',
    logLabel: (v) => `${String(v)} rpm`,
  },
  {
    key: 'rate_limit_llm_rpm',
    value: { value: 30 },
    description: 'Maximum requests per minute for AI/LLM endpoints (chat sessions, AI matcher) per IP address.',
    logLabel: (v) => `${String(v)} rpm`,
  },
  {
    key: 'rate_limit_auth_rpm',
    value: { value: 15 },
    description: 'Maximum requests per minute for authentication endpoints per IP address.',
    logLabel: (v) => `${String(v)} rpm`,
  },
  {
    key: 'rate_limit_llm_user_rpm',
    value: { value: 15 },
    description:
      'Maximum requests per minute for AI/LLM endpoints per forwarded user (X-Forwarded-User-Id). Applies to multi-tenant API key integrations. 0 = disabled (falls back to per-IP limit).',
    logLabel: (v) => (v ? `${String(v)} rpm` : 'disabled'),
  },
  {
    key: 'max_attachment_size_bytes',
    value: { value: 5242880 },
    description:
      'Maximum file size in bytes for attachments sent via signed URL. 5 242 880 = 5 MB (Devs.ai chat file limit).',
    logLabel: (v) => `${(Number(v) / 1024 / 1024).toFixed(1)} MB`,
  },
  {
    key: 'allowed_attachment_domains',
    value: { value: [] },
    description:
      'JSON array of trusted hostnames for attachment URLs. Empty array means all HTTPS domains are allowed. Example: ["myproject.supabase.co"]',
    logLabel: (v) => (Array.isArray(v) && v.length ? v.join(', ') : '(all HTTPS)'),
  },
];

export async function seedSettings(): Promise<{ seeded: number }> {
  let seeded = 0;

  for (const def of SEED_DEFINITIONS) {
    const existing = await getSetting(def.key);
    if (!existing) {
      await upsertSetting(def.key, def.value, def.description);
      seeded++;
      console.log(`    [Settings] Seeded ${def.key} = ${def.logLabel(def.value.value)}`);
    } else {
      console.log(
        `    [Settings] ${def.key} already exists (${def.logLabel((existing.value as Record<string, unknown>)?.value)})`,
      );
    }
  }

  return { seeded };
}
