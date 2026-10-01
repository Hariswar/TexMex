// Notification actions posted by the service worker, authorised by the per-delivery token
// embedded in the push payload (the service worker has no user session).
//   { logId, token, action: 'snooze', minutes? }  → re-remind later
//   { logId, token, action: 'opened' }            → user tapped through to WhatsApp
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: cors });

  let body: { logId?: string; token?: string; action?: string; minutes?: number };
  try {
    body = await req.json();
  } catch {
    return new Response('bad json', { status: 400, headers: cors });
  }
  const { logId, token, action } = body;
  if (!logId || !token) return new Response('missing logId/token', { status: 400, headers: cors });

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  });

  let update: Record<string, unknown>;
  if (action === 'snooze') {
    const minutes = Math.min(240, Math.max(1, Math.round(body.minutes ?? 15)));
    update = { status: 'snoozed', remind_at: new Date(Date.now() + minutes * 60_000).toISOString() };
  } else if (action === 'opened') {
    update = { opened_at: new Date().toISOString() };
  } else {
    return new Response('unknown action', { status: 400, headers: cors });
  }

  const { data, error } = await db
    .from('delivery_logs')
    .update(update)
    .eq('id', logId)
    .eq('action_token', token)
    .select('id')
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500, headers: cors });
  if (!data) return new Response('not found', { status: 404, headers: cors });
  return Response.json({ ok: true }, { headers: cors });
});
