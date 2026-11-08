// One-time: open the Reddit GoLogin profile from code so the OWNER can sign in
// inside it; the session is then saved on the code path. Waits up to 10 minutes.
import { config } from 'dotenv';
import { GologinApi } from 'gologin';
config({ path: '.env.local' });
const GL = GologinApi({ token: process.env.GOLOGIN_TOKEN });
const { browser } = await GL.launch({ profileId: process.env.GOLOGIN_PROFILE_ID });
const page = await browser.newPage();
await page.goto('https://old.reddit.com/login/?dest=https%3A%2F%2Fold.reddit.com%2Fmessage%2Finbox%2F', { waitUntil: 'domcontentloaded', timeout: 60000 });
console.log('browser open — owner signs in now; waiting up to 10 min');
const t0 = Date.now();
let user = null;
while (Date.now() - t0 < 600000 && !user) {
  await new Promise((r) => setTimeout(r, 5000));
  try {
    for (const p of await browser.pages()) {
      const u = await p.$eval('#header-bottom-right .user a', (a) => a.textContent.trim()).catch(() => null);
      if (u) { user = u; break; }
      const nu = await p.evaluate(() => document.querySelector('[data-testid="user-drawer-button"], #expand-user-drawer-button, shreddit-app')?.tagName ? (document.cookie.includes('reddit_session') || null) : null).catch(() => null);
      if (nu && !user) user = 'new-ui-session';
    }
  } catch {}
}
console.log(user ? `logged in as ${user}` : 'timed out, not logged in');
await new Promise((r) => setTimeout(r, 3000));
await GL.exit();
console.log('profile saved and closed');
