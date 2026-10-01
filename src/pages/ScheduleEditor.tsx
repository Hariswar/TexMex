import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ErrorText, Sheet, useOnline } from '../components/ui';
import { nextRunAt, upcomingRuns } from '../../supabase/functions/_shared/recurrence.ts';
import { renderTemplate, templateVars } from '../../supabase/functions/_shared/template.ts';
import { draftToRRule, REPEAT_LABELS, type RepeatKind, type ScheduleDraft } from '../lib/scheduleForm';
import { supabase } from '../lib/supabase';
import { DELIVERY_MODE_LABELS, type DeliveryMode, type Profile, type Recipient } from '../lib/types';

interface Props {
  initial: ScheduleDraft;
  profile: Profile;
  recipients: Recipient[];
  onClose: () => void;
  onSaved: () => void;
}

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

const draftKey = (id?: string) => `texmex:draft:${id ?? 'new'}`;

function loadDraft(initial: ScheduleDraft): { draft: ScheduleDraft; restored: boolean } {
  try {
    const raw = localStorage.getItem(draftKey(initial.id));
    if (raw) return { draft: { ...initial, ...JSON.parse(raw) }, restored: true };
  } catch {
    // storage unavailable — fall through
  }
  return { draft: initial, restored: false };
}

export default function ScheduleEditor({ initial, profile, recipients, onClose, onSaved }: Props) {
  const [{ draft: startDraft, restored }] = useState(() => loadDraft(initial));
  const [d, setD] = useState<ScheduleDraft>(startDraft);
  const [seed, setSeed] = useState(0);
  const [skipInput, setSkipInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const online = useOnline();

  const set = <K extends keyof ScheduleDraft>(key: K, value: ScheduleDraft[K]) => setD((prev) => ({ ...prev, [key]: value }));

  // Offline drafting: every change is kept locally until it is saved.
  useEffect(() => {
    try {
      localStorage.setItem(draftKey(d.id), JSON.stringify(d));
    } catch {
      // ignore
    }
  }, [d]);

  const discardDraft = useCallback(() => {
    try {
      localStorage.removeItem(draftKey(d.id));
    } catch {
      // ignore
    }
  }, [d.id]);

  const recipient = recipients.find((r) => r.id === d.recipient_id);
  const timing = useMemo(
    () => ({ rrule: draftToRRule(d), start_date: d.start_date, send_time: d.send_time, timezone: profile.timezone }),
    [d, profile.timezone],
  );

  const upcoming = useMemo(() => {
    try {
      return upcomingRuns(timing, new Date(), 3);
    } catch {
      return [];
    }
  }, [timing]);

  const preview = useMemo(() => {
    void seed; // re-roll variations
    return renderTemplate(d.message_template || '…', templateVars(recipient?.display_name ?? 'there', upcoming[0] ?? new Date(), profile.timezone));
  }, [d.message_template, recipient, upcoming, profile.timezone, seed]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!online) {
      setError("You're offline. Your draft is saved on this device, so come back and save once you're online.");
      return;
    }
    if (d.kind === 'weekly' && d.days.length === 0) {
      setError('Pick at least one day.');
      return;
    }
    const next = nextRunAt(timing, new Date());
    if (!next) {
      setError('That time has already passed. Pick a time in the future.');
      return;
    }
    if (d.delivery_mode === 'telegram' && !recipient?.telegram_chat_id) {
      setError(`${recipient?.display_name ?? 'This contact'} has no Telegram chat id. Add one in Contacts.`);
      return;
    }

    setSaving(true);
    const row = {
      title: d.title.trim(),
      recipient_id: d.recipient_id,
      message_template: d.message_template.trim(),
      rrule: timing.rrule,
      start_date: d.start_date,
      send_time: d.send_time,
      timezone: profile.timezone,
      skip_dates: d.skip_dates,
      delivery_mode: d.delivery_mode,
      active: true,
      next_run_at: next.toISOString(),
      retry_count: 0,
    };
    const { error } = d.id
      ? await supabase.from('schedules').update(row).eq('id', d.id)
      : await supabase.from('schedules').insert(row);
    setSaving(false);
    if (error) {
      setError(error.message);
      return;
    }
    discardDraft();
    onSaved();
  }

  async function remove() {
    if (!d.id || !confirm('Delete this scheduled message?')) return;
    const { error } = await supabase.from('schedules').delete().eq('id', d.id);
    if (error) return setError(error.message);
    discardDraft();
    onSaved();
  }

  function cancel() {
    discardDraft();
    onClose();
  }

  function toggleDay(day: number) {
    set('days', d.days.includes(day) ? d.days.filter((x) => x !== day) : [...d.days, day]);
  }

  return (
    <Sheet title={d.id ? 'Edit message' : 'New scheduled message'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        {restored && (
          <p className="rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:bg-sky-500/15 dark:text-sky-200">
            Restored your unsaved draft.{' '}
            <button type="button" className="font-semibold underline" onClick={() => setD(initial)}>
              Start over
            </button>
          </p>
        )}

        <div>
          <label className="label" htmlFor="recipient">
            To
          </label>
          <select id="recipient" className="field" required value={d.recipient_id} onChange={(e) => set('recipient_id', e.target.value)}>
            <option value="" disabled>
              Choose a contact or group
            </option>
            {recipients.map((r) => (
              <option key={r.id} value={r.id}>
                {r.display_name}
                {r.type === 'group' ? ' (group)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="title">
            Name <span className="font-normal text-stone-400">(optional)</span>
          </label>
          <input id="title" className="field" placeholder="Good morning, rent reminder, …" value={d.title} onChange={(e) => set('title', e.target.value)} />
        </div>

        <div>
          <label className="label" htmlFor="message">
            Message
          </label>
          <textarea
            id="message"
            className="field min-h-24 font-mono text-sm"
            required
            maxLength={2000}
            placeholder="{Hey|Hi} {first_name}, are we still on for today?"
            value={d.message_template}
            onChange={(e) => set('message_template', e.target.value)}
          />
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            Variables: <code>{'{name}'}</code> <code>{'{first_name}'}</code> <code>{'{day}'}</code> <code>{'{date}'}</code>. Random
            variations: <code>{'{Hi|Hey|Yo}'}</code>
          </p>
          <div className="mt-2 flex items-start gap-2 rounded-xl bg-brand-50 p-3 dark:bg-brand-700/15">
            <p className="flex-1 text-sm whitespace-pre-wrap">{preview}</p>
            <button type="button" className="btn-ghost -my-1 shrink-0 px-2 py-1 text-xs" onClick={() => setSeed((s) => s + 1)}>
              🎲 Shuffle
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label" htmlFor="repeat">
              Repeat
            </label>
            <select id="repeat" className="field" value={d.kind} onChange={(e) => set('kind', e.target.value as RepeatKind)}>
              {Object.entries(REPEAT_LABELS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {d.kind === 'weekly' && (
            <div className="col-span-2 flex justify-between gap-1">
              {DAY_ORDER.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(day)}
                  aria-pressed={d.days.includes(day)}
                  className={`h-10 w-10 rounded-full text-sm font-semibold transition ${
                    d.days.includes(day) ? 'bg-brand-600 text-white' : 'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300'
                  }`}
                >
                  {DAY_LETTERS[day]}
                </button>
              ))}
            </div>
          )}

          {d.kind === 'every_n' && (
            <div className="col-span-2">
              <label className="label" htmlFor="every">
                Every how many days?
              </label>
              <input
                id="every"
                type="number"
                min={2}
                max={365}
                className="field"
                value={d.every_n}
                onChange={(e) => set('every_n', Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
          )}

          <div>
            <label className="label" htmlFor="start">
              {d.kind === 'once' ? 'Date' : 'Starting'}
            </label>
            <input id="start" type="date" required className="field" value={d.start_date} onChange={(e) => set('start_date', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="time">
              Time
            </label>
            <input id="time" type="time" required className="field" value={d.send_time} onChange={(e) => set('send_time', e.target.value)} />
          </div>
        </div>

        <p className="text-xs text-stone-500 dark:text-stone-400">
          {upcoming.length
            ? `Next: ${upcoming.map((u) => u.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })).join(' · ')}`
            : 'No upcoming runs.'}{' '}
          ({profile.timezone})
        </p>

        <div>
          <label className="label" htmlFor="mode">
            Delivery
          </label>
          <select id="mode" className="field" value={d.delivery_mode} onChange={(e) => set('delivery_mode', e.target.value as DeliveryMode)}>
            {Object.entries(DELIVERY_MODE_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          {d.delivery_mode === 'webpush_reminder' && recipient?.type === 'group' && (
            <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
              WhatsApp can't pre-select a group from a link. Tapping the reminder opens WhatsApp with the text ready, and you pick the group.
            </p>
          )}
        </div>

        {d.kind !== 'once' && (
          <div>
            <label className="label" htmlFor="skip">
              Skip dates <span className="font-normal text-stone-400">(rest days, holidays)</span>
            </label>
            <div className="flex gap-2">
              <input id="skip" type="date" className="field" value={skipInput} onChange={(e) => setSkipInput(e.target.value)} />
              <button
                type="button"
                className="btn-secondary"
                disabled={!skipInput}
                onClick={() => {
                  if (!d.skip_dates.includes(skipInput)) set('skip_dates', [...d.skip_dates, skipInput].sort());
                  setSkipInput('');
                }}
              >
                Add
              </button>
            </div>
            {d.skip_dates.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {d.skip_dates.map((date) => (
                  <button
                    key={date}
                    type="button"
                    className="rounded-full bg-stone-100 px-2.5 py-1 text-xs dark:bg-stone-800"
                    onClick={() => set('skip_dates', d.skip_dates.filter((x) => x !== date))}
                    aria-label={`Remove ${date}`}
                  >
                    {new Date(`${date}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' })} ✕
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <ErrorText>{error}</ErrorText>

        <div className="flex items-center gap-2 pt-1">
          {d.id && (
            <button type="button" className="btn-danger" onClick={remove}>
              Delete
            </button>
          )}
          <div className="flex-1" />
          <button type="button" className="btn-ghost" onClick={cancel}>
            Cancel
          </button>
          <button className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
