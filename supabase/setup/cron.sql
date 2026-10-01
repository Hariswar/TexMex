-- Run once in the Supabase SQL editor AFTER deploying the `dispatch` function.
-- Replace the two placeholder values first. Secrets live in Vault, not in the job text.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://YOUR-PROJECT-REF.supabase.co', 'project_url');
select vault.create_secret('SAME-VALUE-AS-DISPATCH_SECRET', 'dispatch_secret');

-- Every minute: ask the dispatch function to fire whatever is due.
select cron.schedule(
  'texmex-dispatch',
  '* * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'dispatch_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $$
);

-- Housekeeping: drop delivery logs older than 180 days, nightly.
select cron.schedule(
  'texmex-log-retention',
  '15 3 * * *',
  $$ delete from public.delivery_logs where fired_at < now() - interval '180 days' $$
);
