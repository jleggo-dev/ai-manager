# Leaving the app mid-request

What happens to an answer the coach is still working out when the person switches apps or locks
the phone — and how every chat and read surface gets it back.

**The ruling this serves (owner, 2026-11-03):** _"If a food lookup is in flight and I switch apps
or lock the screen, the lookup stops. The same must hold for the general coach chat and every
other place a chat is active: switching apps or going to the lock screen must not kill the
answer. When I come back, the answer I was waiting on is there, or still arriving."_

Two older rulings bind the shape: no general keep-awake (2026-11-01 — the screen stays on only
while the metronome clicks), and soft-fail is never shown as an answer (2026-09-05). So the fix is
resumability, not keeping the app awake, and a dead connection is never reported as "couldn't
reach" while the answer is still coming.

## What iOS does to a request

The moment the app leaves the screen, WKWebView is suspended. JavaScript stops; timers stop; a
fetch in flight comes back to one of three things when the app returns:

- the response, if the socket happened to stay open and the server answered meanwhile;
- a rejection — `TypeError: The network connection was lost` — if the socket was torn down;
- nothing: the fetch never settles, and only the request's own bound ends it, minutes later.

Before this work the described-meal read (10–150 s: two model calls, every food source, and up to
a minute on the web for a maker-named food) had exactly one way to deliver — that fetch. The second
and third outcomes were the owner's bug: a fault line, or a wait that ended in "took too long",
while the server had finished the read and had nowhere to send it.

## Does the server keep working after the client leaves? (measured)

Yes, as long as the handler has not answered. Measured twice on the deployed API with
`apps/cadence-api/scripts/probe-backgrounded-phone.ts` (a real JWT, the stream killed 2.5 s in):
on 2026-08-14 and again on 2026-11-03, the coach reply was generated in full and on file 17 s after
the client vanished. What Vercel freezes is work started _after_ the response is sent
(`services/background.ts`) — so anything that must survive is written **before** the route answers.
The function cap is `maxDuration: "max"` (apps/cadence-api/vercel.json); the read's own bound of
150 s sits well inside it on either plan.

`scripts/probe-kept-answer.ts` is the same measurement for a plain JSON read route (below). Run it
after any deploy that touches the read: `npm -w apps/cadence-api run probe:kept-answer`
(`MEAL="a pint of Rickard's Red"` for the slow path). Its verdict is one word: KEPT, LOST or UNKNOWN.

## The shape

Three pieces, one per kind of surface.

### 1. A long request carries a client-made id, and the server keeps its answer

`POST /nutrition/meals/preview`, `/meals/preview/answer`, `/photo/read` and `/photo/preview` take
an optional `request_id` (a uuid the client mints). The route (`routes/answers.ts` →
`services/kept-answers.ts`, table `cadence.kept_answers`, migration 0065):

1. **claims** the id as `running` before the work starts — the first claim wins, a second request
   under the same id is answered from the row (202 while running, the answer once done, the fault
   once failed) and never starts a second read;
2. **runs** the work, whether or not the client is still listening;
3. **keeps** the outcome on the row — the answer, or the fault with the status the route would
   have answered with — _before_ answering the live client.

`GET /answers/:request_id` answers with one word the client acts on: `done` (the answer), `failed`
(the same refusal the live client would have been sent), `running` (keep waiting), `lost` (claimed
and never finished — the run died with its instance; told as a fault of ours with a way to try
again, never as "nothing found") or `unknown` (the request never arrived — re-send it). A `running`
row older than five minutes reads as `lost`; rows are swept after a day. Keeping the row never
costs the read: a claim or write that fails is logged and the live client is answered the old way.

### 2. The client remembers what it is waiting on, and comes back for it

`lib/api/kept-answers.ts` `postKept` is what the four read functions in `lib/api/nutrition.ts` now
call. It sends the POST under the id and, however the connection fares, gets the answer:

- 200 → the answer; 202 → ask after it; a live refusal → thrown with its status, as before;
- the POST dies → ask `GET /answers/:id` every 1.5 s until `done`/`failed`, re-send once on
  `unknown`, report `lost`;
- the app comes back to the foreground with the POST still in the air → ask at once, in parallel
  (`lib/app-resume.ts`), because that fetch may be a corpse that never settles; whichever answers
  first wins and the other is let go;
- bounds: the caller's own `signal` stops everything (leaving the door, superseding the read);
  `timeoutMs` bounds the whole operation but is checked _after_ an ask, so a phone away past the
  bound still gets one look at an answer that landed; offline (the browser says so, or two asks in
  a row cannot reach the server) is reported at once; an id still `unknown` a few asks after the
  re-send is the failure it is.

All of this is in memory and covers the common case — a switch of apps, a lock of a minute. For
the case past it — iOS reclaimed the webview while the phone sat locked, and the app relaunches
with no memory of the sheet — the quick log's three reading doors write what they are waiting on
to disk (`features/food/readInProgress.ts`: door, slot, date, words, correction, the picture for
the photo door, and the request id), the way the walkthrough remembers its session (#461). On
launch the shell opens the drawer on that door (`MainTabs` → `FoodHome` → `MealScreen` →
`reopenDoor.ts`), the words are back in the box, and the door asks after the answer under the
remembered id before sending anything. The record is cleared when the read settles or the door is
closed, is owner-stamped, and is not reopened after fifteen minutes (the server's row is `lost` at
five). An answer "re-read" (a tapped choice) is quick and covered by the in-memory path alone.

### 3. For chat, the thread itself is the store

The coach stream already survived a drop: the relay drains to completion server-side, the reply is
persisted, `GET /coach/current` reports `generating`, and `useResumeHealer` polls on resume
(#195, 2026-08). Two gaps closed here:

- **The opening stretch.** `generating` rested on `in_flight_response_id`, which the provider
  announces 5–15 s into a turn. A phone that left inside that stretch and came back was told
  nothing was generating, and the client then said "connection dropped" while the reply was on its
  way. `turn_started_at` (0065) is set at route entry and cleared with the response id (and in the
  route's catch — a failed turn is not generating), so the whole turn reads as in flight, bounded
  by the same five-minute age.
- **A relaunch mid-turn.** Only the healer knew a turn was in the air, and it died with the
  webview. `useCoachTranscript` now treats a restore that finds `generating` with the person's
  message as the last word on file as a turn to wait for: the thread is adopted with her empty
  bubble (the dots), the composer waits, and the healer's poll brings the reply in. If it never
  lands, the bubble says so in plain words (`REPLY_LOST`), never "connection dropped".

The same hook serves the coach tab, the onboarding chat and the meal drawer's chat, so all three
get both.

## What was verified where

- Tests: `routes/answers.test.ts` (claim, join, keep, lost, unknown, another person),
  `routes/nutrition.client.test.ts` (the web client's real `previewMeal` against the real route
  with the connection killed mid-read — the read ran once and the answer came back),
  `routes/coach-current.test.ts` and `coach-message-stream.test.ts` (the turn's marks),
  `lib/api/kept-answers.test.ts` (every way the connection can fare, as a table),
  `useCoachChat.reopen.test.ts`, `readInProgress.test.ts`, `reopenDoor.test.ts`, and the resume
  rows in the describe sheet, chat door and photo hook tests.
- Live: `probe:backgrounded` on the deployed API (coach reply kept, 2026-11-03).
- Device: see the PR for which surfaces were tried on the owner's phone.
