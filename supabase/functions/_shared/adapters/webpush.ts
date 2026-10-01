import webpush from 'npm:web-push@3.6.7';
import { whatsappLink } from '../whatsapp.ts';
import type { DeliveryAdapter, DeliveryContext } from './types.ts';

let configured = false;

function configure() {
  if (configured) return;
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  );
  configured = true;
}

/** Sends the reminder push to every device the user enabled. Shared by snooze re-delivery. */
export async function sendReminderPush(ctx: DeliveryContext): Promise<void> {
  configure();
  const { db, schedule, recipient, message, logId, actionToken } = ctx;

  const { data: subs, error } = await db
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', schedule.user_id);
  if (error) throw new Error(`Loading push subscriptions: ${error.message}`);
  if (!subs?.length) throw new Error('No devices have notifications enabled (Settings → Enable notifications)');

  const payload = JSON.stringify({
    title: schedule.title || `Message ${recipient.display_name}`,
    body: message,
    url: whatsappLink(recipient, message),
    isGroup: recipient.type === 'group',
    recipientName: recipient.display_name,
    logId,
    token: actionToken,
    actionUrl: `${Deno.env.get('SUPABASE_URL')}/functions/v1/action`,
    tag: `schedule-${schedule.id}`,
  });

  const results = await Promise.allSettled(
    subs.map((s) =>
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
        TTL: 60 * 60,
        urgency: 'high',
      }),
    ),
  );

  const expired: string[] = [];
  results.forEach((r, i) => {
    const code = r.status === 'rejected' ? (r.reason as { statusCode?: number })?.statusCode : undefined;
    if (code === 404 || code === 410) expired.push(subs[i].id);
  });
  if (expired.length) await db.from('push_subscriptions').delete().in('id', expired);

  if (!results.some((r) => r.status === 'fulfilled')) {
    const reason = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    throw new Error(`Push failed on all devices: ${reason?.reason?.body ?? reason?.reason?.message ?? 'unknown'}`);
  }
}

export const webPushReminderAdapter: DeliveryAdapter = {
  mode: 'webpush_reminder',
  async deliver(ctx) {
    await sendReminderPush(ctx);
    return { status: 'reminded' };
  },
};
