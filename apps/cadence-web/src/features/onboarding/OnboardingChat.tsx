import { useMemo, useRef } from 'react';
import { CoachFace } from '../../components/CoachFace.tsx';
import { CoachFoodActionSheet } from '../coach/CoachFoodActionSheet.tsx';
import type { Step } from '../review/reviewConstants.ts';
import { HealthOfferCard } from './HealthOfferCard.tsx';
import { findHealthOfferTurn, healthAlreadyShared } from './health-digest.ts';
import { capabilities } from '../../lib/capability/index.ts';
import { OPENING_PICKS, OPENING_PLACEHOLDER, OPENING_QUESTION } from '@cadence/shared';
import { useEnsureCoachFace } from '../coach/useEnsureCoachFace.ts';
import { useStickToBottom } from './useStickToBottom.ts';
import { useCoachChat } from './useCoachChat.ts';
import { chatProgress, livePicks, viewTurns } from './coachTurns.ts';
import { ChatTurn } from './ChatTurn.tsx';
import { ChatComposer } from './ChatComposer.tsx';
import { QuickPicks } from './QuickPicks.tsx';
import { CapturedPills } from './CapturedPills.tsx';
import { ConfirmCard } from './ConfirmCard.tsx';

const GearIcon = () => (
  <svg width="17" height="17" viewBox="0 0 17 17" aria-hidden>
    <circle className="stroke" cx="8.5" cy="8.5" r="2.6" />
    <path
      className="stroke"
      d="M8.5 1.6v2M8.5 13.4v2M1.6 8.5h2M13.4 8.5h2M3.6 3.6l1.4 1.4M12 12l1.4 1.4M13.4 3.6L12 5M5 12l-1.4 1.4"
      strokeLinecap="round"
    />
  </svg>
);

const ONGOING_GREETING =
  "Hey — good to see you 👋 How's your rhythm feeling? If something needs to shift — more, less, a different day — say the word and I'll adjust your plan.";

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
  onReview,
  onBuild,
  onSettings,
  onBack,
  intent = 'onboarding',
  chrome = 'onboarding',
}: {
  onReview?: (step?: Step) => void;
  onBuild?: () => void;
  onSettings?: () => void;
  onBack?: () => void;
  intent?: 'onboarding' | 'ongoing';
  chrome?: 'onboarding' | 'none';
}) {
  const { turns, input, setInput, streaming, capturedGoals, restored, send, foodAction, clearFoodAction, sessionId } =
    useCoachChat({ intent });

  // Someone resuming mid-onboarding lands here directly, never passing MeetCadence — so the draw
  // has to happen here too, or Cadence speaks the whole conversation wearing the brand mark.
  useEnsureCoachFace(intent === 'onboarding');

  const views = useMemo(() => viewTurns(turns), [turns]);
  const picks = livePicks(views, streaming);
  // `chatProgress` only sees turns that came from the server, and the opening turn never does —
  // so before the first reply it would report 0 and the bar would sit empty on the one screen
  // everyone sees. Fall back to what the opening turn itself claims.
  const progress = chatProgress(views) || (intent === 'onboarding' ? (OPENING_PICKS.progress ?? 0) : 0);
  const confirming = picks?.layout === 'confirm';
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

  // Follow the newest turn, but never steal the viewport from someone reading back — see
  // useStickToBottom. Scrolls the pane only; scrollIntoView would pan the whole shell on mobile.
  const { onScroll, stickNow } = useStickToBottom(chatRef, turns);

  return (
    <div className="chatscreen">
      {onSettings && (
        <button className="float-gear" onClick={onSettings} aria-label="Settings" title="Settings">
          <GearIcon />
        </button>
      )}
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

      <div className={`chat${chrome === 'onboarding' ? ' has-top' : ''}`} ref={chatRef} onScroll={onScroll}>
        {!restored ? (
          <div className="chat-loading">
            <ChatTurn role="coach" text="" pending />
          </div>
        ) : (
          intent === 'ongoing' && !turns.length && <ChatTurn role="coach" text={ONGOING_GREETING} />
        )}
        {/* The opening turn is the app's, not the model's — always the same question, so it paints
            instantly instead of costing a round-trip before the user has done anything. It stays at
            the top of a restored transcript too: it IS the first thing they saw, even though it was
            never sent upstream. Its picks go live only while it is still the newest turn. */}
        {restored && intent === 'onboarding' && (
          <ChatTurn
            role="coach"
            text={OPENING_QUESTION}
            after={!turns.length ? <QuickPicks key="opening" picks={OPENING_PICKS} onCompose={setInput} /> : undefined}
          />
        )}
        {restored &&
          views.map((t, i) => {
            const last = i === views.length - 1;
            return (
              <div key={i} style={{ display: 'contents' }}>
                <ChatTurn
                  role={t.role}
                  text={t.text}
                  pending={t.role === 'coach' && !t.text}
                  after={
                    last && picks ? (
                      confirming ? (
                        <ConfirmCard
                          onEdit={(step) => onReview?.(step)}
                          onTellMore={() => setInput("There's something you missed — ")}
                        />
                      ) : (
                        <QuickPicks key={i} picks={picks} onCompose={setInput} />
                      )
                    ) : null
                  }
                />
                {i === healthOfferAt && <HealthOfferCard sessionId={() => sessionId.current} />}
              </div>
            );
          })}
      </div>

      {confirming ? (
        <div className="composer-wrap">
          <div className="cfm-bar">
            <button className="cfm-build" onClick={() => onBuild?.()}>
              Build it
            </button>
            <button className="cfm-change" onClick={() => setInput('Actually, ')}>
              Change something
            </button>
          </div>
          {/* The disclosure holds through the confirmation — this is the turn where someone is
              deciding whether to trust what they just read back. */}
          <div className="chat-disclaimer">
            <CoachFace size={18} ring={false} />
            <span>{"I'm AI and can make mistakes — please double-check what I say."}</span>
          </div>
        </div>
      ) : (
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
          above={
            chrome === 'onboarding' ? <CapturedPills goals={capturedGoals} onFix={() => onReview?.('goals')} /> : null
          }
        />
      )}

      {foodAction && <CoachFoodActionSheet action={foodAction} onClose={clearFoodAction} onDone={clearFoodAction} />}
    </div>
  );
}
