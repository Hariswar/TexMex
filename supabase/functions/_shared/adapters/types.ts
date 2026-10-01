import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export interface RecipientRow {
  id: string;
  type: 'individual' | 'group';
  display_name: string;
  phone: string | null;
  whatsapp_chat_id: string | null;
  telegram_chat_id: string | null;
}

export interface ScheduleRow {
  id: string;
  user_id: string;
  recipient_id: string;
  title: string;
  message_template: string;
  rrule: string | null;
  start_date: string;
  send_time: string;
  timezone: string;
  skip_dates: string[];
  delivery_mode: string;
  active: boolean;
  next_run_at: string | null;
  retry_count: number;
}

export interface DeliveryContext {
  db: SupabaseClient;
  schedule: ScheduleRow;
  recipient: RecipientRow;
  message: string;
  logId: string;
  actionToken: string;
}

/**
 * A delivery adapter turns a rendered message into an actual delivery.
 * 'reminded' means a human still has to press send; 'sent' means it went out automatically.
 * Throw to signal failure — the dispatcher handles retries and logging.
 */
export interface DeliveryAdapter {
  mode: string;
  deliver(ctx: DeliveryContext): Promise<{ status: 'sent' | 'reminded'; detail?: string }>;
}
