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

/**
 * Current standing of one item — and a standing is an INSTRUCTION to the coach, not a label
 * (owner design 2026-09-02). Each one answers a different planning question, so the word on the
 * row is enough to decide what happens to the item next:
 *
 *  - `queued` — "Up next". Yet to learn, in the user's own order. Propose the top one when
 *    something is learned; never start one unasked.
 *  - `working` — "Learning". The learn part of each session. One or two at a time.
 *  - `known` — "Keeping up". Learned and in the rotation: the warm-up and play-out pool, rested
 *    longest first. The settled tempo lives on these.
 *  - `retired` — "Learned". Finished, not revisited. Counted in Progress, never scheduled. One
 *    tap brings it back to Keeping up.
 *
 * The UI labels differ from the schema words on purpose (CLAUDE.md's nomenclature rule), and one
 * pair actively collides: `update_repertoire`'s `learned` VERB means "crossed into Keeping up just
 * now" and stores `known` — it is not the standing called "Learned", which is `retired`.
 *
 * There is no "set aside": pausing something returns it to `queued` with its weeks kept, so a
 * paused piece is simply one they have yet to get back to.
 */
export type RepertoireStatus = 'queued' | 'working' | 'known' | 'retired';

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
