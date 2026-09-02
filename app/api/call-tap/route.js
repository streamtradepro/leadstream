import { db } from '../../../lib/db.js';

export const dynamic = 'force-dynamic';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

// Beacon from usahomerepairs.net when a visitor taps a call button. Body is JSON
// sent as text/plain (sendBeacon can't set JSON content-type without a preflight).
export async function POST(req) {
  let body = {};
  try {
    body = JSON.parse(await req.text());
  } catch {
    return Response.json({ error: 'bad json' }, { status: 400, headers: CORS });
  }
  const clean = (v, n = 80) => (typeof v === 'string' ? v.trim().slice(0, n) : null);
  const row = {
    city: clean(body.city),
    state: clean(body.state, 2),
    geo_source: clean(body.geo_source, 20),
    page: clean(body.page, 200),
    label: clean(body.label, 60),
    user_agent: clean(req.headers.get('user-agent'), 200),
  };
  const { error } = await db().from('call_taps').insert(row);
  if (error) return Response.json({ error: error.message }, { status: 500, headers: CORS });
  return Response.json({ ok: true }, { headers: CORS });
}
