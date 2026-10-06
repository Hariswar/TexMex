import { Bell, CalendarClock, History, Minus, Plus, Shuffle, Trash2, X, Zap, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Avatar, ErrorText, Segmented, Sheet, useOnline } from '../components/ui';
import { nextRunAt, upcomingRuns } from '../../supabase/functions/_shared/recurrence.ts';
import { renderTemplate, templateVars } from '../../supabase/functions/_shared/template.ts';
import { draftToRRule, REPEAT_LABELS, type RepeatKind, type ScheduleDraft } from '../lib/scheduleForm';
import { supabase } from '../lib/supabase';
import type { DeliveryMode, Profile, Recipient } from '../lib/types';
import { dayWord } from './SchedulesPage';

interface Props {
  initial: ScheduleDraft;
  profile: Profile;
  recipients: Recipient[];
  onClose: () => void;
  onSaved: () => void;
}

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

const REPEAT_OPTIONS = (Object.keys(REPEAT_LABELS) as RepeatKind[]).map((k) => ({
  value: k,
  label: k === 'weekdays' ? 'Weekdays' : REPEAT_LABELS[k],
}));

const INSERTS: { label: string; text: string }[] = [
  { label: 'First name', text: '{first_name}' },
  { label: 'Full name', text: '{name}' },
  { label: 'Day', text: '{day}' },
  { label: 'Date', text: '{date}' },
  { label: 'Variation', text: '{Hi|Hey|Hello}' },
];

const DELIVERY: { value: DeliveryMode; icon: LucideIcon; title: string; body: string }[] = [
  { value: 'webpush_reminder', icon: Bell, title: 'WhatsApp reminder', body: 'You get a notification. Tap it and WhatsApp opens with the message ready. Press send.' },
  { value: 'telegram', icon: Zap, title: 'Telegram, automatic', body: 'Sent for you at the scheduled time. No tap needed.' },
];

const draftKey = (id?: string) => `texmex:draft:${id ?? 'new'}`;

function loadDraft(initial: ScheduleDraft): { draft: ScheduleDraft; restored: boolean } {
  try {
    const raw = localStorage.getItem(draftKey(initial.id));
    if (raw) {
      const draft = { ...initial, ...JSON.parse(raw) };
      if (JSON.stringify(draft) !== JSON.stringify(initial)) return { draft, restored: true };
    }
  } catch {
    // storage unavailable — fall through
  }
  return { draft: initial, restored: false };
}

export default function ScheduleEditor({ initial, profile, recipients, onClose, onSaved }: Props) {
  const [{ draft: startDraft, restored }] = useState(() => loadDraft(initial));
  const [d, setD] = useState<ScheduleDraft>(startDraft);
  const [showRestored, setShowRestored] = useState(restored);
  const [seed, setSeed] = useState(0);
  const [skipInput, setSkipInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const online = useOnline();
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const recipientRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const row = recipientRowRef.current;
      const chip = row?.querySelector<HTMLElement>('[aria-checked="true"]');
      if (!row || !chip) return;
      const r = row.getBoundingClientRect();
      const c = chip.getBoundingClientRect();
      row.scrollLeft += c.left - r.left - (r.width - c.width) / 2;
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [error]);

  const set = <K extends keyof ScheduleDraft>(key: K, value: ScheduleDraft[K]) => setD((prev) => ({ ...prev, [key]: value }));

  // Offline drafting: unsaved edits are kept on this device until saved or discarded.
  useEffect(() => {
    try {
      if (JSON.stringify(d) === JSON.stringify(initial)) localStorage.removeItem(draftKey(d.id));
      else localStorage.setItem(draftKey(d.id), JSON.stringify(d));
    } catch {
      // ignore
    }
  }, [d, initial]);

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
    if (!d.message_template.trim()) return '';
    return renderTemplate(d.message_template, templateVars(recipient?.display_name ?? 'there', upcoming[0] ?? new Date(), profile.timezone));
  }, [d.message_template, recipient, upcoming, profile.timezone, seed]);

  function insert(text: string) {
    const el = messageRef.current;
    const value = d.message_template;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const needsSpace = start > 0 && !/\s$/.test(value.slice(0, start));
    const piece = (needsSpace ? ' ' : '') + text;
    set('message_template', value.slice(0, start) + piece + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + piece.length, start + piece.length);
    });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!d.recipient_id) return setError('Choose who to send this to.');
    if (!d.message_template.trim()) return setError('Write a message.');
    if (!online) return setError("You're offline. Your draft is saved on this device, so come back and save once you're online.");
    if (d.kind === 'weekly' && d.days.length === 0) return setError('Pick at least one day.');
    const next = nextRunAt(timing, new Date());
    if (!next) return setError('That time has already passed. Pick a time in the future.');
    if (d.delivery_mode === 'telegram' && !recipient?.telegram_chat_id) {
      return setError(`${recipient?.display_name ?? 'This contact'} has no Telegram chat id. Add one in Contacts.`);
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
    const { error } = d.id ? await supabase.from('schedules').update(row).eq('id', d.id) : await supabase.from('schedules').insert(row);
    setSaving(false);
    if (error) return setError(error.message);
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
    <Sheet
      title={d.id ? 'Edit message' : 'New message'}
      onClose={onClose}
      footer={
        <>
          {d.id && (
            <button type="button" className="btn-danger px-3" onClick={remove} aria-label="Delete message">
              <Trash2 className="size-4.5" aria-hidden />
              <span className="max-[360px]:sr-only">Delete</span>
            </button>
          )}
          <div className="flex-1" />
          <button type="button" className="btn-ghost" onClick={cancel}>
            Cancel
          </button>
          <button type="submit" form="schedule-form" className="btn-primary min-w-24" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="schedule-form" onSubmit={save} className="space-y-6" noValidate>
        {showRestored && (
          <div className="flex items-center gap-3 rounded-xl bg-info-soft px-3.5 py-2.5 text-sm text-info" role="status">
            <History className="size-4 shrink-0" aria-hidden />
            <span className="flex-1 font-medium">Restored your unsaved changes.</span>
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={() => {
                setD(initial);
                setShowRestored(false);
              }}
            >
              Discard
            </button>
          </div>
        )}

        {/* Recipient */}
        <fieldset>
          <legend className="label">To</legend>
          <div ref={recipientRowRef} role="radiogroup" aria-label="Recipient" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 scrollbar-none">
            {recipients.map((r) => {
              const active = r.id === d.recipient_id;
              return (
                <button
                  key={r.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => set('recipient_id', r.id)}
                  className={`flex min-h-12 shrink-0 items-center gap-2 rounded-full border py-1.5 pr-4 pl-1.5 text-sm font-semibold transition-colors duration-150 ${
                    active ? 'border-primary bg-primary-soft text-primary-ink' : 'border-line bg-surface hover:bg-surface-2'
                  }`}
                >
                  <Avatar name={r.display_name} size="sm" />
                  {r.display_name}
                </button>
              );
            })}
          </div>
          {d.delivery_mode === 'webpush_reminder' && recipient?.type === 'group' && (
            <p className="hint">WhatsApp can't open a group from a link. It opens with your text ready and you pick “{recipient.display_name}”.</p>
          )}
        </fieldset>

        {/* Message */}
        <div>
          <label className="label" htmlFor="message">
            Message
          </label>
          <textarea
            id="message"
            ref={messageRef}
            className="field min-h-28 resize-none leading-relaxed"
            maxLength={2000}
            placeholder="Hey {first_name}, are we still on for today?"
            value={d.message_template}
            onChange={(e) => set('message_template', e.target.value)}
          />
          <div className="mt-2 flex flex-wrap gap-1.5" aria-label="Insert into message">
            {INSERTS.map((i) => (
              <button
                key={i.label}
                type="button"
                onClick={() => insert(i.text)}
                className="inline-flex min-h-9 items-center gap-1 rounded-full bg-surface-2 px-3 text-[13px] font-semibold text-fg transition-colors duration-150 hover:bg-line"
              >
                <Plus className="size-3.5 text-muted" aria-hidden />
                {i.label}
              </button>
            ))}
          </div>
          <p className="hint">“Variation” picks one option at random each time, so repeat messages don't look automated.</p>
        </div>

        {/* Preview */}
        <div className="rounded-2xl bg-surface-2 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="px-1 text-[13px] font-semibold text-muted">Preview</span>
            <button type="button" className="btn-ghost -my-1 min-h-9 px-2.5 text-[13px]" onClick={() => setSeed((s) => s + 1)}>
              <Shuffle className="size-4" aria-hidden /> Shuffle
            </button>
          </div>
          {preview ? (
            <div className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-tr-md bg-bubble px-3.5 py-2 text-[15px] leading-snug whitespace-pre-wrap text-bubble-fg shadow-sm">
              {preview}
            </div>
          ) : (
            <p className="px-1 pb-1 text-sm text-muted">Your message will appear here.</p>
          )}
        </div>

        {/* Name */}
        <div>
          <label className="label" htmlFor="title">
            Label <span className="font-normal text-muted">(optional)</span>
          </label>
          <input id="title" className="field" placeholder="Good morning, rent reminder, …" value={d.title} onChange={(e) => set('title', e.target.value)} />
        </div>

        {/* When */}
        <fieldset className="space-y-4">
          <legend className="label">Repeat</legend>
          <Segmented label="Repeat" value={d.kind} options={REPEAT_OPTIONS} onChange={(v) => set('kind', v)} />

          {d.kind === 'weekly' && (
            <div className="flex justify-between gap-1" role="group" aria-label="Days of the week">
              {DAY_ORDER.map((day) => {
                const on = d.days.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleDay(day)}
                    aria-pressed={on}
                    aria-label={DAY_NAMES[day]}
                    className={`size-11 rounded-full text-sm font-bold transition-colors duration-150 ${
                      on ? 'bg-primary text-on-primary' : 'bg-surface-2 text-muted hover:bg-line'
                    }`}
                  >
                    {DAY_LETTERS[day]}
                  </button>
                );
              })}
            </div>
          )}

          {d.kind === 'every_n' && (
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium">Every</span>
              <div className="flex items-center rounded-xl border border-line">
                <button type="button" className="icon-btn rounded-xl" aria-label="Fewer days" onClick={() => set('every_n', Math.max(2, d.every_n - 1))}>
                  <Minus className="size-4" />
                </button>
                <span className="w-10 text-center text-base font-bold tabular-nums" aria-live="polite">
                  {d.every_n}
                </span>
                <button type="button" className="icon-btn rounded-xl" aria-label="More days" onClick={() => set('every_n', Math.min(365, d.every_n + 1))}>
                  <Plus className="size-4" />
                </button>
              </div>
              <span className="text-sm font-medium">days</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
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

          <div className="rounded-xl border border-line px-3.5 py-3">
            <p className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-muted">
              <CalendarClock className="size-4" aria-hidden /> Next sends · {profile.timezone.replace(/_/g, ' ')}
            </p>
            {upcoming.length ? (
              <ul className="space-y-1">
                {upcoming.map((u) => (
                  <li key={u.toISOString()} className="flex justify-between text-sm">
                    <span className="font-medium">{dayWord(u)}</span>
                    <span className="text-muted tabular-nums">{u.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-danger">No upcoming sends. Check the date and time.</p>
            )}
          </div>
        </fieldset>

        {/* Delivery */}
        <fieldset>
          <legend className="label">Delivery</legend>
          <div role="radiogroup" aria-label="Delivery" className="space-y-2">
            {DELIVERY.map((o) => {
              const active = d.delivery_mode === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => set('delivery_mode', o.value)}
                  className={`flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors duration-150 ${
                    active ? 'border-primary bg-primary-soft' : 'border-line bg-surface hover:bg-surface-2'
                  }`}
                >
                  <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${active ? 'bg-primary text-on-primary' : 'bg-surface-2 text-muted'}`}>
                    <o.icon className="size-4.5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{o.title}</span>
                    <span className="block text-sm leading-snug text-muted">{o.body}</span>
                  </span>
                  <span
                    className={`mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${active ? 'border-primary' : 'border-line'}`}
                    aria-hidden
                  >
                    {active && <span className="size-2.5 rounded-full bg-primary" />}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {/* Skip dates */}
        {d.kind !== 'once' && (
          <div>
            <label className="label" htmlFor="skip">
              Skip dates <span className="font-normal text-muted">(optional)</span>
            </label>
            <div className="flex gap-2">
              <input id="skip" type="date" className="field" value={skipInput} onChange={(e) => setSkipInput(e.target.value)} />
              <button
                type="button"
                className="btn-secondary min-h-12"
                disabled={!skipInput}
                onClick={() => {
                  if (!d.skip_dates.includes(skipInput)) set('skip_dates', [...d.skip_dates, skipInput].sort());
                  setSkipInput('');
                }}
              >
                Add
              </button>
            </div>
            {d.skip_dates.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {d.skip_dates.map((date) => (
                  <button
                    key={date}
                    type="button"
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-surface-2 pr-2 pl-3 text-[13px] font-semibold hover:bg-line"
                    onClick={() => set('skip_dates', d.skip_dates.filter((x) => x !== date))}
                    aria-label={`Remove skip date ${date}`}
                  >
                    {new Date(`${date}T00:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                    <X className="size-3.5 text-muted" aria-hidden />
                  </button>
                ))}
              </div>
            ) : (
              <p className="hint">Holidays, days off, anything you want to skip.</p>
            )}
          </div>
        )}

        <div ref={errorRef}>
          <ErrorText>{error}</ErrorText>
        </div>
      </form>
    </Sheet>
  );
}
