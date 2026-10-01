# TexMex

Schedule any message to anyone, once or on repeat (a daily good morning, a weekly check-in, a monthly bill reminder, a group invite), and get a push notification at send time. Tap the notification and WhatsApp opens with the message already typed, so you just press send. Telegram chats can be messaged fully automatically.

It's an installable PWA that costs $0 to run: **Vercel** (frontend) + **Supabase** (Postgres, auth, `pg_cron`, Edge Functions) + **Web Push**.

## How it works

```
pg_cron (every minute) ──► dispatch Edge Function
                              │ claim due schedules (FOR UPDATE SKIP LOCKED)
                              │ render template ({name}, {Hi|Hey} variations)
                              ▼
                         delivery adapter
                           ├─ webpush_reminder → push to your devices → tap → wa.me link → you press send
                           └─ telegram         → Bot API sendMessage (automatic, works in groups)
                              │
                              ▼
                         delivery_logs + compute next_run_at (timezone/DST aware)

Notification "+15 min" ──► action Edge Function ──► log marked snoozed ──► dispatch re-sends later
```

* **Delivery adapters** live in [supabase/functions/_shared/adapters/](supabase/functions/_shared/adapters/). To add a channel (Twilio SMS, email, …), implement `DeliveryAdapter`, register it in `index.ts`, and add the mode to the `delivery_mode` enum.
* **Recurrence** ([recurrence.ts](supabase/functions/_shared/recurrence.ts)) is a small RRULE subset (`DAILY`/`WEEKLY`/`MONTHLY`, `INTERVAL`, `BYDAY`). Every schedule stores its local date, local time and IANA timezone; `next_run_at` is UTC. The browser and the dispatcher share the same code.
* **Reliability**: due rows are claimed atomically, so overlapping cron runs never double-send. Failed sends retry with backoff (1, 2, 4 min). A run that is more than 30 minutes late is logged as *skipped* rather than sent late. If an automatic channel keeps failing, you get a one-tap reminder instead.

### WhatsApp caveats

* `wa.me` links can pre-fill a chat **with a person** (by phone number). For **groups**, WhatsApp opens with the text ready and you pick the group. No official link targets a group.
* Unofficial WhatsApp automation (whatsapp-web.js, Baileys, …) can get your number banned. It's deliberately not included. If you experiment with it, write it as another adapter and use a spare number.

## Setup

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com) (free tier).
2. Install the CLI (`brew install supabase/tap/supabase`), then:
   ```sh
   supabase login
   supabase link --project-ref YOUR-PROJECT-REF
   supabase db push                      # applies supabase/migrations
   ```
3. **Auth → URL configuration**: set *Site URL* to your Vercel URL and add `http://localhost:5173` to the redirect URLs.

### 2. Keys and secrets

```sh
npm install
npm run vapid                            # prints a VAPID public + private key
openssl rand -hex 32                     # a random DISPATCH_SECRET

supabase secrets set \
  VAPID_PUBLIC_KEY=... \
  VAPID_PRIVATE_KEY=... \
  VAPID_SUBJECT=mailto:you@example.com \
  DISPATCH_SECRET=...
# optional, for Telegram delivery:
supabase secrets set TELEGRAM_BOT_TOKEN=123456:ABC...
```

### 3. Edge Functions and cron

```sh
supabase functions deploy dispatch --no-verify-jwt
supabase functions deploy action   --no-verify-jwt
```

Open [supabase/setup/cron.sql](supabase/setup/cron.sql), put in your project URL and the same `DISPATCH_SECRET`, and run it in the Supabase SQL editor.

### 4. Frontend

```sh
cp .env.example .env.local               # fill in URL, anon key, VAPID public key
npm run dev
```

To deploy, import the repo in Vercel and add the three `VITE_*` variables. Vite is detected automatically.

### 5. On your phone

* **Android / desktop Chrome**: open the site, go to Settings, then Enable notifications.
* **iPhone (iOS 16.4+)**: open the site in Safari, tap Share, then *Add to Home Screen*. Open TexMex from the home screen, then go to Settings and tap Enable notifications. iOS only allows web push for installed PWAs.

### Telegram (optional, fully automatic)

1. Create a bot with [@BotFather](https://t.me/BotFather) and set `TELEGRAM_BOT_TOKEN`.
2. Add the bot to your group and send any message in the group.
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `chat.id` (group ids start with `-`).
4. Put that id on the contact and choose **Telegram — send automatically** on the schedule.

## Development

```sh
npm test          # recurrence / DST / template / link tests
npm run build     # typecheck app + service worker, build PWA
```

Message templates support `{name}`, `{first_name}`, `{day}` and `{date}`, plus random variations such as `{Hi|Hey} {first_name}, {how are you?|what's new?}`. Variations can be nested.

## Roadmap

Implemented: MVP, templates and variations, skip dates, "+15 min" snooze, presets, a 7-day upcoming view, history, retries and failure fallback, and Telegram.

Next ideas:
* Track replies, with streaks and a weekly summary.
* Natural-language input ("every Friday at noon ask the roommates about weekend plans") via chrono-node or an LLM.
* Conditional sends (weather, calendar).
* Shared schedules.
