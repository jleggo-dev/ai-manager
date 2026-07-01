/** Providers that only support model-mode profiles (no agent objects). */
export function isModelOnlyProviderType(type: string): boolean {
  return type === "google-gemini" || type === "devs-ai-v2";
}
