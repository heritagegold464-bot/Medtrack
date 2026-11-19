// Background Web Push reminders. Invoke every minute (see DEPLOY.md). Uses the SERVICE ROLE key,
// which exists only as a server-side secret here — never in the frontend.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT')!, Deno.env.get('VAPID_PUBLIC_KEY')!, Deno.env.get('VAPID_PRIVATE_KEY')!);

const hm = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };

Deno.serve(async (req) => {
  if (req.headers.get('authorization') !== `Bearer ${Deno.env.get('CRON_SECRET')}`) return new Response('forbidden', { status: 403 });
  const { data: profiles } = await sb.from('profiles').select('*').is('deleted_at', null);
  let sent = 0;
  for (const p of profiles ?? []) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: p.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    const o: Record<string, string> = {}; parts.forEach((x) => (o[x.type] = x.value));
    const today = `${o.year}-${o.month}-${o.day}`; const now = Number(o.hour) * 60 + Number(o.minute);
    const at = (t: string, off = 0) => now === hm(t) + off; // function runs each minute
    const { data: prefs } = await sb.from('notification_preferences').select('*').eq('user_id', p.user_id).maybeSingle();
    if (!prefs) continue;
    const { data: day } = await sb.from('cycle_days').select('id').eq('user_id', p.user_id).eq('status', 'open').is('deleted_at', null).order('cycle_number').order('day_number').limit(1).maybeSingle();
    const { data: sess } = day ? await sb.from('reading_sessions').select('slot,status,planned_start').eq('cycle_day_id', day.id).is('deleted_at', null) : { data: [] };
    const pri = sess?.find((s) => s.slot === 'primary'), sec = sess?.find((s) => s.slot === 'secondary');
    const msgs: Array<{ title: string; body: string; tag: string }> = [];
    if (prefs.primary_reminder && pri?.status === 'pending' && at(p.primary_time)) msgs.push({ title: 'Start primary reading', body: 'Your primary session is due now.', tag: 'primary' });
    if (prefs.secondary_reminder && sec?.status === 'pending' && at(p.secondary_time)) msgs.push({ title: 'Start secondary reading', body: 'Your secondary session is due now.', tag: 'secondary' });
    if (prefs.overdue_reminder) for (const s of [pri, sec]) if (s?.status === 'pending' && at(s.planned_start, prefs.overdue_after_minutes)) msgs.push({ title: 'Session overdue', body: `Your ${s.slot} session has not been started.`, tag: `overdue-${s.slot}` });
    if (at(p.accountability_time)) {
      const { data: acc } = await sb.from('daily_accountability').select('id').eq('user_id', p.user_id).eq('check_date', today).maybeSingle();
      if (prefs.accountability_reminder && !acc) msgs.push({ title: 'Daily accountability check', body: 'Record how today went.', tag: 'accountability' });
      if (prefs.incomplete_reminder && sess?.some((s) => s.status === 'partial' || s.status === 'in_progress')) msgs.push({ title: 'Unfinished session', body: 'Finish it or close the day.', tag: 'incomplete' });
      if (prefs.unrecorded_reminder) {
        const { count } = await sb.from('study_records').select('id', { count: 'exact', head: true }).eq('user_id', p.user_id).eq('study_date', today).gt('actual_seconds', 0);
        if (!count) msgs.push({ title: 'No study recorded today', body: 'Nothing has been logged yet.', tag: 'unrecorded' });
      }
    }
    if (!msgs.length) continue;
    const { data: subs } = await sb.from('push_subscriptions').select('*').eq('user_id', p.user_id);
    for (const sub of subs ?? []) for (const m of msgs) {
      try { await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify({ ...m, url: '/' })); sent++; }
      catch (e) { if ([404, 410].includes((e as { statusCode?: number }).statusCode ?? 0)) await sb.from('push_subscriptions').delete().eq('id', sub.id); }
    }
  }
  return new Response(JSON.stringify({ sent }), { headers: { 'content-type': 'application/json' } });
});
