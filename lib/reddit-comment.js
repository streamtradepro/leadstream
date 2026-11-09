// Post a public comment on a Reddit post from inside the GoLogin page (old.reddit.com
// comment form), and verify it from the account's own comment history when the
// thread does not show it (subreddit filters hide a comment from everyone but
// its author, and a rate-limited submit shows nothing at all).
import { gotoOld, redditUser, humanType, sleep, jitter } from './gologin.js';
import { db } from './db.js';

const BOX = '.commentarea > form.usertext textarea[name="text"]';
export const postIdOf = (url) => (String(url).match(/\/comments\/([a-z0-9]+)/i) || [])[1] || null;

// Does our comment history show a comment on this post? → { found, permalink }
export async function findOwnComment(page, me, postId) {
  await gotoOld(page, `https://old.reddit.com/user/${me}/comments/?limit=25`);
  const permalink = await page.evaluate((pid) => {
    const a = [...document.querySelectorAll('.comment a.bylink')].find((x) => new RegExp('/comments/' + pid + '/', 'i').test(x.href));
    return a?.href || null;
  }, postId);
  return { found: !!permalink, permalink };
}

// → { ok, me, permalink, note, error, rateLimited }
export async function postComment(page, { url, text, dry = false }) {
  await gotoOld(page, url);
  const me = await redditUser(page);
  if (!me) return { ok: false, error: 'profile is not logged into Reddit — run scripts/gologin-login.mjs and sign in' };

  if (!(await page.$(BOX))) {
    const note = await page.$eval('.commentarea', (el) => el.innerText.replace(/\s+/g, ' ').slice(0, 160)).catch(() => '');
    return { ok: false, me, error: 'no comment box on this post (archived, locked, or layout changed): ' + note };
  }
  await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), BOX);
  await sleep(jitter(1500, 3000)); // read the post for a moment
  await humanType(page, BOX, text);
  await sleep(jitter(800, 1800));
  if (dry) return { ok: true, me, dry: true };

  await page.click('.commentarea > form.usertext .usertext-buttons button[type="submit"]');
  const appeared = await page.waitForFunction(
    (name) => [...document.querySelectorAll('.commentarea .comment .author')].some((a) => a.textContent.trim() === name),
    { timeout: 30_000 }, me,
  ).then(() => true).catch(() => false);

  if (appeared) {
    const permalink = await page.evaluate((name) => {
      const author = [...document.querySelectorAll('.commentarea .comment .author')].find((a) => a.textContent.trim() === name);
      return author?.closest('.comment')?.querySelector('a.bylink')?.href || null;
    }, me);
    return { ok: true, me, permalink };
  }

  // Reddit's inline error ("you are doing that too much. try again in N minutes" = rate limit).
  const err = await page.$eval('.commentarea form.usertext .error, .commentarea form.usertext .status', (e) => e.textContent.trim()).catch(() => '');
  if (/too much|try again in/i.test(err)) return { ok: false, me, error: 'reddit comment rate limit: ' + err, rateLimited: true };

  // Not in the thread — posted but filtered, or not posted at all? Our history knows.
  const own = await findOwnComment(page, me, postIdOf(url)).catch(() => ({ found: false }));
  if (own.found) return { ok: true, me, permalink: own.permalink, note: 'posted but not visible in the thread — probably held by the subreddit filter' };
  return { ok: false, me, error: 'comment did not appear within 30s and is not in our comment history' + (err ? ': ' + err : '') };
}

// Record the outcome on the lead. Success → replied. Failure → keep it visible in the
// app (status new) but mark handled_by 'gologin-failed:…' so automation never retries
// it: the comment may have gone through without us seeing it (double post risk).
export async function recordCommentResult(lead, r, text) {
  if (r.ok) return db().from('leads').update({ status: 'replied', handled_by: `gologin:${r.me}`, handled_at: new Date().toISOString(), reply_draft: text }).eq('id', lead.id);
  return db().from('leads').update({ handled_by: `gologin-failed:${(r.error || 'unknown').slice(0, 80)}`, handled_at: new Date().toISOString() }).eq('id', lead.id);
}
