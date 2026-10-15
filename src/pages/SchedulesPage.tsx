import { Bell, BellOff, Plus, Repeat, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Avatar, ErrorText, IconBubble, Spinner, Switch } from '../components/ui';
import { renderTemplate, templateVars } from '../../supabase/functions/_shared/template.ts';
import { nextRunAt } from '../../supabase/functions/_shared/recurrence.ts';
import { enablePush, getPushState, type PushState } from '../lib/push';
import { PRESETS, type Preset } from '../lib/presets';
import { describeSchedule, emptyDraft, scheduleToDraft, type ScheduleDraft } from '../lib/scheduleForm';
import { supabase } from '../lib/supabase';
import type { Profile, Recipient, Schedule } from '../lib/types';
import ScheduleEditor from './ScheduleEditor';

interface Props {
  profile: Profile;
  recipients: Recipient[];
  onRecipientsChange: () => Promise<void> | void;
}

export function relativeTime(iso: string): string {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `in ${mins} min`;
  if (mins < 48 * 60) return `in ${Math.round(mins / 60)} h`;
  return `in ${Math.round(mins / 1440)} days`;
}

export function dayWord(d: Date): string {
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(today)) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function whenText(s: Schedule): string {
  if (!s.active) return s.rrule || s.next_run_at ? 'Paused' : 'Sent';
  if (!s.next_run_at) return '';
  const at = new Date(s.next_run_at);
  return `${dayWord(at)}, ${at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

/** "Daily", "Weekdays", "Sun", … — the pattern without the time, which whenText already shows. */
function repeatText(s: Schedule): string {
  if (!s.rrule) return 'One time';
  const pattern = describeSchedule(s).split(' · ').slice(0, -1).join(' · ');
  if (pattern.startsWith('Monthly')) return 'Monthly';
  if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/.test(pattern)) return `Every ${pattern}`;
  return pattern;
}

export default function SchedulesPage({ profile, recipients, onRecipientsChange }: Props) {
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

  async function setActive(s: Schedule, resume: boolean) {
    setError('');
    const next = resume ? nextRunAt(s, new Date()) : null;
    if (resume && !next) {
      setError('That message already went out. Open it to pick a new time.');
      return;
    }
    // Optimistic update so the switch responds instantly.
    setSchedules((prev) => prev?.map((x) => (x.id === s.id ? { ...x, active: resume, next_run_at: next?.toISOString() ?? x.next_run_at } : x)) ?? null);
    const { error } = await supabase
      .from('schedules')
      .update(resume ? { active: true, next_run_at: next!.toISOString(), retry_count: 0 } : { active: false })
      .eq('id', s.id);
    if (error) setError(error.message);
    load();
  }

  if (!schedules) return error ? <ErrorText>{error}</ErrorText> : <Spinner />;

  return (
    <div className="space-y-5 pb-24">
      {schedules.length > 0 && <NotificationBanner />}
      <ErrorText>{error}</ErrorText>

      {schedules.length === 0 ? (
        <Welcome onNew={startNew} />
      ) : (
        <ul className="space-y-3">
          {schedules.map((s) => {
            const r = byId.get(s.recipient_id);
            const message = renderTemplate(s.message_template, templateVars(r?.display_name ?? 'there', new Date(s.next_run_at ?? Date.now()), s.timezone), () => 0);
            const finished = !s.active && !s.rrule && !s.next_run_at;
            return (
              <li key={s.id} className={`card flex items-start gap-1 pr-1.5 ${s.active ? '' : 'opacity-70'}`}>
                <button
                  className="flex min-w-0 flex-1 gap-3 rounded-2xl p-4 pr-1 text-left transition-colors duration-150 active:bg-surface-2"
                  onClick={() => setEditing(scheduleToDraft(s))}
                  aria-label={`Edit message to ${r?.display_name ?? 'unknown'}`}
                >
                  <Avatar name={r?.display_name ?? '?'} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">{r?.display_name ?? 'Unknown'}</span>
                    <span className="mt-0.5 line-clamp-2 block text-[15px] leading-snug text-fg/85">{message}</span>
                    <span className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] font-semibold whitespace-nowrap">
                      <span className={s.active ? 'text-primary-ink' : 'text-muted'}>{whenText(s)}</span>
                      <span className="text-muted" aria-hidden>·</span>
                      <span className="inline-flex items-center gap-1 font-medium text-muted">
                        <Repeat className="size-3.5" aria-hidden />
                        {repeatText(s)}
                      </span>
                    </span>
                  </span>
                </button>
                {!finished && (
                  <div className="pt-2.5">
                    <Switch checked={s.active} onChange={(v) => setActive(s, v)} label={`Message to ${r?.display_name ?? 'unknown'} on`} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 bg-linear-to-t from-bg via-bg/90 to-transparent px-4 pt-8 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <button className="btn-primary pointer-events-auto mx-auto flex min-h-14 w-full max-w-md rounded-2xl text-base shadow-lg shadow-primary/25" onClick={() => startNew()}>
          <Plus className="size-5" aria-hidden /> New message
        </button>
      </div>

      {editing && (
        <ScheduleEditor
          initial={editing}
          profile={profile}
          recipients={recipients}
          onRecipientsChange={onRecipientsChange}
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

function Welcome({ onNew }: { onNew: (p?: Preset) => void }) {
  const ideas = PRESETS.filter((p) => ['Good morning', 'Check in', 'Bill reminder', 'One-time reminder'].includes(p.label));
  return (
    <div className="space-y-6">
      <div className="card px-5 py-7 text-center">
        <div className="flex justify-center">
          <IconBubble icon={Bell} size="lg" />
        </div>
        <h2 className="mt-4 text-xl font-extrabold">Never forget to text someone</h2>
        <p className="mx-auto mt-2 max-w-xs text-[15px] leading-relaxed text-muted">
          Write a message and pick a time. When it's time, you get a notification. Tap it and send.
        </p>
      </div>

      <section>
        <h2 className="section-title">Need an idea?</h2>
        <div className="grid grid-cols-2 gap-3">
          {ideas.map((p) => (
            <button
              key={p.label}
              onClick={() => onNew(p)}
              className="card flex flex-col items-start gap-3 p-4 text-left transition-colors duration-150 hover:bg-surface-2 active:bg-surface-2"
            >
              <IconBubble icon={p.icon} size="sm" />
              <span className="font-semibold">{p.label}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

// Reminders can only reach devices that turned notifications on. Without this banner a missing
// subscription only shows up as "Failed" entries in History.
function NotificationBanner() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getPushState().then(setState).catch(() => setState('unsupported'));
  }, []);

  if (!state || state === 'on') return null;

  async function turnOn() {
    setBusy(true);
    setError('');
    try {
      await enablePush();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setState(await getPushState());
    setBusy(false);
  }

  const copy: Record<Exclude<PushState, 'on'>, string> = {
    off: "You won't get reminders on this device until notifications are on.",
    denied: 'Notifications are blocked for this site. Allow them in your browser or phone settings, then reload.',
    'needs-install': 'On iPhone, tap Share → “Add to Home Screen”, open TexMex from there, then turn on notifications.',
    'no-worker': "The app's background service didn't start, so reminders can't arrive. Reload the page.",
    unsupported: "This browser can't show notifications. Try Chrome, or Safari on iPhone from the Home Screen.",
  };

  return (
    <section role="alert" className="card border-warn/40 bg-warn-soft p-4">
      <div className="flex gap-3">
        <IconBubble icon={state === 'needs-install' ? Smartphone : BellOff} tone="warn" />
        <div className="min-w-0 flex-1">
          <p className="font-bold text-fg">Turn on reminders</p>
          <p className="mt-0.5 text-sm leading-snug text-fg/80">{copy[state]}</p>
          {error && <p className="mt-1.5 text-sm font-medium text-danger">{error}</p>}
        </div>
      </div>
      {state === 'off' && (
        <button className="btn-primary mt-3 w-full" onClick={turnOn} disabled={busy}>
          <Bell className="size-4.5" aria-hidden /> {busy ? 'Turning on…' : 'Turn on notifications'}
        </button>
      )}
    </section>
  );
}
