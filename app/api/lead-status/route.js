import { db } from '../../../lib/db.js';
import { authenticate, unauthorized } from '../../../lib/auth.js';

export const dynamic = 'force-dynamic';

const STATUSES = new Set(['new', 'replied', 'skipped']);

export async function POST(req) {
  const auth = await authenticate(req);
  if (!auth) return unauthorized();
  const { id, status } = await req.json();
  if (!id || !STATUSES.has(status)) {
    return Response.json({ error: 'id and valid status required' }, { status: 400 });
  }
  // Record who handled it so the team sees "Replied by Maria" and nobody answers the same post twice.
  const patch = status === 'new'
    ? { status, handled_by: null, handled_by_id: null, handled_at: null }
    : { status, handled_by: auth.staff.name, handled_by_id: auth.staff.id, handled_at: new Date().toISOString() };
  const { error } = await db().from('leads').update(patch).eq('id', id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
