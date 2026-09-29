/* ===== deterministic helpers: every value is a closed-form function of t ===== */
const AS = window.__ASSETS, CD = window.__CUES;
const BEAT = 0.5, BAR = 2.0;
const Bt = (bar, beat = 1) => (bar - 1) * BAR + (beat - 1) * BEAT;
const CUE = {}; for (const c of CD.cues) CUE[c.name] = c.peak;   // measured transient peaks (s)
const Q = n => { if (!(n in CUE)) throw new Error('cue ' + n); return CUE[n]; };
const clamp = (x, a = 0, b = 1) => x < a ? a : x > b ? b : x;
const lerp = (a, b, k) => a + (b - a) * k;
const sstep = x => { x = clamp(x); return x * x * x * (x * (6 * x - 15) + 10); };
const ramp = (t, t0, d) => sstep((t - t0) / d);                    // 0→1 over [t0,t0+d]
const win = (t, a, b, d = .12) => Math.min(ramp(t, a, d), 1 - ramp(t, b, d)); // in at a, out at b

/* closed-form damped-spring unit step (zero initial velocity) */
function stepResp(t, w, z) {
  if (t <= 0) return 0;
  if (z < 1) { const wd = w * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t)); }
  if (Math.abs(z - 1) < 1e-6) return 1 - Math.exp(-w * t) * (1 + w * t);
  const s = Math.sqrt(z * z - 1), a = w * (z + s), b = w * (z - s);
  return 1 - (a * Math.exp(-b * t) - b * Math.exp(-a * t)) / (a - b);
}
/* value with several target changes = sum of independent spring responses */
function S(t, v0, keys, P) {
  let v = v0, prev = v0;
  for (const [ti, vi] of keys) { if (t > ti) v += (vi - prev) * stepResp(t - ti, P.w, P.z); prev = vi; }
  return v;
}
const SPR = {
  x: { w: 21, z: .88 }, y: { w: 19, z: .9 }, w: { w: 18, z: .84 }, h: { w: 15, z: .92 }, sc: { w: 26, z: .78 },
  rad: { w: 20, z: 1 }, cur: { w: 30, z: .93 }, curSlow: { w: 14, z: 1 }, panel: { w: 17, z: .9 }, tabL: { w: 38, z: .85 }, tabR: { w: 21, z: .92 },
  slow: { w: 9, z: 1 }, pop: { w: 30, z: .68 }, cam: { w: 7, z: 1 },
};
/* geometry track: keys = [[t,{x,y,w,h,r}],...]; missing fields carry forward. x/y/w/h/r each use their own spring. */
function G(t, init, keys, PP = {}) {
  const P = Object.assign({ x: SPR.x, y: SPR.y, w: SPR.w, h: SPR.h, r: SPR.rad }, PP);
  const out = {}; let cur = Object.assign({}, init); const per = { x: [], y: [], w: [], h: [], r: [] };
  for (const [ti, g] of keys) { cur = Object.assign({}, cur, g); for (const k in per) per[k].push([ti, cur[k]]); }
  for (const k in per) out[k] = S(t, init[k], per[k], P[k]);
  return out;
}
const setG = (el, g, extra = '') => { el.style.left = g.x.toFixed(2) + 'px'; el.style.top = g.y.toFixed(2) + 'px'; el.style.width = Math.max(0, g.w).toFixed(2) + 'px'; el.style.height = Math.max(0, g.h).toFixed(2) + 'px'; el.style.borderRadius = Math.max(0, g.r).toFixed(2) + 'px'; if (extra) el.style.cssText += extra; };
const op = (el, v) => { v = clamp(v); el.style.opacity = v < .002 ? 0 : v.toFixed(3); el.style.visibility = v < .002 ? 'hidden' : 'visible'; };

/* directional (x-axis) blur used only for content replacement, never on outer containers */
const blurCss = px => px < .4 ? 'none' : `url(#db${clamp(Math.round(px), 1, 8)})`;
/* text replacement: old exits (ex s) BEFORE the swap, new enters (en s) AFTER. items = [[t,html],...] */
function swap(el, t, items, o = {}) {
  const ex = o.ex ?? .06, en = o.en ?? .09, bl = o.bl ?? 5;
  let i = -1; for (let k = 0; k < items.length; k++) if (t >= items[k][0] - 1e-9) i = k;
  if (i < 0) { el.style.opacity = 0; return; }
  const html = items[i][1]; if (el.__h !== html) { el.innerHTML = html; el.__h = html; }
  let e = sstep((t - items[i][0]) / en), b = (1 - e) * bl, dy = (1 - e) * 4, o1 = e;
  const nx = items[i + 1];
  if (nx) { const x = sstep((t - (nx[0] - ex)) / ex); if (x > 0) { o1 = Math.min(o1, 1 - x); b = Math.max(b, x * bl); dy = -x * 3; } }
  el.style.opacity = o1 < .002 ? 0 : o1.toFixed(3);
  el.style.transform = `translate3d(0,${dy.toFixed(2)}px,0)`;
  el.style.filter = blurCss(b);
}
/* simple fade-with-blur for a whole block that appears at a / leaves at b */
function appear(el, t, a, b = 1e9, o = {}) {
  const d = o.d ?? .12, bl = o.bl ?? 4, dy0 = o.dy ?? 6;
  const i = ramp(t, a, d), x = b < 1e8 ? ramp(t, b - (o.ex ?? .06), o.ex ?? .06) : 0;
  const v = i * (1 - x); op(el, v);
  const bb = (1 - i) * bl + x * bl;
  el.style.filter = blurCss(bb);
  el.style.transform = `translate3d(${o.dx ? ((1 - i) * o.dx).toFixed(2) : 0}px,${((1 - i) * dy0 - x * 3).toFixed(2)}px,0)`;
}
const ic = (n, s = 16, extra = '') => `<svg class="ic" viewBox="0 0 24 24" style="width:${s}px;height:${s}px;${extra}">${(AS.icons[n] || '').replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')}</svg>`;
const av = (k, size, st = 'idle') => `<img src="${AS.avatars[k][st]}" style="width:${size}px;height:${size}px">`;
