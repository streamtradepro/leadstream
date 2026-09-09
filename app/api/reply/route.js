import { db } from '../../../lib/db.js';
import { draftReply } from '../../../lib/classify.js';
import { authenticate, unauthorized } from '../../../lib/auth.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req) {
  if (!(await authenticate(req))) return unauthorized();
  const { id } = await req.json();
  const { data: lead, error } = await db().from('leads').select('*').eq('id', id).single();
  if (error || !lead) return Response.json({ error: 'lead not found' }, { status: 404 });

  try {
    const reply = await draftReply(lead);
    await db().from('leads').update({ reply_draft: reply }).eq('id', id);
    return Response.json({ reply });
  } catch (e) {
    console.error('reply draft failed:', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}
