import { Bell, CalendarX2, CheckCheck, CircleAlert, Clock, Inbox, SkipForward, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, EmptyState, ErrorText, IconBubble, Spinner, type Tone } from '../components/ui';
import { upcomingRuns } from '../../supabase/functions/_shared/recurrence.ts';
import { supabase } from '../lib/supabase';
import type { DeliveryLog, DeliveryStatus, Schedule } from '../lib/types';
import { dayWord } from './SchedulesPage';

const STATUS: Record<DeliveryStatus, { label: string; tone: Tone; icon: LucideIcon }> = {
  sent: { label: 'Sent', tone: 'success', icon: CheckCheck },
  reminded: { label: 'Reminded', tone: 'primary', icon: Bell },
  snoozed: { label: 'Snoozed', tone: 'warn', icon: Clock },
  skipped: { label: 'Skipped', tone: 'neutral', icon: SkipForward },
  failed: { label: 'Failed', tone: 'danger', icon: CircleAlert },
};

interface Upcoming {
  at: Date;
  title: string;
  skipped: boolean;
}

export default function HistoryPage() {
  const [logs, setLogs] = useState<DeliveryLog[] | null>(null);
  const [upcoming, setUpcoming] = useState<Upcoming[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      const [logsRes, schedRes] = await Promise.all([
        supabase
          .from('delivery_logs')
          .select('id, schedule_id, fired_at, status, message, error, opened_at, schedules(title, recipients(display_name))')
          .order('fired_at', { ascending: false })
          .limit(100),
        supabase.from('schedules').select('*, recipients(display_name)').eq('active', true),
      ]);
      if (logsRes.error || schedRes.error) {
        setError((logsRes.error ?? schedRes.error)!.message);
        return;
      }
      setLogs(logsRes.data as unknown as DeliveryLog[]);

      const now = new Date();
      const horizon = new Date(now.getTime() + 7 * 86_400_000);
      const items: Upcoming[] = [];
      for (const s of schedRes.data as (Schedule & { recipients: { display_name: string } | null })[]) {
        const title = s.title || `Message ${s.recipients?.display_name ?? ''}`;
        for (const at of upcomingRuns(s, now, 20, horizon)) {
          const localDate = at.toLocaleDateString('en-CA', { timeZone: s.timezone });
          items.push({ at, title, skipped: s.skip_dates.includes(localDate) });
        }
      }
      setUpcoming(items.sort((a, b) => a.at.getTime() - b.at.getTime()));
    })();
  }, []);

  if (error) return <ErrorText>{error}</ErrorText>;
  if (!logs) return <Spinner />;

  const grouped = new Map<string, Upcoming[]>();
  for (const u of upcoming) {
    const key = dayWord(u.at);
    grouped.set(key, [...(grouped.get(key) ?? []), u]);
  }

  return (
    <div className="space-y-7">
      <section aria-labelledby="upcoming">
        <h2 id="upcoming" className="section-title">
          Next 7 days
        </h2>
        {upcoming.length === 0 ? (
          <div className="card flex items-center gap-3 p-4 text-sm text-muted">
            <IconBubble icon={CalendarX2} tone="neutral" size="sm" />
            Nothing scheduled this week.
          </div>
        ) : (
          <div className="card divide-y divide-line overflow-hidden">
            {[...grouped].map(([day, items]) => (
              <div key={day} className="flex gap-4 px-4 py-3">
                <p className="w-20 shrink-0 pt-0.5 text-sm font-bold">{day}</p>
                <ul className="min-w-0 flex-1 space-y-1.5">
                  {items.map((u, i) => (
                    <li key={i} className={`flex items-baseline gap-3 text-sm ${u.skipped ? 'text-muted line-through' : ''}`}>
                      <span className="w-18 shrink-0 text-muted tabular-nums">{u.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                      <span className="truncate font-medium">{u.title}</span>
                      {u.skipped && <span className="sr-only">(skipped)</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="history">
        <h2 id="history" className="section-title">
          History
        </h2>
        {logs.length === 0 ? (
          <EmptyState icon={Inbox} title="Nothing has fired yet">
            Every send, reminder, skip or failure will show up here.
          </EmptyState>
        ) : (
          <ul className="card divide-y divide-line overflow-hidden">
            {logs.map((l) => {
              const st = STATUS[l.status];
              return (
                <li key={l.id} className="flex gap-3 px-4 py-3.5">
                  <IconBubble icon={st.icon} tone={st.tone} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-semibold">{l.schedules?.title || `Message ${l.schedules?.recipients?.display_name ?? ''}`}</p>
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </div>
                    <p className="text-[13px] text-muted">
                      {new Date(l.fired_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                      {l.schedules?.recipients?.display_name && ` · to ${l.schedules.recipients.display_name}`}
                      {l.opened_at && ' · opened'}
                    </p>
                    {l.message && <p className="mt-1.5 text-sm leading-snug">{l.message}</p>}
                    {l.error && l.status !== 'sent' && <p className={`mt-1 text-[13px] ${l.status === 'failed' ? 'text-danger' : 'text-muted'}`}>{l.error}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
