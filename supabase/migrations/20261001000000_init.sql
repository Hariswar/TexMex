-- TexMex core schema: users' profiles, push subscriptions, recipients, schedules, delivery logs.
-- All times are stored as timestamptz (UTC); schedules carry their own IANA timezone.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  name       text,
  timezone   text not null default 'UTC',
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, name) values (new.id, split_part(new.email, '@', 1));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------- push subscriptions
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- -------------------------------------------------------------- recipients
create type public.recipient_type as enum ('individual', 'group');

create table public.recipients (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  type             public.recipient_type not null default 'individual',
  display_name     text not null check (length(display_name) between 1 and 100),
  phone            text,           -- E.164-ish, used for wa.me links (individuals)
  whatsapp_chat_id text,           -- reserved for chat-ID based adapters
  telegram_chat_id text,           -- for the Telegram bot adapter
  created_at       timestamptz not null default now()
);
create index on public.recipients (user_id);

-- --------------------------------------------------------------- schedules
create type public.delivery_mode as enum ('webpush_reminder', 'telegram');

create table public.schedules (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  recipient_id     uuid not null references public.recipients on delete cascade,
  title            text not null default '',
  message_template text not null check (length(message_template) between 1 and 2000),
  rrule            text,            -- e.g. FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR ; null = one-time
  start_date       date not null,   -- local date of first possible run (DTSTART)
  send_time        time not null,   -- local wall-clock time
  timezone         text not null,
  skip_dates       date[] not null default '{}',
  delivery_mode    public.delivery_mode not null default 'webpush_reminder',
  active           boolean not null default true,
  next_run_at      timestamptz,
  retry_count      int not null default 0,
  locked_until     timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index schedules_due_idx on public.schedules (next_run_at) where active;
create index on public.schedules (user_id);

create function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger schedules_touch before update on public.schedules
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------- delivery logs
create type public.delivery_status as enum ('sent', 'reminded', 'failed', 'skipped', 'snoozed');

create table public.delivery_logs (
  id           uuid primary key default gen_random_uuid(),
  schedule_id  uuid not null references public.schedules on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  fired_at     timestamptz not null default now(),
  status       public.delivery_status not null,
  message      text,
  error        text,
  action_token text,          -- lets the service worker snooze / ack without a session
  remind_at    timestamptz,   -- when a snoozed reminder should fire again
  opened_at    timestamptz    -- user tapped "Open in WhatsApp"
);
create index on public.delivery_logs (user_id, fired_at desc);
create index delivery_logs_snoozed_idx on public.delivery_logs (remind_at) where status = 'snoozed';

-- --------------------------------------------------------------------- RLS
alter table public.profiles           enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.recipients         enable row level security;
alter table public.schedules          enable row level security;
alter table public.delivery_logs      enable row level security;

create policy "own profile" on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy "own subscriptions" on public.push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own recipients" on public.recipients
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own schedules" on public.schedules
  for all using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.recipients r where r.id = recipient_id and r.user_id = auth.uid())
  );

create policy "read own logs" on public.delivery_logs
  for select using (user_id = auth.uid());

-- ------------------------------------------------------ dispatcher support
-- Atomically claims due schedules so overlapping cron invocations never double-send.
create function public.claim_due_schedules(batch int default 50)
returns setof public.schedules
language sql security definer set search_path = '' as $$
  update public.schedules s
     set locked_until = now() + interval '5 minutes'
   where s.id in (
     select id from public.schedules
      where active
        and next_run_at <= now()
        and (locked_until is null or locked_until < now())
      order by next_run_at
      limit batch
      for update skip locked
   )
  returning s.*;
$$;

revoke execute on function public.claim_due_schedules(int) from public, anon, authenticated;
grant execute on function public.claim_due_schedules(int) to service_role;

-- ------------------------------------------------------------ privileges
-- Explicit grants so this works even when "Automatically expose new tables" is off.
-- RLS policies above still decide which rows each user can touch; anon gets nothing.
grant usage on schema public to authenticated, service_role;

grant select, insert, update, delete on public.profiles, public.push_subscriptions, public.recipients, public.schedules
  to authenticated;
grant select on public.delivery_logs to authenticated;

grant all on public.profiles, public.push_subscriptions, public.recipients, public.schedules, public.delivery_logs
  to service_role;
