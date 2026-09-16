import { fetchCandidatePosts } from './reddit.js';
import { fetchCandidatePostsRss } from './reddit-rss.js';
import { classifyPosts } from './classify.js';
import { db } from './db.js';
import { sendPush } from './push.js';
import { CATEGORIES, CATEGORY_KEYS, pushStates } from './categories.js';

export async function runScan() {
  // Official API when credentials exist; public RSS feeds while registration is pending.
  const useApi = process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET;
  const posts = useApi ? await fetchCandidatePosts() : await fetchCandidatePostsRss();

  // Dedupe against DB (noise rows are stored too, so nothing gets re-classified)
  let existing = new Set();
  const ids = posts.map((p) => p.reddit_id);
  for (let i = 0; i < ids.length; i += 500) {
    const { data, error } = await db().from('leads').select('reddit_id').in('reddit_id', ids.slice(i, i + 500));
    if (error) throw new Error('dedupe query failed: ' + error.message);
    for (const r of data || []) existing.add(r.reddit_id);
  }
  const fresh = posts.filter((p) => !existing.has(p.reddit_id));
  if (!fresh.length) return { fetched: posts.length, new: 0, hot: 0 };

  const classified = await classifyPosts(fresh);
  const byId = new Map(classified.map((c) => [c.id, c]));

  const rows = fresh.map((p) => {
    const c = byId.get(p.reddit_id) || {};
    const { category_hint, region_state, ...post } = p;
    const category = CATEGORY_KEYS.includes(c.category) ? c.category : 'other';
    return {
      ...post,
      category,
      intent: c.intent || 'noise',
      location_raw: c.location_raw ?? null,
      city: c.city ?? null,
      state: (c.state ?? region_state ?? null) || null,
      lead_score: Number(c.lead_score) || 0,
      reasoning: c.reason || null,
    };
  });

  const { error: insertErr } = await db()
    .from('leads')
    .upsert(rows, { onConflict: 'reddit_id', ignoreDuplicates: true });
  if (insertErr) throw new Error('insert failed: ' + insertErr.message);

  // Notify for every lead that will actually appear in the app (the app shows score >= 70
  // for both service and DIY intent), not just service-intent ones — otherwise about a
  // third of the list arrives silently and nobody knows to look. Owner asked for this
  // 2026-09-15. PUSH_INTENTS narrows it back (e.g. "service") without a deploy.
  const minScore = Number(process.env.PUSH_MIN_SCORE) || 70;
  const intents = new Set((process.env.PUSH_INTENTS || 'service,diy').split(',').map((s) => s.trim()).filter(Boolean));
  const states = pushStates(); // null = all states
  const hot = rows
    .filter((r) => intents.has(r.intent) && r.lead_score >= minScore && r.category !== 'other')
    .filter((r) => !states || (r.state && states.has(r.state.toUpperCase())))
    .sort((a, b) => b.lead_score - a.lead_score);

  if (hot.length) {
    const { data: devices } = await db().from('devices').select('expo_push_token');
    const tokens = (devices || []).map((d) => d.expo_push_token);
    for (const h of hot.slice(0, 10)) {
      const where = [h.city, h.state].filter(Boolean).join(', ') || `r/${h.subreddit}`;
      const cat = CATEGORIES[h.category];
      await sendPush(tokens, {
        title: `${cat ? cat.emoji + ' ' + cat.label : '\u{1F525}'} ${h.lead_score} — ${where}`,
        body: h.title.slice(0, 150),
        data: { url: h.url, reddit_id: h.reddit_id },
      });
    }
    await db()
      .from('leads')
      .update({ pushed_at: new Date().toISOString() })
      .in('reddit_id', hot.map((h) => h.reddit_id));
  }

  const byCat = {};
  for (const r of rows) if (r.intent === 'service') byCat[r.category] = (byCat[r.category] || 0) + 1;
  return { fetched: posts.length, new: rows.length, hot: hot.length, service_by_category: byCat };
}
