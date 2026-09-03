import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

const { runScan } = await import('../lib/scan.js');

const once = process.argv.includes('--once');

let running = false;
async function tick() {
  if (running) return; // never overlap scans
  running = true;
  const t0 = Date.now();
  try {
    const r = await runScan();
    console.log(
      new Date().toISOString(),
      `fetched=${r.fetched} new=${r.new} hot=${r.hot}`,
      ((Date.now() - t0) / 1000).toFixed(1) + 's'
    );
  } catch (e) {
    console.error(new Date().toISOString(), 'scan error:', e.message);
  } finally {
    running = false;
  }
}

await tick();

if (!once) {
  const min = Number(process.env.SCAN_INTERVAL_MIN) || 30;
  console.log(`autopilot: scanning every ${min} min (ctrl+c to stop)`);
  setInterval(tick, min * 60 * 1000);
}
