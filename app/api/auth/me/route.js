import { authenticate, unauthorized } from '../../../../lib/auth.js';

export const dynamic = 'force-dynamic';

export async function GET(req) {
  const a = await authenticate(req);
  if (!a) return unauthorized();
  return Response.json({ staff: a.staff });
}
