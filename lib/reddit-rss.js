// Public Atom-feed fallback used while Reddit Data API registration is pending.
// Same output shape as the OAuth path in reddit.js. Low volume: a couple dozen
// feed fetches per scan, spaced out, which is ordinary RSS-reader behavior.
import { CATEGORIES, ALL_TERMS_QUERY, REGION_SUBS, activeRegions } from './categories.js';

// Reddit asks for a unique, descriptive user agent; browser-like UAs without cookies get 429/403 far sooner.
const UA = 'leadstream/1.0 (home-repair lead monitor; +https://usahomerepairs.net)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 429 = rate limited, 403 = temporarily blocked; both clear after a pause. Wait 65s, then 130s, then give up.
const RETRY_WAITS = [65_000, 130_000];
async function fetchFeed(url, attempt = 0) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/atom+xml, application/xml;q=0.9, */*;q=0.5' } });
  if ((res.status === 429 || res.status === 403) && attempt < RETRY_WAITS.length) {
    await sleep(RETRY_WAITS[attempt]);
    return fetchFeed(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`RSS ${url} failed: ${res.status}`);
  return res.text();
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x200B;/gi, '')
    .replace(/&amp;/g, '&');
}

function stripHtml(s) {
  return decodeEntities(decodeEntities(s))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : '';
}

function parseAtom(xml) {
  const out = [];
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  for (const e of entries) {
    const id = tag(e, 'id').trim();
    if (!/^t3_/.test(id)) continue; // posts only, skip comments (t1_)
    const linkMatch = e.match(/<link[^>]*href="([^"]+)"/);
    const catMatch = e.match(/<category[^>]*label="r\/([^"]+)"/);
    const updated = tag(e, 'updated').trim();
    out.push({
      reddit_id: id,
      subreddit: catMatch ? catMatch[1] : null,
      title: decodeEntities(tag(e, 'title')).trim(),
      body: stripHtml(tag(e, 'content')).slice(0, 1500),
      author: decodeEntities(tag(e, 'name')).replace(/^\/u\//, '').trim() || null,
      url: linkMatch ? decodeEntities(linkMatch[1]) : null,
      posted_at: updated ? new Date(updated).toISOString() : new Date().toISOString(),
      reddit_score: 0, // not exposed in feeds
    });
  }
  return out;
}

const TARGET_SUBS = ['GarageDoorService', 'GarageDoorRepair', 'garagedoors', 'Locksmith', 'chimney', 'hvacadvice'];

export function buildFeeds() {
  const feeds = [];
  // Sitewide, per category
  for (const [key, c] of Object.entries(CATEGORIES)) {
    feeds.push({ url: `https://www.reddit.com/search.rss?q=${encodeURIComponent(c.query)}&sort=new&limit=100`, hint: { category_hint: key } });
  }
  // Dedicated trade subs
  for (const s of TARGET_SUBS) {
    feeds.push({ url: `https://www.reddit.com/r/${s}/new/.rss?limit=50`, hint: {} });
  }
  // Regional sweep: ONE multireddit search per region (r/a+b+c/search.rss) — all
  // state/metro subs, all terms, newest first. Chunked in case a region has many subs.
  for (const region of activeRegions()) {
    const subs = REGION_SUBS[region];
    for (let i = 0; i < subs.length; i += 30) {
      feeds.push({
        url: `https://www.reddit.com/r/${subs.slice(i, i + 30).join('+')}/search.rss?q=${encodeURIComponent(ALL_TERMS_QUERY)}&restrict_sr=on&sort=new&limit=100`,
        hint: { region_state: region },
      });
    }
  }
  return feeds;
}

export async function fetchCandidatePostsRss() {
  const lookbackMs = (Number(process.env.LOOKBACK_HOURS) || 26) * 3600 * 1000;
  const cutoff = Date.now() - lookbackMs;
  const byId = new Map();
  const feeds = buildFeeds();
  let ok = 0;

  for (const [i, f] of feeds.entries()) {
    try {
      if (i > 0) await sleep(Number(process.env.FEED_DELAY_MS) || 8000); // ~7 requests/min keeps us under Reddit's unauthenticated limit
      const xml = await fetchFeed(f.url);
      ok++;
      for (const p of parseAtom(xml)) {
        if (new Date(p.posted_at).getTime() < cutoff) continue;
        const existing = byId.get(p.reddit_id);
        if (existing) {
          Object.assign(existing, { ...f.hint, ...Object.fromEntries(Object.entries(existing).filter(([, v]) => v != null)) });
        } else {
          byId.set(p.reddit_id, { ...p, ...f.hint });
        }
      }
    } catch (e) {
      console.error(`feed failed (${f.url.slice(0, 80)}):`, e.message);
    }
  }
  console.log(`feeds ok ${ok}/${feeds.length}, candidates ${byId.size}`);
  return [...byId.values()];
}
