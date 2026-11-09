// Reddit CHAT reader: accept pending chat requests, store every new inbound message
// on its lead, push the team, draft (or send) the reply that carries the phone number.
// Runs inside an already-launched GoLogin page so callers can share one browser
// session with other work (one launch per run — six launches in 15 min got the
// session rate-limited with HTTP 429 on 2026-11-08).
import { db } from './db.js';
import { draftDmFollowup } from './classify.js';
import { sendPush } from './push.js';
import { sleep, jitter } from './gologin.js';
import { chatSession, inviterFromInviteState, resolveUsernames } from './reddit-chat.js';

const MAX_OUT_PER_USER = Number(process.env.DM_MAX_PER_USER || 3);

async function leadFor(username) {
  // The person we commented to (lead.author) — newest first, prefer ones we handled.
  const { data } = await db().from('leads').select('*').ilike('author', username).order('handled_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(1);
  return data?.[0] || null;
}

// → summary { invites, accepted, rooms, new_inbound, drafted, sent, closed, unmatched, spam_flagged? }
export async function runChatReader(page, { auto = false, dry = false } = {}) {
  const summary = { invites: 0, accepted: 0, rooms: 0, new_inbound: 0, drafted: 0, sent: 0, closed: 0, unmatched: 0 };
  await chatSession(page, async (chat) => {
    let sync = await chat.sync();
    const invites = Object.entries(sync.rooms?.invite || {});
    summary.invites = invites.length;
    const inviters = invites.map(([, inv]) => inviterFromInviteState(inv.invite_state, chat.me));
    const names = await resolveUsernames(page, inviters.map((w) => w.userId).filter(Boolean));
    for (const [i, [roomId, inv]] of invites.entries()) {
      const who = inviters[i];
      // Modmail / system rooms (bans, admin notices) are invites too; not leads.
      const kind = (inv.invite_state?.events || []).find((e) => e.type === 'com.reddit.chat.type')?.content?.type;
      if (kind && kind !== 'direct' && kind !== 'dm') { console.log(`skip ${kind} room ${roomId}`); continue; }
      const label = who.name || names[String(who.userId || '').replace(/^@/, '').replace(/:reddit\.com$/, '')] || who.userId;
      console.log(`invite ${roomId} from u/${label}`);
      if (dry) continue;
      const j = await chat.join(roomId);
      if (j.status === 200) summary.accepted++;
      else {
        console.error('join failed', roomId, j.status, JSON.stringify(j.json).slice(0, 120));
        // 403 "User is flagged for spam" = OUR account's chat is restricted (seen 2026-11-08).
        if (j.json?.['com.reddit.error.code'] === 'spam') summary.spam_flagged = true;
      }
      await sleep(jitter(800, 1800));
    }
    if (summary.accepted) sync = await chat.sync();

    const rooms = Object.keys(sync.rooms?.join || {});
    summary.rooms = rooms.length;
    let tokens = null;
    for (const roomId of rooms) {
      const members = await chat.members(roomId);
      const other = members.find((m) => m.userId !== chat.me);
      let username = other?.name || null;
      if (!username && other?.userId) username = (await resolveUsernames(page, [other.userId]))[other.userId.replace(/^@/, '').replace(/:reddit\.com$/, '')] || other.userId;
      username = username || 'unknown';
      const msgs = await chat.messages(roomId, 50);
      const inbound = msgs.filter((e) => e.sender !== chat.me && e.content?.body);
      if (!inbound.length) continue;

      const { data: known } = await db().from('reddit_dms').select('reddit_message_id').in('reddit_message_id', inbound.map((e) => e.event_id));
      const knownIds = new Set((known || []).map((k) => k.reddit_message_id));
      const fresh = inbound.filter((e) => !knownIds.has(e.event_id));
      if (dry) { for (const e of fresh) console.log(`  [${new Date(e.origin_server_ts).toISOString().slice(0, 16)}] u/${username}: ${e.content.body.slice(0, 160)}`); continue; }
      if (!fresh.length) continue;

      const lead = await leadFor(username);
      for (const e of fresh) {
        summary.new_inbound++;
        await db().from('reddit_dms').insert({ lead_id: lead?.id || null, reddit_user: username, direction: 'in', subject: 'chat', body: e.content.body, reddit_message_id: e.event_id, thread_id: roomId, status: 'received', created_at: new Date(e.origin_server_ts).toISOString() });
      }
      await chat.readMarker(roomId, fresh.at(-1).event_id).catch(() => {});

      if (!tokens) {
        const { data: devices } = await db().from('devices').select('expo_push_token');
        tokens = (devices || []).map((d) => d.expo_push_token);
      }
      const last = fresh.at(-1).content.body;
      await sendPush(tokens, { title: `💬 u/${username} replied${lead ? ` — ${[lead.city, lead.state].filter(Boolean).join(', ') || 'r/' + lead.subreddit}` : ''}`, body: last.slice(0, 150), data: { url: 'https://chat.reddit.com/', lead_id: lead?.id || null } });

      if (!lead) { summary.unmatched++; console.log(`chat from u/${username} with no matching lead — left for a human`); continue; }
      await db().from('leads').update({ dm_status: 'replied' }).eq('id', lead.id);

      const { data: thread } = await db().from('reddit_dms').select('direction,body,status').eq('reddit_user', username).order('created_at', { ascending: true });
      const outCount = (thread || []).filter((t) => t.direction === 'out' && t.status === 'sent').length;
      if (outCount >= MAX_OUT_PER_USER) { await db().from('leads').update({ dm_status: 'closed' }).eq('id', lead.id); summary.closed++; continue; }

      // Our public comment is the opening line of the conversation.
      const opening = lead.reply_draft ? [{ direction: 'out', body: lead.reply_draft }] : [];
      const reply = await draftDmFollowup(lead, [...opening, ...(thread || []).filter((t) => t.status !== 'queued' && t.status !== 'failed')]);
      if (!auto) {
        await db().from('reddit_dms').insert({ lead_id: lead.id, reddit_user: username, direction: 'out', subject: 'chat', body: reply, thread_id: roomId, sent_by: 'auto-draft', status: 'queued' });
        summary.drafted++;
        console.log(`drafted for u/${username}: ${reply}`);
        continue;
      }
      await sleep(jitter(2500, 6000));
      const r = await chat.send(roomId, reply);
      await db().from('reddit_dms').insert({ lead_id: lead.id, reddit_user: username, direction: 'out', subject: 'chat', body: reply, thread_id: roomId, reddit_message_id: r.eventId, sent_by: 'auto', status: r.ok ? 'sent' : 'failed', error: r.error });
      if (r.ok) { summary.sent++; await db().from('leads').update({ dm_count: (lead.dm_count || 0) + 1 }).eq('id', lead.id); console.log(`sent to u/${username}: ${reply}`); }
      else console.error(`send to u/${username} failed: ${r.error}`);
    }
  });
  return summary;
}
