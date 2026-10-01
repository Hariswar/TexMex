import { useEffect, useState } from 'react';
import { Badge, EmptyState, ErrorText, Spinner } from '../components/ui';
import { upcomingRuns } from '../../supabase/functions/_shared/recurrence.ts';
import { supabase } from '../lib/supabase';
import type { DeliveryLog, DeliveryStatus, Schedule } from '../lib/types';

const STATUS: Record<DeliveryStatus, { label: string; color: 'green' | 'amber' | 'red' | 'gray' | 'blue' }> = {
  sent: { label: 'Sent', color: 'green' },
  reminded: { label: 'Reminded', color: 'blue' },
  snoozed: { label: 'Snoozed', color: 'amber' },
  skipped: { label: 'Skipped', color: 'gray' },
  failed: { label: 'Failed', color: 'red' },
};

interface Upcoming {
  at: Date;
  title: string;
  skipped: boolean;
}

function dayLabel(d: Date): string {
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
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
    const key = dayLabel(u.at);
    grouped.set(key, [...(grouped.get(key) ?? []), u]);
  }

  return (
    <div className="space-y-6">
      <section>
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">Next 7 days</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-stone-500">Nothing scheduled this week.</p>
        ) : (
          <div className="card space-y-3">
            {[...grouped].map(([day, items]) => (
              <div key={day}>
                <p className="mb-1 text-xs font-semibold text-stone-500 dark:text-stone-400">{day}</p>
                <ul className="space-y-1">
                  {items.map((u, i) => (
                    <li key={i} className={`flex items-center gap-3 text-sm ${u.skipped ? 'text-stone-400 line-through' : ''}`}>
                      <span className="w-20 shrink-0 font-mono text-xs">{u.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                      <span className="truncate">{u.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">History</h2>
        {logs.length === 0 ? (
          <EmptyState icon="📭" title="Nothing has fired yet">
            Each send, reminder, skip, or failure shows up here.
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {logs.map((l) => (
              <li key={l.id} className="card py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">
                    {l.schedules?.title || `Message ${l.schedules?.recipients?.display_name ?? ''}`}
                  </p>
                  <div className="flex shrink-0 gap-1">
                    {l.opened_at && <Badge color="green">Opened</Badge>}
                    <Badge color={STATUS[l.status].color}>{STATUS[l.status].label}</Badge>
                  </div>
                </div>
                <p className="text-xs text-stone-500 dark:text-stone-400">
                  {new Date(l.fired_at).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </p>
                {l.message && <p className="mt-1 text-sm">{l.message}</p>}
                {l.error && <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">{l.error}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
