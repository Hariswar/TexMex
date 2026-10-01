export type RecipientType = 'individual' | 'group';
export type DeliveryMode = 'webpush_reminder' | 'telegram';
export type DeliveryStatus = 'sent' | 'reminded' | 'failed' | 'skipped' | 'snoozed';

export interface Profile {
  id: string;
  name: string | null;
  timezone: string;
}

export interface Recipient {
  id: string;
  type: RecipientType;
  display_name: string;
  phone: string | null;
  whatsapp_chat_id: string | null;
  telegram_chat_id: string | null;
  created_at: string;
}

export interface Schedule {
  id: string;
  recipient_id: string;
  title: string;
  message_template: string;
  rrule: string | null;
  start_date: string;
  send_time: string;
  timezone: string;
  skip_dates: string[];
  delivery_mode: DeliveryMode;
  active: boolean;
  next_run_at: string | null;
  created_at: string;
}

export interface DeliveryLog {
  id: string;
  schedule_id: string;
  fired_at: string;
  status: DeliveryStatus;
  message: string | null;
  error: string | null;
  opened_at: string | null;
  schedules: { title: string; recipients: { display_name: string } | null } | null;
}

export const DELIVERY_MODE_LABELS: Record<DeliveryMode, string> = {
  webpush_reminder: 'WhatsApp — remind me, one tap to send',
  telegram: 'Telegram — send automatically',
};
