import { BellOff, BellRing, ChevronDown, Globe, LogOut, Share, Smartphone, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Avatar, ErrorText, IconBubble, Switch, type Tone } from '../components/ui';
import { nextRunAt } from '../../supabase/functions/_shared/recurrence.ts';
import { disablePush, enablePush, getPushState, isIos, type PushState } from '../lib/push';
import { supabase } from '../lib/supabase';
import type { Profile, Schedule } from '../lib/types';

interface Props {
  profile: Profile;
  email: string;
  onProfileChange: (p: Profile) => void;
}

const PUSH: Record<PushState, { title: string; body: string; icon: LucideIcon; tone: Tone }> = {
  on: { title: 'Notifications on', body: 'This device gets your reminders.', icon: BellRing, tone: 'success' },
  off: { title: 'Notifications off', body: 'Turn on to get the one-tap reminder at send time.', icon: BellOff, tone: 'warn' },
  denied: { title: 'Notifications blocked', body: 'Allow notifications for this site in your browser or system settings, then reload.', icon: BellOff, tone: 'danger' },
  unsupported: { title: 'Not supported', body: "This browser can't receive web push notifications.", icon: BellOff, tone: 'neutral' },
  'needs-install': { title: 'Add to Home Screen first', body: 'On iPhone, notifications only work for apps on the Home Screen.', icon: Smartphone, tone: 'warn' },
};

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="section-title">{title}</h2>
      <div className="card divide-y divide-line overflow-hidden">{children}</div>
    </section>
  );
}

export default function SettingsPage({ profile, email, onProfileChange }: Props) {
  const [push, setPush] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tzMessage, setTzMessage] = useState('');

  const timezones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
    } catch {
      return [profile.timezone];
    }
  }, [profile.timezone]);

  useEffect(() => {
    getPushState().then(setPush);
  }, []);

  async function togglePush() {
    setBusy(true);
    setError('');
    try {
      if (push === 'on') await disablePush();
      else await enablePush();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setPush(await getPushState());
    setBusy(false);
  }

  async function changeTimezone(timezone: string) {
    setError('');
    setTzMessage('');
    const { error } = await supabase.from('profiles').update({ timezone }).eq('id', profile.id);
    if (error) return setError(error.message);
    onProfileChange({ ...profile, timezone });

    // Keep "2 PM" meaning 2 PM in the new zone for every schedule.
    const { data } = await supabase.from('schedules').select('*');
    const now = new Date();
    await Promise.all(
      ((data ?? []) as Schedule[]).map((s) => {
        const next = nextRunAt({ ...s, timezone }, now);
        return supabase
          .from('schedules')
          .update({ timezone, next_run_at: next?.toISOString() ?? null, ...(next ? {} : { active: false }) })
          .eq('id', s.id);
      }),
    );
    setTzMessage(`Moved ${data?.length ?? 0} message${data?.length === 1 ? '' : 's'} to the new time zone.`);
  }

  const p = push ? PUSH[push] : null;

  return (
    <div className="space-y-7">
      <Group title="Notifications">
        <div className="flex items-center gap-3 px-4 py-3.5">
          {p ? <IconBubble icon={p.icon} tone={p.tone} /> : <span className="size-10" />}
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{p?.title ?? 'Checking…'}</p>
            <p className="text-sm leading-snug text-muted">{p?.body}</p>
          </div>
          {(push === 'on' || push === 'off') && (
            <Switch checked={push === 'on'} onChange={() => !busy && togglePush()} label="Notifications on this device" />
          )}
        </div>
        {push === 'needs-install' && (
          <ol className="space-y-2 px-4 py-3.5 text-sm">
            <li className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-surface-2 text-xs font-bold">1</span>
              Tap <Share className="size-4" aria-label="Share" /> in Safari
            </li>
            <li className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-surface-2 text-xs font-bold">2</span>
              Choose “Add to Home Screen”
            </li>
            <li className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-surface-2 text-xs font-bold">3</span>
              Open TexMex from your Home Screen
            </li>
          </ol>
        )}
        {isIos() && push === 'on' && (
          <p className="px-4 py-3 text-[13px] text-muted">iPhone doesn't show notification buttons. Tap the notification to open WhatsApp.</p>
        )}
      </Group>

      <Group title="Time zone">
        <label className="flex items-center gap-3 px-4 py-3.5" htmlFor="tz">
          <IconBubble icon={Globe} tone="neutral" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm text-muted">Messages send at local time in</span>
            <span className="relative block">
              <select
                id="tz"
                className="w-full appearance-none bg-transparent pr-6 font-semibold text-fg outline-none"
                value={profile.timezone}
                onChange={(e) => changeTimezone(e.target.value)}
              >
                {timezones.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-0 size-4 -translate-y-1/2 text-muted" aria-hidden />
            </span>
          </span>
        </label>
        {tzMessage && (
          <p className="px-4 py-3 text-sm font-medium text-success" role="status">
            {tzMessage}
          </p>
        )}
      </Group>

      <ErrorText>{error}</ErrorText>

      <Group title="Account">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <Avatar name={profile.name || email} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{profile.name || 'Signed in'}</p>
            <p className="truncate text-sm text-muted">{email}</p>
          </div>
        </div>
        <button
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left font-semibold text-danger transition-colors duration-150 hover:bg-danger-soft"
          onClick={() => supabase.auth.signOut()}
        >
          <span className="flex size-10 items-center justify-center">
            <LogOut className="size-5" aria-hidden />
          </span>
          Sign out
        </button>
      </Group>
    </div>
  );
}
