import 'dotenv/config';
import type { AppConfig } from './types.ts';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!_config) {
    _config = {
      port: parseInt(process.env.PORT ?? '3001', 10),

      aiManagerSupabase: {
        url: requireEnv('AI_MANAGER_SUPABASE_URL'),
        anonKey: requireEnv('AI_MANAGER_SUPABASE_ANON_KEY'),
        serviceRoleKey: requireEnv('AI_MANAGER_SUPABASE_SERVICE_ROLE_KEY'),
      },

      devsAi: {
        baseUrl: process.env.DEVS_AI_BASE_URL || 'https://devs.ai',
        apiKey: process.env.DEVS_AI_API_KEY,
        defaultModel: 'GPT-5.2',
      },
    };
  }
  return _config;
}

export default getConfig;
