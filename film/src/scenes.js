/* ===== scenes: render(t) sets every style from t alone. No state survives between frames. ===== */
document.body.insertAdjacentHTML('afterbegin', html);
$('laneP').insertAdjacentHTML('beforeend', compHTML);

const SC = 35 / 30;                                  // ui logical px → stage px
const U = (x, y) => [120 + x * SC, 67.5 + y * SC];   // absolute ui coords → world
const MAIN = (x, y) => U(272 + x, y);
const PARK = [1500, 900];
const T = n => Q(n);
const $$ = (root, sel) => root.querySelector(sel);

/* ---------- avatar helpers ---------- */
function setAv(box, think = 0, need = 0, dot = 'none', t = 0) {
  if (!box) return;
  const a = $$(box, '.a-i'), b = $$(box, '.a-t'), c = $$(box, '.a-u'), d = $$(box, '.dot');
  b.style.opacity = think.toFixed(3); c.style.opacity = need.toFixed(3); a.style.opacity = clamp(1 - Math.max(think, need)).toFixed(3);
  if (d) {
    if (dot === 'work') { d.style.opacity = (0.65 + 0.35 * Math.sin(t * 2 * Math.PI / 1.4)).toFixed(3); d.style.background = 'var(--accent)'; }
    else if (dot === 'need') { d.style.opacity = 1; d.style.background = 'var(--warning)'; }
    else d.style.opacity = 0;
  }
}
const avOf = el => el.querySelector('.avatar');

/* ---------- lane construction (rows, details, done body) ---------- */
const LANE = {
  R: { el: $('laneR'), key: 'research', idx: 0, doneTxt: 'Competitor map complete', doneCue: 'done1' },
  P: { el: $('laneP'), key: 'pricing', idx: 1, doneTxt: 'Pricing captured', doneCue: 'done2' },
  A: { el: $('laneA'), key: 'analyst', idx: 2, doneTxt: 'Positioning analysis complete', doneCue: 'done3' },
};
const rowDefs = {
  R: [
    { t0: T('lane1'), tEnd: 9.9, items: [[T('lane1'), 'Searching…'], [9.9, 'Found 3 competitors']], tag: [9.9, '3 sources'] },
    { t0: 10.28, tEnd: 12.6, items: [[10.28, 'Reading sources…'], [12.6, 'Read 3 sources']] },
    { t0: 12.9, tEnd: T('done1') - 0.1, items: [[12.9, 'Mapping competitors…'], [T('done1') - 0.1, 'Competitor map drafted']] },
  ],
  P: [
    { t0: T('lane2') + 0.04, tEnd: T('expand'), items: [[T('lane2') + 0.04, 'Reading pricing…'], [T('expand'), '5 plans captured']], tag: [T('expand'), '5 plans'] },
    { t0: 10.62, tEnd: 11.4, items: [[10.62, 'Saving plans to workspace'], [11.4, 'Saved to workspace']] },
    { t0: 11.72, tEnd: T('done2') - 0.1, items: [[11.72, 'Opening the browser…'], [T('resume'), 'Submitting the request…'], [T('done2') - 0.1, 'Quote request sent']] },
  ],
  A: [
    { t0: T('lane3') + 0.03, tEnd: 11.3, items: [[T('lane3') + 0.03, 'Comparing features…'], [11.3, 'Compared 12 features']], tag: [11.3, '12 features'] },
    { t0: 11.85, tEnd: T('done3') - 0.1, items: [[11.85, 'Comparing positioning…'], [T('done3') - 0.1, 'Positioning mapped']] },
    { t0: 13.4, tEnd: T('resume') + 0.25, items: [[13.4, 'Waiting for pricing…'], [T('resume') + 0.25, 'Pricing received']] },
  ],
};
for (const k in LANE) {
  const L = LANE[k]; L.rows = [];
  const host = $(L.el.id + 'Rows');
  rowDefs[k].forEach((d, i) => {
    const r = document.createElement('div'); r.className = 'lrow'; r.style.top = (108 + i * 40) + 'px';
    r.innerHTML = `<div class="ico"></div><div class="rt" style="white-space:nowrap"></div><div class="tag" style="opacity:0"></div>`;
    host.appendChild(r); L.rows.push({ el: r, ico: r.children[0], rt: r.children[1], tag: r.children[2], d });
  });
  // "task" chip target line inside card
  const done = $(L.el.id + 'Done');
  done.style.cssText = 'position:absolute;inset:0;opacity:0';
  done.innerHTML = `<div style="position:absolute;inset:0;display:flex;align-items:center;gap:14px;padding:0 16px"><div style="position:relative;width:28px;height:28px;flex:none">${avStack(L.key, 28).replace('style="', 'style="left:0;top:0;')}</div><div style="font-size:14px;font-weight:650;white-space:nowrap"><span style="color:var(--success)">✓</span> ${L.doneTxt}</div><span class="pill ok" style="margin-left:auto">Done</span></div>`;
  // detail blocks
  const det = document.createElement('div'); det.className = 'abs'; det.style.cssText = 'left:16px;right:16px;top:240px'; host.appendChild(det); L.det = det;
}
/* Research: source chips */
LANE.R.det.innerHTML = `<div class="lbl" style="margin-bottom:10px">Sources</div>` + ['atlas.example', 'beacon.example', 'cinder.example'].map((s, i) => `<div class="chip" data-i="${i}" style="display:flex;margin-bottom:8px;height:32px;border-radius:10px;font-size:12.5px;color:var(--text)"><span style="width:14px;height:14px;border-radius:4px;background:${['#5b6bff', '#e5a83b', '#3fb27f'][i]}"></span>${s}<span class="t3" style="margin-left:auto;font-family:var(--mono);font-size:11px">${['pricing', 'pricing', 'plans'][i]}</span></div>`).join('');
LANE.R.detTimes = [9.62, 9.97, 10.34];
/* Pricing: captured plans */
LANE.P.det.innerHTML = `<div class="lbl" style="margin-bottom:10px">Plans captured</div><div style="display:flex;flex-wrap:wrap;gap:8px">` + ['Free · $0', 'Team · $24', 'Business · $60', 'Beacon · $9', 'Cinder · $12'].map(s => `<span class="chip" style="height:30px;color:var(--text);font-size:12.5px">${s}</span>`).join('') + `</div>`;
LANE.P.detTimes = [9.34, 9.5, 9.66, 9.8, 9.93];
/* Analyst: feature matrix */
LANE.A.det.innerHTML = `<div class="lbl" style="margin-bottom:10px">Features</div><div id="mx" style="font-size:12.5px">` + [['', 'Atlas', 'Beacon', 'Cinder'], ['Docs', 1, 0, 0], ['Analytics', 0, 1, 1], ['Automation', 0, 0, 1], ['SSO', 1, 1, 0]].map((r, i) => `<div style="display:flex;height:30px;align-items:center;${i ? 'border-top:1px solid var(--border)' : ''}"><span style="flex:1.4;color:${i ? 'var(--text)' : 'var(--text-3)'}">${r[0]}</span>${r.slice(1).map((c, j) => `<span data-c="${i}-${j}" style="flex:1;text-align:center;color:${i ? (c ? 'var(--success)' : 'var(--text-3)') : 'var(--text-3)'};font-size:${i ? 15 : 11.5}px">${i ? (c ? '●' : '○') : c}</span>`).join('')}</div>`).join('') + `</div>`;
LANE.A.mx = [...LANE.A.det.querySelectorAll('[data-c]')].filter(e => /^[1-4]-/.test(e.dataset.c));
/* Pricing: tools tray + connector line */
const tray = document.createElement('div'); tray.className = 'abs'; tray.style.cssText = 'left:16px;top:330px;width:560px;height:100px';
tray.innerHTML = `<div class="lbl" style="margin-bottom:10px">Tools</div><div style="display:flex;gap:26px">` + [['G', 'GitHub', 'var(--success)', 'var(--success-soft)'], ['F', 'Filesystem', '#d146c8', 'rgba(209,70,200,.16)'], ['T', 'Time', 'var(--success)', 'var(--success-soft)']].map((t, i) => `<div class="tl" data-i="${i}" style="display:flex;flex-direction:column;align-items:center;gap:6px;position:relative">${tile(t[0], t[2], t[3])}<span class="t2" style="font-size:11.5px">${t[1]}</span></div>`).join('') + `</div>`;
$('lanePBody').appendChild(tray);
const linkSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
linkSvg.setAttribute('style', 'position:absolute;left:0;top:0;width:700px;height:520px;overflow:visible;pointer-events:none');
linkSvg.innerHTML = `<path id="linkPath" d="M 118 358 L 118 342 Q 118 334 110 334 L 10 334 L 10 44 Q 10 28 26 28" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-dasharray="4 5" opacity=".9"/><circle id="linkDot" r="5" fill="var(--accent)"/>`;
$('lanePBody').appendChild(linkSvg);
const linkPath = $('linkPath'), linkDot = $('linkDot'), linkLen = linkPath.getTotalLength();
/* task chips travelling from the request into each Bot card */
const chips = [
  { name: 'Map competitors', lane: 'R', cue: 'chip1' }, { name: 'Collect plans &amp; pricing', lane: 'P', cue: 'chip2' }, { name: 'Compare positioning', lane: 'A', cue: 'chip3' },
].map((c, i) => {
  const el = document.createElement('div'); el.className = 'chip';
  el.style.cssText = 'position:absolute;height:28px;z-index:8;background:var(--accent-soft);border-color:rgba(110,139,255,.35);color:var(--accent);font-weight:550;font-size:12.5px';
  el.innerHTML = `${ic('arrow-left', 12, 'transform:rotate(-135deg)')}${c.name}`;
  $('vChat').appendChild(el); return Object.assign(c, { el, i });
});
/* steps rail */
const stepDefs = [
  { name: 'Open pricing', on: () => T('bclick1'), off: () => T('bclick2'), time: '0:02' },
  { name: 'Read plans', on: () => T('bclick2'), off: () => T('bclick4'), time: '0:03' },
  { name: 'Compare tiers', on: () => T('bclick4'), off: () => 1e9, time: '' },
];
const stepsHost = $('steps');
stepDefs.forEach((s, i) => {
  const r = document.createElement('div'); r.className = 'abs'; r.style.cssText = `left:0;top:${i * 44}px;width:300px;height:36px;display:flex;align-items:center;gap:12px;font-size:14px`;
  r.innerHTML = `<div class="si" style="width:24px;height:24px;border-radius:7px;display:grid;place-items:center;position:relative;flex:none"></div><span class="sn">${s.name}</span><span class="t3 mono stm" style="margin-left:auto;font-size:11.5px"></span>`;
  stepsHost.appendChild(r); s.el = r; s.ico = r.children[0]; s.tm = r.children[2];
});
const stepNote = document.createElement('div'); stepNote.className = 'abs'; stepNote.style.cssText = 'left:36px;top:112px;width:264px;font-size:12.5px;line-height:1.45;color:var(--warning)'; stepNote.textContent = 'Needs your approval to submit.'; stepsHost.appendChild(stepNote);

/* run steps in routines */
const runHost = $('runSteps'), runDefs = [['Research competitors', 'step1', 'step2'], ['Check pricing changes', 'step2', 'step3'], ['Summarize differences', 'step3', 'dryDone']];
runDefs.forEach((d, i) => { const r = document.createElement('div'); r.className = 'abs'; r.style.cssText = `left:0;top:${i * 30}px;height:26px;display:flex;align-items:center;gap:12px;font-size:13.5px`; r.innerHTML = `<div class="ri" style="width:20px;height:20px;position:relative;border-radius:50%;display:grid;place-items:center"></div><span>${d[0]}</span>`; runHost.appendChild(r); d.el = r; d.ico = r.children[0]; });
const runDone = document.createElement('span'); runDone.className = 'pill ok abs'; runDone.style.cssText = 'left:0;top:96px;height:24px'; runDone.innerHTML = `${ic('check', 13)}Dry run complete`; runHost.appendChild(runDone);

/* ---------- small icon snippets ---------- */
const CHECK = c => `<span style="width:20px;height:20px;border-radius:50%;background:var(--success-soft);color:var(--success);display:grid;place-items:center">${ic('check', 12, 'stroke-width:3')}</span>`;
const SPIN = a => `<div style="position:absolute;inset:1px;border-radius:50%;border:2px solid var(--accent-soft);border-top-color:var(--accent);transform:rotate(${a}deg)"></div>`;
const PEND = `<span style="width:16px;height:16px;border-radius:50%;border:1.5px solid var(--border-strong)"></span>`;

/* =============================================================== */
const els = { win: $('win'), tileBg: $('tileBg'), glyph: $('glyph'), collapseAv: $('collapseAv'), ui: $('ui'), uiWrap: $('uiWrap'), phoneWrap: $('phoneWrap'), cam: $('cam') };
const LIFT = 48;

function render(t) {
  /* ---------- key times ---------- */
  const tStretch = T('stretch'), tWindow = T('window'), tShrink = T('shrink'), tLock = T('lock'), tCollapse = T('collapse'), tIcon = T('iconIn');

  /* ========== 1. window: ONE container that morphs tile → app → phone → app → avatar → tile ========== */
  const cx = 960;
  const cy = S(t, 540, [[T('wordmark'), 540 - LIFT], [tStretch, 540], [T('headline'), 540 - LIFT], [T('close'), 540]], SPR.y);
  const w = S(t, 200, [[tStretch, 1680], [tShrink, 430], [tLock, 1680], [tCollapse, 180], [tIcon, 200]], SPR.w);
  const h = S(t, 200, [[tStretch + 0.09, 945], [tShrink + 0.04, 880], [tLock + 0.03, 945], [tCollapse, 180], [tIcon, 200]], SPR.h);
  const r = S(t, 46, [[tStretch + 0.05, 14], [tShrink, 56], [tLock, 14], [tCollapse, 90], [tIcon, 46]], SPR.rad);
  const tileOp = 1 - ramp(t, tStretch + 0.04, 0.3) + ramp(t, tIcon, 0.16);
  const glyphOp = 1 - ramp(t, tStretch - 0.02, 0.13) + ramp(t, tIcon + 0.12, 0.16);
  const wEl = els.win;
  wEl.style.left = (cx - w / 2).toFixed(2) + 'px'; wEl.style.top = (cy - h / 2).toFixed(2) + 'px';
  wEl.style.width = w.toFixed(2) + 'px'; wEl.style.height = h.toFixed(2) + 'px'; wEl.style.borderRadius = r.toFixed(2) + 'px';
  const appAmt = clamp(1 - tileOp);
  const phoneAmt = ramp(t, tShrink, .3) * (1 - ramp(t, tLock, .3));
  wEl.style.boxShadow = `0 0 0 ${(1 + phoneAmt).toFixed(2)}px rgba(255,255,255,${((0.07 + 0.08 * phoneAmt) * appAmt).toFixed(3)}), 0 40px 90px rgba(0,0,0,${(0.35 + 0.25 * appAmt).toFixed(2)})`;
  op(els.tileBg, tileOp); op(els.glyph, glyphOp);
  const gs = clamp(Math.min(w, h) / 200, 0.4, 1.2); els.glyph.style.transform = `scale(${gs.toFixed(3)})`;
  // collapse avatar (CoS) in the shrunk container
  op(els.collapseAv, ramp(t, tCollapse + 0.02, 0.12) * (1 - ramp(t, tIcon, 0.1)));
  setAv(els.collapseAv, 0, 0, 'none', t);
  els.collapseAv.style.transform = `scale(${(0.7 + 0.3 * stepResp(t - tCollapse, 24, .75)).toFixed(3)})`;

  /* ---------- opening / closing marketing text (outside the container) ---------- */
  const tileBottom = 540 - LIFT + 100;
  $('wordmark').style.top = (tileBottom + 30) + 'px'; $('tagline').style.top = (tileBottom + 100) + 'px';
  appear($('wordmark'), t, T('wordmark'), tStretch - 0.08, { d: .16, bl: 6, ex: .07 });
  appear($('tagline'), t, T('tagline'), tStretch - 0.08, { d: .16, bl: 6, ex: .07 });
  $('endHead').style.top = (tileBottom + 30) + 'px'; $('endSub').style.top = (tileBottom + 112) + 'px'; $('endUrl').style.top = (tileBottom + 166) + 'px';
  appear($('endHead'), t, T('headline'), T('close') - 0.1, { d: .18, bl: 7, ex: .08 });
  appear($('endSub'), t, T('sub'), T('close') - 0.1, { d: .18, bl: 6, ex: .08 });
  appear($('endUrl'), t, T('url'), T('close') - 0.1, { d: .18, bl: 6, ex: .08 });

  /* ---------- visibility of content layers inside the container ---------- */
  const uiIn = ramp(t, tStretch + 0.28, 0.16) * (1 - ramp(t, tShrink, 0.2)) + ramp(t, tLock + 0.1, 0.18) * (1 - ramp(t, T('layers') - 0.02, 0.01));
  const uiVisible = Math.max(ramp(t, tStretch + 0.28, 0.16) * (1 - ramp(t, tShrink, 0.2)), ramp(t, tLock + 0.1, 0.18) * (1 - ramp(t, tCollapse - 0.02, 0.2)));
  const archOn = ramp(t, T('layers') - 0.05, 0.28) * (1 - ramp(t, T('w4') + 0.28, 0.24));
  const uiDim = 1 - 0.965 * archOn;
  op(els.ui, uiVisible * uiDim);
  els.uiWrap.style.visibility = uiVisible > .002 || archOn > .002 ? 'visible' : 'hidden';

  sidebar(t); chat(t); lanes(t); computer(t); result(t); views(t); phone(t); arch(t, archOn);
  cursor(t); camera(t); caption(t);
}

/* ============================ sidebar ============================ */
function sidebar(t) {
  const spawn = T('spawn'), think = T('think'), stack = T('stack');
  const working = win(t, think, stack, .1);                       // Chief is "working"
  const needsOn = win(t, T('approvalCard'), T('approve') + 0.04, .08);
  // selection highlight
  const inChat = 1 - win(t, T('activity') - 0.02, T('shrink'), .1);
  const hiY = S(t, 84, [[T('toComputer'), 224], [T('approve') + 0.1, 84]], SPR.panel);
  const hi = $('botHi'); hi.style.top = hiY.toFixed(2) + 'px'; op(hi, inChat);
  const nh = $('navHi'); nh.style.top = S(t, 606, [[T('routines'), 640]], SPR.panel).toFixed(2) + 'px'; op(nh, win(t, T('activity'), T('shrink'), .1));
  op($('navBadge'), needsOn); $('navBadge').style.transform = `scale(${(0.6 + 0.4 * stepResp(t - T('approvalCard'), 30, .6)).toFixed(3)})`;
  // team rows slide in at spawn
  [['rowR', 0], ['rowP', 1], ['rowA', 2]].forEach(([id, i]) => {
    const el = $(id), a = spawn + i * 0.07;
    const k = ramp(t, a, .16); el.style.opacity = k.toFixed(3); el.style.transform = `translateX(${((1 - k) * -14).toFixed(2)}px)`;
    el.style.filter = blurCss((1 - k) * 4);
  });
  const tl = $('teamLbl'); op(tl, ramp(t, spawn, .14));
  // previews
  swap($('rowCpv'), t, [[0, 'Your first point of contact'], [T('send') + 0.05, 'You: Research the top 3…'], [think, 'Thinking…'], [T('delegating'), 'Delegating to 3 Bots'], [T('team'), 'Working with 3 Bots'], [T('approvalCard'), 'Waiting on Pricing'], [T('approve') + 0.15, 'Working with 3 Bots'], [stack, 'Launch brief ready']]);
  swap($('rowRpv'), t, [[spawn + .1, 'Queued'], [T('lane1'), 'Searching…'], [T('done1'), 'Competitor map complete']]);
  swap($('rowPpv'), t, [[spawn + .17, 'Queued'], [T('lane2'), 'Reading pricing…'], [T('approvalCard'), 'Submit a form?'], [T('resume'), 'Reading pricing…'], [T('done2'), 'Pricing captured']]);
  swap($('rowApv'), t, [[spawn + .24, 'Queued'], [T('lane3'), 'Comparing features…'], [T('done3'), 'Positioning analysis complete']]);
  // avatar states
  setAv(avOf($('rowC')), working, 0, working > .5 ? 'work' : 'none', t);
  const wk = (a, b) => win(t, a, b, .1);
  setAv(avOf($('rowR')), wk(T('team'), T('done1')), 0, wk(T('team'), T('done1')) > .5 ? 'work' : 'none', t);
  setAv(avOf($('rowP')), wk(T('team'), T('done2')) * (1 - needsOn), needsOn, needsOn > .5 ? 'need' : wk(T('team'), T('done2')) > .5 ? 'work' : 'none', t);
  setAv(avOf($('rowA')), wk(T('team'), T('done3')), 0, wk(T('team'), T('done3')) > .5 ? 'work' : 'none', t);
  op($('rowPneed'), needsOn);
}

/* ============================ chat view ============================ */
const words1 = ['Research', 'the', 'top', '3', 'competitors,'], words2 = ['compare', 'their', 'pricing', 'and', 'features,'], words3 = ['and', 'prepare', 'a', 'launch', 'brief.'];
function typed(t) {
  const out = [];
  const grp = (ws, end) => ws.forEach((w, i) => { if (t >= end - (ws.length - 1 - i) * 0.05) out.push(w); });
  grp(words1, T('key1')); grp(words2, T('key2')); grp(words3, T('key3'));
  return out.join(' ');
}
const measurer = $('compTxt');
function chat(t) {
  const send = T('send');
  swap($('hdrSub'), t, [[0, 'Your first point of contact'], [T('think'), 'Thinking…'], [T('delegating'), 'Delegating'], [T('team'), 'Working with 3 Bots'], [T('approvalCard'), 'Waiting on Pricing'], [T('approve') + 0.15, 'Working with 3 Bots'], [T('stack'), 'Done']], { bl: 3 });
  const th = win(t, T('think'), T('stack'), .12);
  setAv($$($('hdrAv'), '.avatar'), th, 0, th > .5 ? 'work' : 'none', t);
  $$($('hdrAv'), '.dot').style.borderColor = 'var(--bg)';
  // tab indicator
  const ti = $('tabInd'); ti.style.left = '24px'; ti.style.width = '32px';
  // composer + typing
  const txt = t < send ? typed(t) : '';
  const c = $('compTxt'); if (c.__h !== txt) { c.textContent = txt; c.__h = txt; }
  c.style.opacity = t < send ? 1 : (1 - ramp(t, send, .06));
  op($('compPh'), t < T('key1') - 0.25 ? 1 : 0);
  const focus = ramp(t, T('focus') - 0.02, .1) * (t < send + 0.3 ? 1 : 0);
  $('composer').style.borderColor = focus > .5 ? 'var(--accent)' : 'var(--border-strong)';
  $('composer').style.boxShadow = focus > .5 ? '0 0 0 3px rgba(110,139,255,.16)' : 'none';
  const caretOn = focus > .5 && t < send && (typed(t) !== '' || Math.floor((t - T('focus')) * 2) % 2 === 0);
  const cr = $('caret'); cr.style.opacity = caretOn ? 1 : 0; cr.style.left = (20 + c.offsetWidth + 2) + 'px';
  $('sendBtn').style.background = t < send && txt.length > 0 ? 'var(--accent)' : 'var(--surface-3)';
  $('sendBtn').style.color = t < send && txt.length > 0 ? 'var(--accent-fg)' : 'var(--text-2)';
  $('sendBtn').style.transform = `scale(${(1 - 0.1 * Math.exp(-Math.pow((t - send - 0.03) / 0.05, 2))).toFixed(3)})`;
  // user bubble: morphs out of the composer into the thread
  const b = G(t, { x: 224, y: 724, w: 720, h: 50, r: 14 }, [[send, { x: 424, y: 118, w: 520, h: 70, r: 14 }]], { y: { w: 22, z: .85 }, h: { w: 22, z: .85 }, w: { w: 24, z: .9 }, x: { w: 24, z: .9 } });
  const ub = $('userBubble'); setG(ub, b); op(ub, (t >= send - 0.005 ? 1 : 0) * (1 - ramp(t, T('stack') - 0.02, .12)));
  const ut = $('ubText'); ut.style.width = '484px'; op(ut, ramp(t, send + 0.07, .1)); ut.style.filter = blurCss((1 - ramp(t, send + 0.07, .1)) * 4);
  op($('ubTime'), ramp(t, send + 0.3, .15) * (1 - ramp(t, T('stack') - 0.02, .1)));
  // decision surface
  const d = G(t, { x: 474, y: 214, w: 220, h: 56, r: 14 }, [[T('delegating'), { x: 204, y: 214, w: 760, h: 56, r: 14 }]], { x: { w: 20, z: .88 }, w: { w: 20, z: .86 } });
  const dec = $('dec'); setG(dec, d);
  const decOp = ramp(t, T('plan') - 0.02, .09) * (1 - ramp(t, T('spawn') + 0.02, .08));
  op(dec, decOp); dec.style.transform = `translateY(${((1 - ramp(t, T('plan'), .12)) * 8).toFixed(2)}px)`;
  swap($('decTxt'), t, [[T('plan'), 'Planning task…'], [T('delegating'), 'Delegating']], { bl: 4 });
  setAv($$($('decAv'), '.avatar'), 1, 0, 'none', t);
  $('decSpin').style.transform = `rotate(${(t * 420) % 360}deg)`;
  // composer hides behind lanes only visually; hint fades in with composer
  op($('hint'), 1);
}

/* ============================ lanes ============================ */
function laneGeom(k) {
  const L = LANE[k], i = L.idx, spawn = T('spawn'), team = T('team'), expand = T('expand'), toC = T('toComputer') - 0.1, ap = T('approve') + 0.1;
  const rectSpawn = { x: [118, 434, 750][i], y: 214, w: 300, h: 92, r: 14 };
  const rectTeam = { x: [40, 408, 776][i], y: 214, w: 352, h: 470, r: 14 };
  const rectExp = [{ x: 696, y: 214, w: 432, h: 227, r: 14 }, { x: 40, y: 214, w: 640, h: 470, r: 14 }, { x: 696, y: 457, w: 432, h: 227, r: 14 }][i];
  const keys = [[spawn + i * 0.045, rectSpawn], [team + i * 0.04, rectTeam], [expand + i * 0.03, rectExp]];
  if (k === 'P') keys.push([toC, { x: 0, y: 0, w: 1168, h: 810, r: 0 }]);
  keys.push([ap + (k === 'P' ? 0 : 0.02), rectTeam]);
  const doneT = T(L.doneCue);
  keys.push([doneT, { x: rectTeam.x, y: 214, w: 352, h: 64, r: 14 }]);
  keys.push([T('converge') + i * 0.06, { x: 224, y: [200, 262, 324][i], w: 720, h: 56, r: 14 }]);
  keys.push([T('stack') + i * 0.03, { x: 240, y: 190 + i * 46, w: 688, h: 40, r: 10 }]);
  const PP = k === 'P' ? { x: { w: 17, z: .9 }, y: { w: 17, z: .9 }, w: { w: 15, z: .92 }, h: { w: 14, z: .94 } } : {};
  return G(t_, { x: 204, y: 214, w: 760, h: 56, r: 14 }, keys, PP);
}
let t_ = 0;
function lanes(t) {
  t_ = t;
  const spawn = T('spawn'), team = T('team');
  Object.keys(LANE).forEach(k => {
    const L = LANE[k], el = L.el, i = L.idx, g = laneGeom(k);
    setG(el, g);
    const doneT = T(L.doneCue), toC = T('toComputer'), ap = T('approve');
    // visibility
    let vis = ramp(t, spawn - 0.01, .05) * (1 - ramp(t, T('result') + i * 0.04, .1));
    if (k !== 'P') vis *= 1 - Math.min(ramp(t, toC + 0.05, .25), 1 - ramp(t, ap + 0.15, .15));
    op(el, vis);
    el.style.zIndex = k === 'P' ? 3 : 2;
    // header/rows body fades out just before compressing into a "done" row; returns... never
    let bodyOp = ramp(t, spawn + 0.08, .12) * (1 - ramp(t, doneT - 0.09, .07));
    if (k === 'P') bodyOp *= 1 - Math.min(ramp(t, toC - 0.05, .1), 1 - ramp(t, ap + 0.22, .12));
    const body = $(el.id + 'Body'); op(body, bodyOp);
    const lhd = $$(body, '.lhd');
    // avatar states
    const work = win(t, team, doneT, .1), needOn = k === 'P' ? win(t, T('approvalCard'), T('approve') + 0.04, .08) : 0;
    setAv($$(lhd, '.avatar'), work * (1 - needOn), needOn, needOn > .5 ? 'need' : work > .5 ? 'work' : 'none', t);
    $$(lhd, '.dot').style.borderColor = 'var(--surface-1)';
    // engine label reveals briefly then collapses
    const eng = $(el.id + 'Eng'); const eOp = win(t, team + i * 0.05, team + 1.35 + i * 0.05, .14); op(eng, eOp); eng.style.transform = `translateX(${((1 - eOp) * 8).toFixed(1)}px)`;
    // done body
    const dn = $(el.id + 'Done'); op(dn, ramp(t, doneT + 0.02, .12)); dn.style.filter = blurCss((1 - ramp(t, doneT + 0.02, .12)) * 4);
    setAv($$(dn, '.avatar'), 0, 0, 'none', t);
    dn.style.pointerEvents = 'none';
    // rows
    L.rows.forEach((row) => {
      const d = row.d, a = ramp(t, d.t0 - 0.02, .14);
      op(row.el, a); row.el.style.transform = `translateY(${((1 - a) * 8).toFixed(1)}px)`;
      const spinning = t >= d.t0 && t < d.tEnd;
      const html = t < d.t0 ? '' : spinning ? 'S' : 'C';
      if (row.ico.__h !== html) { row.ico.innerHTML = html === 'C' ? CHECK() : html === 'S' ? '<div class="sp"></div>' : ''; row.ico.__h = html; }
      if (spinning) { const s = row.ico.firstChild; s.style.cssText = `position:absolute;inset:1px;border-radius:50%;border:2px solid var(--accent-soft);border-top-color:var(--accent);transform:rotate(${((t - d.t0) * 430) % 360}deg)`; }
      swap(row.rt, t, d.items, { bl: 4 });
      if (d.tag) { const tg = row.tag; if (tg.__h !== d.tag[1]) { tg.textContent = d.tag[1]; tg.__h = d.tag[1]; } op(tg, ramp(t, d.tag[0] + .04, .12)); }
    });
    // details
    if (k === 'R') [...L.det.querySelectorAll('.chip')].forEach((c, j) => { const a = ramp(t, L.detTimes[j], .12); op(c, a); c.style.transform = `translateY(${((1 - a) * 6).toFixed(1)}px)`; });
    if (k === 'P') [...L.det.querySelectorAll('.chip')].forEach((c, j) => { const a = ramp(t, L.detTimes[j], .1); op(c, a); c.style.transform = `scale(${(0.9 + 0.1 * a).toFixed(3)})`; });
    if (k === 'A') L.mx.forEach((c, j) => { const a = ramp(t, 9.9 + (j % 3) * 0.19 + Math.floor(j / 3) * 0.11 + ((j * 7) % 5) * 0.023, .1); op(c, a); });
    op(L.det.firstChild, ramp(t, k === 'R' ? 9.5 : k === 'P' ? 9.25 : 9.85, .12));
  });
  // task chips travelling from the original request into their Bot cards
  chips.forEach((c) => {
    const t0 = T(c.cue), g = laneGeomOf(c.lane, t), g0 = laneGeomOf(c.lane, t0);
    const tx = g.x + 14, ty = g.y + 62, tx0 = g0.x + 14, ty0 = g0.y + 62;
    const p0 = [424 + 22 + c.i * 96, 150];
    const k = stepResp(t - t0, 24, .82);
    const x = tx + (p0[0] - tx0) * (1 - k), y = ty + (p0[1] - ty0) * (1 - k);
    c.el.style.left = x.toFixed(2) + 'px'; c.el.style.top = y.toFixed(2) + 'px';
    const lifeEnd = LANE[c.lane].doneCue;
    op(c.el, ramp(t, t0 - 0.02, .06) * (1 - ramp(t, T('done' + (LANE[c.lane].idx + 1)) - 0.09, .07)) * (1 - Math.min(ramp(t, T('toComputer') - 0.1, .15), 1 - ramp(t, T('approve') + 0.15, .12))));
    c.el.style.zIndex = 9;
    c.el.style.transform = `scale(${(1 + 0.05 * Math.exp(-Math.pow((t - t0 - .15) / .12, 2))).toFixed(3)})`;
  });
  // pricing tray + connector line
  const trayOn = win(t, T('tray'), T('toComputer') - 0.06, .16);
  op(tray, trayOn); tray.style.transform = `translateY(${((1 - stepResp(t - T('tray'), 22, .8)) * 14).toFixed(2)}px) scale(${(0.96 + 0.04 * stepResp(t - T('tray'), 22, .8)).toFixed(3)})`;
  const tool = T('tool'), tls = [...tray.querySelectorAll('.tl')];
  const act = win(t, tool - 0.02, T('toComputer') - 0.08, .1);
  tls.forEach((e, i) => { const tileEl = e.firstChild; tileEl.style.boxShadow = i === 1 ? `0 0 0 2px rgba(110,139,255,${(act).toFixed(2)}), 0 0 ${(14 * act).toFixed(0)}px rgba(110,139,255,${(0.45 * act).toFixed(2)})` : 'none'; e.style.opacity = i === 1 ? 1 : (1 - 0.35 * act); });
  const lk = clamp((t - tool) / 0.42);
  op(linkSvg, lk > 0 ? win(t, tool, T('toComputer') - 0.1, .08) : 0);
  linkPath.style.strokeDashoffset = (-t * 20).toFixed(2);
  const pt = linkPath.getPointAtLength(linkLen * sstep(lk)); linkDot.setAttribute('cx', pt.x.toFixed(2)); linkDot.setAttribute('cy', pt.y.toFixed(2));
  linkPath.style.clipPath = 'none'; linkPath.setAttribute('stroke-dasharray', '4 5'); linkPath.style.opacity = (0.35 + 0.6 * (1 - lk)).toFixed(2);
}
function laneGeomOf(k, tt) { const s = t_; t_ = tt; const g = laneGeom(k); t_ = s; return g; }

/* ============================ computer view (inside the Pricing card) ============================ */
function computer(t) {
  const toC = T('toComputer'), comp = T('computer'), halt = T('halt'), ap = T('approve');
  const cv = $('compView');
  const on = ramp(t, comp + 0.02, .14) * (1 - ramp(t, ap + 0.06, .1));
  op(cv, on);
  // tab indicator: two edges with their own springs
  const l = S(t, 24, [[comp, 82]], SPR.tabL), rr = S(t, 56, [[comp, 152]], SPR.tabR);
  const ti = $('tabInd2'); ti.style.left = l.toFixed(2) + 'px'; ti.style.width = (rr - l).toFixed(2) + 'px';
  const cm = ramp(t, comp, .2); cv.querySelector('.tab').style.color = `color-mix(in srgb, var(--text-2) ${(cm * 100).toFixed(0)}%, var(--text))`;
  $('tabComp').style.color = `color-mix(in srgb, var(--text) ${(cm * 100).toFixed(0)}%, var(--text-2))`;
  // compress on halt (slow spring), then collapse of the whole view at approval
  const H = S(t, 563, [[halt, 330]], SPR.slow);
  const scr = $('scrCard'); scr.style.height = H.toFixed(2) + 'px'; $('stepCard').style.height = H.toFixed(2) + 'px';
  const BH = S(t, 445, [[halt, 212]], SPR.slow); $('browser').style.height = BH.toFixed(2) + 'px';
  op($('scrNote'), 1 - ramp(t, halt, .3));
  const ap0 = T('approvalCard');
  // control pill
  swap($('ctrlTxt'), t, [[comp + 0.1, 'Bot is controlling the computer'], [ap0, 'Waiting for your approval']], { bl: 3 });
  const pw = ramp(t, ap0, .15); const pl = $('ctrlPill');
  pl.style.background = `color-mix(in srgb, var(--warning-soft) ${(pw * 100).toFixed(0)}%, var(--accent-soft))`; pl.style.color = `color-mix(in srgb, var(--warning) ${(pw * 100).toFixed(0)}%, var(--accent))`;
  $('ctrlDot').style.background = 'currentColor'; $('ctrlDot').style.opacity = (0.55 + 0.45 * Math.sin(t * 2 * Math.PI / 1.4)).toFixed(2);
  pl.style.opacity = ramp(t, comp + 0.05, .12);
  // ---- browser ----
  const b1 = T('bclick1'), b2 = T('bclick2'), b3 = T('bclick3'), b4 = T('bclick4');
  const showPg = i => i === 0 ? t < b1 : i === 1 ? (t >= b1 && t < b2) : i === 2 ? (t >= b2 && t < b4) : t >= b4;
  [0, 1, 2, 3].forEach(i => { $('pg' + i).style.visibility = showPg(i) ? 'visible' : 'hidden'; });
  const addr = t < b1 ? '<span style="color:#80868b">Search or enter address</span>' : t < b2 ? 'atlas.example' : t < b4 ? 'atlas.example/pricing' : 'beacon.example/pricing';
  const ad = $('addr'); if (ad.__h !== addr) { ad.innerHTML = addr; ad.__h = addr; }
  const t1 = t < b1 ? 'New tab' : t < b2 ? 'Atlas · Docs' : 'Atlas · Pricing';
  const tb1 = $('tab1'); if (tb1.__h !== t1) { tb1.textContent = t1; tb1.__h = t1; }
  const tw = S(t, 0, [[b4, 184]], SPR.w); const tb2 = $('tab2'); tb2.style.width = Math.max(0, tw).toFixed(1) + 'px'; tb2.style.padding = tw > 20 ? '6px 12px' : '0';
  tb1.style.background = t >= b4 ? '#cdd0d6' : '#fff'; tb2.style.background = t >= b4 ? '#fff' : '#cdd0d6';
  $('tabPlus').style.left = (200 + tw + 4) + 'px';
  const lb = Math.max(ramp(t, b1, .16) * (1 - ramp(t, b1 + .17, .05)), ramp(t, b2, .16) * (1 - ramp(t, b2 + .17, .05)));
  const bar = $('loadBar'); bar.style.width = (712 * clamp((t - (t < b2 ? b1 : b2)) / .17)).toFixed(1) + 'px'; op(bar, lb > 0 || (t > b1 && t < b1 + .2) || (t > b2 && t < b2 + .2) ? 1 : 0);
  [['scan0', b3 - 0.25], ['scan1', b3], ['scan2', b3 + 0.125]].forEach(([id, a]) => { const e = $(id); op(e, ramp(t, a, .06) * (t < b4 ? 1 : 0)); });
  // bot cursor path in viewport coords (fast responses + one slow approach summed)
  const kx = [[comp + 0.02, 620], [b1 - .28, 328], [b2 - .38, 516], [b3 - .38, 346], [b3 + .05, 208], [b4 + .12, 128]];
  const ky = [[comp + 0.02, 250], [b1 - .28, -40], [b2 - .38, 26], [b3 - .38, 236], [b3 + .05, -46], [b4 + .12, 232]];
  const bx = S(t, 620, kx.slice(1), SPR.cur) + (99 - 128) * stepResp(t - halt, 6, 1);
  const by = S(t, 250, ky.slice(1), SPR.cur) + (311 - 232) * stepResp(t - halt, 6, 1);
  const bc = $('botCur'); bc.style.left = bx.toFixed(2) + 'px'; bc.style.top = by.toFixed(2) + 'px';
  const clickPulse = [b1, b2, b3, b4].reduce((a, c) => a + Math.exp(-Math.pow((t - c - 0.03) / .05, 2)), 0);
  bc.style.transform = `scale(${(1 - 0.12 * clickPulse).toFixed(3)})`; bc.style.transformOrigin = '4px 3px';
  op(bc, ramp(t, comp + 0.02, .12) * (1 - ramp(t, ap + 0.08, .06)));
  // steps rail
  stepDefs.forEach((s, i) => {
    const a = ramp(t, comp + 0.1 + i * .06, .12); op(s.el, a); s.el.style.transform = `translateY(${((1 - a) * 6).toFixed(1)}px)`;
    const st = t >= s.off() ? 'done' : t >= s.on() ? (i === 2 && t >= ap0 ? 'wait' : 'act') : 'pend';
    let inner;
    if (st === 'done') inner = `<span style="width:24px;height:24px;border-radius:7px;background:var(--success-soft);color:var(--success);display:grid;place-items:center">${ic('check', 14, 'stroke-width:3')}</span>`;
    else if (st === 'act') inner = `<div style="width:20px;height:20px;border-radius:50%;border:2.5px solid var(--accent-soft);border-top-color:var(--accent);transform:rotate(${((t * 430) % 360).toFixed(0)}deg)"></div>`;
    else if (st === 'wait') inner = `<span style="width:24px;height:24px;border-radius:7px;background:var(--warning-soft);color:var(--warning);display:grid;place-items:center">${ic('hand', 14)}</span>`;
    else inner = PEND;
    s.ico.innerHTML = inner;
    s.el.style.color = st === 'pend' ? 'var(--text-3)' : 'var(--text)';
    s.tm.textContent = st === 'done' ? s.time : '';
  });
  op(stepNote, ramp(t, ap0 + 0.05, .12) * (1 - ramp(t, ap + 0.02, .05)));
  // ---- approval card: emerges from the compressed screen, collapses instantly on Allow ----
  const A = $('appr');
  const g = G(t, { x: 304, y: 380, w: 560, h: 44, r: 14 }, [[ap0, { x: 24, y: 458, w: 1120, h: 236, r: 14 }], [ap, { x: 24, y: 576, w: 1120, h: 0, r: 14 }]], { x: { w: 24, z: .9 }, y: { w: 24, z: .9 }, w: { w: 24, z: .9 }, h: { w: 24, z: .92 }, r: SPR.rad });
  setG(A, g); A.style.zIndex = 12;
  const inner = ramp(t, ap0 + 0.09, .12) * (1 - ramp(t, ap - 0.005, .05));
  op(A, ramp(t, ap0 - 0.01, .05) * (1 - ramp(t, ap + 0.06, .05)));
  [...A.children].forEach(c => { c.style.opacity = inner.toFixed(3); c.style.filter = blurCss((1 - ramp(t, ap0 + 0.09, .12)) * 4); });
  const ba = $('btnAllow'); ba.style.transform = `scale(${(1 - 0.06 * Math.exp(-Math.pow((t - ap - 0.02) / .04, 2))).toFixed(3)})`;
  ba.style.boxShadow = `0 0 0 ${(3 * win(t, ap - 0.4, ap + 0.05, .2)).toFixed(1)}px rgba(110,139,255,.25)`;
}

/* ============================ result message ============================ */
function result(t) {
  const st = T('stack'), rs = T('result');
  const f = $('resMsg');
  const g = G(t, { x: 224, y: 124, w: 720, h: 300, r: 14 }, [[rs, { x: 224, y: 112, w: 720, h: 462, r: 14 }]], { h: { w: 16, z: .9 } });
  setG(f, g); f.style.zIndex = 1;
  const o = ramp(t, st - 0.02, .16); op(f, o); f.style.borderColor = 'var(--border)';
  const av2 = $$($('resAv'), '.avatar'); setAv(av2, win(t, T('think'), st, .1), 0, 'none', t);
  [...f.children].slice(0, 4).forEach(c => { c.style.opacity = ramp(t, st + 0.02, .14); });
  const ttl = $('resTitle'); appear(ttl, t, rs, 1e9, { d: .14, bl: 5 }); ttl.style.transform += '';
  const rows = ['rr0', 'rr1', 'rr2', 'rr3'], cues = ['row1', 'row2', 'row3', 'row4'];
  op($('resTable'), ramp(t, T('row1') - 0.02, .04));
  rows.forEach((id, i) => { const a = ramp(t, T(cues[i]) - 0.015, .07); $(id).style.opacity = a.toFixed(3); });
  appear($('resSecA'), t, T('row3'), 1e9, { d: .15, bl: 4, dy: 8 }); appear($('resSecB'), t, T('row4'), 1e9, { d: .15, bl: 4, dy: 8 });
}

/* ============================ view slides (chat → activity → routines) ============================ */
function views(t) {
  const act = T('activity'), rou = T('routines'), rs = T('live') + 0.35, back = T('lock') - 0.5;
  const vC = S(t, 0, [[act, -1168], [rs, -1168], [back, 0]], SPR.panel);
  // hidden repositioning happens while the whole ui is invisible (bar 13)
  const vA = S(t, 1168, [[act, 0], [rou, -1168], [rs, 1168]], SPR.panel);
  const vR = S(t, 1168, [[rou, 0], [rs, 1168]], SPR.panel);
  $('vChat').style.transform = `translateX(${vC.toFixed(2)}px)`;
  $('vAct').style.transform = `translateX(${vA.toFixed(2)}px)`;
  $('vRou').style.transform = `translateX(${vR.toFixed(2)}px)`;
  // ---- activity ----
  swap($('actSub'), t, [[act, 'Nothing needs you']], { bl: 3 });
  appear($('waitEmpty'), t, T('waiting'), 1e9, { d: .16, bl: 4 });
  [['act0', 'res1'], ['act1', 'res2'], ['act2', 'res3']].forEach(([id, c]) => appear($(id), t, T(c), 1e9, { d: .16, bl: 4, dy: 10 }));
  appear($('recLbl'), t, T('res1') - 0.05, 1e9, { d: .14, bl: 3 });
  appear($('actHeld'), t, T('held'), 1e9, { d: .2, bl: 4, dy: 12 });
  // ---- routines ----
  const ri = $('rouItem'); const rk = ramp(t, rou + 0.02, .2); op(ri, rk); ri.style.transform = `translateY(${((1 - stepResp(t - rou, 22, .8)) * -18).toFixed(2)}px) scale(${(0.97 + 0.03 * stepResp(t - rou, 22, .8)).toFixed(3)})`;
  appear($('rouDetail'), t, rou + 0.12, 1e9, { d: .2, bl: 5, dy: 10 });
  const live = T('live'), dry = T('dryclick');
  const modeHtml = t < live ? '<span class="pill acc">Dry run only</span>' : '<span class="pill ok">Live</span>';
  swap($('rouMode'), t, [[0, '<span class="pill acc">Dry run only</span>'], [live, '<span class="pill ok">Live</span>']], { ex: .05, en: .12, bl: 4 });
  swap($('rouPillL'), t, [[0, '<span class="pill acc">Dry run only</span>'], [live, '<span class="pill ok">Live</span>']], { ex: .05, en: .12, bl: 4 });
  const bh = S(t, 100, [[live, 0]], SPR.panel); const ban = $('rouBanner'); ban.style.height = Math.max(0, bh).toFixed(2) + 'px'; op(ban, 1 - ramp(t, live, .16)); ban.style.borderWidth = bh < 2 ? '0' : '1px';
  const shift = S(t, 0, [[live, -116]], SPR.panel);
  $('rouTry').style.top = (192 + shift).toFixed(2) + 'px'; $('rouInstr').style.top = (478 + shift).toFixed(2) + 'px';
  const bl = $('btnLive'); bl.style.transform = `scale(${(1 - 0.06 * Math.exp(-Math.pow((t - live - 0.02) / .04, 2))).toFixed(3)})`;
  const bd = $('btnDry'); bd.style.transform = `scale(${(1 - 0.06 * Math.exp(-Math.pow((t - dry - 0.02) / .04, 2))).toFixed(3)})`;
  bd.style.background = t >= dry && t < T('dryDone') + 0.4 ? 'var(--surface-3)' : 'var(--surface-2)';
  runDefs.forEach((d, i) => {
    const on = T(d[1]), off = T(d[2]);
    const a = ramp(t, on - 0.02, .12); op(d.el, a); d.el.style.transform = `translateY(${((1 - a) * 6).toFixed(1)}px)`;
    d.ico.innerHTML = t >= off ? CHECK() : t >= on ? `<div style="position:absolute;inset:1px;border-radius:50%;border:2px solid var(--accent-soft);border-top-color:var(--accent);transform:rotate(${((t - on) * 430) % 360}deg)"></div>` : '';
  });
  appear(runDone, t, T('dryDone'), 1e9, { d: .14, bl: 3 });
}

/* ============================ phone ============================ */
function phone(t) {
  const shrink = T('shrink'), notify = T('notify'), tap = T('tap'), lock = T('lock');
  op(els.phoneWrap, ramp(t, shrink + 0.16, .16) * (1 - ramp(t, lock, .12)));
  const ny = S(t, -100, [[notify, 14], [tap + 0.1, -100]], SPR.pop);
  const nt = $('phNote'); nt.style.top = ny.toFixed(2) + 'px'; nt.style.transform = `scale(${(1 - 0.03 * Math.exp(-Math.pow((t - tap - 0.02) / .06, 2))).toFixed(3)})`;
  const sc = S(t, 0, [[tap + 0.08, -210]], SPR.panel);
  $('phThread').style.transform = `translateY(${sc.toFixed(2)}px)`;
  const enc = $('phEnc'); appear(enc, t, tap + 0.08, 1e9, { d: .14, bl: 3 });
  swap($('phSub'), t, [[0, 'Your first point of contact'], [tap + 0.02, 'Done']], { bl: 3 });
  const pm = $('phMsg'); pm.style.filter = 'none';
}

/* ============================ architecture layer ============================ */
function arch(t, on) {
  const ly = T('layers'), ws = [T('layers'), T('w2'), T('w3'), T('w4')];
  const A = $('arch'); A.style.visibility = on > .002 ? 'visible' : 'hidden';
  op($('archOut'), on * ramp(t, ly - 0.03, .2));
  const lock = T('w4');
  const lp = 1 + 0.25 * Math.exp(-Math.pow((t - lock - 0.05) / .1, 2));
  $('archLbl').style.opacity = (on * ramp(t, ly, .16)).toFixed(3);
  $('archLock').style.transform = `scale(${lp.toFixed(3)})`; $('archLock').style.color = t >= lock ? 'var(--accent)' : 'var(--text-2)'; $('archLock').style.display = 'inline-block';
  // plates: staggered, each with its own offset
  for (let i = 0; i < 4; i++) {
    const p = $('plate' + i), a = ramp(t, ly + 0.05 + i * 0.07, .18) * on;
    op(p, a); p.style.transform = `translateY(${((1 - a) * 14).toFixed(1)}px)`;
    const hl = i === 0 ? Math.max(ramp(t, ws[0], .1) * .6, ramp(t, ws[3], .1)) : i === 1 ? ramp(t, ws[1], .1) : i === 2 ? ramp(t, ws[2], .1) : ramp(t, ws[3], .1);
    p.style.borderColor = `color-mix(in srgb, var(--accent) ${(hl * 100).toFixed(0)}%, var(--border))`;
    if (i < 3) { const ar = $('arr' + i); op(ar, ramp(t, ly + 0.14 + i * 0.07, .16) * on); }
  }
  $('archOut').style.borderColor = `color-mix(in srgb, var(--accent) ${(Math.max(ramp(t, ws[0], .12) * (1 - ramp(t, ws[1], .1)) * .8, ramp(t, ws[3], .12)) * 100).toFixed(0)}%, var(--border-strong))`;
  for (let i = 0; i < 4; i++) {
    const w = $('w' + i); const a = ramp(t, ws[i], .16); const gone = ramp(t, T('w4') + 0.5, .2);
    const cur = i === 3 ? 1 : 1 - ramp(t, ws[i + 1], .2) * 0.55;
    op(w, a * (1 - gone)); w.style.opacity = (a * (1 - gone) * cur).toFixed(3);
    w.style.transform = `translateX(${((1 - a) * -28).toFixed(1)}px)`; w.style.filter = blurCss((1 - a) * 7);
    w.style.color = 'var(--text)';
  }
}

/* ============================ cursor ============================ */
const CLICKS = [T('focus'), T('send'), T('approve'), T('dryclick'), T('live'), T('tap')];
function cursor(t) {
  const send = MAIN(920, 749), comp = MAIN(500, 749), allow = MAIN(99, 660), dry = MAIN(526, 397), lv = MAIN(1048, 221), note = [960, 151];
  const kx = [], ky = [];
  const K = (time, p) => { kx.push([time, p[0]]); ky.push([time, p[1]]); };
  K(T('window') + 0.05, comp); K(T('key3') + 0.02, send);
  K(T('approvalCard') + 0.5, allow);
  K(T('routines') + 0.2, dry); K(T('dryDone') - 0.05, lv);
  K(T('notify') + 0.22, note);
  K(T('collapse') - 0.5, PARK);
  const x = S(t, PARK[0], kx, SPR.cur), y = S(t, PARK[1], ky, SPR.cur);
  const cs = 1 - 0.14 * CLICKS.reduce((a, c) => a + Math.exp(-Math.pow((t - c - 0.035) / 0.05, 2)), 0);
  const c = $('cursor'); c.style.left = (x - 4).toFixed(2) + 'px'; c.style.top = (y - 3).toFixed(2) + 'px';
  c.style.transformOrigin = '4px 3px'; c.style.transform = `scale(${cs.toFixed(3)})`;
  op(c, ramp(t, T('window') + 0.0, .2) * (1 - ramp(t, T('collapse') - 0.15, .35)));
  // click ripple at the hotspot
  let rp = null; for (const cc of CLICKS) if (t >= cc && t < cc + 0.5) rp = cc;
  const R = $('ripple');
  if (rp !== null) { const k = (t - rp) / 0.5, big = rp === T('tap'); R.style.left = x.toFixed(2) + 'px'; R.style.top = y.toFixed(2) + 'px'; R.style.opacity = ((big ? .55 : .35) * (1 - k)).toFixed(3); R.style.transform = `scale(${(0.25 + (big ? 1.2 : .8) * sstep(k)).toFixed(3)})`; R.style.visibility = 'visible'; }
  else { R.style.visibility = 'hidden'; R.style.opacity = 0; }
}

/* ============================ camera & caption ============================ */
function camera(t) {
  const sc = S(t, 1, [[T('team'), .978], [T('computer') - 0.2, 1.035], [T('halt'), 1.04], [T('resume'), .985], [T('activity'), 1.0], [T('shrink'), 1.035], [T('lock'), 1.0]], SPR.cam);
  const tx = S(t, 0, [[T('computer') - 0.2, -14], [T('resume'), 0], [T('routines'), -10], [T('shrink'), 0]], SPR.cam);
  els.cam.style.transform = `translate(${tx.toFixed(2)}px,0) scale(${sc.toFixed(4)})`;
}
function caption(t) {
  swap($('cap'), t, [
    [T('tool'), 'Tools when they need them.'], [T('computer') + 0.02, 'Watch live. Take over anytime.'], [T('halt') - 0.02, ''],
    [T('waiting'), 'Important things interrupt you. Everything else can wait.'], [T('routines') - 0.1, ''],
    [T('dryclick'), 'Turn repeatable work into a routine.'], [T('live') - 0.1, ''],
    [T('tap'), 'Your team stays with you.'], [T('layers') - 0.15, ''],
  ], { bl: 4, ex: .07, en: .12 });
}

window.seek = t => { render(t); return t; };
document.fonts.ready.then(() => { render(0); window.__ready = true; });
