/* ===== static DOM: built once, then only styled by scenes.js (pure function of t) ===== */
const $ = id => document.getElementById(id);
const avStack = (k, size, cls = '') => `<div class="avatar ${cls}" style="width:${size}px;height:${size}px">` +
  `<img class="a-i" src="${AS.avatars[k].idle}"><img class="a-t" src="${AS.avatars[k].thinking}" style="opacity:0"><img class="a-u" src="${AS.avatars[k].unsure}" style="opacity:0">` +
  (k === 'cos' ? `<span class="crown">${ic('crown', Math.max(8, Math.round(size * .3)), 'stroke-width:2.4')}</span>` : '') +
  `<span class="dot"></span></div>`;
const ICONSVG = (s, r = 185) => `<svg viewBox="100 100 824 824" style="width:${s}px;height:${s}px;display:block"><rect x="100" y="100" width="824" height="824" rx="${r}" fill="url(#gBg)"/><rect x="100" y="100" width="824" height="412" rx="${r}" fill="#fff" opacity=".06"/>${GLYPH}</svg>`;
const GLYPH = `<g filter="url(#gSh)"><path d="M330 330 h364 a86 86 0 0 1 86 86 v176 a86 86 0 0 1 -86 86 h-190 l-96 78 v-78 h-78 a86 86 0 0 1 -86 -86 v-176 a86 86 0 0 1 86 -86 z" fill="url(#gFace)"/></g><rect x="496" y="250" width="32" height="80" rx="16" fill="#fff"/><circle cx="512" cy="238" r="34" fill="#fff"/><rect x="412" y="440" width="58" height="92" rx="29" fill="#3B35C9"/><rect x="554" y="440" width="58" height="92" rx="29" fill="#3B35C9"/>`;
const chipEngine = (e, m) => `<span class="chip">${ic('cpu', 14)}<b>${e}</b>${m ? ' ' + m : ''}</span>`;
const tile = (l, c, bg) => `<div style="width:44px;height:44px;border-radius:10px;background:${bg};color:${c};display:grid;place-items:center;font-weight:650;font-size:18px">${l}</div>`;
const navItem = (i, y, icon, label) => `<div class="nav" id="nav${i}" style="top:${y}px">${ic(icon, 16)}<span>${label}</span></div>`;
const sbRow = (id, y, k, name, pv) => `<div class="sbrow" id="${id}" style="top:${y}px">${avStack(k, 34).replace('class="avatar "', 'class="avatar" ').replace('style="', 'style="left:10px;top:9px;')}<div class="nm">${name}</div><div class="pv" id="${id}pv"></div><span class="pill warn" id="${id}need" style="position:absolute;right:8px;top:6px;opacity:0;height:19px;font-size:11.5px">Needs you</span></div>`;

const mkLane = (id, k, name, role, engine) => `
<div class="lane" id="${id}">
  <div id="${id}Body" style="position:absolute;inset:0">
    <div class="lhd">${avStack(k, 32).replace('style="', 'style="left:14px;top:12px;')}
      <div class="abs" style="left:54px;top:9px;font-size:14px;font-weight:650;white-space:nowrap">${name}</div>
      <div class="abs t3" style="left:54px;top:29px;font-size:12px;white-space:nowrap">${role}</div>
      <div class="abs" id="${id}Eng" style="right:12px;top:14px"><span class="chip" style="height:24px;font-size:11px;padding:0 9px">${ic('cpu', 12)}<b>${engine}</b></span></div>
    </div>
    <div id="${id}Rows"></div>
  </div>
  <div id="${id}Done" class="abs" style="left:0;top:0;right:0;height:62px;opacity:0"></div>
</div>`;

const site = {
  nav: (active) => `<div class="abs" style="left:0;top:0;width:712px;height:46px;border-bottom:1px solid #e6e8ee"></div>
    <div class="abs" style="left:24px;top:11px;font-weight:800;font-size:18px;letter-spacing:-.03em;color:#111">atlas<span style="color:#5b6bff">.</span></div>
    <div class="abs" style="left:430px;top:15px;font-size:12.5px;color:#4a4f5c">Product</div>
    <div class="abs" id="siteNavPricing" style="left:492px;top:15px;font-size:12.5px;color:${active === 'pricing' ? '#111' : '#4a4f5c'};font-weight:${active === 'pricing' ? 650 : 500}">Pricing</div>
    <div class="abs" style="left:548px;top:15px;font-size:12.5px;color:#4a4f5c">Docs</div>
    <div class="abs" style="left:606px;top:9px;height:28px;padding:0 12px;border-radius:14px;background:#111;color:#fff;font-size:12px;line-height:28px;font-weight:600">Sign in</div>`,
};
const plan = (x, n, price, feats, hi) => `<div class="abs" style="left:${x}px;top:128px;width:204px;height:214px;border:1px solid #e1e4ec;border-radius:12px;padding:16px;background:#fff">
  <div style="font-size:13px;font-weight:650;color:#111">${n}</div>
  <div style="margin-top:8px;font-size:30px;font-weight:750;letter-spacing:-.03em;color:#111">${price}<span style="font-size:11px;font-weight:500;color:#7a7f8c;letter-spacing:0"> /editor</span></div>
  <div style="margin-top:12px;font-size:12px;line-height:1.9;color:#4a4f5c">${feats.map(f => '✓ ' + f).join('<br>')}</div>
  <div style="position:absolute;left:16px;bottom:16px;right:16px;height:30px;border-radius:8px;background:${hi ? '#111' : '#f0f1f5'};color:${hi ? '#fff' : '#111'};font-size:12px;font-weight:600;text-align:center;line-height:30px">Choose ${n}</div></div>`;

const html = `
<svg width="0" height="0" style="position:absolute"><defs>
  <linearGradient id="gBg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7B93FF"/><stop offset="1" stop-color="#4A3FD9"/></linearGradient>
  <linearGradient id="gFace" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#E7EAFF"/></linearGradient>
  <filter id="gSh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#1B1466" flood-opacity=".35"/></filter>
  ${[1, 2, 3, 4, 5, 6, 7, 8].map(n => `<filter id="db${n}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${n} 0"/></filter>`).join('')}
</defs></svg>
<div id="stage"><div id="cam">
  <div id="win">
    <div id="winBg"></div><div id="tileBg"></div>
    <div id="glyph"><svg viewBox="100 100 824 824">${GLYPH}</svg></div>
    <div id="collapseAv">${avStack('cos', 120)}</div>
    <div id="uiWrap"><div id="ui">
      <!-- ================= sidebar ================= -->
      <div id="sb">
        <div class="abs" style="left:22px;top:17px;width:28px;height:28px">${ICONSVG(28, 185).replace('<rect x="100" y="100" width="824" height="824" rx="185"', '<rect x="100" y="100" width="824" height="824" rx="200"')}</div>
        <div class="abs" style="left:60px;top:14px;font-size:18px;font-weight:650;letter-spacing:-.01em">OpenBot</div>
        <div class="abs t2" style="left:203px;top:18px">${ic('search', 18)}</div><div class="abs t2" style="left:238px;top:18px">${ic('square-pen', 18)}</div>
        <div class="abs lbl" style="left:22px;top:66px">Bots</div>
        <div class="abs" id="botHi" style="left:8px;top:84px;width:256px;height:52px;border-radius:10px;background:var(--surface-2);border-left:2px solid var(--accent)"></div>
        ${sbRow('rowC', 84, 'cos', 'Chief of Staff')}
        <div class="abs lbl" id="teamLbl" style="left:22px;top:152px">Team</div>
        ${sbRow('rowR', 170, 'research', 'Research')}
        ${sbRow('rowP', 224, 'pricing', 'Pricing')}
        ${sbRow('rowA', 278, 'analyst', 'Product Analyst')}
        <div class="abs" style="left:0;top:596px;width:272px;height:1px;background:var(--border)"></div>
        <div class="abs" id="navHi" style="left:8px;top:606px;width:256px;height:33px;border-radius:8px;background:var(--surface-2)"></div>
        ${navItem(0, 606, 'activity', 'Activity')}${navItem(1, 640, 'calendar-clock', 'Routines')}${navItem(2, 674, 'plug', 'Connectors')}
        ${navItem(3, 708, 'shield-check', 'Audit')}${navItem(4, 742, 'monitor-smartphone', 'Devices')}${navItem(5, 776, 'settings', 'Settings')}
        <div class="badge" id="navBadge" style="top:612px;right:14px">1</div>
      </div>
      <!-- ================= main ================= -->
      <div id="main">
        <!-- ---------- chat view ---------- -->
        <div class="view" id="vChat">
          <div class="abs" id="hdrAv" style="left:24px;top:15px">${avStack('cos', 36).replace('style="', 'style="left:0;top:0;')}</div>
          <div class="hdr-name" style="left:70px;top:12px">Chief of Staff</div>
          <div class="hdr-sub" id="hdrSub" style="left:70px;top:36px"></div>
          <div class="abs" style="right:24px;top:20px">${chipEngine('Claude', 'Opus 5.5')}</div>
          <div class="tab" style="left:24px;top:69px;color:var(--text)">Chat</div><div class="tab" style="left:82px;top:69px">Profile</div>
          <div class="abs" id="tabInd" style="top:92px;height:2px;background:var(--accent);border-radius:2px"></div>
          <div class="abs" style="left:0;top:94px;width:1168px;height:1px;background:var(--border)"></div>

          <div class="bubble-user" id="userBubble"><div id="ubText">Research the top 3 competitors, compare their pricing and features, and prepare a launch brief.</div></div>
          <div class="abs t3" id="ubTime" style="left:840px;top:196px;width:104px;text-align:right;font-size:12px">9:41 AM</div>

          <div class="card" id="dec" style="overflow:hidden">
            <div class="abs" id="decAv" style="left:14px;top:17px">${avStack('cos', 28).replace('style="', 'style="left:0;top:0;')}</div>
            <div class="abs" id="decTxt" style="left:54px;top:19px;font-size:14px;font-weight:550;white-space:nowrap"></div>
            <div class="abs" id="decSpin" style="right:20px;top:20px;width:22px;height:22px;border-radius:50%;border:2.5px solid var(--accent-soft);border-top-color:var(--accent)"></div>
          </div>

          ${mkLane('laneR', 'research', 'Research', 'Mapping competitors', 'Claude Code')}
          ${mkLane('laneA', 'analyst', 'Product Analyst', 'Positioning', 'Claude Code')}
          ${mkLane('laneP', 'pricing', 'Pricing', 'Plans &amp; pricing', 'Codex')}

          <!-- result message -->
          <div class="card" id="resMsg" style="overflow:hidden;border-radius:14px">
            <div class="abs" id="resAv" style="left:16px;top:14px">${avStack('cos', 30).replace('style="', 'style="left:0;top:0;')}</div>
            <div class="abs msgname" style="left:56px;top:14px">Chief of Staff</div><div class="abs t3" style="left:158px;top:16px;font-size:12px">9:44 AM</div>
            <span class="pill ok abs" style="left:56px;top:38px;height:20px">Result</span>
            <div class="abs" id="resTitle" style="left:16px;top:74px;font-size:18px;font-weight:700;letter-spacing:-.01em;white-space:nowrap">Launch brief ready <span class="mono" style="font-size:12px;font-weight:500;background:var(--surface-2);padding:3px 7px;border-radius:6px;margin-left:8px;vertical-align:2px">workspace/launch-brief.md</span></div>
            <div class="abs" id="resTable" style="left:16px;top:114px;width:688px">
              <table class="t"><tr id="rr0"><th>Competitor</th><th>Entry plan</th><th>Team plan</th><th>Strongest at</th></tr>
              <tr id="rr1"><td>Atlas</td><td>Free</td><td>$24 / seat</td><td>Docs-first workflow</td></tr>
              <tr id="rr2"><td>Beacon</td><td>$9 / seat</td><td>$32 / seat</td><td>Analytics</td></tr>
              <tr id="rr3"><td>Cinder</td><td>$12 / seat</td><td>$28 / seat</td><td>Automation</td></tr></table>
            </div>
            <div class="abs" id="resSecA" style="left:16px;top:294px;width:330px"><div class="lbl" style="margin-bottom:8px">Positioning opportunities</div><div style="font-size:13.5px;line-height:1.6;color:var(--text)">• No one leads on setup speed<br>• Team plans start at $24 or more</div></div>
            <div class="abs" id="resSecB" style="left:374px;top:294px;width:330px"><div class="lbl" style="margin-bottom:8px">Recommended launch angles</div><div style="font-size:13.5px;line-height:1.6;color:var(--text)">• Lead with price transparency<br>• Ship a free plan comparison page</div></div>
          </div>

          <div class="composer" id="composer">
            <div class="abs" id="compTxt" style="left:20px;top:14px;font-size:14.5px;white-space:nowrap;color:var(--text)"></div>
            <div class="abs t3" id="compPh" style="left:20px;top:14px;font-size:14.5px">Message Chief of Staff…</div>
            <div class="abs" id="caret" style="top:15px;width:1.5px;height:19px;background:var(--accent)"></div>
            <div class="sendbtn" id="sendBtn">${ic('arrow-up', 16)}</div>
          </div>
          <div class="abs t3" id="hint" style="left:0;width:1168px;text-align:center;top:785px;font-size:11.5px">Enter to send · Shift+Enter for a new line</div>

          <!-- approval (above everything in chat) -->
          <div class="appr" id="appr">
            <div class="abs" style="left:16px;top:14px;display:flex;align-items:center;gap:8px;font-size:15px;font-weight:650"><span style="color:var(--warning)">${ic('shield-alert', 18)}</span>Review an action</div>
            <div class="abs t3" style="right:18px;top:16px;font-size:12px;display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:50%;background:var(--warning)"></span>Pricing · Waiting for you</div>
            <div class="abs" style="left:16px;top:46px;font-size:15px">Submit a form on beacon.example</div>
            <div class="abs mono" style="left:16px;top:76px;right:16px;height:44px;border-radius:10px;background:var(--bg);border:1px solid var(--border);font-size:13px;line-height:42px;padding:0 14px;color:var(--text)">Submit “Request quote” · beacon.example/pricing</div>
            <div class="abs t2" style="left:16px;top:132px;font-size:13px;display:flex;align-items:center;gap:4px">${ic('chevron-right', 14)}Details</div>
            <div class="abs" style="left:16px;top:156px;font-size:13px;color:var(--warning)">Risk: medium</div>
            <div class="abs" id="apprBtns" style="left:16px;top:184px;display:flex;gap:10px">
              <span class="btn pri" id="btnAllow" style="height:36px;padding:0 20px;font-size:14px">Allow once</span><span class="btn" style="height:36px;padding:0 18px;font-size:14px">Always allow</span><span class="btn danger" style="height:36px;padding:0 16px;font-size:14px">Deny</span></div>
          </div>
        </div>
        <!-- ---------- activity view ---------- -->
        <div class="view" id="vAct">
          <div class="abs" style="left:24px;top:14px;font-size:18px;font-weight:650">Activity</div>
          <div class="abs t2" id="actSub" style="left:24px;top:40px;font-size:13px"></div>
          <div class="abs" style="left:0;top:76px;width:1168px;height:1px;background:var(--border)"></div>
          <div class="abs lbl" style="left:224px;top:104px">Waiting on you</div>
          <div class="abs" id="waitEmpty" style="left:224px;top:130px;width:720px;height:62px;border-radius:12px;border:1px dashed var(--border-strong);display:flex;align-items:center;gap:10px;padding:0 20px;color:var(--text-2);font-size:13.5px"><span style="color:var(--success)">${ic('circle-check', 18)}</span>Nothing is waiting on you.</div>
          <div class="abs lbl" id="recLbl" style="left:224px;top:226px">Recent results</div>
          ${[['cos', 'Chief of Staff', 'Launch brief ready', 'just now'], ['pricing', 'Pricing', 'Pricing analysis', '2m ago'], ['research', 'Research', 'Competitor research', '4m ago']].map((r, i) => `
          <div class="abs" id="act${i}" style="left:224px;top:${252 + i * 74}px;width:720px;height:66px">
            ${avStack(r[0], 34).replace('style="', 'style="left:0;top:8px;')}
            <div class="abs" style="left:48px;top:6px;font-size:14px;font-weight:650">${r[1]}</div><span class="pill ok abs" style="left:${48 + (r[1].length * 8.6 + 10)}px;top:5px;height:19px;font-size:11.5px">Result</span>
            <div class="abs" style="left:48px;top:30px;font-size:13.5px"><span style="color:var(--success)">✓</span> ${r[2]}</div>
            <div class="abs t3" style="right:0;top:7px;font-size:12px">${r[3]}</div></div>`).join('')}
          <div class="abs" id="actHeld" style="left:212px;top:480px;width:744px;height:104px;border-radius:12px;background:rgba(229,168,59,.07)">
            ${avStack('analyst', 34).replace('style="', 'style="left:12px;top:12px;')}
            <div class="abs" style="left:60px;top:10px;font-size:14px;font-weight:650">Product Analyst</div><span class="pill warn abs" style="left:184px;top:9px;height:19px;font-size:11.5px">Held for digest</span>
            <div class="abs" style="left:60px;top:34px;font-size:13.5px">Still comparing older plan pages… (progress)</div>
            <div class="abs t2" style="left:60px;top:66px;font-size:12.5px;display:flex;gap:18px"><span style="display:flex;gap:6px;align-items:center">${ic('message-square', 14)}Open chat</span><span class="btn sm" style="margin:-6px 0 0 -6px">${ic('send', 13)}Deliver</span><span style="display:flex;gap:6px;align-items:center">${ic('bell-off', 14)}Mark as noise</span></div>
            <div class="abs t3" style="right:14px;top:11px;font-size:12px">held</div></div>
        </div>
        <!-- ---------- routines view ---------- -->
        <div class="view" id="vRou">
          <div class="abs" style="left:24px;top:14px;font-size:18px;font-weight:650">Routines</div>
          <div class="abs t2" style="left:24px;top:40px;font-size:13px">Work your bots do on a schedule or when something happens</div>
          <span class="btn pri abs" style="right:24px;top:18px;height:34px">${ic('plus', 15)}New routine</span>
          <div class="abs" style="left:0;top:76px;width:1168px;height:1px;background:var(--border)"></div>
          <div class="abs" style="left:420px;top:77px;width:1px;height:733px;background:var(--border)"></div>
          <div class="abs" style="left:10px;top:92px;width:400px;height:62px;border-radius:10px">
            ${avStack('release', 34).replace('style="', 'style="left:10px;top:14px;')}
            <div class="abs" style="left:58px;top:10px;font-size:14px;font-weight:600">Morning inbox sweep</div><div class="abs t2" style="left:58px;top:32px;font-size:12.5px">Weekdays at 08:00</div>
            <span class="pill ok abs" style="right:10px;top:20px">Live</span></div>
          <div class="abs" id="rouItem" style="left:10px;top:162px;width:400px;height:62px;border-radius:10px;background:var(--surface-2)">
            ${avStack('research', 34).replace('style="', 'style="left:10px;top:14px;')}
            <div class="abs" style="left:58px;top:10px;font-size:14px;font-weight:600">Weekly competitor watch</div><div class="abs t2" style="left:58px;top:32px;font-size:12.5px">Every Monday at 08:00</div>
            <span class="abs" id="rouPillL" style="right:10px;top:20px"></span></div>
          <div class="abs" id="rouDetail" style="left:456px;top:96px;width:688px;height:700px">
            <div class="abs" style="left:0;top:0;font-size:22px;font-weight:700;letter-spacing:-.01em">Weekly competitor watch</div>
            <span class="btn abs" style="right:0;top:0;height:32px">${ic('pause', 14)}Pause</span>
            <div class="abs" id="rouPills" style="left:0;top:40px;display:flex;align-items:center;gap:14px;font-size:13.5px;color:var(--text-2);height:22px">
              <span id="rouMode"></span><span style="display:flex;align-items:center;gap:6px"><span style="position:relative;width:20px;height:20px;display:inline-block">${avStack('research', 20).replace('style="', 'style="left:0;top:0;')}</span>Research</span><span style="display:flex;align-items:center;gap:6px">${ic('calendar-clock', 15)}Every Monday at 08:00</span></div>
            <div class="abs" id="rouBanner" style="left:0;top:76px;width:688px;height:100px;border-radius:12px;background:var(--accent-soft);border:1px solid rgba(110,139,255,.25);overflow:hidden">
              <div class="abs" style="left:16px;top:14px;color:var(--accent)">${ic('flask-conical', 18)}</div>
              <div class="abs" style="left:48px;top:14px;width:440px;font-size:13.5px;line-height:1.5"><b>Dry run only.</b> Scheduled runs rehearse: Research plans the work, but nothing is sent or changed. Turn on live runs once a dry run looks right.</div>
              <span class="btn pri abs" id="btnLive" style="right:16px;top:32px">${ic('zap', 14)}Turn on live runs</span></div>
            <div class="card" id="rouTry" style="left:0;top:192px;width:688px;height:270px">
              <div class="abs" style="left:20px;top:18px;font-size:15px;font-weight:650">Try it</div>
              <div class="abs t2" style="left:20px;top:44px;width:640px;font-size:13px;line-height:1.5"><b class="t2" style="color:var(--text)">Dry run</b> rehearses without side effects and lists what it would do. <b style="color:var(--text)">Run now</b> does it for real, once; anything risky still asks you first.</div>
              <div class="abs" style="left:20px;top:92px;display:flex;gap:10px;align-items:center"><span class="btn" id="btnDry">${ic('flask-conical', 14)}Dry run</span><span class="btn" id="btnRun">${ic('play', 14)}Run now</span><span class="t3" style="font-size:12.5px;margin-left:6px">Last run Never</span></div>
              <div class="abs" id="runSteps" style="left:20px;top:140px;width:640px"></div>
            </div>
            <div class="card" id="rouInstr" style="left:0;top:478px;width:688px;height:140px"><div class="abs" style="left:20px;top:18px;font-size:15px;font-weight:650">Instructions</div><div class="abs t2" style="left:20px;top:44px;font-size:13px">What Research does each time this routine runs.</div>
              <div class="abs" style="left:20px;top:70px;width:648px;height:52px;border-radius:8px;border:1px solid var(--border);background:var(--bg);padding:10px 12px;font-size:13px">Check the three competitors' pricing pages and summarize what changed since last week.</div></div>
          </div>
        </div>
      </div>
      <!-- architecture overlay lives in window px space, see #arch -->
    </div>
    <div id="arch" class="abs" style="left:0;top:0;width:1680px;height:945px">
      <div class="abs" id="archOut" style="left:950px;top:132px;width:620px;height:690px;border-radius:26px;border:1.5px dashed var(--border-strong)"></div>
      <div class="abs" id="archLbl" style="left:980px;top:150px;display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-2);font-weight:600"><span id="archLock" style="color:var(--text-2)">${ic('lock', 15)}</span>This computer</div>
      ${[['OpenBot', 'Your workspace', 'app'], ['Claude Code · Codex', 'Your accounts', 'cpu'], ['Tools', 'Your connectors', 'plug'], ['Virtual computer', 'Runs on this machine', 'monitor']].map((p, i) => `
      <div class="abs" id="plate${i}" style="left:980px;top:${196 + i * 150}px;width:560px;height:96px;border-radius:16px;background:var(--surface-1);border:1px solid var(--border);display:flex;align-items:center;gap:18px;padding:0 24px">
        <div style="width:44px;height:44px;border-radius:12px;background:var(--surface-2);display:grid;place-items:center;color:var(--text)">${p[2] === 'app' ? ICONSVG(30) : ic(p[2], 22)}</div>
        <div><div style="font-size:18px;font-weight:650">${p[0]}</div><div class="t2" style="font-size:14px;margin-top:2px">${p[1]}</div></div></div>
      ${i < 3 ? `<div class="abs t3" id="arr${i}" style="left:1247px;top:${196 + i * 150 + 100}px">${ic('chevron-down', 26)}</div>` : ''}`).join('')}
      <div class="big" id="w0" style="left:130px;top:250px;font-size:76px">Local-first.</div>
      <div class="big" id="w1" style="left:130px;top:372px;font-size:76px">Your accounts.</div>
      <div class="big" id="w2" style="left:130px;top:494px;font-size:76px">Your tools.</div>
      <div class="big" id="w3" style="left:130px;top:616px;font-size:76px">Your data.</div>
    </div></div>
    <div id="phoneWrap"><div id="phone" style="position:absolute;inset:0;background:var(--bg);overflow:hidden">
      <div id="phThread" class="abs" style="left:0;top:0;width:430px;height:880px">
        <div class="abs t2" style="left:0;right:0;top:170px;text-align:center;font-size:12.5px;font-weight:600;letter-spacing:.02em">Today</div>
        <div class="bubble-user abs" style="left:64px;top:200px;width:342px;font-size:15px;padding:12px 16px"><div>Research the top 3 competitors, compare their pricing and features, and prepare a launch brief.</div></div>
        <div class="abs" id="phMsg" style="left:0;top:340px;width:430px;height:600px">
          <div class="abs" style="left:18px;top:0">${avStack('cos', 32).replace('style="', 'style="left:0;top:0;')}</div>
          <div class="abs msgname" style="left:62px;top:0;font-size:15px">Chief of Staff</div><div class="abs t3" style="left:174px;top:3px;font-size:12px">9:44 AM</div>
          <span class="pill ok abs" style="left:62px;top:26px">Result</span>
          <div class="abs" style="left:18px;top:62px;font-size:19px;font-weight:700;letter-spacing:-.01em">Launch brief ready</div>
          <div class="abs mono" style="left:18px;top:94px;font-size:11.5px;color:var(--text-2);background:var(--surface-2);padding:3px 7px;border-radius:6px">workspace/launch-brief.md</div>
          <div class="abs" style="left:18px;top:132px;width:394px"><table class="t" style="font-size:13px"><tr><th>Competitor</th><th>Team plan</th></tr><tr><td>Atlas</td><td>$24 / seat</td></tr><tr><td>Beacon</td><td>$32 / seat</td></tr><tr><td>Cinder</td><td>$28 / seat</td></tr></table></div>
          <div class="abs" style="left:18px;top:308px;width:394px"><div class="lbl" style="margin-bottom:8px">Recommended launch angles</div><div style="font-size:14px;line-height:1.6">• Lead with price transparency<br>• Ship a free plan comparison page</div></div>
        </div>
      </div>
      <div class="abs" style="left:0;top:0;width:430px;height:146px;background:var(--bg)"></div>
      <div class="abs" style="left:14px;top:60px;color:var(--text-2)">${ic('arrow-left', 22)}</div>
      <div class="abs" style="left:48px;top:44px">${avStack('cos', 46).replace('style="', 'style="left:0;top:0;')}</div>
      <div class="abs" style="left:106px;top:48px;font-size:18px;font-weight:650">Chief of Staff</div>
      <div class="abs t2" id="phSub" style="left:106px;top:74px;font-size:13.5px">Your first point of contact</div>
      <div class="abs" style="right:14px;top:56px">${chipEngine('Claude', '')}</div>
      <div class="tab" style="left:22px;top:114px;color:var(--text);font-size:15px">Chat</div><div class="tab" style="left:82px;top:114px;font-size:15px">Profile</div>
      <div class="abs" style="left:22px;top:142px;width:36px;height:2px;background:var(--accent);border-radius:2px"></div>
      <div class="abs" style="left:0;top:144px;width:430px;height:1px;background:var(--border)"></div>
      <span class="pill mut abs" id="phEnc" style="right:16px;top:150px;height:24px;font-size:12px;color:var(--success);background:var(--success-soft)">${ic('lock', 12)}Encrypted</span>
      <div class="composer" style="left:16px;top:802px;width:398px;height:52px;border-radius:26px"><div class="abs t3" style="left:20px;top:15px;font-size:15px">Message Chief of Staff…</div><div class="sendbtn" style="top:9px;right:9px;border-radius:50%;width:34px;height:34px">${ic('arrow-up', 16)}</div></div>
      <div class="abs" id="phNote" style="left:12px;top:14px;width:406px;height:74px;border-radius:20px;background:#25262c;border:1px solid var(--border-strong);box-shadow:0 12px 32px rgba(0,0,0,.5)">
        <div class="abs" style="left:14px;top:16px;width:40px;height:40px;border-radius:10px;overflow:hidden">${ICONSVG(40, 185)}</div>
        <div class="abs t2" style="left:66px;top:9px;font-size:12px;font-weight:600;letter-spacing:.02em">OPENBOT</div><div class="abs t3" style="right:16px;top:9px;font-size:12px">now</div>
        <div class="abs" style="left:66px;top:27px;font-size:16px;font-weight:650">Competitor brief ready</div>
        <div class="abs t2" style="left:66px;top:48px;font-size:13.5px">Chief of Staff · Launch brief</div></div>
    </div></div>
  </div>
  <div class="big" id="wordmark" style="left:0;width:1920px;text-align:center;font-size:50px;top:0">OpenBot</div>
  <div class="big" id="tagline" style="left:0;width:1920px;text-align:center;font-size:24px;font-weight:500;letter-spacing:-.005em;color:var(--text-2);top:0">Your AI team, in one local-first workspace.</div>
  <div class="big" id="endHead" style="left:0;width:1920px;text-align:center;font-size:58px;top:0">Build your AI team.</div>
  <div class="big" id="endSub" style="left:0;width:1920px;text-align:center;font-size:26px;font-weight:500;letter-spacing:-.005em;color:var(--text-2);top:0">One request. The right Bots. You stay in control.</div>
  <div class="big" id="endUrl" style="left:0;width:1920px;text-align:center;font-size:22px;font-weight:550;letter-spacing:0;color:var(--accent);top:0;font-family:var(--mono)">github.com/sanlega/OpenBot</div>
  <div id="ripple" class="abs" style="left:0;top:0;width:44px;height:44px;margin:-22px 0 0 -22px;border-radius:50%;border:2px solid var(--accent);opacity:0"></div>
  <div id="cursor"><svg viewBox="0 0 28 28" width="28" height="28"><path d="M4 3 L4 22 L9.2 17.4 L12.6 25.2 L15.6 23.9 L12.2 16.2 L19 16.2 Z" fill="#fff" stroke="#0b0c10" stroke-width="1.6" stroke-linejoin="round"/></svg></div>
</div>
<div id="cap"></div>
</div>`;

/* the computer view (Pricing lane card, full size) + browser mock are appended after the lane exists */
const compHTML = `
<div id="compView" class="abs" style="left:0;top:0;width:1168px;height:810px;background:var(--bg)">
  <div class="abs" style="left:24px;top:15px">${avStack('pricing', 36).replace('style="', 'style="left:0;top:0;')}</div>
  <div class="hdr-name" style="left:70px;top:12px">Pricing</div><div class="hdr-sub" style="left:70px;top:36px">Uses the browser on the virtual computer.</div>
  <div class="abs" style="right:24px;top:20px">${chipEngine('Codex', 'gpt-5-codex')}</div>
  <div class="tab" style="left:24px;top:69px">Chat</div><div class="tab" id="tabComp" style="left:82px;top:69px;color:var(--text)">Computer</div><div class="tab" style="left:172px;top:69px">Profile</div>
  <div class="abs" id="tabInd2" style="top:92px;height:2px;background:var(--accent);border-radius:2px"></div>
  <div class="abs" style="left:0;top:94px;width:1168px;height:1px;background:var(--border)"></div>

  <div class="card" id="scrCard" style="left:24px;top:112px;width:760px;height:563px;overflow:hidden">
    <div class="abs" style="left:24px;top:18px;font-size:16px;font-weight:650">Screen</div>
    <div class="abs t2" style="left:24px;top:41px;font-size:13px">What this bot sees, live.</div>
    <span class="pill acc abs" id="ctrlPill" style="left:255px;top:20px;height:24px;font-size:12px;gap:7px"><span id="ctrlDot" style="width:8px;height:8px;border-radius:50%;background:var(--accent)"></span><span id="ctrlTxt">Bot is controlling the computer</span></span>
    <span class="btn abs" style="right:24px;top:18px;height:34px">${ic('mouse-pointer-2', 14)}Take over</span>
    <div class="chrome" id="browser" style="left:24px;top:72px;width:712px;height:445px">
      <div class="abs" style="left:0;top:0;width:712px;height:32px;background:#dfe1e5"></div>
      <div class="abs" id="tab1" style="left:8px;top:5px;width:184px;height:27px;border-radius:9px 9px 0 0;background:#fff;font-size:11.5px;color:#202124;padding:6px 12px;white-space:nowrap;overflow:hidden">Atlas · Docs</div>
      <div class="abs" id="tab2" style="left:196px;top:5px;width:0;height:27px;border-radius:9px 9px 0 0;background:#fff;font-size:11.5px;color:#202124;padding:6px 12px;white-space:nowrap;overflow:hidden">Beacon · Pricing</div>
      <div class="abs" id="tabPlus" style="left:200px;top:6px;font-size:17px;color:#5f6368;line-height:22px">+</div>
      <div class="abs" style="left:0;top:32px;width:712px;height:32px;background:#fff;border-bottom:1px solid #dadce0"></div>
      <div class="abs" style="left:14px;top:38px;font-size:14px;color:#5f6368;letter-spacing:10px">←→⟳</div>
      <div class="abs" style="left:96px;top:37px;width:560px;height:22px;border-radius:11px;background:#f1f3f4;font-size:12px;color:#202124;padding:3px 14px" id="addr"></div>
      <div class="abs" id="loadBar" style="left:0;top:62px;height:2px;background:#4a76f5;width:0"></div>
      <div class="site" id="vp" style="left:0;top:64px;width:712px;height:381px;overflow:hidden">
        <div class="abs" id="pg0" style="inset:0"><div class="abs" style="left:0;right:0;top:150px;text-align:center;color:#9aa0a6;font-size:14px">New tab</div></div>
        <div class="abs" id="pg1" style="inset:0">${site.nav('home')}
          <div class="abs" style="left:48px;top:96px;font-size:40px;line-height:1.1;font-weight:800;letter-spacing:-.035em;color:#111">Docs your team<br>actually reads.</div>
          <div class="abs" style="left:48px;top:196px;width:400px;font-size:14px;line-height:1.5;color:#5a5f6c">Write once, keep every plan, spec and changelog in one place.</div>
          <div class="abs" style="left:48px;top:250px;height:38px;padding:0 20px;border-radius:19px;background:#111;color:#fff;font-size:13px;line-height:38px;font-weight:600">Get started</div></div>
        <div class="abs" id="pg2" style="inset:0">${site.nav('pricing')}
          <div class="abs" style="left:24px;top:64px;font-size:26px;font-weight:800;letter-spacing:-.03em;color:#111">Pricing</div>
          <div class="abs" style="left:24px;top:98px;font-size:12.5px;color:#5a5f6c">Simple per-editor plans.</div>
          ${plan(24, 'Free', '$0', ['3 editors', '10 docs', 'Community support'], false)}${plan(244, 'Team', '$24', ['Unlimited docs', 'Version history', 'Priority support'], true)}${plan(464, 'Business', '$60', ['SSO', 'Audit log', 'Dedicated manager'], false)}
          <div class="abs" id="scan0" style="left:19px;top:123px;width:214px;height:224px;border-radius:14px;border:2px solid #4a76f5;background:rgba(74,118,245,.07)"></div>
          <div class="abs" id="scan1" style="left:239px;top:123px;width:214px;height:224px;border-radius:14px;border:2px solid #4a76f5;background:rgba(74,118,245,.07)"></div>
          <div class="abs" id="scan2" style="left:459px;top:123px;width:214px;height:224px;border-radius:14px;border:2px solid #4a76f5;background:rgba(74,118,245,.07)"></div></div>
        <div class="abs" id="pg3" style="inset:0">${site.nav('pricing').replace('atlas', 'beacon')}
          <div class="abs" style="left:24px;top:64px;font-size:24px;font-weight:800;letter-spacing:-.03em;color:#111">Get a custom quote</div>
          ${[['Company', 'Example Co'], ['Work email', 'team@example.com'], ['Seats', '25']].map((f, i) => `<div class="abs" style="left:24px;top:${112 + i * 58}px;width:330px"><div style="font-size:11.5px;font-weight:600;color:#4a4f5c;margin-bottom:5px">${f[0]}</div><div style="height:32px;border:1px solid #d5d8e0;border-radius:8px;padding:6px 10px;font-size:12.5px;color:#111">${f[1]}</div></div>`).join('')}
          <div class="abs" id="submitBtn" style="left:24px;top:292px;width:150px;height:38px;border-radius:9px;background:#111;color:#fff;font-size:13px;font-weight:600;text-align:center;line-height:38px">Request quote</div>
          <div class="abs" style="left:400px;top:112px;width:270px;font-size:13px;line-height:1.6;color:#5a5f6c">Teams of 20+ get volume pricing.<br>We reply within one business day.</div></div>
        <div class="abs" id="botCur" style="left:0;top:0;width:120px;height:36px;z-index:5">
          <svg viewBox="0 0 28 28" width="26" height="26" style="position:absolute;left:-4px;top:-3px;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))"><path d="M4 3 L4 22 L9.2 17.4 L12.6 25.2 L15.6 23.9 L12.2 16.2 L19 16.2 Z" fill="#6e8bff" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>
          <div style="position:absolute;left:18px;top:16px;height:20px;padding:0 8px;border-radius:10px;background:#6e8bff;color:#0b0c10;font-size:11px;font-weight:700;line-height:20px;white-space:nowrap">Pricing</div>
        </div>
      </div>
    </div>
    <div class="abs t3" id="scrNote" style="left:24px;top:528px;font-size:12.5px;display:flex;align-items:center;gap:8px">${ic('info', 14)}All bots share one computer and workspace; bots are not a security boundary.</div>
  </div>
  <div class="card" id="stepCard" style="left:800px;top:112px;width:344px;height:563px;overflow:hidden">
    <div class="abs" style="left:22px;top:18px;font-size:16px;font-weight:650">Tasks</div>
    <div class="abs t2" style="left:22px;top:41px;font-size:13px;width:300px;line-height:1.45">Jev picks each step and OpenBot checks it before it runs. Risky steps ask you first.</div>
    <div class="abs" style="left:22px;top:98px;width:300px;font-size:14px;font-weight:600;line-height:1.35">Compare pricing pages for the top 3 competitors</div>
    <div id="steps" class="abs" style="left:22px;top:154px;width:300px"></div>
  </div>
</div>`;
