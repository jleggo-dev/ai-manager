/**
 * LIVE PROBE: does Devs.ai read a file on the v1 CHAT path — the per-chat sandbox?
 *
 * The coach runs on devs-ai-v2 (Responses), where a document rides by standalone file id and
 * the 2026-09-13 probe found Excel unreadable. v1 is the other road: a Devs.ai chat session with
 * an id of its own, files uploaded INTO that chat (`POST /api/v1/chats/{id}/files`) and
 * referenced as `{type:'document', id}` content — the path AI Admin's `attachments` option
 * already takes (`services/attachment-resolver.ts` → `messageChatSession`). Owner, 2026-09-13:
 * "maybe try the v1 path."
 *
 * Sanctioned and in-process: a real devs-ai (v1) chat profile from the workspace, a chat session
 * opened through the engine for scratch account-1, the file put at a signed URL in a throwaway
 * private bucket (the engine downloads it from there, the way it would from any client), and
 * `sendChatMessage(..., { attachments })`. The bucket and the object are removed on exit.
 *
 * Run:  FILE=C:/path/to/file.xlsx npm -w apps/cadence-api run probe:v1-file
 *
 * VERDICT (2026-09-13, the owner's 142 KB Excel export, v1 chat "AI XP Launch Playbook Agent"):
 * the file IS in the chat's sandbox — the agent sees it by name, size, owner and dates, and
 * reaches for its own tools to open it ("let me export it… convert it to Google Sheets") — but
 * it "cannot directly read the internal contents of the Excel file… in native Excel format".
 * So the v1 sandbox holds a file the model can list; it does not convert Excel any more than
 * v2 does. Two of the three v1 chat profiles in the workspace carry a bare model name as their
 * Devs.ai AI id and 404 on open — stale rows worth cleaning, not this probe's concern.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { openChatSession, sendChatMessage } from '@ai-admin/core';
import { cadenceConfig } from '../src/config.ts';
import { withAim } from '../src/ai/aim.ts';
import { cadenceServiceClient } from '../src/db/supabase.ts';
import { ensureUser } from '../src/repos/users.ts';

const MIME_BY_EXT: Readonly<Record<string, string>> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain',
  csv: 'text/csv',
};

const ASK =
  'I attached a file. What is it about? Tell me what it contains — the sheets or sections, the ' +
  'names, the years, the numbers. If you cannot see the file at all, say exactly: I cannot see the file.';

const PROBE_BUCKET = 'probe-v1-files';

/* ── a real devs-ai (v1) chat profile, from the AI Admin API (same pick as the e2e helper) ── */
interface ProfileLite {
  id: string;
  name?: string;
  mode?: string;
  external_ai_id?: string | null;
  provider_id?: string;
  provider?: { id?: string; type?: string; base_url?: string } | null;
}
interface ProviderLite {
  id: string;
  type?: string;
  base_url?: string;
}

async function findV1ChatProfiles(): Promise<ProfileLite[]> {
  const key = process.env.AI_ADMIN_API_KEY || process.env.VITE_DEV_API_KEY || '';
  const rawBase = process.env.AI_ADMIN_BASE_URL || 'https://ai-manager-alpha-seven.vercel.app';
  const base =
    rawBase.includes('/_/backend') || rawBase.includes('localhost')
      ? rawBase.replace(/\/+$/, '')
      : rawBase.replace(/\/+$/, '') + '/_/backend';
  if (!key) throw new Error('no AI Admin API key in backend/.env');
  const headers = { Authorization: `Bearer ${key}` };
  const [profiles, providers] = await Promise.all([
    fetch(`${base}/api/ai-profiles?limit=200`, { headers }).then((r) => r.json() as Promise<{ data?: ProfileLite[] }>),
    fetch(`${base}/api/providers?limit=100`, { headers }).then((r) => r.json() as Promise<{ data?: ProviderLite[] }>),
  ]);
  const byId = new Map((providers.data ?? []).map((p) => [p.id, p]));
  const real = (p: ProviderLite | undefined) =>
    !!p && !/example\.com|localhost|127\.0\.0\.1/.test(String(p.base_url ?? ''));
  const candidates = (profiles.data ?? []).filter((p) => {
    const prov = p.provider?.id ? byId.get(p.provider.id) : p.provider_id ? byId.get(p.provider_id) : undefined;
    return prov?.type === 'devs-ai' && p.mode === 'chat' && Boolean(p.external_ai_id) && real(prov);
  });
  if (!candidates.length) throw new Error('no devs-ai (v1) chat profile with an external_ai_id in the workspace');
  // A v1 chat opens against a Devs.ai AI (an agent entity, cuid-shaped id). Some profiles carry
  // a bare model name there from an older shape and 404 on open — those go last.
  const looksLikeAi = (p: ProfileLite) => /^c[a-z0-9]{20,}$/.test(String(p.external_ai_id ?? ''));
  candidates.sort((a, b) => Number(looksLikeAi(b)) - Number(looksLikeAi(a)));
  console.log(`v1 chat candidates: ${candidates.map((p) => `${p.name ?? p.id} (ai ${p.external_ai_id})`).join('; ')}`);
  return candidates;
}

/** Open a v1 chat on the first candidate Devs.ai actually recognises. */
async function openV1Session(userId: string, candidates: ProfileLite[]) {
  let last: unknown;
  for (const profile of candidates) {
    try {
      const session = await withAim(userId, () =>
        openChatSession(profile.id, { userId, callingApplication: cadenceConfig.aim.callingApplication }),
      );
      return { profile, session };
    } catch (e) {
      last = e;
      console.log(`  ${profile.name ?? profile.id}: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}`);
    }
  }
  throw last instanceof Error ? last : new Error('no v1 chat profile could be opened');
}

/* ── the file, at a signed URL the engine can download ───────────────────────────────────── */
async function stageFile(file: string): Promise<{ url: string; fileName: string; mimeType: string; cleanup: () => Promise<void> }> {
  const fileName = path.basename(file);
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const mimeType = MIME_BY_EXT[ext];
  if (!mimeType) throw new Error(`no MIME for .${ext}`);
  const storage = cadenceServiceClient().storage;
  await storage.createBucket(PROBE_BUCKET, { public: false }).catch(() => {});
  const objectPath = `probe/${Date.now()}-${fileName}`;
  const up = await storage.from(PROBE_BUCKET).upload(objectPath, readFileSync(file), { contentType: mimeType });
  if (up.error) throw new Error(`stage upload failed: ${up.error.message}`);
  const signed = await storage.from(PROBE_BUCKET).createSignedUrl(objectPath, 900);
  if (signed.error || !signed.data?.signedUrl) throw new Error(`sign failed: ${signed.error?.message}`);
  return {
    url: signed.data.signedUrl,
    fileName,
    mimeType,
    cleanup: async () => {
      await storage.from(PROBE_BUCKET).remove([objectPath]).catch(() => {});
      await storage.deleteBucket(PROBE_BUCKET).catch(() => {});
    },
  };
}

async function main() {
  const file = process.env.FILE;
  if (!file) throw new Error('FILE=<path> is required');
  const userId = cadenceConfig.devAccounts['account-1']!;
  await ensureUser(userId);

  const candidates = await findV1ChatProfiles();

  const staged = await stageFile(file);
  try {
    const { profile, session } = await openV1Session(userId, candidates);
    console.log(
      `v1 chat profile: ${profile.name ?? profile.id} (ai ${profile.external_ai_id})\n` +
        `session ${session.sessionId} on ${session.providerType}, devs.ai chat ${session.externalChatId}\n`,
    );

    const { response } = await withAim(userId, () =>
      sendChatMessage(session.sessionId, ASK, {
        attachments: [{ url: staged.url, fileName: staged.fileName, mimeType: staged.mimeType }],
      }),
    );
    // The v1 chat stream is not the v2 event shape the coach relay reads, so take the raw SSE
    // and pull the text out generically: every `data:` JSON line's content/text/delta strings.
    const raw = await new Response(response.body).text();
    const pieces: string[] = [];
    const grab = (v: unknown): void => {
      if (typeof v === 'string') return;
      if (Array.isArray(v)) return v.forEach(grab);
      if (v && typeof v === 'object') {
        for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
          if ((k === 'content' || k === 'text' || k === 'delta') && typeof val === 'string') pieces.push(val);
          else grab(val);
        }
      }
    };
    for (const line of raw.split('\n')) {
      const m = /^data:\s*(\{.*\})\s*$/.exec(line);
      if (!m) continue;
      try {
        grab(JSON.parse(m[1]!));
      } catch {
        /* not JSON — skip */
      }
    }
    const reply = pieces.join('').trim();
    console.log(`reply:\n${reply || '(no text found — raw stream below)'}\n`);
    if (!reply) console.log(`raw (first 3000 chars):\n${raw.slice(0, 3000)}\n`);
    const cannot = /i cannot see the file/i.test(reply);
    console.log(`=== verdict (v1 chat file) === ${cannot ? 'NOT SEEN' : reply ? 'SEEN (read the reply)' : 'unclear'}`);
  } finally {
    await staged.cleanup();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
