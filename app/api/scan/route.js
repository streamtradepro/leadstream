import { runScan } from '../../../lib/scan.js';
import { authenticate } from '../../../lib/auth.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function authorized(req) {
  const auth = req.headers.get('authorization') || '';
  const cron = process.env.CRON_SECRET;
  if (cron && auth === `Bearer ${cron}`) return true;
  const a = await authenticate(req); // owner only (app secret or an owner-role staff token)
  return !!a && a.owner;
}

export async function GET(req) {
  if (!(await authorized(req))) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const result = await runScan();
    return Response.json(result);
  } catch (e) {
    console.error('scan failed:', e);
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  return GET(req);
}
