// Public Atom-feed fallback used while Reddit Data API registration is pending.
// Same output shape as the OAuth path in reddit.js. Low volume: a couple dozen
// feed fetches per scan, spaced out, which is ordinary RSS-reader behavior.
import { CATEGORIES, ALL_TERMS_QUERY, REGION_SUBS, activeRegions } from './categories.js';
import { BRIGHTDATA_ROOT_CA } from './brightdata-root-ca.js';

// Reddit asks for a unique, descriptive user agent; browser-like UAs without cookies get 429/403 far sooner.
const UA = 'leadstream/1.0 (home-repair lead monitor; +https://usahomerepairs.net)';
const HEADERS = { 'User-Agent': UA, Accept: 'application/atom+xml, application/xml;q=0.9, */*;q=0.5' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Optional residential proxy (Bright Data) --------------------------------
// Reddit 403s Vercel's datacenter egress outright, so the hourly cloud cron never
// once finished a scan (each blocked feed burned 195s of retry waits, then the
// 300s function limit hit). With REDDIT_PROXY_HOST set, every feed is fetched
// through the proxy on its OWN sticky session — its own home IP — so there is no
// per-IP rate limit to pace around, and a 429/502 is retried in seconds on a fresh
// IP instead of waited out. The office PC has no REDDIT_PROXY_* vars and keeps
// fetching directly for free.
//
// Bright Data terminates TLS itself and re-signs with its own root; we verify
// against that root (port 44445) rather than switching verification off.
const PROXY = process.env.REDDIT_PROXY_HOST
  ? {
      host: process.env.REDDIT_PROXY_HOST,
      port: Number(process.env.REDDIT_PROXY_PORT) || 44445,
      user: process.env.REDDIT_PROXY_USER,
      pass: process.env.REDDIT_PROXY_PASS,
    }
  : null;

let undiciModule = null; // loaded once, only when proxying — the direct path never needs it
function undici() {
  return (undiciModule ??= import('undici'));
}

function proxyDispatcher(ProxyAgent, session) {
  return new ProxyAgent({
    uri: `http://${PROXY.host}:${PROXY.port}`,
    token: 'Basic ' + Buffer.from(`${PROXY.user}-session-${session}:${PROXY.pass}`).toString('base64'),
    requestTls: { ca: BRIGHTDATA_ROOT_CA },
  });
}

// Direct (office IP): 429 = rate limited, 403 = temporarily blocked; both clear after a pause
// on the SAME IP, so wait 65s, then 130s, then give up.
const RETRY_WAITS = [65_000, 130_000];
async function fetchDirect(url, attempt = 0) {
  const res = await fetch(url, { headers: HEADERS });
  if ((res.status === 429 || res.status === 403) && attempt < RETRY_WAITS.length) {
    await sleep(RETRY_WAITS[attempt]);
    return fetchDirect(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`RSS ${url} failed: ${res.status}`);
  return res.text();
}

// Proxied: a retry gets a brand-new session (new IP), so there is nothing to cool down.
// 402/502/503 here come from Bright Data, not Reddit. 402 in particular arrives in short
// clusters (seen surviving 4 back-to-back attempts, then 8/8 fine minutes later), so the
// waits step up to outlast a blip: worst case ~37s per feed, still far inside the 300s
// function budget. Bright Data's own error headers are logged so the cause records itself.
const PROXY_RETRY_WAITS = [2_000, 5_000, 10_000, 20_000];
const PROXY_RETRY_STATUSES = new Set([402, 403, 429, 502, 503]);
async function fetchViaProxy(url, session, attempt = 0) {
  const { fetch: proxiedFetch, ProxyAgent } = await undici();
  const dispatcher = proxyDispatcher(ProxyAgent, attempt ? `${session}r${attempt}` : session);
  try {
    const res = await proxiedFetch(url, { dispatcher, headers: HEADERS });
    if (PROXY_RETRY_STATUSES.has(res.status) && attempt < PROXY_RETRY_WAITS.length) {
      const brd = [...res.headers.entries()].filter(([k]) => /^x-(brd|luminati)/i.test(k)).map(([k, v]) => `${k}=${v}`).join(' ');
      console.warn(`proxy ${res.status} on attempt ${attempt + 1} (${url.slice(30, 80)})${brd ? ' ' + brd : ''}`);
      await res.body?.cancel().catch(() => {});
      await sleep(PROXY_RETRY_WAITS[attempt]);
      return await fetchViaProxy(url, session, attempt + 1);
    }
    if (!res.ok) throw new Error(`RSS ${url} failed: ${res.status}`);
    return await res.text();
  } finally {
    await dispatcher.close().catch(() => {}); // one agent per feed; never leak sockets in a serverless function
  }
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
  const scanId = Date.now().toString(36); // one session prefix per scan; each feed gets its own suffix
  let ok = 0;

  for (const [i, f] of feeds.entries()) {
    try {
      // Pacing only matters when every feed shares one IP. ~7 requests/min keeps the
      // office IP under Reddit's unauthenticated limit; proxied feeds each have their own IP.
      if (i > 0 && !PROXY) await sleep(Number(process.env.FEED_DELAY_MS) || 8000);
      const xml = PROXY ? await fetchViaProxy(f.url, `${scanId}f${i}`) : await fetchDirect(f.url);
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
  console.log(`feeds ok ${ok}/${feeds.length}, candidates ${byId.size}${PROXY ? ' (via residential proxy)' : ''}`);
  return [...byId.values()];
}
