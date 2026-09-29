import fs from 'fs';
import { blobatarUri } from 'blobatar/uri';
import { thinking, unsure } from 'blobatar/expression';
const BOT = { traits: { tone: [0.45, 0.55, 0.65, 0.75] } };
const COS = { hue: 285, traits: { shape: 0.11, tone: 0.6 } };
const ids = {
  cos: ['bot_cos_01', COS],
  research: ['bot_research_01', BOT],
  pricing: ['bot_pricing_01', BOT],
  analyst: ['bot_analyst_01', BOT],
  release: ['bot_release_01', BOT],
};
const out = { avatars: {} };
for (const [k, [id, look]] of Object.entries(ids)) {
  out.avatars[k] = {
    idle: blobatarUri(id, { background: 'circle', ...look }),
    thinking: blobatarUri(id, { background: 'circle', expression: thinking, ...look }),
    unsure: blobatarUri(id, { background: 'circle', expression: unsure, ...look }),
  };
}
const names = ['activity','calendar-clock','plug','shield-check','monitor-smartphone','settings','search','square-pen','arrow-up','cpu','check','chevron-right','shield-alert','crown','play','flask-conical','zap','pause','lock','hand','message-square','monitor','info','arrow-left','mouse-pointer-2','bell-off','send','folder','clock','x','rotate-cw','chevron-down','laptop','container','layers','wrench','globe','plus','circle-check'];
out.icons = {};
for (const n of names) {
  const f = `node_modules/lucide-static/icons/${n}.svg`;
  if (fs.existsSync(f)) out.icons[n] = fs.readFileSync(f, 'utf8').replace(/<!--.*?-->/gs,'').trim();
  else console.error('missing icon', n);
}
out.font = fs.readFileSync('node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2').toString('base64');
fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/assets.json', JSON.stringify(out));
console.log('assets ok', Object.keys(out.icons).length, 'icons', (JSON.stringify(out).length/1024|0)+'KB');
