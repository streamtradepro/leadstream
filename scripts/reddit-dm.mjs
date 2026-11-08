#!/usr/bin/env node
// Send a private Reddit message to a lead from the owner's account via GoLogin.
//
//   node scripts/reddit-dm.mjs --lead <uuid>              # AI-drafted, disclosed DM with the phone line
//   node scripts/reddit-dm.mjs --lead <uuid> --text "…"    # your own words
//   node scripts/reddit-dm.mjs --user <name> --text "…"    # ad-hoc, no lead
//   --dry    open compose and fill it, do NOT send (window stays open 60s)
//   --force  ignore the daily cap, the 48h freshness rule and dm_status
//
// Guard rails (Reddit bans the account for PATTERN, not for the proxy):
//   DM_DAILY_CAP (default 6) outbound DMs per calendar day, UTC
//   only leads posted in the last 48h, never the same user twice
import { config } from 'dotenv';
config({ path: '.env.local' });
import { db } from '../lib/db.js';
import { draftDm } from '../lib/classify.js';
import { withRedditBrowser, redditUser, gotoOld, humanType, sleep, jitter, pageText } from '../lib/gologin.js';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (!a.startsWith('--')) continue;
  const next = process.argv[i + 1];
  args[a.slice(2)] = next === undefined || next.startsWith('--') ? true : next;
}

const CAP = Number(process.env.DM_DAILY_CAP || 6);
const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);

async function main() {
  let lead = null;
  let user = args.user;
  let text = typeof args.text === 'string' ? args.text : null;

  if (args.lead) {
    const { data, error } = await db().from('leads').select('*').eq('id', args.lead).single();
    if (error || !data) throw new Error('lead not found: ' + (error?.message || args.lead));
    lead = data;
    user = user || lead.author;
    if (!args.force) {
      if (lead.dm_status) throw new Error(`lead already has dm_status=${lead.dm_status}`);
      const ageH = (Date.now() - new Date(lead.posted_at || lead.created_at).getTime()) / 36e5;
      if (ageH > 48) throw new Error(`post is ${ageH.toFixed(0)}h old; DMs only go to posts under 48h (--force to override)`);
    }
  }
  if (!user) throw new Error('need --lead <id> or --user <name>');
  if (!user || /^\[deleted\]$/i.test(user)) throw new Error('author is deleted');

  if (!args.force) {
    const { count } = await db().from('reddit_dms').select('id', { count: 'exact', head: true })
      .eq('direction', 'out').eq('status', 'sent').gte('created_at', dayStart.toISOString());
    if ((count || 0) >= CAP) throw new Error(`daily cap reached (${count}/${CAP})`);
    const { count: prior } = await db().from('reddit_dms').select('id', { count: 'exact', head: true })
      .eq('direction', 'out').eq('reddit_user', user);
    if (prior) throw new Error(`already messaged u/${user} before`);
  }

  if (!text) {
    if (!lead) throw new Error('--text is required without --lead');
    text = await draftDm(lead);
  }
  const subject = lead ? `your ${lead.category?.replace(/_/g, ' ') || 'repair'} post` : 'your post';

  console.log('to     :', 'u/' + user);
  console.log('subject:', subject);
  console.log('message:', text);
  if (args.dry) console.log('DRY RUN — will fill compose but not send');

  await withRedditBrowser(async (page) => {
    await gotoOld(page, `https://old.reddit.com/message/compose/?to=${encodeURIComponent(user)}&subject=${encodeURIComponent(subject)}`);
    const me = await redditUser(page);
    if (!me) throw new Error('profile is not logged into Reddit — run scripts/gologin-login.mjs and sign in');

    const box = '#compose-message textarea[name="text"]';
    await page.waitForSelector(box, { timeout: 15_000 });
    await sleep(jitter(1000, 2200));
    await humanType(page, box, text);
    await sleep(jitter(700, 1500));

    if (args.dry) {
      console.log('dry run: compose filled, leaving the window open 60s');
      await sleep(60_000);
      return;
    }

    await page.click('#compose-message button[type="submit"], #compose-message .btn');
    // old reddit answers inline: ".status" says "your message has been delivered",
    // ".error" carries USER_DOESNT_EXIST / NOT_WHITELISTED_BY_USER_MESSAGE / RATELIMIT.
    await sleep(2500);
    const status = (await pageText(page, '#compose-message .status')).trim();
    const errs = await page.$$eval('#compose-message .error', (els) => els.map((e) => e.textContent.trim()).filter(Boolean)).catch(() => []);
    const delivered = /delivered/i.test(status) || /\/message\/(sent|inbox)/.test(page.url());
    const errText = errs.join(' | ');
    const unreachable = /doesn'?t accept|not accepting|whitelist|blocked|doesn'?t exist|USER_DOESNT_EXIST/i.test(errText);

    const row = {
      lead_id: lead?.id || null, reddit_user: user, direction: 'out', subject, body: text,
      sent_by: args.text ? 'owner' : 'auto', status: delivered ? 'sent' : 'failed', error: delivered ? null : (errText || status || 'no confirmation'),
    };
    await db().from('reddit_dms').insert(row);

    if (lead) {
      const patch = delivered
        ? { dm_status: 'sent', dm_count: (lead.dm_count || 0) + 1, status: 'replied', handled_by: `gologin-dm:${me}`, handled_at: new Date().toISOString() }
        : unreachable ? { dm_status: 'unreachable' } : {};
      if (Object.keys(patch).length) await db().from('leads').update(patch).eq('id', lead.id);
    }
    if (!delivered) throw new Error('not delivered: ' + (errText || status || 'no confirmation on page'));
    console.log(`sent as ${me}`);
  });
}

main().catch((e) => { console.error('reddit-dm failed:', e.message); process.exit(1); });
