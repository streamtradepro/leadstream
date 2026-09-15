import { db } from '../../../lib/db.js';
import { authenticate, unauthorized } from '../../../lib/auth.js';

export const dynamic = 'force-dynamic';

// Reddit threads go cold fast: once a post has a few answers, our reply is buried.
// Measured on our own data (2026-09-15): median time from "posted on Reddit" to
// "stored by the scanner" is 18 min, and 14 of the 15 leads staff actually replied
// to were under an hour old. 80 min therefore hides ~10% of volume while leaving
// roughly an hour of working time on everything that matters.
// Tune with LEAD_MAX_AGE_MIN (minutes) — no redeploy of the app needed.
const DEFAULT_MAX_AGE_MIN = 80;

function maxAgeMinutes(param) {
  if (param === 'all') return null; // explicit opt-out: show everything
  const asked = Number(param);
  if (Number.isFinite(asked) && asked > 0) return asked;
  const fromEnv = Number(process.env.LEAD_MAX_AGE_MIN);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_MAX_AGE_MIN;
}

/**
 * One person cross-posting to r/doors AND r/fixit is ONE lead, not two.
 *
 * Keyed on author+title, never title alone: two different people can both title a
 * post "Help!", and collapsing those would silently destroy a real lead. A row
 * missing either field is never merged.
 *
 * Keeps the highest-scoring copy and lists the other subreddits in `also_in`, so
 * two staff can't reply to the same person in two places and look like bots.
 */
function collapseCrossposts(leads) {
  const groups = new Map();
  const order = [];
  for (const lead of leads) {
    const author = (lead.author || '').trim().toLowerCase();
    const title = (lead.title || '').trim().toLowerCase();
    const key = author && title ? `${author}|${title}` : `row:${lead.id}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key).push(lead);
  }
  return order.map((key) => {
    const group = groups.get(key);
    if (group.length === 1) return group[0];
    const best = group.reduce((a, b) => ((b.lead_score ?? 0) > (a.lead_score ?? 0) ? b : a));
    const also = [...new Set(group.map((l) => l.subreddit).filter((s) => s && s !== best.subreddit))];
    return { ...best, also_in: also };
  });
}

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
  // Freshness cut runs in the DB so the 200-row cap isn't spent on stale threads.
  const maxAge = maxAgeMinutes(url.searchParams.get('maxAge'));
  if (maxAge) q = q.gte('posted_at', new Date(Date.now() - maxAge * 60_000).toISOString());
  const { data, error } = await q.order('created_at', { ascending: false }).limit(200);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ leads: collapseCrossposts(data || []), me: auth.staff, maxAgeMin: maxAge });
}
