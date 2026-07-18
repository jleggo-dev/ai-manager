/**
 * Recurrence expansion (spec §5.4/§6.3 schedule) — pure, deterministic. No LLM, no DB.
 * Supports the RRULE subset Cadence needs for real habit cadences:
 *   FREQ=DAILY | WEEKLY | MONTHLY, with INTERVAL=n, BYDAY=MO,WE, BYMONTHDAY=1,15.
 * INTERVAL is computed against a stable ANCHOR (the plan start), so a rolling horizon that is
 * topped up over time always lands on the same dates (e.g. "every other day" never shifts parity).
 * Returns the YYYY-MM-DD dates an activity occurs in [from, to].
 */
const DOW: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const DOW_NAME = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface ParsedRecurrence {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'NONE';
  interval: number; // ≥1
  byday: number[]; // 0=Sun … 6=Sat (WEEKLY)
  bymonthday: number[]; // 1..31 (MONTHLY)
}

export function parseRecurrence(recurrence: string): ParsedRecurrence {
  const r = (recurrence || '').toUpperCase();
  const freq: ParsedRecurrence['freq'] = r.includes('MONTHLY')
    ? 'MONTHLY'
    : r.includes('WEEKLY')
      ? 'WEEKLY'
      : r.includes('DAILY')
        ? 'DAILY'
        : 'NONE';
  const interval = Math.max(1, parseInt(r.match(/INTERVAL=(\d+)/)?.[1] ?? '1', 10) || 1);
  const bydayGrp = r.match(/BYDAY=([A-Z,]+)/)?.[1];
  const byday = bydayGrp
    ? bydayGrp
        .split(',')
        .map((d) => DOW[d])
        .filter((n): n is number => n !== undefined)
    : [];
  const bmdGrp = r.match(/BYMONTHDAY=([\d,]+)/)?.[1];
  const bymonthday = bmdGrp
    ? bmdGrp
        .split(',')
        .map((d) => parseInt(d, 10))
        .filter((n) => n >= 1 && n <= 31)
    : [];
  return { freq, interval, byday, bymonthday };
}

function toUTC(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function dayDiff(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}
function weekStartSun(d: Date): Date {
  const s = new Date(d.getTime());
  s.setUTCDate(s.getUTCDate() - s.getUTCDay());
  return s;
}

/**
 * Dates in [fromISO, toISO] (inclusive) on which `recurrence` fires. INTERVAL/weekly-week/monthly
 * are measured from `anchorISO` (defaults to `fromISO` for one-off/legacy callers). Never fires
 * before the anchor (no occurrences before the plan starts).
 */
export function expandRecurrence(recurrence: string, fromISO: string, toISO: string, anchorISO?: string): string[] {
  const { freq, interval, byday, bymonthday } = parseRecurrence(recurrence);
  if (freq === 'NONE') return [];

  const anchor = toUTC(anchorISO ?? fromISO);
  const end = toUTC(toISO);
  const anchorWeek = weekStartSun(anchor);
  const anchorMonthIdx = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth();

  const out: string[] = [];
  const cur = toUTC(fromISO);
  while (cur <= end) {
    if (cur >= anchor) {
      let fire = false;
      if (freq === 'DAILY') {
        fire = dayDiff(anchor, cur) % interval === 0;
      } else if (freq === 'WEEKLY') {
        const weekIdx = dayDiff(anchorWeek, weekStartSun(cur)) / 7;
        const onDays = byday.length ? byday : [anchor.getUTCDay()];
        fire = Number.isInteger(weekIdx) && weekIdx % interval === 0 && onDays.includes(cur.getUTCDay());
      } else if (freq === 'MONTHLY') {
        const monthIdx = cur.getUTCFullYear() * 12 + cur.getUTCMonth() - anchorMonthIdx;
        const onDates = bymonthday.length ? bymonthday : [anchor.getUTCDate()];
        fire = monthIdx % interval === 0 && onDates.includes(cur.getUTCDate());
      }
      if (fire) out.push(fmt(cur));
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** Human-readable cadence for the UI — "Every other day", "Mon, Wed, Fri", "Every other week". */
export function describeRecurrence(recurrence: string): string {
  const { freq, interval, byday, bymonthday } = parseRecurrence(recurrence);
  if (freq === 'NONE') return 'One-time';
  if (freq === 'DAILY') {
    return interval === 1 ? 'Every day' : interval === 2 ? 'Every other day' : `Every ${interval} days`;
  }
  if (freq === 'WEEKLY') {
    const days = byday.length
      ? [...byday]
          .sort((a, b) => a - b)
          .map((n) => DOW_NAME[n])
          .join(', ')
      : '';
    if (interval === 1) return days || 'Weekly';
    if (interval === 2) return days ? `Every other week · ${days}` : 'Every other week';
    return days ? `Every ${interval} weeks · ${days}` : `Every ${interval} weeks`;
  }
  // MONTHLY
  const md = [...bymonthday].sort((a, b) => a - b);
  const daysStr = md.length ? `day${md.length > 1 ? 's' : ''} ${md.join(', ')}` : '';
  if (interval === 1) return md.length ? `Monthly · ${daysStr}` : 'Monthly';
  return `Every ${interval} months${md.length ? ` · ${daysStr}` : ''}`;
}

const DAY_ABBR: Record<string, string> = {
  sunday: 'SU',
  monday: 'MO',
  tuesday: 'TU',
  wednesday: 'WE',
  thursday: 'TH',
  friday: 'FR',
  saturday: 'SA',
  sun: 'SU',
  mon: 'MO',
  tue: 'TU',
  wed: 'WE',
  thu: 'TH',
  fri: 'FR',
  sat: 'SA',
};

/**
 * Normalize a synthesized schedule's recurrence into the RRULE subset expandRecurrence reads.
 * Accepts an existing "FREQ=…" string (passed through verbatim, so INTERVAL/BYMONTHDAY survive),
 * or {recurrence:"weekly|daily|monthly", days:[…], interval?}.
 */
export function toRRule(schedule: Record<string, unknown> | null | undefined): string {
  if (!schedule || typeof schedule !== 'object') return '';
  const rec = String((schedule as { recurrence?: unknown }).recurrence ?? '').toUpperCase();
  if (rec.startsWith('FREQ=')) return rec;
  const intervalRaw = Number((schedule as { interval?: unknown }).interval ?? 1);
  const interval = Number.isFinite(intervalRaw) && intervalRaw > 1 ? Math.floor(intervalRaw) : 1;
  const suffix = interval > 1 ? `;INTERVAL=${interval}` : '';
  const daysRaw = (schedule as { days?: unknown }).days;
  const days = Array.isArray(daysRaw) ? daysRaw : [];
  const byday = days.map((d) => DAY_ABBR[String(d).toLowerCase()]).filter((x): x is string => Boolean(x));
  if (rec.includes('MONTHLY')) return `FREQ=MONTHLY${suffix}`;
  if (rec.includes('DAILY')) return `FREQ=DAILY${suffix}`;
  if (rec.includes('WEEKLY') || byday.length) {
    return byday.length ? `FREQ=WEEKLY${suffix};BYDAY=${byday.join(',')}` : `FREQ=WEEKLY${suffix}`;
  }
  return rec ? `FREQ=${rec}${suffix}` : '';
}
