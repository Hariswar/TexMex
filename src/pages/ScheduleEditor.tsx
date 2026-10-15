import { Bell, ChevronDown, History, Plus, Shuffle, Trash2, User, Users, X, Zap, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Avatar, ErrorText, Segmented, Sheet, useOnline } from '../components/ui';
import { nextRunAt } from '../../supabase/functions/_shared/recurrence.ts';
import { renderTemplate, templateVars } from '../../supabase/functions/_shared/template.ts';
import { draftToRRule, type RepeatKind, type ScheduleDraft } from '../lib/scheduleForm';
import { supabase } from '../lib/supabase';
import type { DeliveryMode, Profile, Recipient, RecipientType } from '../lib/types';
import { dayWord } from './SchedulesPage';

interface Props {
  initial: ScheduleDraft;
  profile: Profile;
  recipients: Recipient[];
  onRecipientsChange: () => Promise<void> | void;
  onClose: () => void;
  onSaved: () => void;
}

const NEW = '__new__';
const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

const BASE_REPEAT: { value: RepeatKind; label: string }[] = [
  { value: 'once', label: 'Once' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

const DELIVERY: { value: DeliveryMode; icon: LucideIcon; title: string; body: string }[] = [
  { value: 'webpush_reminder', icon: Bell, title: 'Remind me (WhatsApp)', body: 'You get a notification, tap it, and press send in WhatsApp.' },
  { value: 'telegram', icon: Zap, title: 'Send automatically (Telegram)', body: 'Goes out by itself. Needs a Telegram chat ID on the contact.' },
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

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-2.5 text-base font-bold">
        <span className="flex size-7 items-center justify-center rounded-full bg-primary-soft text-sm font-extrabold text-primary-ink" aria-hidden>
          {n}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

export default function ScheduleEditor({ initial, profile, recipients, onRecipientsChange, onClose, onSaved }: Props) {
  const [{ draft: startDraft, restored }] = useState(() =>
    loadDraft(recipients.length ? initial : { ...initial, recipient_id: initial.recipient_id || NEW }),
  );
  const [d, setD] = useState<ScheduleDraft>(startDraft);
  const [showRestored, setShowRestored] = useState(restored);
  const [newContact, setNewContact] = useState<{ type: RecipientType; name: string; phone: string }>({ type: 'individual', name: '', phone: '' });
  const [showMore, setShowMore] = useState(startDraft.delivery_mode !== 'webpush_reminder' || startDraft.skip_dates.length > 0);
  const [seed, setSeed] = useState(0);
  const [skipInput, setSkipInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const online = useOnline();
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const recipientRowRef = useRef<HTMLDivElement>(null);

  const set = <K extends keyof ScheduleDraft>(key: K, value: ScheduleDraft[K]) => setD((prev) => ({ ...prev, [key]: value }));

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [error]);

  // Bring the selected person into view when they're further along the row.
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

  const isNew = d.recipient_id === NEW;
  const recipient = recipients.find((r) => r.id === d.recipient_id);
  const recipientName = isNew ? newContact.name.trim() || 'there' : recipient?.display_name ?? 'there';
  const isGroup = isNew ? newContact.type === 'group' : recipient?.type === 'group';

  const timing = useMemo(
    () => ({ rrule: draftToRRule(d), start_date: d.start_date, send_time: d.send_time, timezone: profile.timezone }),
    [d, profile.timezone],
  );

  const firstSend = useMemo(() => {
    try {
      return nextRunAt(timing, new Date());
    } catch {
      return null;
    }
  }, [timing]);

  const hasVariations = /\{[^{}]*\}/.test(d.message_template);
  const preview = useMemo(() => {
    void seed; // re-roll variations
    return renderTemplate(d.message_template, templateVars(recipientName, firstSend ?? new Date(), profile.timezone));
  }, [d.message_template, recipientName, firstSend, profile.timezone, seed]);

  const repeatOptions = d.kind === 'every_n' ? [...BASE_REPEAT, { value: 'every_n' as const, label: `Every ${d.every_n} days` }] : BASE_REPEAT;

  function setKind(kind: RepeatKind) {
    setD((prev) => {
      // Default "Weekly" to the weekday of the chosen date.
      const days = kind === 'weekly' && prev.kind !== 'weekly' ? [new Date(`${prev.start_date}T12:00:00`).getDay()] : prev.days;
      return { ...prev, kind, days };
    });
  }

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

    if (!d.recipient_id) return setError('Choose who this message is for.');
    const phone = newContact.phone.replace(/[^\d+]/g, '');
    if (isNew) {
      if (!newContact.name.trim()) return setError('Type a name for the new person or group.');
      if (newContact.type === 'individual' && phone.replace(/\D/g, '').length < 7) {
        return setError('Type their WhatsApp number with the country code, like +1 573 555 0123.');
      }
    }
    if (!d.message_template.trim()) return setError('Type your message.');
    if (d.kind === 'weekly' && d.days.length === 0) return setError('Pick at least one day of the week.');
    if (!firstSend) return setError('That time has already passed. Pick a later time.');
    if (d.delivery_mode === 'telegram' && !recipient?.telegram_chat_id) {
      return setError(`To send automatically, add a Telegram chat ID to ${recipientName} in Settings → People & groups. Or switch back to “Remind me”.`);
    }
    if (!online) return setError("You're offline. Your message is saved on this device, so try again when you're back online.");

    setSaving(true);
    let recipientId = d.recipient_id;
    if (isNew) {
      const { data, error } = await supabase
        .from('recipients')
        .insert({ type: newContact.type, display_name: newContact.name.trim(), phone: newContact.type === 'individual' ? phone : null })
        .select('id')
        .single();
      if (error || !data) {
        setSaving(false);
        return setError(error?.message ?? 'Could not save the new contact.');
      }
      recipientId = data.id;
      await onRecipientsChange();
    }

    const row = {
      title: d.title.trim(),
      recipient_id: recipientId,
      message_template: d.message_template.trim(),
      rrule: timing.rrule,
      start_date: d.start_date,
      send_time: d.send_time,
      timezone: profile.timezone,
      skip_dates: d.skip_dates,
      delivery_mode: d.delivery_mode,
      active: true,
      next_run_at: firstSend.toISOString(),
      retry_count: 0,
    };
    const { error } = d.id ? await supabase.from('schedules').update(row).eq('id', d.id) : await supabase.from('schedules').insert(row);
    setSaving(false);
    if (error) return setError(error.message);
    discardDraft();
    onSaved();
  }

  async function remove() {
    if (!d.id || !confirm('Delete this message?')) return;
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

  const chip = (active: boolean) =>
    `flex min-h-12 shrink-0 items-center gap-2 rounded-full border py-1.5 pr-4 pl-1.5 text-[15px] font-semibold transition-colors duration-150 ${
      active ? 'border-primary bg-primary-soft text-primary-ink' : 'border-line bg-surface hover:bg-surface-2'
    }`;

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
          <button type="submit" form="schedule-form" className="btn-primary min-w-28 text-base" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="schedule-form" onSubmit={save} className="space-y-8" noValidate>
        {showRestored && (
          <div className="flex items-center gap-3 rounded-xl bg-info-soft px-3.5 py-2.5 text-sm text-info" role="status">
            <History className="size-4 shrink-0" aria-hidden />
            <span className="flex-1 font-medium">We kept your unsaved changes.</span>
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={() => {
                setD(initial);
                setShowRestored(false);
              }}
            >
              Start over
            </button>
          </div>
        )}

        <Step n={1} title="Who is it for?">
          <div ref={recipientRowRef} role="radiogroup" aria-label="Recipient" className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 scrollbar-none">
            {recipients.map((r) => (
              <button key={r.id} type="button" role="radio" aria-checked={r.id === d.recipient_id} onClick={() => set('recipient_id', r.id)} className={chip(r.id === d.recipient_id)}>
                <Avatar name={r.display_name} size="sm" />
                {r.display_name}
              </button>
            ))}
            <button type="button" role="radio" aria-checked={isNew} onClick={() => set('recipient_id', NEW)} className={`${chip(isNew)} pl-3`}>
              <Plus className="size-5" aria-hidden />
              New
            </button>
          </div>

          {isNew && (
            <div className="space-y-3 rounded-2xl bg-surface-2 p-3.5">
              <div role="radiogroup" aria-label="Person or group" className="grid grid-cols-2 gap-1 rounded-xl bg-bg p-1">
                {(['individual', 'group'] as RecipientType[]).map((t) => {
                  const active = newContact.type === t;
                  const Icon = t === 'individual' ? User : Users;
                  return (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setNewContact({ ...newContact, type: t })}
                      className={`flex min-h-10 items-center justify-center gap-2 rounded-lg text-sm font-semibold transition-colors duration-150 ${
                        active ? 'bg-surface text-fg shadow-sm' : 'text-muted'
                      }`}
                    >
                      <Icon className="size-4" aria-hidden />
                      {t === 'individual' ? 'A person' : 'A group'}
                    </button>
                  );
                })}
              </div>
              <div>
                <label className="label" htmlFor="new-name">
                  {newContact.type === 'group' ? 'Group name' : 'Name'}
                </label>
                <input
                  id="new-name"
                  className="field"
                  maxLength={100}
                  autoComplete="off"
                  placeholder={newContact.type === 'group' ? 'Family' : 'Mom'}
                  value={newContact.name}
                  onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                />
              </div>
              {newContact.type === 'individual' ? (
                <div>
                  <label className="label" htmlFor="new-phone">
                    WhatsApp number
                  </label>
                  <input
                    id="new-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    className="field"
                    placeholder="+1 573 555 0123"
                    value={newContact.phone}
                    onChange={(e) => setNewContact({ ...newContact, phone: e.target.value })}
                  />
                </div>
              ) : (
                <p className="text-sm leading-snug text-muted">Use the group you already have in WhatsApp. You'll pick it when you send.</p>
              )}
            </div>
          )}
        </Step>

        <Step n={2} title="What do you want to say?">
          <textarea
            id="message"
            ref={messageRef}
            aria-label="Message"
            className="field min-h-28 resize-none text-[17px] leading-relaxed"
            maxLength={2000}
            placeholder="Hey, are we still on for today?"
            value={d.message_template}
            onChange={(e) => set('message_template', e.target.value)}
          />
          {hasVariations && d.message_template.trim() && (
            <div className="rounded-2xl bg-surface-2 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="px-1 text-[13px] font-semibold text-muted">What they'll see</span>
                <button type="button" className="btn-ghost -my-1 min-h-9 px-2.5 text-[13px]" onClick={() => setSeed((s) => s + 1)}>
                  <Shuffle className="size-4" aria-hidden /> Another
                </button>
              </div>
              <div className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-tr-md bg-bubble px-3.5 py-2 text-[15px] leading-snug whitespace-pre-wrap text-bubble-fg shadow-sm">
                {preview}
              </div>
            </div>
          )}
        </Step>

        <Step n={3} title="When?">
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

          <div>
            <p className="label">Repeat</p>
            <Segmented label="Repeat" value={d.kind} options={repeatOptions} onChange={setKind} />
          </div>

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

          <p className={`rounded-xl px-3.5 py-3 text-[15px] font-medium ${firstSend ? 'bg-primary-soft text-primary-ink' : 'bg-danger-soft text-danger'}`}>
            {firstSend
              ? `${d.kind === 'once' ? 'Sends' : 'First one'}: ${dayWord(firstSend)} at ${firstSend.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
              : 'That time has already passed. Pick a later time.'}
          </p>
        </Step>

        {isGroup && d.delivery_mode === 'webpush_reminder' && (
          <p className="-mt-3 text-sm leading-snug text-muted">
            When it's time, tap the notification. WhatsApp opens with your message, then you pick “{recipientName}” and press send.
          </p>
        )}

        {/* Everything optional lives here so the main form stays short. */}
        <div className="border-t border-line pt-2">
          <button
            type="button"
            className="flex min-h-12 w-full items-center justify-between text-[15px] font-semibold text-muted hover:text-fg"
            aria-expanded={showMore}
            onClick={() => setShowMore((v) => !v)}
          >
            More options
            <ChevronDown className={`size-5 transition-transform duration-200 ${showMore ? 'rotate-180' : ''}`} aria-hidden />
          </button>

          {showMore && (
            <div className="space-y-6 pt-3">
              <div>
                <label className="label" htmlFor="title">
                  Nickname for this message
                </label>
                <input id="title" className="field" placeholder="e.g. Rent reminder" value={d.title} onChange={(e) => set('title', e.target.value)} />
              </div>

              <div>
                <p className="label">Make it personal</p>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => insert('{first_name}')} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-surface-2 px-3 text-[13px] font-semibold hover:bg-line">
                    <Plus className="size-3.5 text-muted" aria-hidden /> Their name
                  </button>
                  <button type="button" onClick={() => insert('{day}')} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-surface-2 px-3 text-[13px] font-semibold hover:bg-line">
                    <Plus className="size-3.5 text-muted" aria-hidden /> Day of the week
                  </button>
                  <button type="button" onClick={() => insert('{Hi|Hey|Hello}')} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-surface-2 px-3 text-[13px] font-semibold hover:bg-line">
                    <Shuffle className="size-3.5 text-muted" aria-hidden /> Random greeting
                  </button>
                </div>
                <p className="hint">“Random greeting” picks Hi, Hey or Hello each time so repeat messages don't look copy-pasted. Edit the words between the | marks to use your own.</p>
              </div>

              {d.kind !== 'once' && (
                <div>
                  <label className="label" htmlFor="skip">
                    Skip these dates
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
                    <p className="hint">Holidays or days off.</p>
                  )}
                </div>
              )}

              <fieldset>
                <legend className="label">How it's sent</legend>
                <div role="radiogroup" aria-label="How it's sent" className="space-y-2">
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
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          )}
        </div>

        <div ref={errorRef}>
          <ErrorText>{error}</ErrorText>
        </div>
      </form>
    </Sheet>
  );
}
