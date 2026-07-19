/* ════════════════════════════════════════════════════════════════
   §C6 Conversation mapping (Cadence conversation_id → AI Admin session)
   ════════════════════════════════════════════════════════════════ */

export interface Conversation {
  conversation_id: string;
  user_id: string;
  ai_session_id: string; // AI Admin chat-session id
  external_chat_id: string | null; // provider chat id (Devs.ai)
  rolling_summary?: string;
  token_estimate?: number;
  created_at: string;
  updated_at?: string; // bumped on message activity — feeds the idle-staleness rule
}
