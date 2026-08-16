-- 0035: the conversation remembers that you walked away.
--
-- The notification contract (owner, 2026-08-16): "If I send a chat message to Cadence and I leave
-- the screen … Cadence always sends a notification when done." The server's only signal for "they
-- left" was the socket dying, and that signal is wrong exactly where it matters: iOS does not kill
-- a connection the instant it suspends a webview. Background the app four seconds into a
-- thirty-second turn and the reply can be written to a socket the server still believes someone is
-- reading, while the person is twenty minutes away and hears nothing.
--
-- Only the client knows it went to background, and iOS gives it a moment to say so. This is where
-- it says it. Set when the app leaves mid-turn; read and cleared when the reply lands.
--
-- Deliberately on `conversations` rather than a separate table: it is per-thread state with the
-- lifetime of a single turn, it must be cleared by the same write path that clears
-- `in_flight_response_id`, and a row that outlives its turn is a stray ping, not a leak.
alter table cadence.conversations
  add column if not exists notify_on_reply boolean not null default false;
