import { db } from '../../../lib/db.js';
import { authenticate, unauthorized } from '../../../lib/auth.js';

export const dynamic = 'force-dynamic';

export async function POST(req) {
  const auth = await authenticate(req);
  if (!auth) return unauthorized();
  const { token, label } = await req.json();
  if (!token) return Response.json({ error: 'token required' }, { status: 400 });
  const { error } = await db()
    .from('devices')
    .upsert({ expo_push_token: token, label: label || null, staff_id: auth.staff.id, staff_name: auth.staff.name }, { onConflict: 'expo_push_token' });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
