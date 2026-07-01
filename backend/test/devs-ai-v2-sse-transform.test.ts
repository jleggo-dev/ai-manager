import { describe, it, expect } from "vitest";
import {
  createSseTransformState,
  transformV2SseDataLine,
} from "../src/integrations/devs-ai-v2/sse-transform.ts";

describe("devs-ai-v2 SSE transform", () => {
  it("maps output_text.delta to OpenAI chat delta shape", () => {
    const state = createSseTransformState();
    const lines = transformV2SseDataLine(
      JSON.stringify({ type: "response.output_text.delta", delta: "Hello" }),
      state,
    );
    expect(state.fullText).toBe("Hello");
    expect(
      lines.some((l) => l.includes("choices") && l.includes("Hello")),
    ).toBe(true);
  });

  it("emits message.complete with responseId on response.completed", () => {
    const state = createSseTransformState();
    transformV2SseDataLine(
      JSON.stringify({ type: "response.output_text.delta", delta: "Done" }),
      state,
    );
    const lines = transformV2SseDataLine(
      JSON.stringify({
        type: "response.completed",
        sequence_number: 42,
        response: {
          id: "resp_abc",
          model: "gpt-test",
          usage: { input_tokens: 10, output_tokens: 5 },
          conversation: { id: "conv_xyz" },
        },
      }),
      state,
    );
    const completeLine = lines.find((l) => l.includes("message.complete"));
    expect(completeLine).toBeTruthy();
    if (!completeLine) return;
    const payload = JSON.parse(completeLine.replace("data: ", "").trim());
    expect(payload.text).toBe("Done");
    expect(payload.responseId).toBe("resp_abc");
    expect(payload.conversationId).toBe("conv_xyz");
    expect(payload.lastSequence).toBe(42);
    expect(payload.inputTokens).toBe(10);
    expect(payload.outputTokens).toBe(5);
  });

  it("forwards v2.response.created for tool-loop threading", () => {
    const state = createSseTransformState();
    const lines = transformV2SseDataLine(
      JSON.stringify({
        type: "response.created",
        response: { id: "resp_new" },
      }),
      state,
    );
    expect(state.responseId).toBe("resp_new");
    expect(lines.some((l) => l.includes("v2.response.created"))).toBe(true);
  });
});
