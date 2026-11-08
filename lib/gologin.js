// Shared GoLogin launcher for the Reddit outreach scripts. The profile holds the
// owner's aged Reddit account: fingerprint and a US residential proxy, with the
// cookies (the Reddit session) kept in GoLogin's SERVER-SIDE cookie store. Every
// launch downloads the profile + writes the server cookies into it; every stop
// uploads the profile zip (cookies stripped) and must upload the cookies too, or
// the next launch gets stale cookies and comes up logged out.
//
// Why the legacy GoLogin class instead of GologinApi().launch(): the SDK works
// out the cookie-DB path when the profile id is set, BEFORE the profile folder
// exists, so it falls back to Default/Cookies while Orbita 154 writes
// Default/Network/Cookies. The upload then fails with SQLITE_CANTOPEN and the
// session never reaches the server (seen 2026-11-08). Here the path is fixed
// after start(), when the folder is on disk.
//
// NEVER run two of these scripts at once, and never run one while the same
// profile is open in the GoLogin app: the later upload wins.
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { GoLogin } from 'gologin';
import puppeteer from 'puppeteer-core';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const jitter = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo));

async function cookiesPath(gl) {
  const base = join(gl.tmpdir, `gologin_profile_${gl.profile_id}`, 'Default');
  for (const p of [join(base, 'Network', 'Cookies'), join(base, 'Cookies')]) {
    try { await access(p); return p; } catch { /* try next */ }
  }
  return join(base, 'Network', 'Cookies');
}

export async function withRedditBrowser(fn) {
  const token = process.env.GOLOGIN_TOKEN;
  const profileId = process.env.GOLOGIN_PROFILE_ID;
  if (!token || !profileId) throw new Error('GOLOGIN_TOKEN and GOLOGIN_PROFILE_ID must be set in .env.local');

  const gl = new GoLogin({ token, profile_id: profileId, uploadCookiesToServer: true });
  const started = await gl.start();
  if (!started?.wsUrl) throw new Error('GoLogin start failed: ' + JSON.stringify(started));
  gl.cookiesFilePath = await cookiesPath(gl);

  const browser = await puppeteer.connect({ browserWSEndpoint: started.wsUrl, defaultViewport: null });
  try {
    const page = await browser.newPage();
    return await fn(page, browser);
  } finally {
    await sleep(1500);
    await browser.close().catch(() => {});
    await sleep(2000); // let Chrome flush the cookie DB before we read it
    // If the cookie DB is not where we expect, the SDK would upload an EMPTY
    // cookie set and wipe the server store (= logged out next launch). Skip the
    // cookie upload in that case; the profile zip still goes up.
    gl.cookiesFilePath = await cookiesPath(gl);
    try { await access(gl.cookiesFilePath); } catch { console.error('cookie DB missing at', gl.cookiesFilePath, '— not uploading cookies'); gl.uploadCookiesToServer = false; }
    await gl.stop().catch((e) => console.error('gologin stop failed:', e.message));
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

// Send a Reddit private message. old.reddit.com/message/compose now redirects to
// the new www.reddit.com compose page (checked 2026-11-08): recipient and title
// are prefilled from the query string, the body is a <textarea name="message-content">
// inside a <faceplate-textarea-input> shadow root, and the Send button is a plain
// light-DOM <button type="submit">. Returns { ok, error, finalUrl }.
export async function sendPrivateMessage(page, { to, subject, text, dry = false }) {
  await page.goto(`https://www.reddit.com/message/compose/?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(subject)}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await sleep(jitter(1500, 3000));
  if (/\/login/.test(page.url())) return { ok: false, error: 'redirected to login — profile not signed in', finalUrl: page.url() };

  const areaHandle = await page.waitForFunction(() => {
    const host = document.querySelector('faceplate-textarea-input[name="message-content"]');
    return host?.shadowRoot?.querySelector('textarea') || null;
  }, { timeout: 20_000 }).catch(() => null);
  if (!areaHandle) return { ok: false, error: 'compose box not found (page layout changed?)', finalUrl: page.url() };

  // Recipient check: Reddit greys the field or shows helper text when the user
  // doesn't exist / doesn't accept messages. Read it before typing.
  const recipient = await page.evaluate(() => document.querySelector('faceplate-text-input[name="message-recipient-input"]')?.shadowRoot?.querySelector('input')?.value || '');
  if (recipient.toLowerCase() !== to.toLowerCase()) return { ok: false, error: `recipient field shows "${recipient}"`, finalUrl: page.url() };

  const el = areaHandle.asElement();
  await el.focus();
  await sleep(jitter(400, 900));
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: jitter(35, 120) });
    if ('.!?'.includes(ch)) await sleep(jitter(250, 700));
  }
  await sleep(jitter(800, 1600));
  if (dry) return { ok: true, dry: true, finalUrl: page.url() };

  const send = await page.$$eval('button[type="submit"]', (btns) => {
    const b = btns.find((x) => x.textContent.trim() === 'Send');
    if (!b) return false;
    b.scrollIntoView({ block: 'center' });
    return true;
  });
  if (!send) return { ok: false, error: 'Send button not found', finalUrl: page.url() };
  const sendBtn = (await page.$$('button[type="submit"]')).at(-1);
  const sendHandle = await page.evaluateHandle(() => [...document.querySelectorAll('button[type="submit"]')].find((x) => x.textContent.trim() === 'Send'));
  await (sendHandle.asElement() || sendBtn).click();

  // Success: navigated away from /compose (to the inbox or sent folder) or a toast.
  // Failure: helper text under a field or a toast with an error.
  const t0 = Date.now();
  while (Date.now() - t0 < 15_000) {
    await sleep(1000);
    if (!/\/message\/compose/.test(page.url())) return { ok: true, finalUrl: page.url() };
    const state = await page.evaluate(() => {
      const helpers = [...document.querySelectorAll('faceplate-form-helper-text')].map((h) => (h.shadowRoot?.textContent || h.textContent || '').trim()).filter((t) => t && !/^\d+\/\d+$/.test(t));
      const toast = [...document.querySelectorAll('faceplate-toast, [role="alert"], shreddit-toast')].map((t) => (t.shadowRoot?.textContent || t.textContent || '').trim()).filter(Boolean);
      return { helpers, toast };
    });
    const msgs = [...state.helpers, ...state.toast];
    if (msgs.some((m) => /sent/i.test(m))) return { ok: true, finalUrl: page.url(), note: msgs.join(' | ') };
    if (msgs.length) return { ok: false, error: msgs.join(' | '), finalUrl: page.url() };
  }
  return { ok: false, error: 'no confirmation within 15s', finalUrl: page.url() };
}
