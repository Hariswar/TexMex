import { telegramAdapter } from './telegram.ts';
import type { DeliveryAdapter } from './types.ts';
import { webPushReminderAdapter } from './webpush.ts';

// Register new channels here (SMS via Twilio, email, ...) and add the mode to the
// `delivery_mode` enum in a migration.
const adapters: Record<string, DeliveryAdapter> = {
  [webPushReminderAdapter.mode]: webPushReminderAdapter,
  [telegramAdapter.mode]: telegramAdapter,
};

export function getAdapter(mode: string): DeliveryAdapter {
  const adapter = adapters[mode];
  if (!adapter) throw new Error(`No delivery adapter for mode "${mode}"`);
  return adapter;
}
