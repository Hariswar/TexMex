import type { DeliveryAdapter } from './types.ts';

// Telegram's Bot API officially supports bots posting into groups, so this adapter sends automatically.
// Add the bot to the group, then put the group's chat id (e.g. -1001234567890) on the recipient.
export const telegramAdapter: DeliveryAdapter = {
  mode: 'telegram',
  async deliver({ recipient, message }) {
    const token = Deno.env.get('TELEGRAM_BOT_TOKEN');
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not configured');
    if (!recipient.telegram_chat_id) throw new Error(`${recipient.display_name} has no Telegram chat id`);

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: recipient.telegram_chat_id, text: message }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.ok) throw new Error(`Telegram ${res.status}: ${body.description ?? 'request failed'}`);
    return { status: 'sent', detail: `message_id ${body.result?.message_id}` };
  },
};
