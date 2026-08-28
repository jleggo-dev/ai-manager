import { useEffect, useMemo, useRef } from 'react';
import { CoachFoodActionSheet } from '../coach/CoachFoodActionSheet.tsx';
import { HealthOfferCard } from './HealthOfferCard.tsx';
import {
  CHAT_REFRESH_CHECK_KEY,
  CHAT_REFRESH_MIN_INTERVAL_MS,
  CHAT_REFRESH_STALE_MS,
  findHealthOfferTurn,
  healthAlreadyShared,
  maybeRefreshHealthDigest,
} from './health-digest.ts';
import { getHealthDigest, postHealthDigest, postWorkoutHistory } from '../../lib/api.ts';
import { capabilities } from '../../lib/capability/index.ts';
import { OPENING_PICKS, OPENING_PLACEHOLDER, OPENING_QUESTION } from '@cadence/shared';
import { useEnsureCoachFace } from '../coach/useEnsureCoachFace.ts';
import { useStickToBottom } from './useStickToBottom.ts';
import { useAnchorOnPrepend } from './useAnchorOnPrepend.ts';
import { useFloatingInset } from './useFloatingInset.ts';
import { useCoachChat } from './useCoachChat.ts';
import { useCoachHistory } from './useCoachHistory.ts';
import { chatProgress, livePicks, viewTurns } from './coachTurns.ts';
import { ChatTurn } from './ChatTurn.tsx';
import { EarlierThread } from './EarlierThread.tsx';
import { EarlierConversations } from './EarlierConversations.tsx';
import { ChatComposer } from './ChatComposer.tsx';
import { QuickPicks } from './QuickPicks.tsx';
import { CapturedPills } from './CapturedPills.tsx';
import { ConfirmCard } from './ConfirmCard.tsx';
import { ChangeCard } from './ChangeCard.tsx';
import { WeekReviewCard } from './WeekReviewCard.tsx';

/**
 * What the app tells Cadence the moment someone shares their Apple Health history. Without it she
 * holds months of their training and says nothing until they ask — which is the app taking
 * something and giving nothing back for it.
 */
const HEALTH_SHARED_NOTE =
  'The user has just shared their Apple Health history with you and it is in your context now. ' +
  'Say what you actually see in it — what they have been doing, how often, and what it means for ' +
  'the goal they told you about. Be specific about their numbers; that is the whole point of them ' +
  'having shared it. Then carry on with your next question. Do this ONCE: the same history will ' +
  'keep being put in front of you as the conversation grows so that you do not lose it, and ' +
  'reading it back a second time makes you sound like you have just noticed it.';

const ONGOING_GREETING =
  "Hey — good to see you 👋 How's your rhythm feeling? If something needs to shift — more, less, a different day — say the word and I'll adjust your plan.";

/**
 * The walkthrough openers — the app telling Cadence that the discussion the gate promised is now.
 * TWO notes because there are two honest arrivals: 'card' (the anonymous path — they signed in at
 * the gate, so they have SEEN the week and her reasoning; re-reciting it would be her reading
 * their own screen to them) and 'fresh' (signed in before onboarding — no gate, no card, so she
 * presents conversationally first). Sent as a <note> so it renders in no one's bubble.
 */
const WALKTHROUGH_SHARED =
  'This is a conversation where your coaching register is right: explain your reasoning properly ' +
  'when they ask, do arithmetic out loud when their goal has numbers, and keep every safety bound ' +
  'you plan by. If you suggested any activities, ask how those land; swapping one for something ' +
  'that fits their life better is a win, not a concession. If you agree on any change, that turn ' +
  'ends with the build card.';
const WALKTHROUGH_NOTES = {
  card:
    'Their first plan was just built, and they arrived here from the card that showed them the ' +
    'week AND your reasoning — do not re-list the activities or re-explain what the card already ' +
    'said. Open the conversation the card could not have: in a sentence or two, say what the ' +
    'whole week is built around for THEIR goal, then invite pushback plainly — which piece feels ' +
    'off, too much, or not them. ' +
    WALKTHROUGH_SHARED,
  fresh:
    'Their first plan was just built, and this is their first conversation since — they have NOT ' +
    'yet been shown your reasoning. Walk their rhythm briefly and conversationally: what the week ' +
    'is built around for their goal and, in a line each, why its main pieces earn their place — ' +
    'short, in your own voice, never a recited list. Then invite pushback plainly — which piece ' +
    'feels off, too much, or not them. ' +
    WALKTHROUGH_SHARED,
} as const;

/**
 * The coach chat — and, since the v2 redesign, onboarding itself.
 *
 * There is no wizard behind this any more. The steps ARE the chat: Cadence asks one question per
 * turn and ships its answer affordances with it (`QuickPicks`), so she can skip what she already
 * knows, reorder, or follow up — none of which a client that hard-codes five screens can do. The
 * client's whole job is to render turns, render whatever picks arrive, and keep the composer
 * honest about whether it is her turn or yours.
 *
 * Two chromes: 'onboarding' (its own full-screen shell with the progress bar, the Broker's live
 * captures, and the confirmation) and 'none' (the Coach TAB, inside MainTabs' .app shell, with a
 * floating settings gear). Both use the same turns, the same picks and the same composer —
 * deliberately, because "one running chat" stops being true the moment the tab is a different chat.
 */
export function OnboardingChat({
  onBuild,
  onBack,
  intent = 'onboarding',
  chrome = 'onboarding',
  openWalkthrough = false,
  sessionNote = null,
  onSessionNoteUsed,
  onPlanChanged,
  onOpenWeekReview,
  onShowChanges,
  autoSend = null,
}: {
  /**
   * Run the coach's build tool. Onboarding hands over its build screen; the Coach tab hands over
   * the whole-plan rebuild. Both are the SAME affordance to the coach — she emits one card and the
   * host decides what building means where she emitted it.
   */
  onBuild?: () => void;
  onBack?: () => void;
  /** A proposed change was applied in the conversation — the host refreshes whatever shows the
   *  plan, so the week on screen and the week she just changed are the same week. */
  onPlanChanged?: () => void;
  intent?: 'onboarding' | 'ongoing';
  chrome?: 'onboarding' | 'none';
  /** Open the walkthrough discussion unprompted: 'card' = they saw the plan card at the gate;
   *  'fresh' = signed-in path, no card — she presents conversationally first. */
  openWalkthrough?: false | 'card' | 'fresh';
  /** App-authored context to open on — today, the session they just finished and tapped
   *  "Talk to me" from. Spoken as a note the coach reads and the user never sees. */
  sessionNote?: string | null;
  onSessionNoteUsed?: () => void;
  /** The WeekReviewCard's Open tap — the host mounts the full-screen review sheet. */
  onOpenWeekReview?: () => void;
  /** ChangeCard's "Show me" tap, offered only when the pending change carries per-item fields
   *  (a check-in offer) — the host mounts the Changes sheet, same idiom as onOpenWeekReview. */
  onShowChanges?: () => void;
  /**
   * A canned message the host wants SENT, visibly — a real user bubble and a real coach turn,
   * unlike `sessionNote`'s invisible nudge. Today's one caller is the end-of-trail card's "Start
   * check-in" (the approved design shows it as something the user said, not something whispered to
   * her). `key` is what makes a REPEAT of the same text fire again on a later end-of-trail: bump it
   * on every tap, because a plain "have I ever sent this" latch would never re-arm after the first.
   */
  autoSend?: { text: string; key: number } | null;
}) {
  const {
    turns,
    earlierTurns,
    input,
    setInput,
    streaming,
    activity,
    capturedGoals,
    restored,
    painted,
    cursor,
    send,
    sendText,
    stop,
    nudge,
    foodAction,
    clearFoodAction,
    sessionId,
  } = useCoachChat({ intent });

  /**
   * Everything said before the conversation on screen — loaded only when asked for, one
   * conversation per tap. Onboarding has no history by definition, and offering to read back
   * through an archive that cannot exist would be a control that never does anything.
   */
  const history = useCoachHistory({
    startedAt: intent === 'onboarding' ? null : cursor.startedAt,
    hasEarlier: intent !== 'onboarding' && cursor.hasEarlier,
  });

  // Someone resuming mid-onboarding lands here directly, never passing MeetCadence — so the draw
  // has to happen here too, or Cadence speaks the whole conversation wearing the brand mark.
  useEnsureCoachFace(intent === 'onboarding');

  /**
   * Chat-open Apple Health refresh, tight tier: by the time the coach checks their file this
   * conversation, this morning's workout is on it. The POST carries the live session id when one
   * exists (recovered thread → mid-conversation injection); before first send there is no session
   * yet and storing alone is enough — the watermark makes the opening pack read it fresh.
   */
  useEffect(() => {
    void maybeRefreshHealthDigest({
      isAvailable: () => capabilities.health.isAvailable(),
      getWorkouts: (since) => capabilities.health.getWorkouts(since),
      getDailySteps: (since) => capabilities.health.getDailySteps(since),
      ensureAccess: () => capabilities.health.requestPermissions(['workouts']),
      getLatest: getHealthDigest,
      post: (d) => postHealthDigest(d, sessionId.current),
      postWorkouts: postWorkoutHistory,
      staleMs: CHAT_REFRESH_STALE_MS,
      minIntervalMs: CHAT_REFRESH_MIN_INTERVAL_MS,
      throttleKey: CHAT_REFRESH_CHECK_KEY,
    }).catch(() => {});
    // Once per chat mount; sessionId is a ref read at POST time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The walkthrough the persona has scripted since v2, finally fired. One nudge, exactly once per
   * arrival-from-the-card, and only into a FRESH thread: the onboarding conversation goes stale as
   * 'graduated' at first commit, so `!turns.length` after restore is the normal state here — and
   * if a transcript DID come back (they talked, killed the app, returned), she has already opened
   * or been spoken to, and a second unprompted opener would read as her not remembering.
   */
  const walkthroughFired = useRef(false);
  /**
   * The session they just finished, handed to her as she opens. Unlike the walkthrough this fires
   * on a thread that ALREADY has turns — someone taps "Talk to me" mid-conversation-history — so
   * it waits only for a quiet moment, not an empty one.
   */
  const sessionNoteFired = useRef(false);
  useEffect(() => {
    if (!sessionNote || !restored || streaming || sessionNoteFired.current) return;
    sessionNoteFired.current = true;
    void nudge(sessionNote).finally(() => onSessionNoteUsed?.());
    // `restored` is the arm signal; streaming is a guard, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionNote, restored]);

  /**
   * The visible check-in bridge (check-in rebuild, step 4). Keyed, not booleaned, because this
   * component stays mounted for the whole Coach tab's life (MainTabs.tsx) — a plain "have I fired"
   * latch would never re-arm for a SECOND end-of-trail later in the same session. Consuming a key
   * only once, ever, is still the point: a parent re-render that hands down a new `autoSend` OBJECT
   * carrying the same `key` must not resend it, which is why the ref compares the key, not the
   * prop reference.
   */
  const autoSendKeyRef = useRef<number | null>(null);
  useEffect(() => {
    if (!autoSend || !restored || autoSendKeyRef.current === autoSend.key) return;
    autoSendKeyRef.current = autoSend.key;
    const { text } = autoSend;
    void sendText(text).then((ok) => {
      // A dead/stale session (or a turn already in flight) must not eat the tap silently — the
      // text lands back in the composer so the SAME Send the user already trusts can retry it.
      if (!ok) setInput(text);
    });
    // `restored` is the arm signal, same as sessionNote's own effect just above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend, restored]);

  useEffect(() => {
    if (!openWalkthrough || !restored || walkthroughFired.current) return;
    if (turns.length || streaming) return;
    walkthroughFired.current = true;
    void nudge(WALKTHROUGH_NOTES[openWalkthrough]);
    // `restored` flipping true is the arm signal; turns/streaming are read as guards, not triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openWalkthrough, restored]);

  const views = useMemo(() => viewTurns(turns), [turns]);
  const picks = livePicks(views, streaming);
  // `chatProgress` only sees turns that came from the server, and the opening turn never does —
  // so before the first reply it would report 0 and the bar would sit empty on the one screen
  // everyone sees. Fall back to what the opening turn itself claims.
  const progress = chatProgress(views) || (intent === 'onboarding' ? (OPENING_PICKS.progress ?? 0) : 0);
  /**
   * The build card is a card, and the composer never goes away for it.
   *
   * It used to swap the composer for a Build/Change bar, which quietly cost two things. The
   * corrections offered on the card only call `setInput` — with the composer gone they prefilled
   * an input nobody could see, so "Change something" did nothing at the one turn where being
   * ignored costs most. And a bar that owns the bottom of the screen can only be up once, which is
   * why a coach who had already spent it started sending people to a review screen that no longer
   * exists. Both are gone: the button rides on the card (ConfirmCard), and you can always type.
   */
  const buildLabel = intent === 'onboarding' ? 'Build it' : 'Rebuild my plan';
  const onOpeningTurn = intent === 'onboarding' && restored && !turns.length;
  const chatRef = useRef<HTMLDivElement | null>(null);

  // Goal-gated Apple Health offer (detour pattern): the card renders under the coach turn that
  // offered it in prose — never unprompted. Gate: iOS shell + not yet answered; the turn index
  // recomputes per render so a streamed re-offer moves the card.
  // Gated on "we already have the data", not "we already asked". Dismissing once must not mean
  // the card can never appear again — if they ask for Apple Health later and she agrees to pull
  // it, the thing they confirm with has to be there.
  const canOfferHealth = capabilities.health.isAvailable() && !healthAlreadyShared();
  const healthOfferAt = canOfferHealth && !streaming ? findHealthOfferTurn(turns) : -1;

  // The floating stack's real height, so no turn ever sits underneath it (useFloatingInset).
  const { inset, floatRef } = useFloatingInset();
  // Follow the newest turn, but never steal the viewport from someone reading back — see
  // useStickToBottom. Scrolls the pane only; scrollIntoView would pan the whole shell on mobile.
  //
  // Declared AFTER the inset on purpose: both are layout effects and they run in declaration
  // order, so measuring the stack first means the follow scrolls against the padding this render
  // actually ends up with, rather than chasing it on a second pass.
  const { onScroll, onTouchStart, onTouchEnd, stickNow, unstick } = useStickToBottom(chatRef);
  // Declared LAST of the layout effects on purpose — when older conversations land above the
  // viewport this has to have the final word on where the reader ends up (useAnchorOnPrepend).
  const markScroll = useAnchorOnPrepend(chatRef, history.earlier.length);

  return (
    <div className="chatscreen">
      {chrome === 'onboarding' && (
        <div className="chat-top">
          {onBack && (
            <button className="chat-back" onClick={onBack} aria-label="Back">
              ←
            </button>
          )}
          <div
            className="chat-prog"
            role="progressbar"
            aria-label="How far through we are"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
          >
            <i style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        </div>
      )}

      <div
        className={`chat${chrome === 'onboarding' ? ' has-top' : ''}`}
        ref={chatRef}
        onScroll={onScroll}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        style={{ paddingBottom: inset }}
      >
        {/* Further back still: the conversations before this one, above everything else because
            that is where earlier belongs. Nothing loads until it is asked for. */}
        <EarlierConversations
          conversations={history.earlier}
          canLoad={history.canLoad}
          loading={history.loading}
          onLoad={() => {
            // Both halves of "the viewport is theirs now": stop following the newest turn, and
            // remember where they are so the incoming history lands above them rather than under.
            unstick();
            markScroll();
            void history.loadEarlier();
          }}
        />
        {/* The retired thread, read-only above everything the live conversation renders. Its own
            divider tells the user where the fresh start begins — see EarlierThread. */}
        <EarlierThread turns={earlierTurns} />
        {!painted ? (
          <div className="chat-loading">
            <ChatTurn role="coach" text="" pending />
          </div>
        ) : (
          // On the server's word, never on the cache's: a greeting painted because the device
          // happened to remember nothing would be the app guessing that a conversation is empty.
          intent === 'ongoing' && restored && !turns.length && <ChatTurn role="coach" text={ONGOING_GREETING} />
        )}
        {/* The opening turn is the app's, not the model's — always the same question, so it paints
            instantly instead of costing a round-trip before the user has done anything. It stays at
            the top of a restored transcript too: it IS the first thing they saw, even though it was
            never sent upstream. Its picks go live only while it is still the newest turn. */}
        {painted && intent === 'onboarding' && (
          <ChatTurn
            role="coach"
            text={OPENING_QUESTION}
            after={!turns.length ? <QuickPicks key="opening" picks={OPENING_PICKS} onCompose={setInput} /> : undefined}
          />
        )}
        {painted &&
          views.map((t, i) => {
            const last = i === views.length - 1;
            return (
              <div key={i} style={{ display: 'contents' }}>
                <ChatTurn
                  role={t.role}
                  text={t.text}
                  pending={t.role === 'coach' && !t.text}
                  // Only the newest turn; a line under an older reply would describe the past.
                  activity={last ? activity : ''}
                  after={
                    <>
                      {/**
                       * The change card follows the STORED PROPOSAL, not a marker in her prose.
                       *
                       * It used to render only when she also emitted `cadence-picks
                       * {"layout":"change"}` — so the card was two independent things the model had
                       * to get right, and only one of them was ever checked. On 2026-08-16 she
                       * called propose_plan_change, the proposal landed in the database with
                       * exactly the right content, she said "let me swap it now" — and nothing
                       * appeared, because the tag was missing. Four turns of the owner asking her
                       * to change his plan while she kept agreeing to. The tool's own output had
                       * already told her "the user now has a card", which became a lie the moment
                       * she skipped the tag.
                       *
                       * ChangeCard asks the server what is pending and renders nothing when the
                       * answer is nothing, so showing it on a finished last turn is safe and
                       * self-correcting. Keyed on the turn so a fresh proposal remounts and
                       * refetches; gated on `!streaming` so it reads AFTER the tool has run.
                       */}
                      {last && !streaming && (
                        <ChangeCard key={`chg${i}`} onApplied={onPlanChanged} onShowChanges={onShowChanges} />
                      )}
                      {/**
                       * Same contract as ChangeCard, one paragraph up: `open_week_review` writes a
                       * pointer, never a tag, so this asks the server what is pending and draws
                       * nothing when the answer is nothing. Safe to mount unconditionally beside it.
                       */}
                      {last && !streaming && <WeekReviewCard key={`wkr${i}`} onOpen={onOpenWeekReview} />}
                      {/**
                       * Her block says WHAT, never how. The only thing left for it to declare is
                       * `build` — the build card is an act, not a shape, and nothing durable is
                       * stored for the client to follow instead. Rows versus grid is derived from
                       * the options inside QuickPicks; a block that still carries the old
                       * `layout` word parses as content and draws the same either way.
                       */}
                      {last && picks ? (
                        picks.build ? (
                          <ConfirmCard
                            buildLabel={buildLabel}
                            onBuild={onBuild}
                            onCorrect={(topic) => {
                              stickNow();
                              setInput(`About ${topic} — that's not quite right. `);
                            }}
                            onTellMore={() => {
                              stickNow();
                              setInput("There's something you missed. ");
                            }}
                          />
                        ) : (
                          <QuickPicks key={i} picks={picks} onCompose={setInput} />
                        )
                      ) : null}
                    </>
                  }
                />
                {i === healthOfferAt && (
                  <HealthOfferCard
                    sessionId={() => sessionId.current}
                    onShared={() => void nudge(HEALTH_SHARED_NOTE)}
                  />
                )}
              </div>
            );
          })}
      </div>

      <ChatComposer
        value={input}
        onChange={setInput}
        onSend={() => {
          // Their own message is the thing they are waiting on, so re-arm the follow even if
          // they had scrolled up to check something before sending.
          stickNow();
          void send();
        }}
        streaming={streaming}
        showDisclaimer={chrome === 'onboarding'}
        // Only while the opening question is the live one: after that she is asking real
        // questions, and an example of a goal would be answering the wrong thing.
        placeholder={onOpeningTurn ? OPENING_PLACEHOLDER : undefined}
        rootRef={floatRef}
        onStop={stop}
        above={
          chrome === 'onboarding' ? (
            <CapturedPills
              goals={capturedGoals}
              onFix={(g) => {
                // A COMPLETE sentence, like a quick pick composes. The first version drafted a
                // dangling "About "X" — ", which the send arrow happily lit up for: someone sent
                // the fragment, and the coach — given a turn with no content — simply re-asked
                // her live question. Trailing space so carrying on types a new sentence.
                stickNow();
                setInput(`About "${g.title}" — that's not quite right. `);
              }}
            />
          ) : null
        }
      />

      {foodAction && <CoachFoodActionSheet action={foodAction} onClose={clearFoodAction} onDone={clearFoodAction} />}
    </div>
  );
}
