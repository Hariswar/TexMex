import { supabase } from './supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export type PushState = 'unsupported' | 'needs-install' | 'no-worker' | 'denied' | 'off' | 'on';

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

/** serviceWorker.ready never settles if registration failed, so give up after a few seconds. */
async function workerRegistration(timeoutMs = 5000): Promise<ServiceWorkerRegistration | null> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert(
    { endpoint: sub.endpoint, p256dh: json.keys!.p256dh, auth: json.keys!.auth, user_agent: navigator.userAgent },
    { onConflict: 'endpoint' },
  );
  if (error) throw new Error(`Couldn't save this device: ${error.message}`);
}

/**
 * "on" means the browser is subscribed AND the server knows about it — reminders are sent to the
 * server's list, so a browser-only subscription would silently receive nothing.
 */
export async function getPushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    // iOS only exposes Web Push to PWAs added to the home screen.
    return isIos() && !isStandalone() ? 'needs-install' : 'unsupported';
  }
  if (Notification.permission === 'denied') return 'denied';
  const reg = await workerRegistration();
  if (!reg) return 'no-worker';
  const sub = await reg.pushManager.getSubscription();
  if (!sub || Notification.permission !== 'granted') return 'off';

  const { data, error } = await supabase.from('push_subscriptions').select('id').eq('endpoint', sub.endpoint).maybeSingle();
  if (error) return 'off';
  if (!data) {
    try {
      await saveSubscription(sub); // repair: subscribed in the browser but never saved
    } catch {
      return 'off';
    }
  }
  return 'on';
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function enablePush(): Promise<void> {
  if (!VAPID_PUBLIC_KEY) throw new Error('The app is missing its notification key (VITE_VAPID_PUBLIC_KEY).');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('You need to click “Allow” when the browser asks about notifications.');

  const reg = await workerRegistration();
  if (!reg) throw new Error("The app's background service didn't start. Reload the page and try again.");
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }));
  await saveSubscription(sub);
}

export async function disablePush(): Promise<void> {
  const reg = await workerRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

/** Asks the server to push a sample notification to all of this user's devices. */
export async function sendTestPush(): Promise<number> {
  const { data, error } = await supabase.functions.invoke<{ devices?: number; error?: string }>('test-push', { method: 'POST' });
  if (error) {
    // FunctionsHttpError carries the JSON body in `context`.
    const body = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(body?.error ?? error.message);
  }
  return data?.devices ?? 0;
}
