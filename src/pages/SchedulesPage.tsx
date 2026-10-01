import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, EmptyState, ErrorText, Spinner } from '../components/ui';
import { renderTemplate, templateVars } from '../../supabase/functions/_shared/template.ts';
import { nextRunAt } from '../../supabase/functions/_shared/recurrence.ts';
import { whatsappLink } from '../../supabase/functions/_shared/whatsapp.ts';
import { PRESETS, type Preset } from '../lib/presets';
import { describeSchedule, emptyDraft, scheduleToDraft, type ScheduleDraft } from '../lib/scheduleForm';
import { supabase } from '../lib/supabase';
import type { Profile, Recipient, Schedule } from '../lib/types';
import ScheduleEditor from './ScheduleEditor';

interface Props {
  profile: Profile;
  recipients: Recipient[];
  onGoToContacts: () => void;
}

export function formatNextRun(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const mins = Math.round((d.getTime() - Date.now()) / 60_000);
  const when = d.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  if (mins < 1) return `${when} (now)`;
  if (mins < 60) return `${when} (in ${mins} min)`;
  if (mins < 48 * 60) return `${when} (in ${Math.round(mins / 60)} h)`;
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function SchedulesPage({ profile, recipients, onGoToContacts }: Props) {
  const [schedules, setSchedules] = useState<Schedule[] | null>(null);
  const [editing, setEditing] = useState<ScheduleDraft | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('schedules')
      .select('*')
      .order('active', { ascending: false })
      .order('next_run_at', { ascending: true, nullsFirst: false });
    if (error) setError(error.message);
    else setSchedules(data as Schedule[]);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byId = useMemo(() => new Map(recipients.map((r) => [r.id, r])), [recipients]);

  function startNew(preset?: Preset) {
    const draft = emptyDraft(recipients[0]?.id ?? '');
    if (!preset) return setEditing(draft);
    const { title, message_template, kind, send_time, days = draft.days } = preset;
    setEditing({ ...draft, title, message_template, kind, send_time, days });
  }

  async function toggleActive(s: Schedule) {
    setError('');
    const resume = !s.active;
    const next = resume ? nextRunAt(s, new Date()) : null;
    if (resume && !next) {
      setError('That one-time message is in the past. Edit it to pick a new time.');
      return;
    }
    const { error } = await supabase
      .from('schedules')
      .update(resume ? { active: true, next_run_at: next!.toISOString(), retry_count: 0 } : { active: false })
      .eq('id', s.id);
    if (error) setError(error.message);
    load();
  }

  function sendNow(s: Schedule) {
    const r = byId.get(s.recipient_id);
    if (!r) return;
    const message = renderTemplate(s.message_template, templateVars(r.display_name, new Date(), s.timezone));
    window.open(whatsappLink(r, message), '_blank', 'noopener');
  }

  if (!schedules) return error ? <ErrorText>{error}</ErrorText> : <Spinner />;

  if (!recipients.length) {
    return (
      <EmptyState icon="👋" title="Add who you message first">
        <p>Add a person or a group, then schedule any message to them: reminders, check-ins, greetings, anything.</p>
        <button className="btn-primary mt-4" onClick={onGoToContacts}>
          Add a contact
        </button>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">Quick start</h2>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {PRESETS.map((p) => (
            <button key={p.label} className="btn-secondary shrink-0 rounded-full" onClick={() => startNew(p)}>
              <span>{p.emoji}</span> {p.label}
            </button>
          ))}
          <button className="btn-secondary shrink-0 rounded-full" onClick={() => startNew()}>
            ✏️ Blank
          </button>
        </div>
      </section>

      <ErrorText>{error}</ErrorText>

      {schedules.length === 0 ? (
        <EmptyState icon="🗓️" title="No scheduled messages yet">
          Pick a quick-start above or tap + to write your own.
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {schedules.map((s) => {
            const r = byId.get(s.recipient_id);
            return (
              <li key={s.id} className={`card ${s.active ? '' : 'opacity-60'}`}>
                <button className="block w-full text-left" onClick={() => setEditing(scheduleToDraft(s))}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{s.title || `Message ${r?.display_name ?? ''}`}</p>
                      <p className="text-sm text-stone-500 dark:text-stone-400">
                        to {r?.display_name ?? 'unknown'} {r?.type === 'group' && '(group)'} · {describeSchedule(s)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {!s.active && <Badge>{s.next_run_at || s.rrule ? 'Paused' : 'Done'}</Badge>}
                      <Badge color={s.delivery_mode === 'telegram' ? 'blue' : 'green'}>
                        {s.delivery_mode === 'telegram' ? 'Telegram · auto' : 'WhatsApp · 1 tap'}
                      </Badge>
                    </div>
                  </div>
                  <p className="mt-2 line-clamp-2 rounded-xl bg-stone-100 px-3 py-2 font-mono text-sm dark:bg-stone-800">
                    {s.message_template}
                  </p>
                  {s.active && <p className="mt-2 text-sm">⏰ Next: {formatNextRun(s.next_run_at)}</p>}
                </button>
                <div className="mt-3 flex flex-wrap gap-2 border-t border-stone-100 pt-3 dark:border-stone-800">
                  <button className="btn-secondary py-1.5" onClick={() => sendNow(s)}>
                    Send now
                  </button>
                  <button className="btn-ghost py-1.5" onClick={() => toggleActive(s)}>
                    {s.active ? 'Pause' : 'Resume'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <button
        className="btn-primary fixed right-4 bottom-24 z-20 h-14 w-14 rounded-full p-0 text-2xl shadow-lg sm:right-[max(1rem,calc(50%-20rem))]"
        onClick={() => startNew()}
        aria-label="New scheduled message"
      >
        +
      </button>

      {editing && (
        <ScheduleEditor
          initial={editing}
          profile={profile}
          recipients={recipients}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}
