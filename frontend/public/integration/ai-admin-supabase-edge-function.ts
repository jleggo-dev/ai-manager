// @ts-nocheck — Deno runtime; not compiled by this project's TypeScript toolchain.
/**
 * AI Admin ↔ Lovable (Supabase Edge Function)
 * -------------------------------------------
 * Implements every mode documented in AI_ADMIN_LOVABLE_INTEGRATION.md §4.
 *
 * Setup:
 * 1. In Supabase: Edge Functions → New function → name it (e.g. ai-admin).
 * 2. Replace the default code with this file.
 * 3. Deploy the function.
 * 4. Project Settings → Edge Functions → Secrets:
 *    - AI_ADMIN_BASE_URL = your AI Admin API base (see Connect Lovable in AI Admin)
 *    - AI_ADMIN_API_KEY  = secret key from AI Admin → Settings → API keys (aim_sk_…)
 *
 * Auth modes (see handbook §2c):
 *   App-context  → Authorization: Bearer aim_sk_…  (no user identity)
 *   User-context → Authorization: Bearer aim_sk_… + X-Forwarded-User-Id: <uid>
 *
 * For user-context modes, the Edge Function validates the Lovable user's
 * Supabase JWT, extracts their UID, and forwards it to AI Admin.
 *
 * From Lovable, call: supabase.functions.invoke('YOUR_FUNCTION_NAME', { body: { ... } })
 * For SSE (streaming), use fetch() — see AI_ADMIN_LOVABLE_INTEGRATION.md §3/§6.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                                */
/* ------------------------------------------------------------------ */

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALL_MODES = [
  "ask-ai-profile          — completion: prompt + profileId + attachments?",
  "run-processing-job      — completion: jobId + variables + attachments?",
  "open-chat-session       — chat step 1: userId + aiProfileId | jobSlug | jobId | workflowSlug | workflowId",
  "resume-chat-session     — chat: continue a prior session by sessionId | externalChatId (+ fallbackToLocal?)",
  "send-chat-message-stream — chat step 2: sessionId + (message | stepKey + variables | ruleSetKey + variables) + attachments? (returns SSE)",
  "list-chat-files         — list all files (uploaded + AI-generated) for a session",
  "list-chat-sessions      — chat: list sessions for the authenticated user (optional filters incl. externalChatId)",
  "get-chat-session        — chat: retrieve a single session with full message history + stats",
  "submit-tool-outputs     — chat: sessionId + systemMessageId + outputs",
  "store-user-credential   — credentials: providerId + apiKey",
  "check-tool-auth         — MCP OAuth: profileId + toolId",
  "initiate-tool-oauth     — MCP OAuth: profileId + toolId → authUrl",
];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Validate the calling user's Lovable Supabase JWT and return their UID.
 * Returns null if no valid JWT is present.
 */
async function resolveUserId(
  req: Request,
): Promise<{ userId: string } | { error: string }> {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) {
    return { error: "Missing Authorization header with Supabase JWT." };
  }
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) {
    return { error: "Invalid or expired Supabase JWT." };
  }
  return { userId: user.id };
}

/**
 * Require a valid user identity for user-context modes.
 * Returns the userId string or a 401 Response.
 */
async function requireUserId(
  req: Request,
): Promise<string | Response> {
  const result = await resolveUserId(req);
  if ("error" in result) {
    return json(
      {
        error: result.error,
        hint: "User-context modes require a valid Supabase JWT from the calling user. See handbook §2c.",
      },
      401,
    );
  }
  return result.userId;
}

/**
 * Build headers for upstream AI Admin requests.
 * App-context: just Authorization + Content-Type.
 * User-context: adds X-Forwarded-User-Id.
 */
function aiAdminHeaders(userId?: string): Record<string, string> {
  const apiKey = Deno.env.get("AI_ADMIN_API_KEY") || "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (userId) {
    headers["X-Forwarded-User-Id"] = userId;
  }
  return headers;
}

/**
 * Proxy an upstream JSON response back to the caller with CORS headers.
 */
function proxyJsonResponse(r: globalThis.Response) {
  return r.text().then((text) => {
    return new Response(text, {
      status: r.status,
      headers: {
        ...corsHeaders,
        "Content-Type": r.headers.get("content-type") || "application/json",
      },
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Main handler                                                       */
/* ------------------------------------------------------------------ */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const rawBase = (Deno.env.get("AI_ADMIN_BASE_URL") || "").replace(/\/+$/, "");
  const base = rawBase.includes("/_/backend")
    ? rawBase
    : rawBase.includes("localhost")
      ? rawBase
      : rawBase + "/_/backend";
  const apiKey = Deno.env.get("AI_ADMIN_API_KEY") || "";
  if (!base || !apiKey) {
    return json(
      {
        error:
          "Missing secrets. In Supabase, add AI_ADMIN_BASE_URL and AI_ADMIN_API_KEY under Project Settings → Edge Functions → Secrets.",
      },
      500,
    );
  }

  if (req.method !== "POST") {
    return json({ error: "Use POST with a JSON body." }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body must be JSON." }, 400);
  }

  const mode = typeof body.mode === "string" ? body.mode : "ask-ai-profile";

  /* ── Completion: ask-ai-profile ─────────────────────────────────── */

  if (mode === "ask-ai-profile") {
    const prompt = body.prompt;
    const profileId = body.profileId;
    if (typeof prompt !== "string" || !prompt.trim()) {
      return json(
        { error: 'Include "prompt" (text you want the AI to answer).' },
        400,
      );
    }
    if (typeof profileId !== "string" || !profileId.trim()) {
      return json(
        {
          error:
            'Include "profileId" (copy from AI Admin → Profiles — the long ID).',
        },
        400,
      );
    }

    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    const payload: Record<string, unknown> = {
      prompt: prompt.trim(),
      slot: { type: "profile", profileId: profileId.trim() },
      formattingRules: Array.isArray(body.formattingRules)
        ? body.formattingRules
        : [],
    };
    if (attachments.length > 0) payload.attachments = attachments;

    const r = await fetch(`${base}/api/ai-matcher/run-slot`, {
      method: "POST",
      headers: aiAdminHeaders(),
      body: JSON.stringify(payload),
    });
    return proxyJsonResponse(r);
  }

  /* ── Completion: run-processing-job ─────────────────────────────── */

  if (mode === "run-processing-job") {
    const jobId = body.jobId;
    const variables = body.variables;
    const callingApp =
      typeof body.callingApplication === "string" && body.callingApplication.trim()
        ? body.callingApplication.trim()
        : null;
    if (!callingApp) {
      return json(
        { error: 'Include "callingApplication" (e.g. "lovable:my-app"). The server requires this field to identify your application.' },
        400,
      );
    }
    if (typeof jobId !== "string" || !jobId.trim()) {
      return json(
        { error: 'Include "jobId" (copy from AI Admin → Jobs).' },
        400,
      );
    }
    if (
      !variables ||
      typeof variables !== "object" ||
      Array.isArray(variables)
    ) {
      return json(
        {
          error:
            'Include "variables" (object). Keys must match the fields your job expects.',
        },
        400,
      );
    }

    const jobPayload: Record<string, unknown> = { variables, callingApplication: callingApp };
    const jobAttachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (jobAttachments.length > 0) jobPayload.attachments = jobAttachments;

    const r = await fetch(`${base}/api/processing-jobs/${jobId.trim()}/test`, {
      method: "POST",
      headers: aiAdminHeaders(),
      body: JSON.stringify(jobPayload),
    });
    return proxyJsonResponse(r);
  }

  /* ── Chat: open-chat-session ────────────────────────────────────── */

  if (mode === "open-chat-session") {
    const userIdResult = await requireUserId(req);
    if (userIdResult instanceof Response) return userIdResult;
    const userId = userIdResult;

    const callingApplication =
      typeof body.callingApplication === "string" && body.callingApplication.trim()
        ? body.callingApplication.trim()
        : null;
    if (!callingApplication) {
      return json(
        { error: 'Include "callingApplication" (e.g. "lovable:my-app"). The server requires this field to identify your application.' },
        400,
      );
    }
    const aiProfileId = body.aiProfileId;
    const jobSlug = body.jobSlug;
    const jobId = body.jobId;
    const workflowSlug = body.workflowSlug;
    const workflowId = body.workflowId;
    const systemPrompt = body.systemPrompt;

    if (!aiProfileId && !jobSlug && !jobId && !workflowSlug && !workflowId) {
      return json(
        {
          error:
            "Provide aiProfileId, jobSlug, jobId, workflowSlug, or workflowId (see AI_ADMIN_LOVABLE_INTEGRATION.md §4).",
        },
        400,
      );
    }

    const payload: Record<string, unknown> = {
      userId,
      callingApplication,
    };
    if (typeof systemPrompt === "string" && systemPrompt.trim()) {
      payload.systemPrompt = systemPrompt.trim();
    }
    if (typeof aiProfileId === "string" && aiProfileId.trim()) {
      payload.aiProfileId = aiProfileId.trim();
    }
    if (typeof jobSlug === "string" && jobSlug.trim()) {
      payload.jobSlug = jobSlug.trim();
    }
    if (typeof jobId === "string" && jobId.trim()) {
      payload.jobId = jobId.trim();
    }
    if (typeof workflowSlug === "string" && workflowSlug.trim()) {
      payload.workflowSlug = workflowSlug.trim();
    }
    if (typeof workflowId === "string" && workflowId.trim()) {
      payload.workflowId = workflowId.trim();
    }

    const r = await fetch(`${base}/api/chat-sessions`, {
      method: "POST",
      headers: aiAdminHeaders(userId),
      body: JSON.stringify(payload),
    });
    return proxyJsonResponse(r);
  }

  /* ── Chat: resume-chat-session ──────────────────────────────────── */

  if (mode === "resume-chat-session") {
    const userIdResult = await requireUserId(req);
    if (userIdResult instanceof Response) return userIdResult;
    const userId = userIdResult;

    const sessionId = body.sessionId;
    const externalChatId = body.externalChatId;
    const hasSessionId = typeof sessionId === "string" && sessionId.trim();
    const hasExternalChatId =
      typeof externalChatId === "string" && externalChatId.trim();
    if (!hasSessionId && !hasExternalChatId) {
      return json(
        {
          error:
            'Provide "sessionId" (AI Admin session id) or "externalChatId" (provider chat id, e.g. Devs.ai) to resume.',
        },
        400,
      );
    }

    const resumePayload: Record<string, unknown> = {};
    if (hasSessionId) resumePayload.sessionId = (sessionId as string).trim();
    if (hasExternalChatId) {
      resumePayload.externalChatId = (externalChatId as string).trim();
    }
    // Opt-in: if the provider's remote chat is gone, continue with local
    // history replay instead of failing with 409.
    if (body.fallbackToLocal === true) resumePayload.fallbackToLocal = true;

    const r = await fetch(`${base}/api/chat-sessions/resume`, {
      method: "POST",
      headers: aiAdminHeaders(userId),
      body: JSON.stringify(resumePayload),
    });
    return proxyJsonResponse(r);
  }

  /* ── Chat: send-chat-message-stream ─────────────────────────────── */

  if (mode === "send-chat-message-stream") {
    const userIdResult = await requireUserId(req);
    if (userIdResult instanceof Response) return userIdResult;
    const userId = userIdResult;

    const sessionId = body.sessionId;
    const message = body.message;
    const stepKey = body.stepKey;
    const ruleSetKey = body.ruleSetKey;
    const variables = body.variables;
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      return json(
        {
          error:
            "sessionId required — use sessionId from open-chat-session response.",
        },
        400,
      );
    }
    const hasMessage = typeof message === "string" && message.trim();
    const hasStep = typeof stepKey === "string" && stepKey.trim();
    const hasRuleSet = typeof ruleSetKey === "string" && ruleSetKey.trim();
    if (!hasMessage && !hasStep && !hasRuleSet) {
      return json(
        {
          error:
            'Provide "message" (free-form text), "stepKey" + "variables" (workflow step), or "ruleSetKey" + "variables" (rule set invocation).',
        },
        400,
      );
    }

    const msgPayload: Record<string, unknown> = {};
    if (hasMessage) msgPayload.message = (message as string).trim();
    if (hasStep) {
      msgPayload.stepKey = (stepKey as string).trim();
      if (variables && typeof variables === "object" && !Array.isArray(variables)) {
        msgPayload.variables = variables;
      }
    }
    if (hasRuleSet) {
      msgPayload.ruleSetKey = (ruleSetKey as string).trim();
      if (variables && typeof variables === "object" && !Array.isArray(variables)) {
        msgPayload.variables = variables;
      }
    }
    const chatAttachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (chatAttachments.length > 0) msgPayload.attachments = chatAttachments;

    const r = await fetch(
      `${base}/api/chat-sessions/${encodeURIComponent(sessionId.trim())}/messages`,
      {
        method: "POST",
        headers: aiAdminHeaders(userId),
        body: JSON.stringify(msgPayload),
      },
    );

    if (!r.ok) {
      // 409 = concurrent message on the same session. The frontend should
      // show "please wait" and NOT retry in a tight loop. See the handbook
      // § "Avoiding and handling 409 Conflict" for best practices.
      const errText = await r.text();
      return new Response(errText, {
        status: r.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const copyHeaders: Record<string, string> = { ...corsHeaders };
    const ct = r.headers.get("content-type");
    if (ct) copyHeaders["Content-Type"] = ct;
    const xsid = r.headers.get("X-Chat-Session-Id");
    if (xsid) copyHeaders["X-Chat-Session-Id"] = xsid;

    return new Response(r.body, {
      status: r.status,
      headers: copyHeaders,
    });
  }

  /* ── Chat: list-chat-files ───────────────────────────────────────── */

  if (mode === "list-chat-files") {
    const userIdResult = await requireUserId(req);
    if (userIdResult instanceof Response) return userIdResult;
    const userId = userIdResult;

    const sessionId = body.sessionId;
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      return json(
        { error: "sessionId required — from open-chat-session response." },
        400,
      );
    }

    const r = await fetch(
      `${base}/api/chat-sessions/${encodeURIComponent(sessionId.trim())}/files`,
      {
        method: "GET",
        headers: aiAdminHeaders(userId),
      },
    );
    return proxyJsonResponse(r);
  }

  /* ── Chat: list-chat-sessions ───────────────────────────────────── */

  if (mode === "list-chat-sessions") {
    const userIdResult = await requireUserId(req);
    if (userIdResult instanceof Response) return userIdResult;
    const userId = userIdResult;

    const params = new URLSearchParams();
    if (typeof body.aiProfileId === "string" && body.aiProfileId.trim()) {
      params.set("aiProfileId", body.aiProfileId.trim());
    }
    if (typeof body.status === "string" && body.status.trim()) {
      params.set("status", body.status.trim());
    }
    if (typeof body.callingApplication === "string" && body.callingApplication.trim()) {
      params.set("callingApplication", body.callingApplication.trim());
    }
    if (typeof body.externalChatId === "string" && body.externalChatId.trim()) {
      params.set("externalChatId", body.externalChatId.trim());
    }

    const qs = params.toString();
    const r = await fetch(
      `${base}/api/chat-sessions${qs ? `?${qs}` : ""}`,
      {
        method: "GET",
        headers: aiAdminHeaders(userId),
      },
    );
    return proxyJsonResponse(r);
  }

  /* ── Chat: get-chat-session ─────────────────────────────────────── */

  if (mode === "get-chat-session") {
    const userIdResult = await requireUserId(req);
    if (userIdResult instanceof Response) return userIdResult;
    const userId = userIdResult;

    const sessionId = body.sessionId;
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      return json(
        { error: "sessionId required — from open-chat-session response." },
        400,
      );
    }

    const r = await fetch(
      `${base}/api/chat-sessions/${encodeURIComponent(sessionId.trim())}`,
      {
        method: "GET",
        headers: aiAdminHeaders(userId),
      },
    );
    return proxyJsonResponse(r);
  }

  /* ── Chat: submit-tool-outputs ──────────────────────────────────── */

  if (mode === "submit-tool-outputs") {
    const userIdResult = await requireUserId(req);
    if (userIdResult instanceof Response) return userIdResult;
    const userId = userIdResult;

    const sessionId = body.sessionId;
    const systemMessageId = body.systemMessageId;
    const outputs = body.outputs;
    if (typeof sessionId !== "string" || !sessionId.trim()) {
      return json({ error: "sessionId required." }, 400);
    }
    if (typeof systemMessageId !== "string" || !systemMessageId.trim()) {
      return json(
        {
          error:
            "systemMessageId required — from the tool.call event's message ID.",
        },
        400,
      );
    }
    if (!Array.isArray(outputs) || outputs.length === 0) {
      return json(
        {
          error:
            'outputs required — array of { toolCallId, output } objects.',
        },
        400,
      );
    }

    const r = await fetch(
      `${base}/api/chat-sessions/${encodeURIComponent(sessionId.trim())}/tool-outputs`,
      {
        method: "POST",
        headers: aiAdminHeaders(userId),
        body: JSON.stringify({
          systemMessageId: systemMessageId.trim(),
          outputs,
        }),
      },
    );

    if (!r.ok) {
      // 409 = session is still processing a previous message/tool-output.
      const errText = await r.text();
      return new Response(errText, {
        status: r.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const copyHeaders: Record<string, string> = { ...corsHeaders };
    const ct = r.headers.get("content-type");
    if (ct) copyHeaders["Content-Type"] = ct;

    return new Response(r.body, {
      status: r.status,
      headers: copyHeaders,
    });
  }

  /* ── Credentials: store-user-credential ─────────────────────────── */

  if (mode === "store-user-credential") {
    const userIdResult = await requireUserId(req);
    if (userIdResult instanceof Response) return userIdResult;
    const userId = userIdResult;

    const providerId = body.providerId;
    const userApiKey = body.apiKey;
    const label = body.label;
    if (typeof providerId !== "string" || !providerId.trim()) {
      return json(
        {
          error:
            'providerId required — UUID of the Devs.ai provider in AI Admin.',
        },
        400,
      );
    }
    if (typeof userApiKey !== "string" || !userApiKey.trim()) {
      return json(
        { error: "apiKey required — the user's personal Devs.ai API key." },
        400,
      );
    }

    const r = await fetch(`${base}/api/user-credentials`, {
      method: "POST",
      headers: aiAdminHeaders(userId),
      body: JSON.stringify({
        providerId: providerId.trim(),
        apiKey: userApiKey.trim(),
        label: typeof label === "string" ? label.trim() : "Personal key",
      }),
    });
    return proxyJsonResponse(r);
  }

  /* ── MCP OAuth: check-tool-auth ─────────────────────────────────── */

  if (mode === "check-tool-auth") {
    const userIdResult = await requireUserId(req);
    if (userIdResult instanceof Response) return userIdResult;
    const userId = userIdResult;

    const profileId = body.profileId;
    const toolId = body.toolId;
    if (typeof profileId !== "string" || !profileId.trim()) {
      return json({ error: "profileId required — AI profile UUID." }, 400);
    }
    if (typeof toolId !== "string" || !toolId.trim()) {
      return json(
        {
          error:
            "toolId required — MCP tool UUID from tool discovery (GET /api/ai-profiles/:id/tools).",
        },
        400,
      );
    }

    const r = await fetch(
      `${base}/api/ai-profiles/${encodeURIComponent(profileId.trim())}/tools/${encodeURIComponent(toolId.trim())}/oauth-status`,
      {
        method: "GET",
        headers: aiAdminHeaders(userId),
      },
    );
    return proxyJsonResponse(r);
  }

  /* ── MCP OAuth: initiate-tool-oauth ─────────────────────────────── */

  if (mode === "initiate-tool-oauth") {
    const userIdResult = await requireUserId(req);
    if (userIdResult instanceof Response) return userIdResult;
    const userId = userIdResult;

    const profileId = body.profileId;
    const toolId = body.toolId;
    if (typeof profileId !== "string" || !profileId.trim()) {
      return json({ error: "profileId required — AI profile UUID." }, 400);
    }
    if (typeof toolId !== "string" || !toolId.trim()) {
      return json({ error: "toolId required — MCP tool UUID." }, 400);
    }

    const r = await fetch(
      `${base}/api/ai-profiles/${encodeURIComponent(profileId.trim())}/tools/${encodeURIComponent(toolId.trim())}/oauth-initiate`,
      {
        method: "POST",
        headers: aiAdminHeaders(userId),
        body: JSON.stringify({}),
      },
    );
    return proxyJsonResponse(r);
  }

  /* ── Unknown mode ───────────────────────────────────────────────── */

  return json(
    {
      error: "Unknown mode.",
      allowedModes: ALL_MODES,
    },
    400,
  );
});
