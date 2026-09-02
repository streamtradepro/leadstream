import { db } from '../../../lib/db.js';
import { sendPush } from '../../../lib/push.js';

export const dynamic = 'force-dynamic';

const ALLOWED_ORIGINS = (process.env.SITE_ORIGINS || 'https://usahomerepairs.net,https://www.usahomerepairs.net')
  .split(',')
  .map((s) => s.trim());

function corsHeaders(req) {
  const origin = req.headers.get('origin') || '';
  const allow = ALLOWED_ORIGINS.includes(origin) || origin.endsWith('.vercel.app') || origin.startsWith('http://localhost');
  return {
    'Access-Control-Allow-Origin': allow ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS(req) {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req) {
  const headers = corsHeaders(req);
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400, headers });
  }

  // Honeypot field: real users never fill it.
  if (body.website) return Response.json({ ok: true }, { headers });

  const clean = (v, n = 200) => (typeof v === 'string' ? v.trim().slice(0, n) : null);
  const row = {
    name: clean(body.name),
    phone: clean(body.phone, 40),
    email: clean(body.email),
    zip: clean(body.zip, 20),
    service: clean(body.service, 80),
    message: clean(body.message, 2000),
    source: clean(body.source, 40) || 'website',
  };
  if (!row.phone && !row.email) {
    return Response.json({ error: 'phone or email required' }, { status: 400, headers });
  }

  const { data, error } = await db().from('site_leads').insert(row).select('id').single();
  if (error) return Response.json({ error: error.message }, { status: 500, headers });

  const { data: devices } = await db().from('devices').select('expo_push_token');
  const tokens = (devices || []).map((d) => d.expo_push_token);
  await sendPush(tokens, {
    title: `\u{1F310} Website lead — ${row.service || 'general'}${row.zip ? ' — ' + row.zip : ''}`,
    body: `${row.name || 'Someone'} · ${row.phone || row.email}${row.message ? ' · ' + row.message.slice(0, 80) : ''}`,
    data: { site_lead_id: data.id, phone: row.phone },
  });

  return Response.json({ ok: true }, { headers });
}
