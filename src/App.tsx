import type { Session } from '@supabase/supabase-js';
import { ChevronLeft, Settings, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Spinner, useOnline } from './components/ui';
import { supabase, supabaseConfigured } from './lib/supabase';
import type { Profile, Recipient } from './lib/types';
import ContactsPage from './pages/ContactsPage';
import HistoryPage from './pages/HistoryPage';
import LoginPage from './pages/LoginPage';
import SchedulesPage from './pages/SchedulesPage';
import SettingsPage from './pages/SettingsPage';

export type View = 'home' | 'settings' | 'contacts' | 'history';

const TITLES: Record<View, string> = {
  home: 'TexMex',
  settings: 'Settings',
  contacts: 'People & groups',
  history: 'History',
};

const PARENT: Record<View, View | null> = { home: null, settings: 'home', contacts: 'settings', history: 'settings' };

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
  const [view, setView] = useState<View>('home');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const online = useOnline();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

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

  const parent = PARENT[view];

  return (
    <div className="mx-auto min-h-dvh max-w-2xl pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-20 bg-bg/90 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 backdrop-blur-md">
        <div className="flex min-h-12 items-center gap-1">
          {parent && (
            <button className="icon-btn -ml-2" onClick={() => setView(parent)} aria-label="Back">
              <ChevronLeft className="size-6" />
            </button>
          )}
          {view === 'home' && <img src="/icon.svg" alt="" className="mr-2 size-8" />}
          <h1 className="flex-1 text-2xl font-extrabold tracking-tight">{TITLES[view]}</h1>
          {view === 'home' && (
            <button className="icon-btn -mr-2" onClick={() => setView('settings')} aria-label="Settings">
              <Settings className="size-6" />
            </button>
          )}
        </div>
        {!online && (
          <p className="mt-2 flex items-center gap-2 rounded-xl bg-warn-soft px-3.5 py-2.5 text-sm font-medium text-warn" role="status">
            <WifiOff className="size-4 shrink-0" aria-hidden />
            You're offline. Changes will save when you're back online.
          </p>
        )}
      </header>

      <main className="px-4 pt-2">
        {!profile ? (
          <Spinner />
        ) : view === 'home' ? (
          <SchedulesPage profile={profile} recipients={recipients} onRecipientsChange={loadRecipients} />
        ) : view === 'contacts' ? (
          <ContactsPage recipients={recipients} onChange={loadRecipients} />
        ) : view === 'history' ? (
          <HistoryPage />
        ) : (
          <SettingsPage profile={profile} email={session.user.email ?? ''} recipientCount={recipients.length} onProfileChange={setProfile} onNavigate={setView} />
        )}
      </main>
    </div>
  );
}

function SetupNotice() {
  return (
    <div className="mx-auto max-w-md p-6">
      <div className="card space-y-3 p-5">
        <h1 className="text-xl font-bold">Almost there</h1>
        <p className="text-sm leading-relaxed text-muted">
          Copy <code>.env.example</code> to <code>.env.local</code> and fill in your Supabase URL, anon key and VAPID public key, then
          restart <code>npm run dev</code>. See the README for the full setup.
        </p>
      </div>
    </div>
  );
}
