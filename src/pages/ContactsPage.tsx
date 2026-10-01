import { useState, type FormEvent } from 'react';
import { Badge, EmptyState, ErrorText, Sheet } from '../components/ui';
import { supabase } from '../lib/supabase';
import type { Recipient, RecipientType } from '../lib/types';

interface Props {
  recipients: Recipient[];
  onChange: () => void;
}

type Draft = Pick<Recipient, 'type' | 'display_name'> & { id?: string; phone: string; telegram_chat_id: string };

const empty: Draft = { type: 'individual', display_name: '', phone: '', telegram_chat_id: '' };

export default function ContactsPage({ recipients, onChange }: Props) {
  const [editing, setEditing] = useState<Draft | null>(null);

  return (
    <div className="space-y-3">
      {recipients.length === 0 ? (
        <EmptyState icon="👥" title="No contacts yet">
          Add a person by phone number, or a group like “Family” or “Roommates”.
        </EmptyState>
      ) : (
        <ul className="card divide-y divide-stone-100 p-0 dark:divide-stone-800">
          {recipients.map((r) => (
            <li key={r.id}>
              <button
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
                onClick={() =>
                  setEditing({ id: r.id, type: r.type, display_name: r.display_name, phone: r.phone ?? '', telegram_chat_id: r.telegram_chat_id ?? '' })
                }
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-lg dark:bg-brand-700/25">
                  {r.type === 'group' ? '👥' : '👤'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{r.display_name}</span>
                  <span className="block truncate text-sm text-stone-500 dark:text-stone-400">
                    {r.type === 'group' ? 'Group' : r.phone || 'No phone'}
                  </span>
                </span>
                {r.telegram_chat_id && <Badge color="blue">Telegram</Badge>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <button className="btn-primary w-full" onClick={() => setEditing({ ...empty })}>
        + Add contact or group
      </button>

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

function ContactEditor({ initial, onClose, onSaved }: { initial: Draft; onClose: () => void; onSaved: () => void }) {
  const [d, setD] = useState(initial);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const phone = d.phone.replace(/[^\d+]/g, '');
    if (d.type === 'individual' && phone.replace(/\D/g, '').length < 7) {
      setError('Enter the full number with country code, e.g. +1 573 555 0123.');
      return;
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
    <Sheet title={d.id ? 'Edit contact' : 'New contact'} onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-2 rounded-xl bg-stone-100 p-1 dark:bg-stone-800">
          {(['individual', 'group'] as RecipientType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setD({ ...d, type: t })}
              className={`rounded-lg py-2 text-sm font-semibold transition ${d.type === t ? 'bg-white shadow-sm dark:bg-stone-700' : 'text-stone-500'}`}
            >
              {t === 'individual' ? '👤 Person' : '👥 Group'}
            </button>
          ))}
        </div>

        <div>
          <label className="label" htmlFor="name">
            Name
          </label>
          <input
            id="name"
            className="field"
            required
            maxLength={100}
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
            <input
              id="phone"
              type="tel"
              className="field"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+1 573 555 0123"
              value={d.phone}
              onChange={(e) => setD({ ...d, phone: e.target.value })}
            />
          </div>
        ) : (
          <p className="rounded-xl bg-stone-100 px-3 py-2 text-sm text-stone-600 dark:bg-stone-800 dark:text-stone-300">
            WhatsApp links can't target a group directly. When the reminder fires, WhatsApp opens with your message ready and you pick
            this group. For fully automatic group messages, use Telegram.
          </p>
        )}

        <div>
          <label className="label" htmlFor="tg">
            Telegram chat id <span className="font-normal text-stone-400">(optional)</span>
          </label>
          <input
            id="tg"
            className="field font-mono"
            placeholder="-1001234567890"
            value={d.telegram_chat_id}
            onChange={(e) => setD({ ...d, telegram_chat_id: e.target.value })}
          />
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">Add your bot to the chat, then use the chat's numeric id (see README).</p>
        </div>

        <ErrorText>{error}</ErrorText>

        <div className="flex items-center gap-2">
          {d.id && (
            <button type="button" className="btn-danger" onClick={remove}>
              Delete
            </button>
          )}
          <div className="flex-1" />
          <button type="button" className="btn-ghost" onClick={onClose}>
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
