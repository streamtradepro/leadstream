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

  // GoLogin's shared residential proxy hands out a different exit IP per session
  // and some exits cannot reach reddit.com at all (chrome-error://chromewebdata).
  // Probe once after launch and relaunch for a fresh exit, up to 3 times.
  let gl, browser, page;
  for (let attempt = 1; ; attempt++) {
    gl = new GoLogin({ token, profile_id: profileId, uploadCookiesToServer: true });
    const started = await gl.start();
    if (!started?.wsUrl) throw new Error('GoLogin start failed: ' + JSON.stringify(started));
    gl.cookiesFilePath = await cookiesPath(gl);
    browser = await puppeteer.connect({ browserWSEndpoint: started.wsUrl, defaultViewport: null });
    page = await browser.newPage();
    await page.goto('https://www.reddit.com/robots.txt', { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
    if (!/^chrome-error:/.test(page.url())) break;
    console.warn(`reddit unreachable through this proxy exit (attempt ${attempt}); relaunching for a new IP…`);
    await browser.close().catch(() => {});
    gl.uploadCookiesToServer = false; // nothing changed; do not touch the server cookie store
    await gl.stop().catch(() => {});
    if (attempt >= 3) throw new Error('reddit unreachable through the GoLogin proxy after 3 launches');
    await sleep(jitter(3000, 7000));
  }
  try {
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
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(u.toString(), { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    await sleep(jitter(600, 1400));
    if (!/^chrome-error:/.test(page.url())) return;
    console.warn('page failed to load (proxy blip), retrying…'); // chrome-error://chromewebdata/
    await sleep(jitter(3000, 6000));
  }
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

// Legacy private message (the "messages" inbox, not Chat) through old Reddit's own
// form endpoint, called from inside the logged-in page so cookies and the modhash
// apply. The new compose page sends a CHAT request instead, which most accounts
// block from strangers ("You can't message that user" / "unable to send a message
// request"); classic PMs are usually still open. Returns { ok, error, raw }.
export async function sendLegacyPm(page, { to, subject, text }) {
  if (!/old\.reddit\.com/.test(page.url())) await gotoOld(page, 'https://old.reddit.com/');
  await sleep(jitter(500, 1200));
  return page.evaluate(async ({ to, subject, text }) => {
    try {
      const me = await fetch('/api/me.json', { credentials: 'include' }).then((r) => r.json());
      const uh = me?.data?.modhash;
      if (!uh) return { ok: false, error: 'no modhash — not logged in' };
      const body = new URLSearchParams({ api_type: 'json', to, subject, text, uh });
      const res = await fetch('/api/compose', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Modhash': uh }, body });
      const raw = await res.text();
      let j = null; try { j = JSON.parse(raw); } catch { /* html */ }
      const errs = j?.json?.errors || [];
      if (res.ok && j && errs.length === 0) return { ok: true, raw: raw.slice(0, 200) };
      return { ok: false, error: errs.map((e) => e.join(': ')).join(' | ') || `HTTP ${res.status}`, raw: raw.slice(0, 300) };
    } catch (e) { return { ok: false, error: 'fetch failed: ' + e.message }; }
  }, { to, subject, text });
}

// Send a Reddit private message. old.reddit.com/message/compose now redirects to
// the new www.reddit.com compose page (checked 2026-11-08): recipient and title
// are prefilled from the query string, the body is a <textarea name="message-content">
// inside a <faceplate-textarea-input> shadow root, and the Send button is a plain
// light-DOM <button type="submit">. Returns { ok, error, finalUrl }.
export async function sendPrivateMessage(page, { to, subject, text, dry = false }) {
  const composeUrl = `https://www.reddit.com/message/compose/?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(subject)}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(composeUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
    await sleep(jitter(1500, 3000));
    if (!/^chrome-error:/.test(page.url())) break; // proxy hiccup: chrome-error://chromewebdata/
    console.warn('compose page failed to load (proxy blip), retrying…');
    await sleep(jitter(3000, 6000));
  }
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

  // Reddit validates the recipient as soon as the form is touched. The verdict
  // ("You are unable to send a message request to this account.", "user not
  // found") is rendered INSIDE the recipient field's shadow root, and the Send
  // button stays disabled while any field is invalid. Read both before sending.
  const formState = () => page.evaluate(() => {
    const btn = [...document.querySelectorAll('button[type="submit"]')].find((x) => x.textContent.trim() === 'Send');
    const errs = [];
    const scan = (root) => {
      for (const el of root.querySelectorAll('*')) {
        if (el.shadowRoot) scan(el.shadowRoot);
      }
      const txt = (root.textContent || '').replace(/\s+/g, ' ');
      const m = txt.match(/[^.]*\b(unable to|can'?t send|cannot send|not accept|doesn'?t exist|not found|invalid|blocked|rate ?limit|too many)\b[^.]*\./i);
      if (m) errs.push(m[0].trim());
    };
    for (const host of document.querySelectorAll('faceplate-text-input, faceplate-textarea-input, faceplate-form-helper-text')) if (host.shadowRoot) scan(host.shadowRoot);
    for (const t of document.querySelectorAll('faceplate-toast, shreddit-toast, [role="alert"]')) errs.push((t.shadowRoot?.textContent || t.textContent || '').trim());
    return { hasBtn: !!btn, disabled: !!btn?.disabled, errors: [...new Set(errs.filter(Boolean))] };
  });

  let st = await formState();
  if (!st.hasBtn) return { ok: false, error: 'Send button not found', finalUrl: page.url() };
  if (st.disabled) {
    await sleep(1500);
    st = await formState();
    if (st.disabled) return { ok: false, error: st.errors.join(' | ') || 'Send disabled (recipient rejected?)', finalUrl: page.url() };
  }
  if (dry) return { ok: true, dry: true, finalUrl: page.url() };

  // Capture the GraphQL answer to the send so we are not guessing from the UI.
  const gql = [];
  const onResp = async (r) => {
    try {
      if (r.request().method() !== 'POST' || !/svc\/shreddit\/graphql/.test(r.url())) return;
      const body = await r.text().catch(() => '');
      gql.push({ status: r.status(), body: body.slice(0, 600) });
    } catch { /* ignore */ }
  };
  page.on('response', onResp);
  const btn = await page.evaluateHandle(() => [...document.querySelectorAll('button[type="submit"]')].find((x) => x.textContent.trim() === 'Send'));
  const box = await btn.asElement().boundingBox();
  await page.mouse.move(box.x + box.width / 2 + jitter(-5, 5), box.y + box.height / 2 + jitter(-3, 3));
  await sleep(jitter(150, 400));
  await page.mouse.down(); await sleep(jitter(40, 110)); await page.mouse.up();

  let result = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 15_000 && !result) {
    await sleep(1000);
    if (!/\/message\/compose/.test(page.url())) { result = { ok: true, finalUrl: page.url() }; break; }
    const now = await formState();
    if (now.errors.some((e) => /sent|delivered/i.test(e))) { result = { ok: true, finalUrl: page.url(), note: now.errors.join(' | ') }; break; }
    if (now.errors.length) { result = { ok: false, error: now.errors.join(' | '), finalUrl: page.url() }; break; }
    const bad = gql.find((g) => g.status >= 400 || /"errors"\s*:\s*\[\s*\{/.test(g.body));
    if (bad) { result = { ok: false, error: `graphql ${bad.status}: ${bad.body.slice(0, 200)}`, finalUrl: page.url() }; break; }
    const good = gql.find((g) => /"ok"\s*:\s*true|createMessage|sendMessage|"message"\s*:\s*\{/i.test(g.body));
    if (good) { result = { ok: true, finalUrl: page.url(), note: good.body.slice(0, 120) }; break; }
  }
  page.off('response', onResp);
  return result || { ok: false, error: 'no confirmation within 15s', finalUrl: page.url(), gql: gql.slice(0, 3) };
}
