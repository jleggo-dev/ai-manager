import { describe, it, expect } from "vitest";
import type { ChatMessage } from "../src/types.ts";
import {
  contentText,
  hasImageParts,
  withImageParts,
  toOpenAiWireMessages,
} from "../src/lib/message-content.ts";
import { messagesToV2Request } from "../src/integrations/devs-ai-v2/request-builder.ts";

/**
 * Vision content parts (types.ts ContentPart): the canonical shape, its helpers, and the
 * per-provider dialect mapping. Text-only messages must be byte-for-byte unchanged — the
 * vision path is strictly additive.
 */

const IMG =
  "https://example.supabase.co/storage/v1/object/sign/meal-photos/u/d/p.jpg?token=t";

describe("message-content helpers", () => {
  it("contentText: string passthrough, text parts joined, images contribute nothing", () => {
    expect(contentText("hello")).toBe("hello");
    expect(
      contentText([
        { type: "text", text: "a" },
        { type: "image_url", url: IMG },
        { type: "text", text: "b" },
      ]),
    ).toBe("a\nb");
  });

  it("withImageParts: no images → plain string; images → text part first, then image parts", () => {
    expect(withImageParts("prompt", [])).toBe("prompt");
    const parts = withImageParts("prompt", [IMG]);
    expect(parts).toEqual([
      { type: "text", text: "prompt" },
      { type: "image_url", url: IMG },
    ]);
    expect(hasImageParts(parts)).toBe(true);
    expect(hasImageParts("prompt")).toBe(false);
  });

  it("toOpenAiWireMessages: strings untouched; parts map to OpenAI image_url dialect", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: withImageParts("look", [IMG]) },
    ];
    const wire = toOpenAiWireMessages(messages);
    expect(wire[0]).toEqual({ role: "system", content: "sys" });
    expect(wire[1]).toEqual({
      role: "user",
      content: [
        { type: "text", text: "look" },
        { type: "image_url", image_url: { url: IMG } },
      ],
    });
  });
});

describe("devs-ai-v2 request builder — vision", () => {
  it("a plain single user string keeps the bare-string input shortcut", () => {
    const body = messagesToV2Request("gpt-4.1-mini", [
      { role: "user", content: "hi" },
    ]);
    expect(body.input).toBe("hi");
  });

  it("a multimodal user turn maps to input_text + input_image and never the string shortcut", () => {
    const body = messagesToV2Request("gpt-4.1-mini", [
      { role: "user", content: withImageParts("what is written here?", [IMG]) },
    ]);
    expect(Array.isArray(body.input)).toBe(true);
    const items = body.input as Array<{ role: string; content: unknown }>;
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      role: "user",
      content: [
        { type: "input_text", text: "what is written here?" },
        { type: "input_image", image_url: IMG },
      ],
    });
  });

  it("system and replayed assistant messages reduce parts to text (Responses dialect)", () => {
    const body = messagesToV2Request("gpt-4.1-mini", [
      {
        role: "system",
        content: [
          { type: "text", text: "persona" },
          { type: "image_url", url: IMG },
        ],
      },
      { role: "assistant", content: [{ type: "text", text: "earlier reply" }] },
      { role: "user", content: "next turn" },
    ]);
    expect(body.instructions).toBe("persona");
    const items = body.input as Array<Record<string, unknown>>;
    expect(items[0]).toMatchObject({
      role: "assistant",
      content: [{ type: "output_text", text: "earlier reply" }],
    });
    expect(items[1]).toEqual({ role: "user", content: "next turn" });
  });
});
