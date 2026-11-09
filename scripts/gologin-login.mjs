// One-time: open the Reddit GoLogin profile from code so the OWNER can sign in
// inside it. When the session is detected the browser closes and the cookies
// are uploaded to GoLogin's server store, which is what every later launch
// reads. Waits up to 15 minutes.
import { config } from 'dotenv';
config({ path: '.env.local' });
import { withRedditBrowser, sleep } from '../lib/gologin.js';

const LIMIT_MS = 15 * 60_000;

const user = await withRedditBrowser(async (page, browser) => {
  await page.goto('https://old.reddit.com/login/?dest=https%3A%2F%2Fold.reddit.com%2Fmessage%2Finbox%2F', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  console.log('browser open — owner signs in now; waiting up to 15 min');

  // A second tab on old.reddit polls /api/me.json, which is {} until logged in.
  const probe = await browser.newPage();
  await probe.goto('https://old.reddit.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.bringToFront();

  const t0 = Date.now();
  while (Date.now() - t0 < LIMIT_MS) {
    await sleep(5000);
    const name = await Promise.race([
      probe.evaluate(() => fetch('/api/me.json', { credentials: 'include' }).then((r) => r.json()).then((j) => j?.data?.name || null).catch(() => null)),
      sleep(8000).then(() => null),
    ]).catch(() => null);
    if (name) return name;
  }
  return null;
});

if (user) console.log(`logged in as ${user}; profile + cookies uploaded`);
else { console.log('timed out, not logged in'); process.exit(1); }
