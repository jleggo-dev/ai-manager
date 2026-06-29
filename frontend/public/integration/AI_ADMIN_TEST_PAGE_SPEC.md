# AI Admin — Integration Test Page Spec

> **Audience:** You are Lovable (or another LLM-based code generator). The user wants you to build a test page that proves the AI Admin integration is working. Follow this spec exactly.

## What to build

A single page in the app titled **"AI Admin — Integration Tests"** with three test sections and a setup guide panel. The page should be clean, readable, and usable by non-technical teammates.

---

## Section 1: Smoke test (fixed prompt)

**Purpose:** Prove the Edge Function → AI Admin connection works.

**UI elements:**
- Text input labeled **"Job 1 ID"** — user pastes a UUID from AI Admin
- Button: **"Run smoke test"**
- Result area: shows the AI's response or an error

**On click:**

```typescript
const { data, error } = await supabase.functions.invoke("ai-admin", {
  body: {
    mode: "run-processing-job",
    jobId: jobId1,
    callingApplication: "lovable:your-project-name",
    variables: {},
  },
});
```

**Display:** Show `data.formatted` if present, otherwise `data.raw`. If `error` or `data.error` exists, show it in red.

**Optional collapsed section** ("Technical details"): show `data.messageSent`, `data.usage`, `data.durationMs`, and the full raw JSON.

### What success looks like

The word **SMOKE_OK** appears in the result area (assuming the user created the smoke test job below).

---

## Section 2: Variable test

**Purpose:** Prove template variables are passed and substituted correctly.

**UI elements:**
- Text input labeled **"Job 2 ID"** — user pastes a UUID
- Text input labeled **"Topic"** (maps to variable `topic`)
- Text input labeled **"Tone"** (maps to variable `tone`)
- Button: **"Run variable test"**
- Result area: shows the AI's response or an error

**On click:**

```typescript
const { data, error } = await supabase.functions.invoke("ai-admin", {
  body: {
    mode: "run-processing-job",
    jobId: jobId2,
    callingApplication: "lovable:your-project-name",
    variables: { topic: topicValue, tone: toneValue },
  },
});
```

**Display:** Same as section 1.

### What success looks like

The AI's response clearly reflects the topic and tone the user typed. For example, if they typed "dogs" and "funny," the response is a funny sentence about dogs.

---

## Section 3: Streaming test (optional)

**Purpose:** Prove SSE streaming works — text appears gradually, not all at once.

**UI elements:**
- Text input labeled **"AI Profile ID"** — user pastes a UUID from AI Admin → Profiles
- Text input labeled **"Message"** with a default like "Say hello in one sentence"
- Button: **"Start streaming test"**
- Result area: text appears word-by-word as the stream arrives

**Implementation:**

Step A — open a session:

```typescript
const { data: session } = await supabase.functions.invoke("ai-admin", {
  body: {
    mode: "open-chat-session",
    userId: "test-stream-user",
    callingApplication: "lovable:your-project-name",
    aiProfileId: profileId,
  },
});
```

Step B — stream a message using `fetch` (not `invoke`, because you need the raw stream):

```typescript
const response = await fetch(
  `${supabaseUrl}/functions/v1/ai-admin`,
  {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${supabaseAnonKey}`,
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify({
      mode: "send-chat-message-stream",
      sessionId: session.id,
      message: messageText,
    }),
  }
);

const reader = response.body.getReader();
const decoder = new TextDecoder();
let fullText = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const chunk = decoder.decode(value, { stream: true });
  // Parse SSE lines: look for lines starting with "data: "
  for (const line of chunk.split("\n")) {
    if (line.startsWith("data: ") && line !== "data: [DONE]") {
      try {
        const parsed = JSON.parse(line.slice(6));
        if (parsed.content) {
          fullText += parsed.content;
          // Update the UI with fullText so it appears gradually
        }
      } catch { /* not all data lines are JSON */ }
    }
  }
}
```

Step C *(optional)* — resume a prior session: to test continuity, store `session.id` (or the provider's `externalChatId`), then later re-open the conversation before streaming again:

```typescript
const { data: resumed } = await supabase.functions.invoke("ai-admin", {
  body: {
    mode: "resume-chat-session",
    sessionId: savedSessionId, // or: externalChatId: savedExternalChatId
  },
});
// resumed.messages restores prior history; then send-chat-message-stream with resumed.sessionId
```

### What success looks like

Text appears **gradually** (like typing), not all at once. If the entire response pops in as one block, streaming is not wired correctly. For the resume test, `resumed.messages` should contain the earlier turns, and the next streamed reply should reflect that prior context.

---

## Section 4: Setup guide panel

Add a visible panel on the same page titled **"How to create test jobs in AI Admin"** with these instructions written for non-technical users:

### Job 1 — Smoke test (fixed prompt)

1. In AI Admin, click **Jobs** in the left menu
2. Click **Create** to make a new job
3. Fill in:
   - **Name:** `Lovable test — fixed`
   - **Slug:** `lovable-test-fixed`
   - **AI Profile:** pick any active profile
4. Save the job, then click it in the list to select it
5. Open the **Build Rules** tab
6. In **Prompt Template**, paste: `Reply with exactly the word SMOKE_OK and nothing else.`
7. Save
8. Copy the job's **ID** (the long code with dashes) and paste it into the test page

### Job 2 — Variable test

1. Create another job:
   - **Name:** `Lovable test — variables`
   - **Slug:** `lovable-test-vars`
   - **AI Profile:** same profile as above
2. In **Build Rules → Prompt Template**, paste: `Write one friendly sentence about {{topic}}. Keep the style {{tone}}.`
3. Click **Suggest from template** to auto-detect the `topic` and `tone` variables
4. Save
5. Copy this job's **ID** and paste it into the test page

### Streaming test (optional)

1. Go to **Profiles** in AI Admin
2. Copy the **ID** of any active profile
3. Paste it into the streaming test section on this page

---

## Verification checklist

After running the tests, confirm:

**In Lovable (test page):**
- [ ] Smoke test shows **SMOKE_OK**
- [ ] Variable test response matches the topic and tone you entered
- [ ] Streaming test shows text appearing gradually (not all at once)
- [ ] No error messages in any section

**In AI Admin:**
- [ ] Go to **Jobs** → click your test job → the **Test** tab shows recent test runs
- [ ] Go to **Diagnostics** → you should see requests from your calling application name

If any test fails, check:
- Are both Supabase secrets set? (`AI_ADMIN_API_KEY`, `AI_ADMIN_BASE_URL`)
- Is the Edge Function deployed?
- Does the job ID match exactly (no extra spaces)?
- Is the AI profile active and linked to a working provider?
