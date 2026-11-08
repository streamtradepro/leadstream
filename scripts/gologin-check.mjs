// Smoke test: launch the Reddit GoLogin profile from code and confirm it is logged in.
import { config } from 'dotenv';
import { GologinApi } from 'gologin';
config({ path: '.env.local' });
const GL = GologinApi({ token: process.env.GOLOGIN_TOKEN });
const t0 = Date.now();
const { browser } = await GL.launch({ profileId: process.env.GOLOGIN_PROFILE_ID });
console.log('launched in', ((Date.now() - t0) / 1000).toFixed(1), 's');
const page = await browser.newPage();
await page.goto('https://old.reddit.com/message/inbox/', { waitUntil: 'domcontentloaded', timeout: 60000 });
const user = await page.$eval('#header-bottom-right .user a', (a) => a.textContent.trim()).catch(() => null);
const unread = await page.$$eval('.message.unread, .message.new', (m) => m.length).catch(() => -1);
const ip = await page.evaluate(() => fetch('https://api.ipify.org?format=json').then((r) => r.json()).then((j) => j.ip).catch(() => null));
console.log({ user, unreadMessages: unread, ip });
await GL.exit();
console.log('closed');
