import { db } from '../../../lib/db.js';

export const dynamic = 'force-dynamic';

const STATUSES = new Set(['new', 'replied', 'skipped']);

export async function POST(req) {
  if (req.headers.get('x-app-secret') !== process.env.APP_SECRET) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { id, status } = await req.json();
  if (!id || !STATUSES.has(status)) {
    return Response.json({ error: 'id and valid status required' }, { status: 400 });
  }
  const { error } = await db().from('leads').update({ status }).eq('id', id);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
