import { fetchCandidatePosts } from './reddit.js';
import { classifyPosts } from './classify.js';
import { db } from './db.js';
import { sendPush } from './push.js';

export async function runScan() {
  const posts = await fetchCandidatePosts();

  // Dedupe against DB (noise rows are stored too, so nothing gets re-classified)
  let existing = new Set();
  const ids = posts.map((p) => p.reddit_id);
  if (ids.length) {
    const { data, error } = await db().from('leads').select('reddit_id').in('reddit_id', ids);
    if (error) throw new Error('dedupe query failed: ' + error.message);
    existing = new Set((data || []).map((r) => r.reddit_id));
  }
  const fresh = posts.filter((p) => !existing.has(p.reddit_id));
  if (!fresh.length) return { fetched: posts.length, new: 0, hot: 0 };

  const classified = await classifyPosts(fresh);
  const byId = new Map(classified.map((c) => [c.id, c]));

  const rows = fresh.map((p) => {
    const c = byId.get(p.reddit_id) || {};
    return {
      ...p,
      intent: c.intent || 'noise',
      location_raw: c.location_raw ?? null,
      city: c.city ?? null,
      state: c.state ?? null,
      lead_score: Number(c.lead_score) || 0,
      reasoning: c.reason || null,
    };
  });

  const { error: insertErr } = await db()
    .from('leads')
    .upsert(rows, { onConflict: 'reddit_id', ignoreDuplicates: true });
  if (insertErr) throw new Error('insert failed: ' + insertErr.message);

  const minScore = Number(process.env.PUSH_MIN_SCORE) || 70;
  const hot = rows
    .filter((r) => r.intent === 'service' && r.lead_score >= minScore)
    .sort((a, b) => b.lead_score - a.lead_score);

  if (hot.length) {
    const { data: devices } = await db().from('devices').select('expo_push_token');
    const tokens = (devices || []).map((d) => d.expo_push_token);
    for (const h of hot.slice(0, 10)) {
      const where = [h.city, h.state].filter(Boolean).join(', ') || `r/${h.subreddit}`;
      await sendPush(tokens, {
        title: `\u{1F525} ${h.lead_score} — ${where}`,
        body: h.title.slice(0, 150),
        data: { url: h.url, reddit_id: h.reddit_id },
      });
    }
    await db()
      .from('leads')
      .update({ pushed_at: new Date().toISOString() })
      .in('reddit_id', hot.map((h) => h.reddit_id));
  }

  return { fetched: posts.length, new: rows.length, hot: hot.length };
}
