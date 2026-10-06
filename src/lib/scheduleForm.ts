// Maps between the friendly "repeat" picker in the editor and the stored RRULE.
import { buildRRule, parseRRule } from '../../supabase/functions/_shared/recurrence.ts';
import type { DeliveryMode, Schedule } from './types';

export type RepeatKind = 'once' | 'daily' | 'weekdays' | 'weekly' | 'every_n' | 'monthly';

export const REPEAT_LABELS: Record<RepeatKind, string> = {
  once: 'Once',
  daily: 'Every day',
  weekdays: 'Weekdays (Mon–Fri)',
  weekly: 'Specific days',
  every_n: 'Every N days',
  monthly: 'Monthly',
};

const WEEKDAY_SET = [1, 2, 3, 4, 5];

export interface ScheduleDraft {
  id?: string;
  title: string;
  recipient_id: string;
  message_template: string;
  kind: RepeatKind;
  days: number[]; // 0 = Sunday
  every_n: number;
  start_date: string;
  send_time: string;
  delivery_mode: DeliveryMode;
  skip_dates: string[];
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function emptyDraft(recipientId = ''): ScheduleDraft {
  return {
    title: '',
    recipient_id: recipientId,
    message_template: '',
    kind: 'weekdays',
    days: [...WEEKDAY_SET],
    every_n: 2,
    start_date: todayIso(),
    send_time: '14:00',
    delivery_mode: 'webpush_reminder',
    skip_dates: [],
  };
}

export function draftToRRule(d: ScheduleDraft): string | null {
  switch (d.kind) {
    case 'once':
      return null;
    case 'daily':
      return buildRRule({ freq: 'DAILY', interval: 1, byday: [] });
    case 'weekdays':
      return buildRRule({ freq: 'WEEKLY', interval: 1, byday: WEEKDAY_SET });
    case 'weekly':
      return buildRRule({ freq: 'WEEKLY', interval: 1, byday: d.days });
    case 'every_n':
      return buildRRule({ freq: 'DAILY', interval: Math.max(1, d.every_n), byday: [] });
    case 'monthly':
      return buildRRule({ freq: 'MONTHLY', interval: 1, byday: [] });
  }
}

export function scheduleToDraft(s: Schedule): ScheduleDraft {
  const base: ScheduleDraft = {
    ...emptyDraft(s.recipient_id),
    id: s.id,
    title: s.title,
    message_template: s.message_template,
    start_date: s.start_date,
    send_time: s.send_time.slice(0, 5),
    delivery_mode: s.delivery_mode,
    skip_dates: s.skip_dates ?? [],
  };
  if (!s.rrule) return { ...base, kind: 'once' };
  const r = parseRRule(s.rrule);
  if (r.freq === 'MONTHLY') return { ...base, kind: 'monthly' };
  if (r.freq === 'DAILY') return r.interval > 1 ? { ...base, kind: 'every_n', every_n: r.interval } : { ...base, kind: 'daily' };
  const isWeekdays = r.byday.length === 5 && WEEKDAY_SET.every((d) => r.byday.includes(d));
  return isWeekdays ? { ...base, kind: 'weekdays' } : { ...base, kind: 'weekly', days: r.byday };
}

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function describeSchedule(s: Pick<Schedule, 'rrule' | 'start_date' | 'send_time'>): string {
  const time = formatTime(s.send_time.slice(0, 5));
  if (!s.rrule) {
    const date = new Date(`${s.start_date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${date} · ${time}`;
  }
  const r = parseRRule(s.rrule);
  if (r.freq === 'MONTHLY') return `Monthly, ${ordinal(Number(s.start_date.slice(8)))} · ${time}`;
  if (r.freq === 'DAILY') return r.interval > 1 ? `Every ${r.interval} days · ${time}` : `Daily · ${time}`;
  const days = [...r.byday].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
  if (days.length === 5 && WEEKDAY_SET.every((d) => days.includes(d))) return `Weekdays · ${time}`;
  if (days.length === 7) return `Daily · ${time}`;
  return `${days.map((d) => DAY_SHORT[d]).join(', ')} · ${time}`;
}

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}
