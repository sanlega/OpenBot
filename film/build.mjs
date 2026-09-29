import fs from 'fs';
const r = f => fs.readFileSync(f, 'utf8');
const assets = JSON.parse(r('build/assets.json'));
const cues = JSON.parse(r('build/cues.json'));
const font = assets.font; delete assets.font;
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>OpenBot film</title>
<meta name="viewport" content="width=1920,height=1080">
<style>
@font-face{font-family:"Inter Variable";font-weight:100 900;font-style:normal;src:url(data:font/woff2;base64,${font}) format("woff2")}
${r('src/style.css')}
</style></head><body>
<script>window.__ASSETS=${JSON.stringify(assets)};window.__CUES=${JSON.stringify(cues)};</script>
<script>
${r('src/lib.js')}
${r('src/dom.js')}
${r('src/scenes.js')}
</script></body></html>`;
fs.writeFileSync('openbot-film.html', html);
console.log('openbot-film.html', (html.length / 1024) | 0, 'KB');
