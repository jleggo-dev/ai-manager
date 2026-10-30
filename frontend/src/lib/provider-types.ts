/** Providers that only support model-mode profiles (no agent objects). */
export function isModelOnlyProviderType(type: string): boolean {
  return type === 'google-gemini' || type === 'devs-ai-v2' || type === 'vercel-ai-gateway';
}

/**
 * Providers whose model list can be refreshed from the provider's own catalogue
 * (`POST /providers/:id/models/sync`).
 */
export function isSyncableProviderType(type: string): boolean {
  return ['google-gemini', 'devs-ai', 'devs-ai-v2', 'vercel-ai-gateway'].includes(type);
}

/**
 * Providers that take a job's expected schema as a native json_schema format, so the Build Rules
 * tab can offer "apply formatting rules after the native schema".
 */
export function providerEnforcesSchema(type: string | undefined | null): boolean {
  return type === 'devs-ai-v2' || type === 'vercel-ai-gateway';
}
