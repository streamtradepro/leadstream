// Reddit Chat through its Matrix backend (matrix.redditspace.com), driven from
// INSIDE the logged-in GoLogin page so every request rides the profile's proxy
// and session. Login type "com.reddit.token" takes the web client's token_v2
// cookie (probe 2026-11-08: login 200, sync 200). Chat requests from strangers
// arrive as room INVITES; accepting one joins the room and exposes the timeline.
import { sleep, jitter } from './gologin.js';

const HS = 'https://matrix.redditspace.com';

async function tokenV2(page) {
  const cookies = await page.cookies('https://www.reddit.com');
  const t = cookies.find((c) => c.name === 'token_v2')?.value;
  if (!t) throw new Error('token_v2 cookie missing — profile not logged into reddit.com');
  return t;
}

// Raw Matrix call from the page context. Returns { status, json }.
function mx(page, access, method, path, body) {
  return page.evaluate(async ({ HS, access, method, path, body }) => {
    const res = await fetch(HS + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(access ? { Authorization: 'Bearer ' + access } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null; try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, json };
  }, { HS, access, method, path, body });
}

export async function chatSession(page, fn) {
  if (!/reddit\.com/.test(page.url()) || /^chrome-error/.test(page.url())) {
    await page.goto('https://www.reddit.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await sleep(1500);
  }
  const tok = await tokenV2(page);
  const login = await mx(page, null, 'POST', '/_matrix/client/v3/login', { type: 'com.reddit.token', token: tok, initial_device_display_name: 'Reddit Web Client' });
  if (login.status !== 200 || !login.json?.access_token) throw new Error(`matrix login failed: ${login.status} ${JSON.stringify(login.json).slice(0, 200)}`);
  const access = login.json.access_token;
  const me = login.json.user_id; // @t2_xxx:reddit.com
  const api = {
    me,
    call: (method, path, body) => mx(page, access, method, path, body),
    sync: async () => {
      const r = await mx(page, access, 'GET', '/_matrix/client/v3/sync?timeout=0&full_state=true');
      if (r.status !== 200) throw new Error('sync failed ' + r.status);
      return r.json;
    },
    join: async (roomId) => mx(page, access, 'POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/join`, {}),
    members: async (roomId) => {
      const r = await mx(page, access, 'GET', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/members`);
      return (r.json?.chunk || []).map((e) => ({ userId: e.state_key, name: e.content?.displayname || null, membership: e.content?.membership }));
    },
    messages: async (roomId, limit = 50) => {
      const r = await mx(page, access, 'GET', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=${limit}`);
      return (r.json?.chunk || []).filter((e) => e.type === 'm.room.message').reverse();
    },
    send: async (roomId, body) => {
      const txn = `ls${Date.now()}${Math.floor(Math.random() * 1e6)}`;
      const r = await mx(page, access, 'PUT', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txn}`, { msgtype: 'm.text', body });
      return { ok: r.status === 200 && !!r.json?.event_id, eventId: r.json?.event_id || null, error: r.status === 200 ? null : `${r.status} ${JSON.stringify(r.json).slice(0, 160)}` };
    },
    readMarker: async (roomId, eventId) => mx(page, access, 'POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/read_markers`, { 'm.fully_read': eventId, 'm.read': eventId }),
  };
  try {
    return await fn(api);
  } finally {
    await mx(page, access, 'POST', '/_matrix/client/v3/logout', {}).catch(() => {});
  }
}

// Who invited us / who else is in the room, from invite_state or members.
export function inviterFromInviteState(inviteState, me) {
  const evs = inviteState?.events || [];
  const member = evs.find((e) => e.type === 'm.room.member' && e.state_key !== me && e.content?.membership === 'join');
  const create = evs.find((e) => e.type === 'm.room.create');
  const sender = member?.state_key || create?.sender || evs.find((e) => e.sender && e.sender !== me)?.sender || null;
  const name = member?.content?.displayname || null;
  return { userId: sender, name };
}

// Matrix ids are @t2_xxx:reddit.com; Reddit's web endpoint maps t2 ids → usernames.
export async function resolveUsernames(page, userIds) {
  const ids = [...new Set(userIds.map((u) => String(u).replace(/^@/, '').replace(/:reddit\.com$/, '')).filter((x) => /^t2_/.test(x)))];
  if (!ids.length) return {};
  const data = await page.evaluate(async (ids) => {
    const r = await fetch('https://www.reddit.com/api/user_data_by_account_ids.json?ids=' + ids.join(','), { credentials: 'include' });
    return r.ok ? r.json() : {};
  }, ids).catch(() => ({}));
  const out = {};
  for (const id of ids) out[id] = data?.[id]?.name || null;
  return out;
}

export { sleep, jitter };
