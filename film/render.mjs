// Deterministic renderer: headless Chromium, 60 fps, 4 temporal subframes per output frame (180° shutter), blended.
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { spawn } from 'child_process';
import fs from 'fs';

const FPS = 60, SUB = 4, SHUTTER = 0.5;               // shutter = fraction of a frame the "camera" is open
const DUR = JSON.parse(fs.readFileSync('build/cues.json')).duration;
const total = Math.round(DUR * FPS);
const [a0, a1] = [Number(process.argv[2] ?? 0), Number(process.argv[3] ?? total)];
const workers = Number(process.env.WORKERS ?? 4);
const FF = process.env.FFMPEG;
fs.mkdirSync('build/seg', { recursive: true });

async function worker(id, from, to) {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=1', '--disable-gpu-vsync', '--font-render-hinting=none'] });
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto('file://' + process.cwd() + '/openbot-film.html');
  await p.waitForFunction(() => window.__ready === true);
  const cdp = await p.context().newCDPSession(p);
  const out = `build/seg/seg-${String(id).padStart(2, '0')}.mp4`;
  const ff = spawn(FF, ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', '1920x1080', '-r', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '13', '-pix_fmt', 'yuv420p', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-vf', 'scale=out_color_matrix=bt709', '-x264-params', 'keyint=60:min-keyint=60:scenecut=0', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const shot = async (t) => {
    await p.evaluate(t => window.seek(t), t);
    const r = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
    return Buffer.from(r.data, 'base64');
  };
  const raw = async (buf) => (await sharp(buf).removeAlpha().raw().toBuffer());
  const t0 = Date.now();
  for (let f = from; f < to; f++) {
    const t = f / FPS, dt = 1 / FPS;
    const offs = Array.from({ length: SUB }, (_, k) => dt * SHUTTER * ((k + 0.5) / SUB - 0.5));
    const first = await shot(t + offs[0]), last = await shot(t + offs[SUB - 1]);
    let frame;
    if (first.equals(last)) frame = await raw(first);
    else {
      const bufs = [first, ...(await (async () => { const m = []; for (let k = 1; k < SUB - 1; k++) m.push(await shot(t + offs[k])); return m; })()), last];
      const raws = await Promise.all(bufs.map(raw));
      const acc = new Uint16Array(raws[0].length);
      for (const r of raws) for (let i = 0; i < r.length; i++) acc[i] += r[i];
      frame = Buffer.allocUnsafe(acc.length);
      for (let i = 0; i < acc.length; i++) frame[i] = (acc[i] + (SUB >> 1)) / SUB;
    }
    if (!ff.stdin.write(frame)) await new Promise(r => ff.stdin.once('drain', r));
    if ((f - from) % 60 === 0) console.log(`[w${id}] frame ${f}/${to} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await b.close();
  return out;
}
const per = Math.ceil((a1 - a0) / workers);
const jobs = [];
for (let i = 0; i < workers; i++) { const s = a0 + i * per, e = Math.min(a1, s + per); if (s < e) jobs.push(worker(i, s, e)); }
const segs = await Promise.all(jobs);
fs.writeFileSync('build/seg/list.txt', segs.map(s => `file '${process.cwd()}/${s}'`).join('\n'));
console.log('done', segs);
