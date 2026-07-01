import { describe, it, expect } from "vitest";
import { encryptSecret } from "../src/lib/crypto.ts";
import { decryptProviderRow } from "../src/models/providers.ts";
import { hydrateAiProfileProviderKeys } from "../src/models/ai-profiles.ts";
import type { AiProfileRow, ProviderRow } from "../src/types.ts";

describe("Provider key decryption for joined rows", () => {
  it("decryptProviderRow decrypts encrypted api_key", () => {
    const plain = "sk-test-provider-key-12345";
    const encrypted = encryptSecret(plain);
    const row: ProviderRow = {
      id: "p1",
      name: "Devs.ai",
      type: "devs-ai",
      base_url: "https://devs.ai",
      api_key: encrypted,
      is_active: true,
      request_timeout_ms: null,
      workspace_id: "ws",
      created_at: "",
      updated_at: "",
    };
    expect(decryptProviderRow(row)?.api_key).toBe(plain);
  });

  it("hydrateAiProfileProviderKeys decrypts nested provider keys", () => {
    const plain = "AIzaSy-test-gemini-key";
    const profile = {
      id: "prof1",
      name: "Gemini Chat",
      provider_id: "p1",
      external_ai_id: "gemini-2.5-flash",
      provider: {
        id: "p1",
        name: "Google Gemini",
        type: "google-gemini",
        base_url: "https://generativelanguage.googleapis.com",
        api_key: encryptSecret(plain),
      },
    } as AiProfileRow;

    const hydrated = hydrateAiProfileProviderKeys(profile);
    expect(hydrated.provider?.api_key).toBe(plain);
    expect(hydrated.provider?.api_key).not.toBe(encryptSecret(plain));
  });

  it("leaves plaintext keys unchanged when no encryption key (dev)", () => {
    const plain = "sk-plaintext-key";
    const row = {
      api_key: plain,
      id: "x",
      name: "t",
      type: "devs-ai",
      base_url: "",
      is_active: true,
      request_timeout_ms: null,
      workspace_id: "w",
      created_at: "",
      updated_at: "",
    } as ProviderRow;
    expect(decryptProviderRow(row)?.api_key).toBe(plain);
  });
});
