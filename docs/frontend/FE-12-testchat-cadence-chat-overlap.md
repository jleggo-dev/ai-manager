# FE-12 — TestChat vs Cadence coach chat overlap

**Status:** Decision recorded (research only — no UI merge)  
**Date:** 2026-07-20  
**Sources:** `frontend/.../TestChatPanel.tsx`, `useTestChatStream.ts`, `lib/test-chat-stream.ts`; `apps/cadence-web/src/lib/api/coach.ts`, `coach-sse.ts`, `features/onboarding/OnboardingChat.tsx`; `packages/client` `parseSseText`

## Decision

**Do not extract a shared chat client package or merge the two UIs.**

Keep AI Admin Test Chat and Cadence coach chat separate. Revisit only if a third in-repo consumer needs the same *incremental* SSE line-buffer + OpenAI-style delta path (unlikely). A thin shared line-buffer utility remains an optional micro-extraction later — not a product chat layer.

## What actually overlaps

| Concern | AI Admin Test Chat | Cadence coach |
|---|---|---|
| Transport | `fetch` + `ReadableStream` SSE | Same |
| Line buffering | Inline in `processStream` (`useTestChatStream`) | `pushCoachSseChunk` / `applyCoachSseLine` (`coach-sse.ts`, WEB-02) |
| Text deltas | Multi-shape: OpenAI `choices[].delta`, Gemini `candidates[]`, generic `content` (`extractTextDelta`) | OpenAI-style `choices[].delta.content` only |
| Control frames | Skips `message.complete` / `message.created`; handles `tool.call` / `tool.message` | Skips `message.complete` / `v2.response.created`; no client tool UI |
| Session API | AI Admin chat-session routes + tool-output resume / OAuth `pendingAuth` | Cadence `/coach/sessions`, `/coach/current`, drop-recovery when `[DONE]` missing |
| Product UI | Mantine admin diagnostics (tools, usage, presets) | Brand coach surface (orb, mic, recovery copy) |
| Roles | `user` / `assistant` / `tool` / `error` | `user` / `coach` |

Conceptual overlap is real (streaming chat + session id). Implementation overlap is thin: both buffer SSE lines and append text deltas. Everything else diverges.

## Why a shared helper is not worth it now

1. **Different event contracts.** Test Chat is a multi-provider / tool-auth debugger. Cadence coach is a single product stream with server-side Scribe and client-side drop recovery. Sharing a “chat stream hook” would either drag Cadence into tool/OAuth complexity or strip Test Chat of what makes it useful.
2. **Different session lifecycles.** Cadence owns freshness (`stale` / `graduated`), 409-safe send, and GET `/coach/current` recovery. Test Chat owns profile-scoped sessions and `submitChatToolOutputs` resume. Those are not the same abstraction.
3. **FE-11 already extracted the AI Admin side.** `useTestChatStream` + `lib/test-chat-stream` are the right seam for admin. Cadence already extracted `coach-sse.ts` (WEB-02). Further sharing would cross the Cadence ↔ AI Admin client boundary the monorepo deliberately keeps one-way (Cadence → AI Admin engine, not shared UI packages).
4. **`packages/client` is the wrong home.** Its `parseSseText` is whole-buffer parsing for external integrators, not incremental UI streaming. Populating it with Cadence/TestChat helpers would recreate the “internal reuse of integrator packages” anti-pattern (report 05).

## Optional later (P3 / opportunistic)

- **Micro-util only:** a ~30-line pure `pushSseLines(buffer, chunk, onLine)` with no product semantics — only if a third caller appears or one of the two buffers regresses again. Do **not** share message types, hooks, or React UI.
- **Do not** unify OnboardingChat / coach chrome with TestChatPanel.
- If Cadence ever surfaces tool-auth in the coach UI (unlikely for brand voice), copy the *pattern* from `pendingAuth` — do not import the admin hook.

## Acceptance for this ticket

- [x] Research written with a clear go / no-go
- [x] No chat UI merge attempted
- [x] `refactoring_plan.md` FE-12 marked Done (with this doc pointer)
