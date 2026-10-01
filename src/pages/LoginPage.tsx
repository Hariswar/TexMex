import { useState, type FormEvent } from 'react';
import { ErrorText } from '../components/ui';
import { supabase } from '../lib/supabase';

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
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/icon.svg" alt="" className="mx-auto mb-4 h-16 w-16" />
          <h1 className="text-3xl font-bold tracking-tight">TexMex</h1>
          <p className="mt-1 text-stone-500 dark:text-stone-400">Schedule messages to anyone. Never forget to send one again.</p>
        </div>

        {state === 'sent' ? (
          <div className="card text-center">
            <div className="mb-2 text-3xl">📬</div>
            <p className="font-semibold">Check your email</p>
            <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
              We sent a sign-in link to <span className="font-medium text-stone-800 dark:text-stone-200">{email}</span>.
            </p>
            <button className="btn-ghost mt-3" onClick={() => setState('idle')}>
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="card space-y-3">
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              className="field"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <ErrorText>{error}</ErrorText>
            <button className="btn-primary w-full" disabled={state === 'sending'}>
              {state === 'sending' ? 'Sending…' : 'Send email'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
