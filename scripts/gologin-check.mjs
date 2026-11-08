// Smoke test: launch the Reddit GoLogin profile from code, confirm login + proxy IP.
import { config } from 'dotenv';
config({ path: '.env.local' });
import { withRedditBrowser, redditUser, gotoOld } from '../lib/gologin.js';
const t0 = Date.now();
await withRedditBrowser(async (page) => {
  console.log('launched in', ((Date.now() - t0) / 1000).toFixed(1), 's');
  await gotoOld(page, 'https://old.reddit.com/message/inbox/');
  const user = await redditUser(page);
  const ip = await page.evaluate(() => fetch('https://api.ipify.org?format=json').then((r) => r.json()).then((j) => j.ip).catch(() => null));
  console.log(JSON.stringify({ user, url: page.url(), ip }));
});
