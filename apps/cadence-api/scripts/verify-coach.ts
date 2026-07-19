/**
 * End-to-end check for P0 of the context/memory architecture:
 *  - persona is the (cacheable) system prompt; context is a SEPARATE injected turn
 *  - conversational reply that asks for the name
 *  - assistant turn + diagnostics logged in AI Admin
 * Run: node --import tsx apps/cadence-api/scripts/verify-coach.ts
 */
import { openCoachSession, injectCoachContext, sendCoachMessage, recordCoachReply, withAim } from '../src/ai/aim.ts';
import { buildContextPack } from '../src/services/context-pack.ts';
import { getChatHistory } from '@ai-admin/core';
import { sql } from '../src/db/sql.ts';

const DEV = '00000000-0000-4000-a000-000000000001';

async function main() {
  try {
    const pack = await buildContextPack(DEV, 'onboarding');
    const ctx = pack.rendered;
    console.log('context first line :', ctx.split('\n')[0]);
    console.log('pack provenance    :', pack.provenance.map((p) => `${p.fn}(${p.rows})`).join(', '));
    console.log('context asks name  :', ctx.includes('name not captured'));

    const s = await openCoachSession(DEV); // persona-only system prompt
    await injectCoachContext(DEV, s.sessionId, ctx);

    const { response, sessionId, diagnosticSession, resolvedMessage } = await sendCoachMessage(
      DEV,
      s.sessionId,
      'Hey! I got pretty out of shape this winter and want to do a Spartan Beast at Blue Mountain in October.',
    );
    console.log('diagnostics bound  :', diagnosticSession !== null, '(analytics on when true)');

    const reader = response.body!.getReader();
    const dec = new TextDecoder();
    let content = '';
    let buf = '';
    let model: string | null = null;
    let pt: number | null = null;
    let ct: number | null = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const d = line.slice(6).trim();
        if (d === '[DONE]') continue;
        try {
          const p = JSON.parse(d);
          if (typeof p.choices?.[0]?.delta?.content === 'string') content += p.choices[0].delta.content;
          if (p.usage) {
            pt = p.usage.prompt_tokens ?? pt;
            ct = p.usage.completion_tokens ?? ct;
          }
          if (typeof p.model === 'string' && !model) model = p.model;
          if (p.type === 'message.complete') {
            pt = p.inputTokens ?? p.estimatedInputTokens ?? pt;
            ct = p.outputTokens ?? p.estimatedOutputTokens ?? ct;
            if (p.modelId) model = p.modelId;
          }
        } catch {
          /* ignore */
        }
      }
    }

    console.log('\n--- coach reply ---\n' + content + '\n-------------------');
    console.log('tokens             :', { promptTokens: pt, completionTokens: ct, model });

    await recordCoachReply(DEV, {
      sessionId,
      content,
      diag: diagnosticSession,
      metrics: { promptTokens: pt, completionTokens: ct, durationMs: 1, firstTokenMs: 1 },
      model,
      promptContent: resolvedMessage,
    });

    const hist = (await withAim(DEV, () => getChatHistory(sessionId))) as Record<string, unknown>;
    const msgs = (hist.messages ?? hist.data ?? []) as Array<{ role?: string; content?: string }>;
    const sys = msgs.find((m) => m.role === 'system');
    const ctxMsg = msgs.find((m) => m.role === 'user' && (m.content ?? '').includes('<context'));
    console.log('\n--- P0 placement ---');
    console.log('system = persona    :', !!sys && (sys.content ?? '').includes('You are Cadence') && !(sys.content ?? '').includes('[context built'));
    console.log('context is own turn :', !!ctxMsg);
    console.log(
      'logged messages    :',
      msgs.map((m) => `${m.role}(${(m.content ?? '').length} chars)`).join(', ') || JSON.stringify(Object.keys(hist)),
    );
  } finally {
    await sql`delete from cadence.conversations where user_id = ${DEV}`;
    await sql.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
