#!/usr/bin/env node
// Reddit CHAT reader for the owner's account (people answer our public comments
// with a chat request). Logic lives in lib/reddit-chat-reader.js so the daily
// loop can run it in the same browser session as the comments.
//
//   node scripts/reddit-chat.mjs           # read, store, push, DRAFT replies (approval mode)
//   node scripts/reddit-chat.mjs --auto    # …and SEND the drafted replies
//   node scripts/reddit-chat.mjs --dry     # read + print only, write nothing, accept nothing
//
// Stop rule: at most DM_MAX_PER_USER (3) outbound messages per person.
import { config } from 'dotenv';
config({ path: '.env.local' });
import { withRedditBrowser } from '../lib/gologin.js';
import { runChatReader } from '../lib/reddit-chat-reader.js';

const summary = await withRedditBrowser((page) => runChatReader(page, { auto: process.argv.includes('--auto'), dry: process.argv.includes('--dry') }))
  .catch((e) => { console.error('reddit-chat failed:', e.message); process.exit(1); });
console.log(JSON.stringify(summary));
