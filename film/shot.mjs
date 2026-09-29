import { chromium } from 'playwright-core';
const times = process.argv.slice(2).map(Number);
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1'] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on('pageerror', e => console.log('PAGEERROR', e.message));
p.on('console', m => { if (m.type() === 'error') console.log('CONSOLE', m.text()); });
await p.goto('file://' + process.cwd() + '/openbot-film.html');
await p.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
for (const t of times) { await p.evaluate(t => window.seek(t), t); await p.screenshot({ path: `build/shot-${t}.png` }); console.log('shot', t); }
await b.close();
