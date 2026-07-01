import { describe, expect, it } from "vitest";
import { isModelOnlyProviderType } from "./provider-types";

describe("isModelOnlyProviderType", () => {
  it("returns true for google-gemini and devs-ai-v2", () => {
    expect(isModelOnlyProviderType("google-gemini")).toBe(true);
    expect(isModelOnlyProviderType("devs-ai-v2")).toBe(true);
  });

  it("returns false for devs-ai v1 and unknown types", () => {
    expect(isModelOnlyProviderType("devs-ai")).toBe(false);
    expect(isModelOnlyProviderType("")).toBe(false);
  });
});
