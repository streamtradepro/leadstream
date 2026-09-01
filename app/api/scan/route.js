import { runScan } from '../../../lib/scan.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(req) {
  const auth = req.headers.get('authorization') || '';
  const cron = process.env.CRON_SECRET;
  const app = process.env.APP_SECRET;
  return (
    (cron && auth === `Bearer ${cron}`) ||
    (app && req.headers.get('x-app-secret') === app)
  );
}

export async function GET(req) {
  if (!authorized(req)) {
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
