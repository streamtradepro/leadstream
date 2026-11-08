#!/usr/bin/env node
// Post a public comment on a Reddit lead from the owner's account, through the
// GoLogin profile (cookies + fingerprint + US residential proxy).
//
//   node scripts/reddit-reply.mjs --lead <uuid>                 # short "I manage a … company" comment, no phone (default)
//   node scripts/reddit-reply.mjs --lead <uuid> --style helpful  # longer diagnostic reply, no company mention
//   node scripts/reddit-reply.mjs --lead <uuid> --text "…"       # your own words
//   node scripts/reddit-reply.mjs --url <post url> --text "…"
//   --dry    open the post and fill the box WITHOUT clicking Save (window stays open 60s)
//   --force  ignore the daily cap and the already-replied check
//
// Why old.reddit.com: the comment box is a plain <form class="usertext"> with a
// <textarea name="text"> and a Save button; the new UI is shadow DOM that changes.
// Guard rail: COMMENT_DAILY_CAP (default 8) per calendar day, UTC.
import { config } from 'dotenv';
config({ path: '.env.local' });
import { db } from '../lib/db.js';
import { draftComment, draftReply } from '../lib/classify.js';
import { withRedditBrowser, redditUser, gotoOld, humanType, sleep, jitter } from '../lib/gologin.js';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const next = process.argv[i + 1];
  args[a.slice(2)] = next === undefined || next.startsWith('--') ? true : next;
}
const CAP = Number(process.env.COMMENT_DAILY_CAP || 8);
const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);

async function main() {
  let lead = null;
  let url = args.url;
  let text = typeof args.text === 'string' ? args.text : null;

  if (args.lead) {
    const { data, error } = await db().from('leads').select('*').eq('id', args.lead).single();
    if (error || !data) throw new Error('lead not found: ' + (error?.message || args.lead));
    lead = data;
    url = url || lead.url;
    if (lead.status === 'replied' && !args.force) throw new Error(`lead already replied by ${lead.handled_by || 'someone'}; pass --force to post anyway`);
  }
  if (!url) throw new Error('need --lead <id> or --url <post>');
  if (!args.force) {
    const { count } = await db().from('leads').select('id', { count: 'exact', head: true }).like('handled_by', 'gologin:%').gte('handled_at', dayStart.toISOString());
    if ((count || 0) >= CAP) throw new Error(`daily comment cap reached (${count}/${CAP})`);
  }
  if (!text) {
    if (!lead) throw new Error('--text is required without --lead');
    text = args.style === 'helpful' ? await draftReply(lead) : await draftComment(lead);
  }

  console.log('post   :', url);
  console.log('comment:', text);
  if (args.dry) console.log('DRY RUN — will fill the box but not click Save');

  await withRedditBrowser(async (page) => {
    await gotoOld(page, url);
    const me = await redditUser(page);
    if (!me) throw new Error('profile is not logged into Reddit — run scripts/gologin-login.mjs and sign in');

    const box = '.commentarea > form.usertext textarea[name="text"]';
    if (!(await page.$(box))) {
      const note = await page.$eval('.commentarea', (el) => el.innerText.replace(/\s+/g, ' ').slice(0, 160)).catch(() => '');
      throw new Error('no comment box on this post (archived, locked, or layout changed): ' + note);
    }
    await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), box);
    await sleep(jitter(1500, 3000)); // read the post for a moment
    await humanType(page, box, text);
    await sleep(jitter(800, 1800));

    if (args.dry) {
      console.log('dry run complete; leaving the browser open for 60s');
      await sleep(60_000);
      return;
    }

    await page.click('.commentarea > form.usertext .usertext-buttons button[type="submit"]');
    // Reddit inserts the new comment at the top of the thread with our username on it.
    await page.waitForFunction(
      (name) => [...document.querySelectorAll('.commentarea .comment .author')].some((a) => a.textContent.trim() === name),
      { timeout: 30_000 },
      me,
    ).catch(async () => {
      const err = await page.$eval('.commentarea form.usertext .error', (e) => e.textContent.trim()).catch(() => '');
      throw new Error('comment did not appear within 30s' + (err ? ': ' + err : ''));
    });
    const permalink = await page.evaluate((name) => {
      const author = [...document.querySelectorAll('.commentarea .comment .author')].find((a) => a.textContent.trim() === name);
      return author?.closest('.comment')?.querySelector('a.bylink')?.href || null;
    }, me);
    console.log('posted as', me, permalink || '');

    if (lead) {
      await db().from('leads').update({ status: 'replied', handled_by: `gologin:${me}`, handled_at: new Date().toISOString(), reply_draft: text }).eq('id', lead.id);
    }
  });
}

main().catch((e) => { console.error('reddit-reply failed:', e.message); process.exit(1); });
