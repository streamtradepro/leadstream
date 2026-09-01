import { db } from '../../../lib/db.js';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (req.headers.get('x-app-secret') !== process.env.APP_SECRET) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { data, error } = await db()
    .from('leads')
    .select('*')
    .neq('intent', 'noise')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ leads: data });
}
