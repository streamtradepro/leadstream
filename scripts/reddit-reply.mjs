#!/usr/bin/env node
// Post a reply to a Reddit lead from the owner's aged account, through the
// GoLogin profile that holds that account's cookies + fingerprint + US
// residential proxy. Runs on the PC where the GoLogin app is installed.
//
//   node scripts/reddit-reply.mjs --lead <uuid>            # uses lead.reply_draft, drafts one if empty
//   node scripts/reddit-reply.mjs --lead <uuid> --text "…"  # your own words
//   node scripts/reddit-reply.mjs --url <post url> --text "…"
//   add --dry to open the post and fill the box WITHOUT clicking Save
//
// Needs in .env.local: GOLOGIN_TOKEN (GoLogin app → API & MCP → New Token, paid
// plans only), GOLOGIN_PROFILE_ID (profile row → ⋯ → Copy ID), SUPABASE_*.
//
// Why old.reddit.com: the new UI renders the comment box inside shadow DOM that
// changes without notice; old.reddit is a plain <form class="usertext"> with a
// <textarea name="text"> and a Save button, and the session cookies are shared.
import 'dotenv/config';
import { config } from 'dotenv';
import { GologinApi } from 'gologin';
import { db } from '../lib/db.js';
import { draftReply } from '../lib/classify.js';

config({ path: '.env.local', override: false });

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? true : arr[i + 1]]);
    return acc;
  }, []),
);

const token = process.env.GOLOGIN_TOKEN;
const profileId = process.env.GOLOGIN_PROFILE_ID;
if (!token || !profileId) {
  console.error('GOLOGIN_TOKEN and GOLOGIN_PROFILE_ID must be set in .env.local');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo));

function toOldReddit(url) {
  const u = new URL(url);
  u.hostname = 'old.reddit.com';
  u.search = '';
  return u.toString();
}

// Type like a person: variable per-key delay, occasional pause at sentence ends.
async function humanType(page, selector, text) {
  await page.click(selector);
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: jitter(35, 120) });
    if ('.!?'.includes(ch)) await sleep(jitter(250, 700));
  }
}

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
    if (!text) {
      text = lead.reply_draft;
      if (!text) {
        console.log('no reply_draft on the lead, drafting one…');
        text = await draftReply(lead);
        await db().from('leads').update({ reply_draft: text }).eq('id', lead.id);
      }
    }
  }
  if (!url || !text) throw new Error('need --lead <id> or --url <post> plus --text');

  console.log('post :', url);
  console.log('reply:', text.replace(/\s+/g, ' ').slice(0, 200) + (text.length > 200 ? '…' : ''));
  if (args.dry) console.log('DRY RUN — will fill the box but not click Save');

  const GL = GologinApi({ token });
  const { browser } = await GL.launch({ profileId });
  try {
    const page = await browser.newPage();
    await page.goto(toOldReddit(url), { waitUntil: 'domcontentloaded', timeout: 60_000 });

    // Logged in? old.reddit shows the username in the header; the login form otherwise.
    const loggedIn = await page.$('#header-bottom-right .user a');
    if (!loggedIn) throw new Error('profile is not logged into Reddit — run it from the GoLogin app and sign in once');

    // The top-level comment form sits under .commentarea; archived/locked posts have none.
    const box = '.commentarea > form.usertext textarea[name="text"]';
    const has = await page.$(box);
    if (!has) throw new Error('no comment box on this post (archived, locked, or layout changed)');

    await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), box);
    await sleep(jitter(1200, 2500)); // read the post for a moment
    await humanType(page, box, text);
    await sleep(jitter(800, 1800));

    if (args.dry) {
      console.log('dry run complete; leaving the browser open for 60s so you can look');
      await sleep(60_000);
      return;
    }

    await page.click('.commentarea > form.usertext .usertext-buttons button[type="submit"]');
    // Reddit inserts the new comment at the top of the thread with our username on it.
    const me = await page.$eval('#header-bottom-right .user a', (a) => a.textContent.trim());
    await page.waitForFunction(
      (name) => [...document.querySelectorAll('.commentarea .comment .author')].some((a) => a.textContent.trim() === name),
      { timeout: 30_000 },
      me,
    );
    const permalink = await page.evaluate((name) => {
      const author = [...document.querySelectorAll('.commentarea .comment .author')].find((a) => a.textContent.trim() === name);
      return author?.closest('.comment')?.querySelector('a.bylink')?.href || null;
    }, me);
    console.log('posted as', me, permalink || '');

    if (lead) {
      await db().from('leads').update({
        status: 'replied',
        handled_by: `gologin:${me}`,
        handled_at: new Date().toISOString(),
        reply_permalink: permalink,
      }).eq('id', lead.id).then(({ error }) => {
        // reply_permalink may not exist yet; the status update is what matters.
        if (error) return db().from('leads').update({ status: 'replied', handled_by: `gologin:${me}`, handled_at: new Date().toISOString() }).eq('id', lead.id);
      });
    }
  } finally {
    await sleep(1500);
    await GL.exit();
  }
}

main().catch((e) => {
  console.error('reddit-reply failed:', e.message);
  process.exit(1);
});
