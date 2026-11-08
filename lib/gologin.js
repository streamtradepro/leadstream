// Shared GoLogin launcher for the Reddit outreach scripts. The profile holds the
// owner's aged Reddit account: cookies, fingerprint and a US residential proxy.
// Every launch downloads the profile from GoLogin's cloud and every exit uploads
// it back, so NEVER run two of these scripts at once, and never run one while
// the same profile is open in the GoLogin app (the later upload wins).
import { GologinApi } from 'gologin';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const jitter = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo));

export async function withRedditBrowser(fn) {
  const token = process.env.GOLOGIN_TOKEN;
  const profileId = process.env.GOLOGIN_PROFILE_ID;
  if (!token || !profileId) throw new Error('GOLOGIN_TOKEN and GOLOGIN_PROFILE_ID must be set in .env.local');
  const GL = GologinApi({ token });
  const { browser } = await GL.launch({ profileId });
  try {
    const page = await browser.newPage();
    return await fn(page, browser);
  } finally {
    await sleep(1500);
    await GL.exit().catch((e) => console.error('gologin exit failed:', e.message));
  }
}

// old.reddit.com shows the signed-in username in the header; null when logged out.
export async function redditUser(page) {
  return page.$eval('#header-bottom-right .user a', (a) => a.textContent.trim()).catch(() => null);
}

export async function gotoOld(page, url) {
  const u = new URL(url);
  u.hostname = 'old.reddit.com';
  await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await sleep(jitter(600, 1400));
}

// Type like a person: variable per-key delay, a pause at sentence ends.
export async function humanType(page, selector, text) {
  await page.click(selector);
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: jitter(35, 120) });
    if ('.!?'.includes(ch)) await sleep(jitter(250, 700));
  }
}

export function pageText(page, selector) {
  return page.$eval(selector, (el) => el.innerText || el.textContent || '').catch(() => '');
}
