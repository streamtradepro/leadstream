#!/usr/bin/env node
// Read the owner's Reddit private-message inbox through the GoLogin profile,
// store new replies on their leads, push the team, and draft (or send) the
// follow-up.
//
//   node scripts/reddit-inbox.mjs            # read inbox, store, push, DRAFT follow-ups (approval mode)
//   node scripts/reddit-inbox.mjs --auto     # …and SEND the follow-ups
//   node scripts/reddit-inbox.mjs --dry      # read + print only, write nothing
//
// Stop rule: after 3 outbound messages to one person we stop drafting and mark
// the lead dm_status=closed. Anything about price/time is pointed at the phone
// line by the prompt in lib/classify.js draftDmFollowup.
import { config } from 'dotenv';
config({ path: '.env.local' });
import { db } from '../lib/db.js';
import { draftDmFollowup } from '../lib/classify.js';
import { sendPush } from '../lib/push.js';
import { withRedditBrowser, redditUser, gotoOld, humanType, sleep, jitter, pageText } from '../lib/gologin.js';

const AUTO = process.argv.includes('--auto');
const DRY = process.argv.includes('--dry');
const MAX_OUT_PER_USER = Number(process.env.DM_MAX_PER_USER || 3);

async function readInbox(page) {
  // /message/messages/ = private messages only (no comment replies / mentions).
  await gotoOld(page, 'https://old.reddit.com/message/messages/');
  return page.$$eval('.message', (els) => els.map((el) => ({
    id: el.getAttribute('data-fullname'),               // t4_xxxx
    author: el.getAttribute('data-author') || el.querySelector('.author')?.textContent?.trim() || null,
    subject: el.querySelector('.subject')?.textContent?.trim() || '',
    body: el.querySelector('.md')?.innerText?.trim() || '',
    at: el.querySelector('time')?.getAttribute('datetime') || null,
    unread: el.classList.contains('new') || !!el.querySelector('.unread'),
  })).filter((m) => m.id && m.author));
}

async function sendReply(page, to, subject, text) {
  await gotoOld(page, `https://old.reddit.com/message/compose/?to=${encodeURIComponent(to)}&subject=${encodeURIComponent(subject)}`);
  const box = '#compose-message textarea[name="text"]';
  await page.waitForSelector(box, { timeout: 15_000 });
  await sleep(jitter(900, 2000));
  await humanType(page, box, text);
  await sleep(jitter(600, 1400));
  await page.click('#compose-message button[type="submit"], #compose-message .btn');
  await sleep(2500);
  const status = (await pageText(page, '#compose-message .status')).trim();
  const errs = await page.$$eval('#compose-message .error', (els) => els.map((e) => e.textContent.trim()).filter(Boolean)).catch(() => []);
  const ok = /delivered/i.test(status) || /\/message\/(sent|inbox)/.test(page.url());
  return { ok, error: ok ? null : (errs.join(' | ') || status || 'no confirmation') };
}

async function main() {
  const summary = { seen: 0, new_inbound: 0, drafted: 0, sent: 0, closed: 0, unmatched: 0 };
  await withRedditBrowser(async (page) => {
    const me = await (async () => { await gotoOld(page, 'https://old.reddit.com/'); return redditUser(page); })();
    if (!me) throw new Error('profile is not logged into Reddit — run scripts/gologin-login.mjs');

    const msgs = await readInbox(page);
    summary.seen = msgs.length;
    const inbound = msgs.filter((m) => m.author.toLowerCase() !== me.toLowerCase());
    if (!inbound.length) return;

    const { data: known } = await db().from('reddit_dms').select('reddit_message_id').in('reddit_message_id', inbound.map((m) => m.id));
    const knownIds = new Set((known || []).map((k) => k.reddit_message_id));
    const fresh = inbound.filter((m) => !knownIds.has(m.id));
    if (DRY) { console.log(JSON.stringify(fresh, null, 2)); return; }

    let tokens = null;
    for (const m of fresh) {
      summary.new_inbound++;
      // Which lead did this come from? The most recent one we DM'd for this user.
      const { data: out } = await db().from('reddit_dms').select('lead_id').eq('reddit_user', m.author).eq('direction', 'out').not('lead_id', 'is', null)
        .order('created_at', { ascending: false }).limit(1);
      const leadId = out?.[0]?.lead_id || null;
      await db().from('reddit_dms').insert({ lead_id: leadId, reddit_user: m.author, direction: 'in', subject: m.subject, body: m.body, reddit_message_id: m.id, status: 'received', created_at: m.at || new Date().toISOString() });
      if (!leadId) { summary.unmatched++; console.log(`inbound from u/${m.author} with no matching lead — left for a human`); continue; }

      const { data: lead } = await db().from('leads').select('*').eq('id', leadId).single();
      await db().from('leads').update({ dm_status: 'replied' }).eq('id', leadId);

      if (!tokens) {
        const { data: devices } = await db().from('devices').select('expo_push_token');
        tokens = (devices || []).map((d) => d.expo_push_token);
      }
      await sendPush(tokens, { title: `💬 u/${m.author} replied — ${[lead.city, lead.state].filter(Boolean).join(', ') || 'r/' + lead.subreddit}`, body: m.body.slice(0, 150), data: { url: 'https://old.reddit.com/message/messages/', lead_id: leadId } });

      const { data: thread } = await db().from('reddit_dms').select('direction,body,status').eq('reddit_user', m.author).order('created_at', { ascending: true });
      const outCount = (thread || []).filter((t) => t.direction === 'out' && t.status === 'sent').length;
      if (outCount >= MAX_OUT_PER_USER) {
        await db().from('leads').update({ dm_status: 'closed' }).eq('id', leadId);
        summary.closed++;
        continue;
      }

      const reply = await draftDmFollowup(lead, (thread || []).filter((t) => t.status !== 'queued' && t.status !== 'failed'));
      const subject = m.subject.startsWith('re:') ? m.subject : `re: ${m.subject}`;
      if (!AUTO) {
        await db().from('reddit_dms').insert({ lead_id: leadId, reddit_user: m.author, direction: 'out', subject, body: reply, sent_by: 'auto-draft', status: 'queued' });
        summary.drafted++;
        console.log(`drafted for u/${m.author}: ${reply.slice(0, 120)}…`);
        continue;
      }
      const r = await sendReply(page, m.author, subject, reply);
      await db().from('reddit_dms').insert({ lead_id: leadId, reddit_user: m.author, direction: 'out', subject, body: reply, sent_by: 'auto', status: r.ok ? 'sent' : 'failed', error: r.error });
      if (r.ok) { summary.sent++; await db().from('leads').update({ dm_count: (lead.dm_count || 0) + 1 }).eq('id', leadId); }
      else console.error(`send to u/${m.author} failed: ${r.error}`);
      await sleep(jitter(4000, 9000));
    }
  });
  console.log(JSON.stringify(summary));
}

main().catch((e) => { console.error('reddit-inbox failed:', e.message); process.exit(1); });
