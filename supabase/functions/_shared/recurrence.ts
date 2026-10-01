// Recurrence engine shared by the browser (to preview / compute the first run)
// and the dispatch Edge Function (to compute the next run after each fire).
// Pure TypeScript with no imports so it runs unchanged in Deno and Vite.
//
// A schedule's timing is:
//   rrule      – RFC 5545 subset (FREQ=DAILY|WEEKLY|MONTHLY, INTERVAL, BYDAY), or null for one-time
//   start_date – local calendar date (DTSTART), 'YYYY-MM-DD'
//   send_time  – local wall-clock time, 'HH:MM' (seconds ignored)
//   timezone   – IANA zone, e.g. 'America/Chicago'
// Runs fire at send_time in the schedule's timezone, so DST shifts are handled.

export type Weekday = 'SU' | 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA';
export const WEEKDAYS: Weekday[] = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export interface ScheduleTiming {
  rrule: string | null;
  start_date: string;
  send_time: string;
  timezone: string;
}

export interface ParsedRule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY';
  interval: number;
  byday: number[]; // 0 = Sunday
}

const DAY_MS = 86_400_000;

export function parseRRule(rule: string): ParsedRule {
  const parts: Record<string, string> = {};
  for (const piece of rule.replace(/^RRULE:/i, '').split(';')) {
    if (!piece) continue;
    const [k, v = ''] = piece.split('=');
    parts[k.trim().toUpperCase()] = v.trim().toUpperCase();
  }
  const freq = parts.FREQ;
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY') {
    throw new Error(`Unsupported FREQ: ${freq ?? '(missing)'}`);
  }
  const interval = Math.max(1, parseInt(parts.INTERVAL ?? '1', 10) || 1);
  const byday = parts.BYDAY
    ? parts.BYDAY.split(',').map((d) => {
        const i = WEEKDAYS.indexOf(d as Weekday);
        if (i < 0) throw new Error(`Unsupported BYDAY value: ${d}`);
        return i;
      })
    : [];
  return { freq, interval, byday };
}

export function buildRRule(rule: ParsedRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byday.length) {
    parts.push(`BYDAY=${[...rule.byday].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => WEEKDAYS[d]).join(',')}`);
  }
  return parts.join(';');
}

// ---- plain calendar dates as integer day numbers (days since 1970-01-01) ----

export function isoToDayNum(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function dayNumToIso(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday. 1970-01-01 was a Thursday. */
export function dayNumWeekday(n: number): number {
  return (((n + 4) % 7) + 7) % 7;
}

// ---- timezone helpers (Intl-based, no dependencies) ----

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

interface WallParts { y: number; m: number; d: number; h: number; mi: number; s: number }

function wallParts(date: Date, tz: string): WallParts {
  const p: Record<string, string> = {};
  for (const part of formatter(tz).formatToParts(date)) p[part.type] = part.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

function offsetMs(date: Date, tz: string): number {
  const p = wallParts(date, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Converts a local wall-clock time in `tz` to a UTC instant.
 * Ambiguous times (DST fall-back) resolve to the earlier instant;
 * non-existent times (DST spring-forward gap) resolve to just after the gap.
 */
export function zonedTimeToUtc(isoDate: string, time: string, tz: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, h, mi);
  const first = wall - offsetMs(new Date(wall), tz);
  const candidates = [first, wall - offsetMs(new Date(first), tz)];
  const matching = candidates.filter((ts) => {
    const p = wallParts(new Date(ts), tz);
    return p.y === y && p.m === m && p.d === d && p.h === h && p.mi === mi;
  });
  return new Date(matching.length ? Math.min(...matching) : Math.max(...candidates));
}

export function localDateString(date: Date, tz: string): string {
  const p = wallParts(date, tz);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

// ---- occurrence matching ----

function mondayWeekStart(day: number): number {
  return day - ((dayNumWeekday(day) + 6) % 7);
}

function matches(rule: ParsedRule, start: number, day: number): boolean {
  if (day < start) return false;
  switch (rule.freq) {
    case 'DAILY':
      return (day - start) % rule.interval === 0;
    case 'WEEKLY': {
      const days = rule.byday.length ? rule.byday : [dayNumWeekday(start)];
      if (!days.includes(dayNumWeekday(day))) return false;
      const weeks = (mondayWeekStart(day) - mondayWeekStart(start)) / 7;
      return weeks % rule.interval === 0;
    }
    case 'MONTHLY': {
      const s = new Date(start * DAY_MS);
      const c = new Date(day * DAY_MS);
      if (c.getUTCDate() !== s.getUTCDate()) return false; // months without that day are skipped
      const months = (c.getUTCFullYear() - s.getUTCFullYear()) * 12 + (c.getUTCMonth() - s.getUTCMonth());
      return months % rule.interval === 0;
    }
  }
}

/** The first occurrence strictly after `after`, or null if the schedule is finished. */
export function nextRunAt(t: ScheduleTiming, after: Date): Date | null {
  if (!t.rrule) {
    const at = zonedTimeToUtc(t.start_date, t.send_time, t.timezone);
    return at > after ? at : null;
  }
  const rule = parseRRule(t.rrule);
  const start = isoToDayNum(t.start_date);
  let day = Math.max(start, isoToDayNum(localDateString(after, t.timezone)) - 1);
  const limit = day + 366 * rule.interval + 62;
  for (; day <= limit; day++) {
    if (!matches(rule, start, day)) continue;
    const at = zonedTimeToUtc(dayNumToIso(day), t.send_time, t.timezone);
    if (at > after) return at;
  }
  return null;
}

/** Up to `count` occurrences after `after`, stopping at `until` if given. */
export function upcomingRuns(t: ScheduleTiming, after: Date, count: number, until?: Date): Date[] {
  const out: Date[] = [];
  let cursor = after;
  while (out.length < count) {
    const next = nextRunAt(t, cursor);
    if (!next || (until && next > until)) break;
    out.push(next);
    cursor = next;
  }
  return out;
}
