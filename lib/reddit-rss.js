// Public Atom-feed fallback used while Reddit Data API registration is pending.
// Same output shape as the OAuth path in reddit.js. Low volume: a handful of
// feed fetches per scan, spaced out, which is ordinary RSS-reader behavior.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchFeed(url, attempt = 0) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (res.status === 429 && attempt < 1) {
    await sleep(61_000);
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

const TARGET_SUBS = ['GarageDoorService', 'GarageDoorRepair', 'garagedoors'];

export async function fetchCandidatePostsRss() {
  const lookbackMs = (Number(process.env.LOOKBACK_HOURS) || 26) * 3600 * 1000;
  const cutoff = Date.now() - lookbackMs;
  const byId = new Map();

  const feeds = [
    'https://www.reddit.com/search.rss?q=%22garage+door%22&sort=new&limit=100',
    ...TARGET_SUBS.map((s) => `https://www.reddit.com/r/${s}/new/.rss?limit=50`),
  ];

  for (const [i, url] of feeds.entries()) {
    try {
      if (i > 0) await sleep(5_000); // be polite between feed fetches
      const xml = await fetchFeed(url);
      for (const p of parseAtom(xml)) {
        if (new Date(p.posted_at).getTime() < cutoff) continue;
        if (!byId.has(p.reddit_id)) byId.set(p.reddit_id, p);
      }
    } catch (e) {
      console.error(`feed failed (${url}):`, e.message);
    }
  }

  return [...byId.values()];
}
