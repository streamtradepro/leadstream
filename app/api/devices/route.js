import { db } from '../../../lib/db.js';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (req.headers.get('x-app-secret') !== process.env.APP_SECRET) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { token, label } = await req.json();
  if (!token) return Response.json({ error: 'token required' }, { status: 400 });
  const { error } = await db()
    .from('devices')
    .upsert({ expo_push_token: token, label: label || null }, { onConflict: 'expo_push_token' });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
