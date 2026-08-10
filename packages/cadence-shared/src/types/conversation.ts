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
  /**
   * Devs.ai v2 response id of the turn currently generating; null/absent when idle. Written by the
   * coach SSE relay and read by the Stop button's route — the coach stream is consumed in-process,
   * so AI Admin's own provider_metadata never learns the id (migration 0029).
   */
  in_flight_response_id?: string | null;
  created_at: string;
  updated_at?: string; // bumped on message activity — feeds the idle-staleness rule
}
