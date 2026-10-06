import { ChevronRight, Info, Phone, Send, Trash2, User, UserPlus, Users } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Avatar, Badge, EmptyState, ErrorText, Sheet } from '../components/ui';
import { supabase } from '../lib/supabase';
import type { Recipient, RecipientType } from '../lib/types';

interface Props {
  recipients: Recipient[];
  onChange: () => void;
  setSubtitle: (node: ReactNode) => void;
}

type Draft = Pick<Recipient, 'type' | 'display_name'> & { id?: string; phone: string; telegram_chat_id: string };

const empty: Draft = { type: 'individual', display_name: '', phone: '', telegram_chat_id: '' };

export default function ContactsPage({ recipients, onChange, setSubtitle }: Props) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const people = recipients.filter((r) => r.type === 'individual');
  const groups = recipients.filter((r) => r.type === 'group');

  useEffect(() => {
    setSubtitle(recipients.length ? `${people.length} ${people.length === 1 ? 'person' : 'people'} · ${groups.length} ${groups.length === 1 ? 'group' : 'groups'}` : null);
  }, [recipients.length, people.length, groups.length, setSubtitle]);

  const open = (r: Recipient) =>
    setEditing({ id: r.id, type: r.type, display_name: r.display_name, phone: r.phone ?? '', telegram_chat_id: r.telegram_chat_id ?? '' });

  return (
    <div className="space-y-6">
      <button className="btn-primary w-full" onClick={() => setEditing({ ...empty })}>
        <UserPlus className="size-4.5" aria-hidden /> Add person or group
      </button>

      {recipients.length === 0 ? (
        <EmptyState icon={Users} title="No contacts yet">
          Add a person by their WhatsApp number, or a group like “Family” or “Roommates”.
        </EmptyState>
      ) : (
        <>
          {groups.length > 0 && <ContactList title="Groups" items={groups} onOpen={open} />}
          {people.length > 0 && <ContactList title="People" items={people} onOpen={open} />}
        </>
      )}

      {editing && (
        <ContactEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChange();
          }}
        />
      )}
    </div>
  );
}

function ContactList({ title, items, onOpen }: { title: string; items: Recipient[]; onOpen: (r: Recipient) => void }) {
  return (
    <section>
      <h2 className="section-title">{title}</h2>
      <ul className="card divide-y divide-line overflow-hidden">
        {items.map((r) => (
          <li key={r.id}>
            <button className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 active:bg-surface-2" onClick={() => onOpen(r)}>
              <Avatar name={r.display_name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{r.display_name}</span>
                <span className="block truncate text-sm text-muted">
                  {r.type === 'group' ? 'WhatsApp group' : r.phone ? formatPhone(r.phone) : 'No phone number'}
                </span>
              </span>
              {r.telegram_chat_id && (
                <Badge tone="info" icon={Send}>
                  Telegram
                </Badge>
              )}
              <ChevronRight className="size-5 shrink-0 text-muted" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatPhone(p: string): string {
  const d = p.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return p.startsWith('+') ? p : `+${d}`;
}

function ContactEditor({ initial, onClose, onSaved }: { initial: Draft; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState(initial);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!d.display_name.trim()) return setError('Give this contact a name.');
    const phone = d.phone.replace(/[^\d+]/g, '');
    if (d.type === 'individual' && phone.replace(/\D/g, '').length < 7) {
      return setError('Enter the full number with country code, e.g. +1 573 555 0123.');
    }
    setSaving(true);
    const row = {
      type: d.type,
      display_name: d.display_name.trim(),
      phone: d.type === 'individual' ? phone : null,
      telegram_chat_id: d.telegram_chat_id.trim() || null,
    };
    const { error } = d.id ? await supabase.from('recipients').update(row).eq('id', d.id) : await supabase.from('recipients').insert(row);
    setSaving(false);
    if (error) setError(error.message);
    else onSaved();
  }

  async function remove() {
    if (!d.id || !confirm(`Delete ${d.display_name}? Their scheduled messages will be deleted too.`)) return;
    const { error } = await supabase.from('recipients').delete().eq('id', d.id);
    if (error) setError(error.message);
    else onSaved();
  }

  return (
    <Sheet
      title={d.id ? 'Edit contact' : 'New contact'}
      onClose={onClose}
      footer={
        <>
          {d.id && (
            <button type="button" className="btn-danger px-3" onClick={remove}>
              <Trash2 className="size-4.5" aria-hidden /> Delete
            </button>
          )}
          <div className="flex-1" />
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="contact-form" className="btn-primary min-w-24" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="contact-form" onSubmit={save} className="space-y-5" noValidate>
        <div role="radiogroup" aria-label="Contact type" className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1">
          {(['individual', 'group'] as RecipientType[]).map((t) => {
            const active = d.type === t;
            const Icon = t === 'individual' ? User : Users;
            return (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setD({ ...d, type: t })}
                className={`flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors duration-150 ${
                  active ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg'
                }`}
              >
                <Icon className="size-4" aria-hidden />
                {t === 'individual' ? 'Person' : 'Group'}
              </button>
            );
          })}
        </div>

        <div>
          <label className="label" htmlFor="name">
            Name
          </label>
          <input
            id="name"
            className="field"
            maxLength={100}
            autoComplete="off"
            placeholder={d.type === 'group' ? 'Family' : 'Alex'}
            value={d.display_name}
            onChange={(e) => setD({ ...d, display_name: e.target.value })}
          />
        </div>

        {d.type === 'individual' ? (
          <div>
            <label className="label" htmlFor="phone">
              WhatsApp number
            </label>
            <div className="relative">
              <Phone className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-muted" aria-hidden />
              <input
                id="phone"
                type="tel"
                className="field pl-10"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+1 573 555 0123"
                value={d.phone}
                onChange={(e) => setD({ ...d, phone: e.target.value })}
              />
            </div>
            <p className="hint">Include the country code.</p>
          </div>
        ) : (
          <div className="flex gap-3 rounded-2xl bg-info-soft p-3.5 text-sm leading-relaxed text-info">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              Use your existing WhatsApp group; nothing changes in WhatsApp. When a reminder fires, WhatsApp opens with your message ready and
              you pick this group. For fully automatic group messages, use Telegram.
            </p>
          </div>
        )}

        <div>
          <label className="label" htmlFor="tg">
            Telegram chat ID <span className="font-normal text-muted">(optional)</span>
          </label>
          <input
            id="tg"
            className="field font-mono text-[15px]"
            placeholder="-1001234567890"
            value={d.telegram_chat_id}
            onChange={(e) => setD({ ...d, telegram_chat_id: e.target.value })}
          />
          <p className="hint">Only needed for automatic Telegram delivery. Add your bot to the chat, then paste its numeric ID (see the README).</p>
        </div>

        <ErrorText>{error}</ErrorText>
      </form>
    </Sheet>
  );
}
