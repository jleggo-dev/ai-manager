import { describe, it, expect } from 'vitest';
import {
  checkinOccurrence,
  isCheckinOccurrence,
  isPreviewOccurrence,
  isSyntheticOccurrence,
  previewOccurrences,
} from './trailPreview.ts';

describe('checkinOccurrence — the check-in as a task on its day', () => {
  it('is a system row named for the day, pending, and recognisably synthetic', () => {
    const occ = checkinOccurrence('2026-09-13');
    expect(occ).toEqual({
      occurrence_id: 'checkin:2026-09-13',
      activity_id: '',
      title: 'Weekly check-in',
      kind: 'system',
      status: 'pending',
    });
    expect(isCheckinOccurrence(occ)).toBe(true);
    expect(isPreviewOccurrence(occ)).toBe(false);
    expect(isSyntheticOccurrence(occ)).toBe(true);
  });

  it('a preview is synthetic too; a real row is neither', () => {
    expect(isSyntheticOccurrence({ occurrence_id: 'preview:2026-09-15:0' })).toBe(true);
    expect(isSyntheticOccurrence({ occurrence_id: '7d3c-…' })).toBe(false);
    expect(isCheckinOccurrence({ occurrence_id: '7d3c-…' })).toBe(false);
  });
});

describe('previewOccurrences — the projected rhythm as stand-in nodes', () => {
  it('gives each preview line the node shape, in order, with an id that names it a preview', () => {
    const out = previewOccurrences({
      date: '2026-09-15',
      preview: [{ title: 'Morning sit', time_of_day: '07:00', area: 'mind' }, { title: 'Long run' }],
    });
    expect(out).toEqual([
      {
        occurrence_id: 'preview:2026-09-15:0',
        activity_id: '',
        title: 'Morning sit',
        kind: 'user',
        status: 'pending',
        time_of_day: '07:00',
        area: 'mind',
      },
      { occurrence_id: 'preview:2026-09-15:1', activity_id: '', title: 'Long run', kind: 'user', status: 'pending' },
    ]);
    expect(out.every(isPreviewOccurrence)).toBe(true);
  });

  it('is empty for a day with no preview (an older server, or an open day)', () => {
    expect(previewOccurrences({ date: '2026-09-15' })).toEqual([]);
  });

  it('never mistakes a real row for a preview', () => {
    expect(isPreviewOccurrence({ occurrence_id: 'a3f1-…' })).toBe(false);
    expect(isPreviewOccurrence({ occurrence_id: '' })).toBe(false);
  });
});
