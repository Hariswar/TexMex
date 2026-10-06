import type { Session } from '@supabase/supabase-js';
import { CalendarClock, History, Settings, Users, WifiOff, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Spinner, useOnline } from './components/ui';
import { supabase, supabaseConfigured } from './lib/supabase';
import type { Profile, Recipient } from './lib/types';
import ContactsPage from './pages/ContactsPage';
import HistoryPage from './pages/HistoryPage';
import LoginPage from './pages/LoginPage';
import SchedulesPage from './pages/SchedulesPage';
import SettingsPage from './pages/SettingsPage';

type Tab = 'schedules' | 'contacts' | 'history' | 'settings';

const TABS: { id: Tab; label: string; title: string; icon: LucideIcon }[] = [
  { id: 'schedules', label: 'Messages', title: 'Scheduled', icon: CalendarClock },
  { id: 'contacts', label: 'Contacts', title: 'Contacts', icon: Users },
  { id: 'history', label: 'Activity', title: 'Activity', icon: History },
  { id: 'settings', label: 'Settings', title: 'Settings', icon: Settings },
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
  const [subtitle, setSubtitle] = useState<ReactNode>(null);
  const online = useOnline();

  useEffect(() => {
    sessionStorage.setItem('texmex:tab', tab);
    setSubtitle(null);
    window.scrollTo(0, 0);
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

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <div className="mx-auto min-h-dvh max-w-2xl pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-20 bg-bg/90 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3 backdrop-blur-md">
        <h1 className="text-[28px] leading-tight font-extrabold tracking-tight">{current.title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        {!online && (
          <p className="mt-3 flex items-center gap-2 rounded-xl bg-warn-soft px-3.5 py-2.5 text-sm font-medium text-warn" role="status">
            <WifiOff className="size-4 shrink-0" aria-hidden />
            You're offline. Drafts are kept on this device.
          </p>
        )}
      </header>

      <main className="px-4 pt-2">
        {!profile ? (
          <Spinner />
        ) : tab === 'schedules' ? (
          <SchedulesPage profile={profile} recipients={recipients} onGoToContacts={() => setTab('contacts')} setSubtitle={setSubtitle} />
        ) : tab === 'contacts' ? (
          <ContactsPage recipients={recipients} onChange={loadRecipients} setSubtitle={setSubtitle} />
        ) : tab === 'history' ? (
          <HistoryPage />
        ) : (
          <SettingsPage profile={profile} email={session.user.email ?? ''} onProfileChange={setProfile} />
        )}
      </main>

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md"
      >
        <div className="mx-auto grid max-w-2xl grid-cols-4 px-2">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-semibold transition-colors duration-150 ${
                  active ? 'text-primary-ink' : 'text-muted hover:text-fg'
                }`}
              >
                <span className={`flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-200 ${active ? 'bg-primary-soft' : ''}`}>
                  <t.icon className="size-5.5" strokeWidth={active ? 2.3 : 2} aria-hidden />
                </span>
                {t.label}
              </button>
            );
          })}
        </div>
      </nav>
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
