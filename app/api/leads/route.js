import { db } from '../../../lib/db.js';
import { authenticate, unauthorized } from '../../../lib/auth.js';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const auth = await authenticate(req);
  if (!auth) return unauthorized();
  const url = new URL(req.url);
  // Default view = the states we're actively working (LEAD_STATES, else PUSH_STATES); ?state=all overrides.
  const defaultStates = (process.env.LEAD_STATES || process.env.PUSH_STATES || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  const stateParam = (url.searchParams.get('state') || '').toUpperCase();
  const states = stateParam === 'ALL' ? [] : stateParam ? [stateParam] : defaultStates;
  const category = url.searchParams.get('category') || '';
  let q = db().from('leads').select('*').neq('intent', 'noise').neq('status', 'skipped').neq('category', 'other');
  if (states.length) q = q.in('state', states);
  const minScore = Number(process.env.LEAD_MIN_SCORE) || 0;
  if (minScore) q = q.gte('lead_score', minScore);
  if (category) q = q.eq('category', category);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(200);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ leads: data, me: auth.staff });
}
