const TOKEN_URL = 'https://www.reddit.com/api/v1/access_token';
const API = 'https://oauth.reddit.com';

let cached = { token: null, exp: 0 };

function ua() {
  return process.env.REDDIT_USER_AGENT || 'web:leadstream:v0.1';
}

async function getToken() {
  if (cached.token && Date.now() < cached.exp - 60_000) return cached.token;
  const basic = Buffer.from(
    `${process.env.REDDIT_CLIENT_ID}:${process.env.REDDIT_CLIENT_SECRET}`
  ).toString('base64');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': ua(),
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Reddit token failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cached = { token: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return cached.token;
}

async function redditGet(path) {
  const token = await getToken();
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': ua() },
  });
  if (!res.ok) throw new Error(`Reddit GET ${path} failed: ${res.status}`);
  return res.json();
}

function normalize(child) {
  const d = child.data;
  return {
    reddit_id: d.name,
    subreddit: d.subreddit,
    title: d.title || '',
    body: (d.selftext || '').slice(0, 1500),
    author: d.author,
    url: `https://www.reddit.com${d.permalink}`,
    posted_at: new Date(d.created_utc * 1000).toISOString(),
    reddit_score: d.score || 0,
  };
}

// Dedicated garage-door subs scanned directly, on top of the sitewide sweep.
const TARGET_SUBS = ['GarageDoorService', 'GarageDoorRepair', 'garagedoors'];

export async function fetchCandidatePosts() {
  const lookbackMs = (Number(process.env.LOOKBACK_HOURS) || 26) * 3600 * 1000;
  const cutoff = Date.now() - lookbackMs;
  const byId = new Map();

  const add = (children) => {
    for (const c of children || []) {
      if (c.kind !== 't3') continue;
      const p = normalize(c);
      if (new Date(p.posted_at).getTime() < cutoff) continue;
      if (!byId.has(p.reddit_id)) byId.set(p.reddit_id, p);
    }
  };

  // Broad sitewide sweep, newest first
  try {
    const q = encodeURIComponent('"garage door"');
    const data = await redditGet(`/search?q=${q}&sort=new&limit=100&type=link`);
    add(data?.data?.children);
  } catch (e) {
    console.error('sitewide search failed:', e.message);
  }

  for (const sub of TARGET_SUBS) {
    try {
      const data = await redditGet(`/r/${sub}/new?limit=50`);
      add(data?.data?.children);
    } catch (e) {
      console.error(`r/${sub} fetch failed:`, e.message);
    }
  }

  return [...byId.values()];
}
