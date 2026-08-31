/**
 * Regenerate the interval parity fixture (see `src/interval-parity.ts`).
 *
 * Run after a DELIBERATE change to the engine, then read the diff: a changed expectation is the
 * thing to review. Both `interval-parity.test.ts` and the Swift check read the file this writes.
 */
import { writeFileSync } from 'node:fs';
import { buildParityFixture } from '../src/interval-parity.ts';

const out = new URL('../interval-parity.json', import.meta.url);
writeFileSync(out, `${JSON.stringify(buildParityFixture(), null, 2)}\n`);
console.log(`wrote ${out.pathname}`);
