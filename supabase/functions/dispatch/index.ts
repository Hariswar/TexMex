// Called every minute by pg_cron (see supabase/setup/cron.sql).
// 1. Claims due schedules, renders their message and hands it to the schedule's delivery adapter.
// 2. Re-sends reminders that were snoozed from a notification.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { getAdapter } from '../_shared/adapters/index.ts';
import type { RecipientRow, ScheduleRow } from '../_shared/adapters/types.ts';
import { sendReminderPush } from '../_shared/adapters/webpush.ts';
import { localDateString, nextRunAt } from '../_shared/recurrence.ts';
import { renderTemplate, templateVars } from '../_shared/template.ts';

const MISSED_WINDOW_MS = 30 * 60_000; // older than this → skip instead of sending late
const MAX_RETRIES = 3; // backoff: 1, 2, 4 minutes

type Outcome = { id: string; status: string; error?: string };

Deno.serve(async (req) => {
  const secret = Deno.env.get('DISPATCH_SECRET');
  if (!secret || req.headers.get('Authorization') !== `Bearer ${secret}`) {
    return new Response('unauthorized', { status: 401 });
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  const { data: due, error } = await db.rpc('claim_due_schedules', { batch: 50 });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const outcomes: Outcome[] = [];
  for (const schedule of (due ?? []) as ScheduleRow[]) {
    outcomes.push(await runSchedule(db, schedule));
  }
  const snoozed = await resendSnoozed(db);

  return Response.json({ processed: outcomes, snoozed });
});

async function runSchedule(db: SupabaseClient, s: ScheduleRow): Promise<Outcome> {
  const now = new Date();
  const scheduledFor = new Date(s.next_run_at!);

  try {
    const { data: recipient, error } = await db.from('recipients').select('*').eq('id', s.recipient_id).single();
    if (error || !recipient) throw new Error(`Recipient missing: ${error?.message ?? 'not found'}`);

    const localDate = localDateString(scheduledFor, s.timezone);
    const lateBy = now.getTime() - scheduledFor.getTime();

    if (lateBy > MISSED_WINDOW_MS) {
      await log(db, s, 'skipped', { error: `Missed window (late by ${Math.round(lateBy / 60_000)} min)` });
    } else if (s.skip_dates?.includes(localDate)) {
      await log(db, s, 'skipped', { error: `Skip date ${localDate}` });
    } else {
      const message = renderTemplate(s.message_template, templateVars(recipient.display_name, scheduledFor, s.timezone));
      const delivered = await deliver(db, s, recipient as RecipientRow, message);
      if (delivered === 'retrying') return { id: s.id, status: 'retrying' };
    }

    await advance(db, s, now, scheduledFor);
    return { id: s.id, status: 'ok' };
  } catch (err) {
    // Unexpected problem (bad timezone, missing recipient...). Log it and move past this occurrence
    // so one broken schedule can't wedge the queue.
    const message = err instanceof Error ? err.message : String(err);
    await log(db, s, 'failed', { error: message });
    try {
      await advance(db, s, now, scheduledFor);
    } catch {
      await db.from('schedules').update({ active: false, locked_until: null }).eq('id', s.id);
    }
    return { id: s.id, status: 'failed', error: message };
  }
}

async function deliver(
  db: SupabaseClient,
  s: ScheduleRow,
  recipient: RecipientRow,
  message: string,
): Promise<'done' | 'retrying'> {
  const logId = crypto.randomUUID();
  const actionToken = crypto.randomUUID();
  const ctx = { db, schedule: s, recipient, message, logId, actionToken };

  try {
    const result = await getAdapter(s.delivery_mode).deliver(ctx);
    await log(db, s, result.status, { id: logId, message, actionToken, error: result.detail });
    return 'done';
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);

    if (s.retry_count < MAX_RETRIES) {
      const delayMin = 2 ** s.retry_count;
      await log(db, s, 'failed', { message, error: `${error} — retry ${s.retry_count + 1}/${MAX_RETRIES} in ${delayMin} min` });
      await db
        .from('schedules')
        .update({
          next_run_at: new Date(Date.now() + delayMin * 60_000).toISOString(),
          retry_count: s.retry_count + 1,
          locked_until: null,
        })
        .eq('id', s.id);
      return 'retrying';
    }

    await log(db, s, 'failed', { message, error: `${error} — giving up after ${MAX_RETRIES} retries` });

    // Failure alert: for automatic channels, fall back to a one-tap reminder so the message still goes out.
    if (s.delivery_mode !== 'webpush_reminder') {
      try {
        await sendReminderPush({ ...ctx, schedule: { ...s, title: `⚠️ Couldn't send to ${recipient.display_name}` } });
        await log(db, s, 'reminded', { id: logId, message, actionToken, error: 'Fallback reminder after failure' });
      } catch {
        // No push devices either — the failed log entry is all we can do.
      }
    }
    return 'done';
  }
}

async function advance(db: SupabaseClient, s: ScheduleRow, now: Date, scheduledFor: Date) {
  const after = now > scheduledFor ? now : scheduledFor;
  const next = nextRunAt(s, after);
  const { error } = await db
    .from('schedules')
    .update({ next_run_at: next?.toISOString() ?? null, active: next !== null, retry_count: 0, locked_until: null })
    .eq('id', s.id);
  if (error) throw new Error(`Advancing schedule: ${error.message}`);
}

async function log(
  db: SupabaseClient,
  s: ScheduleRow,
  status: 'sent' | 'reminded' | 'failed' | 'skipped',
  extra: { id?: string; message?: string; error?: string; actionToken?: string },
) {
  await db.from('delivery_logs').insert({
    ...(extra.id ? { id: extra.id } : {}),
    schedule_id: s.id,
    user_id: s.user_id,
    status,
    message: extra.message ?? null,
    error: extra.error ?? null,
    action_token: extra.actionToken ?? null,
  });
}

async function resendSnoozed(db: SupabaseClient): Promise<number> {
  const { data: rows } = await db
    .from('delivery_logs')
    .select('id')
    .eq('status', 'snoozed')
    .lte('remind_at', new Date().toISOString())
    .limit(50);

  let count = 0;
  for (const { id } of rows ?? []) {
    // Claim the row first so overlapping invocations don't both re-send it.
    const { data: claimed } = await db
      .from('delivery_logs')
      .update({ status: 'reminded', remind_at: null })
      .eq('id', id)
      .eq('status', 'snoozed')
      .select('id, message, action_token, schedules(*, recipients(*))')
      .maybeSingle();
    if (!claimed) continue;

    const schedule = claimed.schedules as unknown as ScheduleRow & { recipients: RecipientRow };
    try {
      await sendReminderPush({
        db,
        schedule,
        recipient: schedule.recipients,
        message: claimed.message ?? '',
        logId: claimed.id,
        actionToken: claimed.action_token ?? '',
      });
      count++;
    } catch (err) {
      await db
        .from('delivery_logs')
        .update({ status: 'failed', error: `Snoozed reminder failed: ${err instanceof Error ? err.message : err}` })
        .eq('id', id);
    }
  }
  return count;
}
