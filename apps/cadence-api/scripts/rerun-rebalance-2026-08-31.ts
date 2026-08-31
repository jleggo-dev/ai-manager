/**
 * One-shot recovery, 2026-08-31: re-run the rebalance the coach started at 11:41 with her exact
 * steer (from cadence.ai_log). The tool fired previewReplan through runInBackground and the
 * serverless invocation froze mid-synthesis (~11:44), so pending_plan never landed and the user
 * got silence. A local process has no such lifetime; the result lands as the normal pending plan
 * + ready push, and the user applies or dismisses from the ordinary card.
 */
import { Agent, setGlobalDispatcher } from 'undici';
// The first local run died on UND_ERR_HEADERS_TIMEOUT: a remote AI Admin job call outran fetch's
// default 5-minute headers window. This run gives the pipeline 15 minutes per call.
setGlobalDispatcher(new Agent({ headersTimeout: 900_000, bodyTimeout: 900_000 }));

const { previewReplan } = await import('../src/services/replan.ts');

const USER = '91e914fa-f014-4e26-accf-c50ca316660e';
const STEER =
  "Jeffrey says Monday and Tuesday currently feel too light/late in the week, and Wednesday is overloaded — it currently has four things stacked on it (early mobility, an early run, piano, AND afternoon hill intervals), which directly conflicts with his own standing constraint that Wednesdays he's at work and can only fit ONE workout with no afternoon session. Fix that: spread real strength and cardio work off Wednesday and onto Monday/Tuesday instead so the week ramps evenly. He also wants to ramp up faster than the current plan does — he feels the progression has been way too conservative given his Ultra Beast goal — so lean the week toward more substantial strength and cardio sessions (he now has a full home gym: kettlebells, TRX, weight vest, rowing machine, bike, treadmill, medicine ball, bands, weight bench, etc., in addition to the pull-up bar and dumbbells) while still respecting his left knee tendinitis and elbow post-procedure limits — ramp intensity/volume up, not around the joint precautions. Also make sure piano practice appears at least three times a week NOT counting his Saturday piano class — currently it's only Wed/Fri (2x), so add a third weekday slot for it.";

console.log('synthesizing — this takes minutes; the phone gets the ready push when it lands…');
const r = await previewReplan(USER, STEER);
console.log(`status: ${r.status}`);
if (r.status === 'vetoed') console.log('violations:', r.violations);
if (r.status === 'proposed') console.log(`proposed ${r.proposal?.activities?.length ?? 0} activities`);
process.exit(0);
