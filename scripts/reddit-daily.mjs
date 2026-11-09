#!/usr/bin/env node
// Daily Reddit outreach loop for the owner's GoLogin account. Runs from the
// "LeadStream Reddit daily" scheduled task (as the logged-in user, because the
// GoLogin profile and Orbita browser live under C:\Users\micky\.gologin):
//
//   1. picks fresh hot leads (service intent, score >= LOOP_MIN_SCORE, < LOOP_MAX_AGE_H old,
//      known city, state in PUSH_STATES, Florida first) that nobody has handled,
//   2. posts the short "I manage a … company" comment on up to LOOP_COMMENTS_PER_RUN of
//      them (LOOP_COMMENTS_PER_DAY attempts per calendar day),
//   3. runs the chat reader (approval mode; LOOP_CHAT_AUTO=1 sends the drafted replies),
//
// all in ONE browser session: six launches in 15 minutes got the session rate-limited
// (HTTP 429) on 2026-11-08. A 429 or a failed comment ends the run; a failed lead is
// marked handled_by 'gologin-failed:…' and never retried by automation.
//
// Safety: refuses to run while an Orbita (GoLogin) browser is open — either the
// desktop app has the profile open or another script is mid-run — and only runs
// between LOOP_START_HOUR and LOOP_END_HOUR local time. `--dry` lists the picks only.
import { config } from 'dotenv';
config({ path: '.env.local' });
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { db } from '../lib/db.js';
import { pushStates } from '../lib/categories.js';
import { draftComment } from '../lib/classify.js';
import { withRedditBrowser, sleep, jitter } from '../lib/gologin.js';
import { postComment, recordCommentResult } from '../lib/reddit-comment.js';
import { runChatReader } from '../lib/reddit-chat-reader.js';

const DRY = process.argv.includes('--dry');
const num = (k, d) => Number(process.env[k] || d);
const PER_RUN = num('LOOP_COMMENTS_PER_RUN', 1);
const PER_DAY = num('LOOP_COMMENTS_PER_DAY', 4);
const MIN_SCORE = num('LOOP_MIN_SCORE', 70);
const MAX_AGE_H = num('LOOP_MAX_AGE_H', 36);
const START_H = num('LOOP_START_HOUR', 9);
const END_H = num('LOOP_END_HOUR', 22);
const SKIP_SUBS = new Set((process.env.LOOP_SKIP_SUBS || 'MiSideReddit').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean));
const LOCK = 'logs/reddit-daily.lock';
const log = (...a) => console.log(new Date().toISOString(), ...a);

function orbitaRunning() {
  // Orbita = GoLogin's Chromium, installed under %USERPROFILE%\.gologin\browser.
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      "Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*\\.gologin\\*' } | Measure-Object | Select-Object -ExpandProperty Count"],
      { encoding: 'utf8', timeout: 20_000 });
    return Number(out.trim()) > 0;
  } catch { return false; }
}

async function pickLeads(limit) {
  const since = new Date(Date.now() - MAX_AGE_H * 3600e3).toISOString();
  const { data, error } = await db().from('leads').select('*')
    .eq('status', 'new').is('handled_by', null).eq('intent', 'service').gte('lead_score', MIN_SCORE).gte('created_at', since)
    .neq('category', 'other').not('author', 'is', null).not('url', 'is', null).not('city', 'is', null)
    .order('lead_score', { ascending: false }).limit(60);
  if (error) throw new Error('lead query failed: ' + error.message);
  const states = pushStates();
  let rows = (data || []).filter((r) => r.state && (!states || states.has(r.state.toUpperCase())) && !SKIP_SUBS.has((r.subreddit || '').toLowerCase()));
  // Never comment to the same person twice from this account (posted or attempted).
  const { data: done } = await db().from('leads').select('author').like('handled_by', 'gologin%').not('author', 'is', null);
  const seen = new Set((done || []).map((d) => d.author.toLowerCase()));
  rows = rows.filter((r) => !seen.has(r.author.toLowerCase()));
  // Florida first, then score.
  rows.sort((a, b) => (b.state === 'FL') - (a.state === 'FL') || b.lead_score - a.lead_score);
  return rows.slice(0, limit);
}

async function main() {
  const hour = new Date().getHours();
  if (!DRY && (hour < START_H || hour >= END_H)) { log(`outside ${START_H}:00-${END_H}:00 window, skipping`); return; }
  if (fs.existsSync(LOCK) && Date.now() - fs.statSync(LOCK).mtimeMs < 40 * 60e3) { log('another run holds the lock, skipping'); return; }
  if (orbitaRunning()) { log('GoLogin browser is open (app or another script) — skipping this run'); return; }
  if (!DRY) fs.writeFileSync(LOCK, String(process.pid));
  const summary = { picked: 0, commented: 0, failed: 0, chat: null };
  try {
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const { count } = await db().from('leads').select('id', { count: 'exact', head: true }).like('handled_by', 'gologin%').gte('handled_at', dayStart.toISOString());
    const budget = Math.max(0, Math.min(PER_RUN, PER_DAY - (count || 0)));
    log(`comment attempts today ${count || 0}/${PER_DAY}, budget this run ${budget}`);
    const leads = budget ? await pickLeads(budget) : [];
    summary.picked = leads.length;
    for (const l of leads) log(`pick ${l.id} ${l.lead_score} ${l.category} ${l.city}, ${l.state} r/${l.subreddit} u/${l.author} — ${(l.title || '').slice(0, 70)}`);
    if (DRY) { log('dry run: nothing posted, chat reader not run'); return; }

    await withRedditBrowser(async (page) => {
      for (const [i, l] of leads.entries()) {
        if (i) await sleep(jitter(120e3, 360e3));
        const text = await draftComment(l);
        log(`comment on ${l.url}\n  ${text}`);
        const r = await postComment(page, { url: l.url, text });
        await recordCommentResult(l, r, text);
        if (r.ok) { summary.commented++; log(`posted ${r.permalink || ''} ${r.note || ''}`); }
        else { summary.failed++; log(`comment failed: ${r.error}`); if (r.rateLimited) throw new Error(r.error); break; }
      }
      await sleep(jitter(15e3, 40e3));
      summary.chat = await runChatReader(page, { auto: process.env.LOOP_CHAT_AUTO === '1' });
    });
  } finally {
    try { fs.unlinkSync(LOCK); } catch {}
    log(JSON.stringify(summary));
  }
}

main().catch((e) => { log('reddit-daily failed:', e.message); process.exit(1); });
