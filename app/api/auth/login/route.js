import { db } from '../../../../lib/db.js';
import { issueToken, publicStaff, verifyPassword } from '../../../../lib/auth.js';

export const dynamic = 'force-dynamic';

const MAX_FAILS = 8;
const LOCK_MINUTES = 15;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = async () => {
  await sleep(700); // blunt brute-force damper
  return Response.json({ error: 'Wrong email or password.' }, { status: 401 });
};

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) return Response.json({ error: 'Email and password are required.' }, { status: 400 });

  const { data: staff } = await db().from('staff').select('*').eq('email', email).maybeSingle();
  if (!staff || !staff.active) return fail();

  if (staff.locked_until && new Date(staff.locked_until) > new Date()) {
    const mins = Math.max(1, Math.ceil((new Date(staff.locked_until) - Date.now()) / 60000));
    return Response.json({ error: `Too many wrong passwords. Try again in ${mins} min.` }, { status: 429 });
  }

  if (!verifyPassword(password, staff.password_hash)) {
    const fails = (staff.failed_logins || 0) + 1;
    const patch = fails >= MAX_FAILS
      ? { failed_logins: 0, locked_until: new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() }
      : { failed_logins: fails };
    await db().from('staff').update(patch).eq('id', staff.id);
    return fail();
  }

  await db().from('staff').update({ failed_logins: 0, locked_until: null, last_seen_at: new Date().toISOString() }).eq('id', staff.id);
  return Response.json({ token: issueToken(staff), staff: publicStaff(staff) });
}
