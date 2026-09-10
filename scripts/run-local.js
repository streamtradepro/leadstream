import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();

const { runScan } = await import('../lib/scan.js');

const once = process.argv.includes('--once');

// Keep logs/scanner.log from growing forever (the scheduled task appends to it every 10 minutes).
try {
  const fs = await import('node:fs');
  const log = 'logs/scanner.log';
  if (fs.existsSync(log) && fs.statSync(log).size > 2 * 1024 * 1024) {
    const tail = fs.readFileSync(log, 'utf8').split(String.fromCharCode(10)).slice(-400).join(String.fromCharCode(10));
    fs.writeFileSync(log, tail);
  }
} catch {}

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
