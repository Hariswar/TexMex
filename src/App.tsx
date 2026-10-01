import type { Session } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import { Spinner, useOnline } from './components/ui';
import { supabase, supabaseConfigured } from './lib/supabase';
import type { Profile, Recipient } from './lib/types';
import ContactsPage from './pages/ContactsPage';
import HistoryPage from './pages/HistoryPage';
import LoginPage from './pages/LoginPage';
import SchedulesPage from './pages/SchedulesPage';
import SettingsPage from './pages/SettingsPage';

type Tab = 'schedules' | 'contacts' | 'history' | 'settings';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'schedules', label: 'Schedules', icon: '🗓️' },
  { id: 'contacts', label: 'Contacts', icon: '👥' },
  { id: 'history', label: 'Activity', icon: '📜' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!supabaseConfigured) return <SetupNotice />;
  if (session === undefined) return <Spinner />;
  if (!session) return <LoginPage />;
  return <Shell session={session} />;
}

function Shell({ session }: { session: Session }) {
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem('texmex:tab') as Tab) || 'schedules');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const online = useOnline();

  useEffect(() => {
    sessionStorage.setItem('texmex:tab', tab);
  }, [tab]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('profiles').select('id, name, timezone').eq('id', session.user.id).single();
      if (!data) return;
      // First run: adopt the device's timezone instead of the UTC default.
      const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (data.timezone === 'UTC' && deviceTz && deviceTz !== 'UTC') {
        await supabase.from('profiles').update({ timezone: deviceTz }).eq('id', data.id);
        data.timezone = deviceTz;
      }
      setProfile(data as Profile);
    })();
  }, [session.user.id]);

  const loadRecipients = useCallback(async () => {
    const { data } = await supabase.from('recipients').select('*').order('display_name');
    if (data) setRecipients(data as Recipient[]);
  }, []);

  useEffect(() => {
    loadRecipients();
  }, [loadRecipients]);

  return (
    <div className="mx-auto min-h-dvh max-w-2xl pb-28">
      <header className="sticky top-0 z-20 border-b border-stone-200/70 bg-stone-50/85 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur dark:border-stone-800/70 dark:bg-stone-950/85">
        <div className="flex items-center gap-2.5">
          <img src="/icon.svg" alt="" className="h-8 w-8" />
          <h1 className="text-xl font-bold tracking-tight">{TABS.find((t) => t.id === tab)!.label}</h1>
        </div>
        {!online && (
          <p className="mt-2 rounded-lg bg-amber-100 px-3 py-1.5 text-sm text-amber-800 dark:bg-amber-500/20 dark:text-amber-200">
            You're offline. You can keep drafting; saving will work once you're back online.
          </p>
        )}
      </header>

      <main className="px-4 pt-4">
        {!profile ? (
          <Spinner />
        ) : tab === 'schedules' ? (
          <SchedulesPage profile={profile} recipients={recipients} onGoToContacts={() => setTab('contacts')} />
        ) : tab === 'contacts' ? (
          <ContactsPage recipients={recipients} onChange={loadRecipients} />
        ) : tab === 'history' ? (
          <HistoryPage />
        ) : (
          <SettingsPage profile={profile} email={session.user.email ?? ''} onProfileChange={setProfile} />
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-stone-800 dark:bg-stone-950/90">
        <div className="mx-auto grid max-w-2xl grid-cols-4">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition ${
                tab === t.id ? 'text-brand-600' : 'text-stone-500 dark:text-stone-400'
              }`}
              aria-current={tab === t.id ? 'page' : undefined}
            >
              <span className={`text-xl transition ${tab === t.id ? '' : 'opacity-60 grayscale'}`}>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function SetupNotice() {
  return (
    <div className="mx-auto max-w-md p-6">
      <div className="card space-y-3">
        <h1 className="text-xl font-bold">Almost there</h1>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          Copy <code>.env.example</code> to <code>.env.local</code> and fill in your Supabase URL, anon key and VAPID public key, then
          restart <code>npm run dev</code>. See the README for the full setup.
        </p>
      </div>
    </div>
  );
}
