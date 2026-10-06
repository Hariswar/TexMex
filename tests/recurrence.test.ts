import { describe, expect, it } from 'vitest';
import { localDateString, nextRunAt, parseRRule, upcomingRuns, zonedTimeToUtc } from '../supabase/functions/_shared/recurrence.ts';
import { renderTemplate } from '../supabase/functions/_shared/template.ts';
import { whatsappLink } from '../supabase/functions/_shared/whatsapp.ts';
import { describeSchedule, draftToRRule, emptyDraft, scheduleToDraft } from '../src/lib/scheduleForm';
import type { Schedule } from '../src/lib/types';

const CHI = 'America/Chicago';
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe('zonedTimeToUtc', () => {
  it('handles standard and daylight time', () => {
    expect(iso(zonedTimeToUtc('2026-01-15', '14:00', CHI))).toBe('2026-01-15T20:00:00.000Z'); // CST -6
    expect(iso(zonedTimeToUtc('2026-07-15', '14:00', CHI))).toBe('2026-07-15T19:00:00.000Z'); // CDT -5
  });

  it('moves non-existent spring-forward times past the gap', () => {
    // 2026-03-08 02:30 does not exist in Chicago; expect 03:30 CDT = 08:30Z
    expect(iso(zonedTimeToUtc('2026-03-08', '02:30', CHI))).toBe('2026-03-08T08:30:00.000Z');
  });

  it('picks the first of two ambiguous fall-back times', () => {
    // 2026-11-01 01:30 happens twice in Chicago; first is CDT = 06:30Z
    expect(iso(zonedTimeToUtc('2026-11-01', '01:30', CHI))).toBe('2026-11-01T06:30:00.000Z');
  });

  it('works for half-hour zones', () => {
    expect(iso(zonedTimeToUtc('2026-10-01', '09:00', 'Asia/Kolkata'))).toBe('2026-10-01T03:30:00.000Z');
  });
});

describe('nextRunAt', () => {
  const weekdays = { rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', start_date: '2026-10-01', send_time: '14:00', timezone: CHI };

  it('fires later today if the time has not passed', () => {
    // Thu 2026-10-01 10:00 CDT
    expect(iso(nextRunAt(weekdays, new Date('2026-10-01T15:00:00Z')))).toBe('2026-10-01T19:00:00.000Z');
  });

  it('skips the weekend', () => {
    // Fri 2026-10-02 15:00 CDT → Mon 10-05 14:00 CDT
    expect(iso(nextRunAt(weekdays, new Date('2026-10-02T20:00:00Z')))).toBe('2026-10-05T19:00:00.000Z');
  });

  it('keeps local wall time across a DST change', () => {
    const runs = upcomingRuns({ ...weekdays, start_date: '2026-10-29' }, new Date('2026-10-29T00:00:00Z'), 3);
    expect(runs.map(iso)).toEqual([
      '2026-10-29T19:00:00.000Z', // Thu, CDT
      '2026-10-30T19:00:00.000Z', // Fri, CDT
      '2026-11-02T20:00:00.000Z', // Mon, CST
    ]);
  });

  it('respects start_date', () => {
    expect(iso(nextRunAt({ ...weekdays, start_date: '2026-10-07' }, new Date('2026-10-01T00:00:00Z')))).toBe('2026-10-07T19:00:00.000Z');
  });

  it('handles every N days anchored to the start date', () => {
    const t = { rrule: 'FREQ=DAILY;INTERVAL=3', start_date: '2026-10-01', send_time: '08:00', timezone: 'UTC' };
    expect(upcomingRuns(t, new Date('2026-10-01T09:00:00Z'), 3).map((d) => localDateString(d, 'UTC'))).toEqual([
      '2026-10-04',
      '2026-10-07',
      '2026-10-10',
    ]);
  });

  it('handles monthly and skips months without the day', () => {
    const t = { rrule: 'FREQ=MONTHLY', start_date: '2026-01-31', send_time: '10:00', timezone: 'UTC' };
    expect(upcomingRuns(t, new Date('2026-01-01T00:00:00Z'), 3).map((d) => localDateString(d, 'UTC'))).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
    ]);
  });

  it('handles biweekly rules', () => {
    const t = { rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', start_date: '2026-10-05', send_time: '09:00', timezone: 'UTC' };
    expect(upcomingRuns(t, new Date('2026-10-01T00:00:00Z'), 3).map((d) => localDateString(d, 'UTC'))).toEqual([
      '2026-10-05',
      '2026-10-19',
      '2026-11-02',
    ]);
  });

  it('returns null for a one-time message in the past', () => {
    const once = { rrule: null, start_date: '2026-10-01', send_time: '14:00', timezone: CHI };
    expect(iso(nextRunAt(once, new Date('2026-10-01T18:00:00Z')))).toBe('2026-10-01T19:00:00.000Z');
    expect(nextRunAt(once, new Date('2026-10-01T19:00:00Z'))).toBeNull();
  });

  it('rejects unsupported rules', () => {
    expect(() => parseRRule('FREQ=YEARLY')).toThrow();
  });
});

describe('schedule form mapping', () => {
  it('round-trips every repeat kind', () => {
    const kinds = ['once', 'daily', 'weekdays', 'weekly', 'every_n', 'monthly'] as const;
    for (const kind of kinds) {
      const draft = { ...emptyDraft('r1'), kind, days: [2, 4], every_n: 3 };
      const rrule = draftToRRule(draft);
      const back = scheduleToDraft({ ...draft, id: 's1', rrule, send_time: '14:00:00', timezone: CHI } as unknown as Schedule);
      expect(back.kind).toBe(kind);
    }
  });

  it('describes schedules', () => {
    expect(describeSchedule({ rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', start_date: '2026-10-01', send_time: '14:00:00' })).toMatch(/^Weekdays · 2:00/);
    expect(describeSchedule({ rrule: 'FREQ=WEEKLY;BYDAY=TU,TH', start_date: '2026-10-01', send_time: '07:30' })).toMatch(/^Tue, Thu · 7:30/);
    expect(describeSchedule({ rrule: 'FREQ=MONTHLY', start_date: '2026-10-22', send_time: '10:00' })).toMatch(/^Monthly, 22nd · 10:00/);
  });
});

describe('renderTemplate', () => {
  it('fills variables and picks variations', () => {
    const vars = { name: 'Sam Lee', first_name: 'Sam', day: 'Monday' };
    expect(renderTemplate('{Hi|Hey} {first_name}, happy {day}!', vars, () => 0)).toBe('Hi Sam, happy Monday!');
    expect(renderTemplate('{Hi|Hey} {first_name}', vars, () => 0.99)).toBe('Hey Sam');
  });

  it('supports nesting and leaves unknown tokens alone', () => {
    expect(renderTemplate('{Gym at 2?|{Lift|Train} at {day}?}', { day: 'Fri' }, () => 0.9)).toBe('Train at Fri?');
    expect(renderTemplate('Use {unknown} braces', {})).toBe('Use {unknown} braces');
  });

  it('collapses the gap left by an empty variation', () => {
    expect(renderTemplate('Gym at 2? {💪|}', {}, () => 0.9)).toBe('Gym at 2?');
  });
});

describe('whatsappLink', () => {
  it('pre-fills chats for individuals and the share sheet for groups', () => {
    expect(whatsappLink({ type: 'individual', phone: '+1 (573) 555-0123' }, 'Gym at 2?')).toBe('https://wa.me/15735550123?text=Gym%20at%202%3F');
    expect(whatsappLink({ type: 'group', phone: null }, 'Gym at 2?')).toBe('https://wa.me/?text=Gym%20at%202%3F');
  });
});
