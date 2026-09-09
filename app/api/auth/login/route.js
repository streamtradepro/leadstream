import { db } from '../../../../lib/db.js';
import { issueToken, publicStaff, verifyPassword } from '../../../../lib/auth.js';

export const dynamic = 'force-dynamic';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!email || !password) return Response.json({ error: 'Email and password are required.' }, { status: 400 });
  const { data: staff } = await db().from('staff').select('*').eq('email', email).maybeSingle();
  if (!staff || !staff.active || !verifyPassword(password, staff.password_hash)) {
    await sleep(700); // blunt brute-force damper
    return Response.json({ error: 'Wrong email or password.' }, { status: 401 });
  }
  db().from('staff').update({ last_seen_at: new Date().toISOString() }).eq('id', staff.id).then(() => {}, () => {});
  return Response.json({ token: issueToken(staff), staff: publicStaff(staff) });
}
