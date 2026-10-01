import { useEffect, useMemo, useState } from 'react';
import { ErrorText } from '../components/ui';
import { nextRunAt } from '../../supabase/functions/_shared/recurrence.ts';
import { disablePush, enablePush, getPushState, isIos, type PushState } from '../lib/push';
import { supabase } from '../lib/supabase';
import type { Profile, Schedule } from '../lib/types';

interface Props {
  profile: Profile;
  email: string;
  onProfileChange: (p: Profile) => void;
}

const PUSH_COPY: Record<PushState, string> = {
  on: 'Notifications are on for this device.',
  off: 'Turn on notifications so this device gets the one-tap reminder at send time.',
  denied: 'Notifications are blocked. Allow them in your browser or system settings, then reload.',
  unsupported: "This browser doesn't support web push.",
  'needs-install': 'On iPhone, first tap Share → “Add to Home Screen”, then open TexMex from the home screen to turn on notifications.',
};

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
    setTzMessage(`Moved ${data?.length ?? 0} schedule(s) to ${timezone}.`);
  }

  return (
    <div className="space-y-4">
      <section className="card space-y-3">
        <h2 className="font-semibold">Notifications</h2>
        <p className="text-sm text-stone-600 dark:text-stone-400">{push ? PUSH_COPY[push] : 'Checking…'}</p>
        {(push === 'on' || push === 'off') && (
          <button className={push === 'on' ? 'btn-secondary' : 'btn-primary'} onClick={togglePush} disabled={busy}>
            {busy ? 'Working…' : push === 'on' ? 'Turn off on this device' : 'Enable notifications'}
          </button>
        )}
        {isIos() && push === 'on' && (
          <p className="text-xs text-stone-500">iOS doesn't show notification buttons. Tap the notification to open WhatsApp.</p>
        )}
      </section>

      <section className="card space-y-2">
        <h2 className="font-semibold">Time zone</h2>
        <select className="field" value={profile.timezone} onChange={(e) => changeTimezone(e.target.value)}>
          {timezones.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <p className="text-xs text-stone-500 dark:text-stone-400">
          Messages fire at their local time in this zone, and daylight saving is handled for you.
        </p>
        {tzMessage && <p className="text-sm text-brand-700 dark:text-brand-500">{tzMessage}</p>}
      </section>

      <ErrorText>{error}</ErrorText>

      <section className="card flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-stone-500 dark:text-stone-400">Signed in as</p>
          <p className="truncate font-medium">{email}</p>
        </div>
        <button className="btn-secondary shrink-0" onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </section>
    </div>
  );
}
