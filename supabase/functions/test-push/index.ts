// "Send test notification" from Settings: pushes a sample reminder to every device of the signed-in user,
// so they can confirm notifications work without waiting for a scheduled time.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { pushToUser } from '../_shared/adapters/webpush.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  });
  const { data, error } = await asUser.auth.getUser();
  if (error || !data.user) return Response.json({ error: 'Not signed in' }, { status: 401, headers: cors });

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  try {
    const devices = await pushToUser(admin, data.user.id, {
      title: 'TexMex test 🎉',
      body: "Reminders work on this device. At send time you'll see your message here. Tap it to open WhatsApp.",
      url: '/',
      tag: 'texmex-test',
    });
    return Response.json({ devices }, { headers: cors });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400, headers: cors });
  }
});
