import { Bell, CalendarClock, PencilLine, Plus, Send, UserPlus, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Avatar, Badge, EmptyState, ErrorText, Spinner, Switch } from '../components/ui';
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
  setSubtitle: (node: ReactNode) => void;
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

function sampleMessage(s: Schedule, r: Recipient | undefined): string {
  const at = s.next_run_at ? new Date(s.next_run_at) : new Date();
  return renderTemplate(s.message_template, templateVars(r?.display_name ?? 'there', at, s.timezone), () => 0);
}

export default function SchedulesPage({ profile, recipients, onGoToContacts, setSubtitle }: Props) {
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
  const upNext = schedules?.find((s) => s.active && s.next_run_at);
  const activeCount = schedules?.filter((s) => s.active).length ?? 0;

  useEffect(() => {
    if (!schedules) return;
    setSubtitle(
      schedules.length === 0
        ? 'Nothing scheduled yet'
        : `${activeCount} active${upNext?.next_run_at ? ` · next ${relativeTime(upNext.next_run_at)}` : ''}`,
    );
  }, [schedules, activeCount, upNext, setSubtitle]);

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
      setError('That one-time message is in the past. Open it to pick a new time.');
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

  function sendNow(s: Schedule) {
    const r = byId.get(s.recipient_id);
    if (!r) return;
    const message = renderTemplate(s.message_template, templateVars(r.display_name, new Date(), s.timezone));
    window.open(whatsappLink(r, message), '_blank', 'noopener');
  }

  if (!schedules) return error ? <ErrorText>{error}</ErrorText> : <Spinner />;

  if (!recipients.length) {
    return (
      <EmptyState icon={UserPlus} title="Add who you message first">
        <p>Add a person or a group, then schedule any message to them: reminders, check-ins, greetings, anything.</p>
        <button className="btn-primary mt-5" onClick={onGoToContacts}>
          <UserPlus className="size-4.5" aria-hidden /> Add a contact
        </button>
      </EmptyState>
    );
  }

  return (
    <div className="space-y-7 pb-20">
      {upNext?.next_run_at && <UpNextCard s={upNext} r={byId.get(upNext.recipient_id)} onSend={() => sendNow(upNext)} onEdit={() => setEditing(scheduleToDraft(upNext))} />}

      <section aria-labelledby="quick-start">
        <h2 id="quick-start" className="section-title">
          Quick start
        </h2>
        <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 scrollbar-none">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              className="flex min-h-11 shrink-0 snap-start items-center gap-2 rounded-full border border-line bg-surface py-2 pr-4 pl-2.5 text-sm font-semibold transition-colors duration-150 hover:bg-surface-2"
              onClick={() => startNew(p)}
            >
              <span className="flex size-7 items-center justify-center rounded-full bg-primary-soft text-primary-ink">
                <p.icon className="size-4" aria-hidden />
              </span>
              {p.label}
            </button>
          ))}
        </div>
      </section>

      <ErrorText>{error}</ErrorText>

      <section aria-labelledby="all-messages">
        <h2 id="all-messages" className="section-title">
          All messages
        </h2>
        {schedules.length === 0 ? (
          <EmptyState icon={CalendarClock} title="No scheduled messages yet">
            Pick a quick start above, or tap <strong className="text-fg">New</strong> to write your own.
          </EmptyState>
        ) : (
          <ul className="card divide-y divide-line overflow-hidden">
            {schedules.map((s) => {
              const r = byId.get(s.recipient_id);
              const name = s.title || `Message ${r?.display_name ?? ''}`;
              const done = !s.active && !s.rrule && !s.next_run_at;
              return (
                <li key={s.id} className="flex items-center gap-1 pr-2">
                  <button
                    className="flex min-w-0 flex-1 items-center gap-3 py-3.5 pl-4 text-left transition-colors duration-150 active:bg-surface-2"
                    onClick={() => setEditing(scheduleToDraft(s))}
                    aria-label={`Edit ${name}`}
                  >
                    <span className={s.active ? '' : 'opacity-50'}>
                      <Avatar name={r?.display_name ?? '?'} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={`truncate font-semibold ${s.active ? '' : 'text-muted'}`}>{name}</span>
                        {done ? <Badge>Done</Badge> : !s.active && <Badge tone="warn">Paused</Badge>}
                      </span>
                      <span className="block truncate text-sm font-medium">{describeSchedule(s)}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-muted">
                        {s.delivery_mode === 'telegram' ? (
                          <Zap className="size-3.5 shrink-0 text-info" aria-hidden />
                        ) : (
                          <Bell className="size-3.5 shrink-0 text-primary-ink" aria-hidden />
                        )}
                        <span className="truncate">
                          {r?.display_name ?? 'Unknown'} · {s.delivery_mode === 'telegram' ? 'Telegram auto' : 'Reminder'}
                        </span>
                      </span>
                    </span>
                  </button>
                  <button className="icon-btn" onClick={() => sendNow(s)} aria-label={`Send ${name} now in WhatsApp`} title="Send now">
                    <Send className="size-5" />
                  </button>
                  {!done && <Switch checked={s.active} onChange={(v) => setActive(s, v)} label={`${name} active`} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <button
        className="btn-primary fixed right-4 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-20 h-14 rounded-2xl px-5 shadow-lg shadow-primary/25 sm:right-[max(1rem,calc(50%-20rem))]"
        onClick={() => startNew()}
      >
        <Plus className="size-5" aria-hidden /> New
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

function UpNextCard({ s, r, onSend, onEdit }: { s: Schedule; r: Recipient | undefined; onSend: () => void; onEdit: () => void }) {
  const at = new Date(s.next_run_at!);
  return (
    <section aria-label="Up next" className="card overflow-hidden">
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div>
          <p className="text-[13px] font-semibold tracking-wide text-primary-ink uppercase">Up next · {relativeTime(s.next_run_at!)}</p>
          <p className="mt-1 text-3xl font-extrabold tracking-tight">
            {at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </p>
          <p className="text-sm font-medium text-muted">{dayWord(at)}</p>
        </div>
        <div className="flex min-w-0 items-center gap-2 rounded-full bg-surface-2 py-1 pr-3 pl-1">
          <Avatar name={r?.display_name ?? '?'} size="sm" />
          <span className="truncate text-sm font-semibold">{r?.display_name}</span>
        </div>
      </div>

      <div className="mx-4 mt-4 rounded-2xl bg-surface-2 p-3">
        <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-md bg-bubble px-3.5 py-2 text-[15px] leading-snug text-bubble-fg shadow-sm">
          {sampleMessage(s, r)}
        </div>
      </div>

      <div className="flex gap-2 p-4">
        <button className="btn-primary flex-1" onClick={onSend}>
          <Send className="size-4.5" aria-hidden /> Send now
        </button>
        <button className="btn-secondary" onClick={onEdit}>
          <PencilLine className="size-4.5" aria-hidden /> Edit
        </button>
      </div>
    </section>
  );
}
