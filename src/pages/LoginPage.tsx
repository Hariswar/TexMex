import { ArrowLeft, Bell, CalendarClock, Mail, MailCheck, Repeat2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ErrorText, IconBubble } from '../components/ui';
import { supabase } from '../lib/supabase';

const FEATURES = [
  { icon: CalendarClock, text: 'Schedule once, daily, weekly or monthly' },
  { icon: Bell, text: 'Get a reminder, then send with one tap' },
  { icon: Repeat2, text: 'Random variations so messages feel personal' },
];

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState('sending');
    setError('');
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } });
    if (error) {
      setError(error.message);
      setState('idle');
    } else {
      setState('sent');
    }
  }

  return (
    <div className="flex min-h-dvh flex-col px-5 pt-[max(3rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">
        <img src="/icon.svg" alt="" className="mb-6 size-16" />
        <h1 className="text-[32px] leading-tight font-extrabold tracking-tight">TexMex</h1>
        <p className="mt-2 text-base leading-relaxed text-muted">Schedule messages to anyone. Never forget to send one again.</p>

        {state === 'sent' ? (
          <div className="card mt-8 p-5">
            <IconBubble icon={MailCheck} tone="success" size="lg" />
            <p className="mt-4 text-lg font-bold">Check your email</p>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              We sent a sign-in link to <span className="font-semibold text-fg">{email}</span>. Open it on this device to continue. It might be in
              spam.
            </p>
            <button className="btn-ghost mt-4 -ml-3" onClick={() => setState('idle')}>
              <ArrowLeft className="size-4.5" aria-hidden /> Use a different email
            </button>
          </div>
        ) : (
          <>
            <ul className="mt-8 space-y-3">
              {FEATURES.map((f) => (
                <li key={f.text} className="flex items-center gap-3 text-[15px] font-medium">
                  <IconBubble icon={f.icon} size="sm" />
                  {f.text}
                </li>
              ))}
            </ul>

            <form onSubmit={submit} className="mt-10 space-y-3">
              <label className="label" htmlFor="email">
                Email
              </label>
              <div className="relative">
                <Mail className="pointer-events-none absolute top-1/2 left-3.5 size-4.5 -translate-y-1/2 text-muted" aria-hidden />
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                  className="field pl-10"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <ErrorText>{error}</ErrorText>
              <button className="btn-primary min-h-12 w-full text-base" disabled={state === 'sending'}>
                {state === 'sending' ? 'Sending…' : 'Send email'}
              </button>
              <p className="text-center text-[13px] text-muted">We'll email you a link to sign in. No password needed.</p>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
