#!/usr/bin/env node
// Post a public comment on a Reddit lead from the owner's account, through the
// GoLogin profile (cookies + fingerprint + US residential proxy).
//
//   node scripts/reddit-reply.mjs --lead <uuid>                 # short "I manage a … company" comment, no phone (default)
//   node scripts/reddit-reply.mjs --lead <uuid> --style helpful  # longer diagnostic reply, no company mention
//   node scripts/reddit-reply.mjs --lead <uuid> --text "…"       # your own words
//   node scripts/reddit-reply.mjs --url <post url> --text "…"
//   --dry    open the post and fill the box WITHOUT clicking Save (window stays open 60s)
//   --force  ignore the daily cap, the already-replied check and the already-failed check
//
// Posting itself lives in lib/reddit-comment.js (shared with the daily loop).
// Guard rail: COMMENT_DAILY_CAP (default 8) per calendar day, UTC.
import { config } from 'dotenv';
config({ path: '.env.local' });
import { db } from '../lib/db.js';
import { draftComment, draftReply } from '../lib/classify.js';
import { withRedditBrowser, sleep } from '../lib/gologin.js';
import { postComment, recordCommentResult } from '../lib/reddit-comment.js';

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
    if (lead.handled_by?.startsWith('gologin-failed') && !args.force) throw new Error(`a comment on this lead already failed (${lead.handled_by}); check the post first, then pass --force`);
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
    const r = await postComment(page, { url, text, dry: !!args.dry });
    if (r.dry) { console.log('dry run complete; leaving the browser open for 60s'); await sleep(60_000); return; }
    if (lead) await recordCommentResult(lead, r, text);
    if (!r.ok) throw new Error(r.error);
    console.log('posted as', r.me, r.permalink || '', r.note ? `(${r.note})` : '');
  });
}

main().catch((e) => { console.error('reddit-reply failed:', e.message); process.exit(1); });
