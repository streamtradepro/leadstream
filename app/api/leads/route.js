import { db } from '../../../lib/db.js';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (req.headers.get('x-app-secret') !== process.env.APP_SECRET) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const url = new URL(req.url);
  const state = (url.searchParams.get('state') || '').toUpperCase();
  const category = url.searchParams.get('category') || '';
  let q = db().from('leads').select('*').neq('intent', 'noise');
  if (state) q = q.eq('state', state);
  if (category) q = q.eq('category', category);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(200);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ leads: data });
}
