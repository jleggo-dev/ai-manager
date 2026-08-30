/* ════════════════════════════════════════════════════════════════
   Repertoire — the material a person is learning or already has
   ════════════════════════════════════════════════════════════════

   Piano pieces, katas, poems, verses, techniques: for any skills-based practice, the list of
   what someone knows IS their progression record, and practice draws on what they already have.
   The piano conversation of 2026-08-29 proved the gap the hard way — nine known pieces had to be
   typed into chat, landed as one frozen sentence in an activity's how_to, and could never rotate
   or be read back.

   Deliberately domain-neutral (the goals.brief migration's warning: a shape that fits exactly one
   sport quietly excludes the ordination exam and the novel). `kind` is free text the coach
   chooses ("piece", "kata", "poem"); anything richer rides `meta`.
*/

/** Current standing of one item. 'working' = learning it now; 'known' = they have it and it can
 *  serve as review/rotation material; 'parked' = deliberately set aside, excluded from rotation. */
export type RepertoireStatus = 'working' | 'known' | 'parked';

export interface RepertoireItem {
  item_id: string;
  user_id: string;
  /** Nullable + set-null on goal delete: what someone knows outlives any one goal. */
  goal_id: string | null;
  /** The item, the way they name it ("Écossaise (Hummel)", "Heian Shodan"). */
  label: string;
  status: RepertoireStatus;
  /** What sort of thing it is, in the coach's plain words — "piece", "kata", "poem". Optional. */
  kind: string | null;
  /** Free room for durable per-item facts (composer, book, settled metronome bpm). */
  meta: Record<string, unknown> | null;
  started_at: string;
  /** Set when it crossed working → known in front of us — absent for backfilled items they
   *  already knew when they told us. */
  learned_at: string | null;
  last_practiced_at: string | null;
}
