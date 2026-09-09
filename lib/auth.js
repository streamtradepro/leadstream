// Staff auth for the phone app. Two ways in:
//   1. `x-app-secret: <APP_SECRET>`  — owner / legacy, full access
//   2. `Authorization: Bearer <token>` — staff token issued by /api/auth/login
// Tokens are HMAC-signed with APP_SECRET and carry the staff's token_version,
// so deactivating a person or resetting their password signs them out everywhere.
import { createHmac, timingSafeEqual, scryptSync, randomBytes } from 'node:crypto';
import { db } from './db.js';

const TOKEN_DAYS = 180;

export function hashPassword(pw, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(String(pw), salt, 32).toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  if (!pw || !stored || !stored.includes(':')) return false;
  const [salt, hex] = stored.split(':');
  return safeEqual(scryptSync(String(pw), salt, 32).toString('hex'), hex);
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

const key = () => process.env.APP_SECRET || '';
const sign = (payload) => createHmac('sha256', key()).update(payload).digest('base64url');

export function issueToken(staff) {
  const exp = Date.now() + TOKEN_DAYS * 864e5;
  const payload = Buffer.from(JSON.stringify({ id: staff.id, v: staff.token_version || 1, exp })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function parseToken(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return p && p.id && p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

export const publicStaff = (s) => ({ id: s.id, name: s.name, email: s.email, role: s.role });

/** → { staff, owner } or null. */
export async function authenticate(req) {
  const secret = req.headers.get('x-app-secret');
  if (secret && key() && safeEqual(secret, key())) {
    return { staff: { id: null, name: 'Owner', email: null, role: 'owner' }, owner: true };
  }
  const m = (req.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  const p = parseToken(m[1]);
  if (!p) return null;
  const { data: staff } = await db()
    .from('staff')
    .select('id, name, email, role, active, token_version')
    .eq('id', p.id)
    .maybeSingle();
  if (!staff || !staff.active || (staff.token_version || 1) !== p.v) return null;
  db().from('staff').update({ last_seen_at: new Date().toISOString() }).eq('id', staff.id).then(() => {}, () => {});
  return { staff: publicStaff(staff), owner: staff.role === 'owner' };
}

export const unauthorized = () => Response.json({ error: 'unauthorized' }, { status: 401 });
