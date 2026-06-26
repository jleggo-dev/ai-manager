import { healthCheck as aiManagerHealth } from '../db/ai-manager.ts';

export async function healthCheck(): Promise<Record<string, boolean>> {
  return aiManagerHealth();
}
