#!/usr/bin/env node
// dashboard.mjs — Skyforge's live board, as a themed list (ledger) at a URL.
// A tiny read-only HTTP server: it reads .skyforge/board.json fresh on every
// request and serves an editorial list — one task per row, top to bottom — that
// auto-polls itself, so the user watches status change (queued -> running ->
// done/failed/blocked) live.
//
//   node dashboard.mjs            # serve http://localhost:4788 for the cwd's board
//   SKYFORGE_DASH_PORT=4799 node dashboard.mjs
//
// READ-ONLY: it never writes board.json — board.mjs remains the sole writer.
// Path resolution matches board.mjs: the board is <cwd>/.skyforge/board.json.

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.SKYFORGE_DASH_PORT) || 4788;
const BOARD = join(process.cwd(), '.skyforge', 'board.json');

// 1. Fresh read on every request; tolerate a missing or half-written board.
function readBoard() {
  if (!existsSync(BOARD)) return { mode: '—', auto: false, tasks: [], missing: true };
  try {
    return JSON.parse(readFileSync(BOARD, 'utf8'));
  } catch {
    return { mode: '—', auto: false, tasks: [], unreadable: true };
  }
}

// 2. The editorial theme — tokens and treatment lifted from the reference proof
//    (light-only, serif body, mono labels, the ledger table, 2px rules), plus
//    restrained, desaturated status accents in the same print-like family.
const CSS = `
:root{
  color-scheme: light only;
  --paper:#ffffff; --ink:#1a1a1a; --muted:#6a6a6a; --faint:#9a9a9a;
  --rule:#e0e0e0; --wash:#fafafa;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Charter,"Bitstream Charter",Georgia,"Times New Roman",serif;
  --mono:ui-monospace,"SF Mono","IBM Plex Mono",Menlo,Consolas,monospace;
  --run:#2b5c8a;  --run-bg:#eef4fa;  --run-bd:#cfe0ef;
  --done:#3f7a52; --done-bg:#eef6f0; --done-bd:#cde5d5;
  --fail:#9a3b3b; --fail-bg:#fbeeee; --fail-bd:#eccccc;
  --block:#8a6a1f;--block-bg:#f7f1e3;--block-bd:#e6d8b5;
  --queue:#6a6a6a;--queue-bg:#f2f2f2;--queue-bd:#dcdcdc;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{
  margin:0; background:var(--paper); color:var(--ink); font-family:var(--serif);
  font-size:1.06rem; line-height:1.6; -webkit-font-smoothing:antialiased;
  text-rendering:optimizeLegibility; font-kerning:normal;
  font-feature-settings:"liga" 1,"onum" 1,"kern" 1;
}
.wrap{max-width:64rem; margin:0 auto; padding:2rem 1.75rem 3rem;}

/* header — kicker / title / lede, as in the reference */
header{margin-bottom:1.2rem;}
.kicker{font-family:var(--mono); font-size:.66rem; letter-spacing:.22em; text-transform:uppercase; color:var(--muted); margin:0 0 .5rem;}
h1{font-weight:400; font-size:clamp(1.7rem,1.4rem + 1.6vw,2.2rem); line-height:1.1; letter-spacing:.01em; margin:0 0 .5rem; text-wrap:balance;}
.lede{font-style:italic; font-size:1.02rem; color:var(--muted); margin:0; max-width:46rem; text-wrap:balance;}

/* factory line — sticky status band, mono uppercase (mirrors the reference toolbar) */
.line{
  position:sticky; top:0; z-index:20; display:flex; flex-wrap:wrap; align-items:center; gap:1rem;
  background:var(--paper); border-bottom:1px solid var(--ink); padding:.7rem 0; margin:1.2rem 0 1.7rem;
  font-family:var(--mono); font-size:.68rem; letter-spacing:.08em; text-transform:uppercase; color:var(--muted);
}
.line .meta b{color:var(--ink); font-weight:700;}
.tallies{display:flex; flex-wrap:wrap; gap:1.1rem; margin-left:auto;}
.tally{display:inline-flex; align-items:center; gap:.45rem;}
.tally b{color:var(--ink); font-weight:700; font-variant-numeric:tabular-nums;}
.tally.zero{opacity:.4;}

/* ledger — the task list, one row per task (mirrors the reference table) */
.ledger-scroll{overflow-x:auto;}
table{width:100%; border-collapse:collapse; min-width:44rem;}
thead th{
  font-family:var(--mono); font-weight:400; font-size:.66rem; letter-spacing:.14em; text-transform:uppercase;
  color:var(--muted); text-align:left; padding:0 1rem .7rem; border-bottom:1px solid var(--ink); white-space:nowrap;
}
thead th.c{text-align:center;}
tbody td{padding:.7rem 1rem; border-bottom:1px dotted var(--rule); vertical-align:top;}
tbody tr:last-child td{border-bottom:1px solid var(--rule);}
tbody tr:hover td{background:var(--wash);}
tbody tr.s-done td{background:#fcfcf7;}
tbody tr.s-done:hover td{background:#f6f6ec;}

td.id{
  font-family:var(--mono); font-size:.82rem; letter-spacing:.05em; color:var(--ink); font-weight:700;
  font-variant-numeric:tabular-nums; white-space:nowrap; border-left:3px solid var(--rule);
}
tr.s-running td.id{border-left-color:var(--run);}
tr.s-done td.id{border-left-color:var(--done);}
tr.s-failed td.id{border-left-color:var(--fail);}
tr.s-blocked td.id{border-left-color:var(--block);}
tr.s-queued td.id{border-left-color:var(--queue);}

td.task{font-size:1.02rem; line-height:1.35; min-width:15rem;}
td.task small{
  display:block; font-family:var(--mono); font-size:.6rem; letter-spacing:.03em; text-transform:uppercase;
  color:var(--faint); margin-top:.22rem; word-break:break-word;
}
td.status{text-align:center; white-space:nowrap;}
td.status .age{
  display:block; font-family:var(--mono); font-size:.58rem; letter-spacing:.04em; text-transform:uppercase;
  color:var(--faint); margin-top:.32rem;
}
td.detail{font-size:.92rem; line-height:1.4; color:var(--muted); min-width:14rem;}
td.detail .agent{font-family:var(--mono); font-size:.66rem; letter-spacing:.05em; text-transform:uppercase; color:var(--faint);}
td.detail .waiting{font-family:var(--mono); font-size:.64rem; line-height:1.5; letter-spacing:.03em; color:var(--block);}
td.detail .waiting.ready{color:var(--done);}
td.detail .dash{color:var(--faint);}

/* status pills + dots */
.pill{
  font-family:var(--mono); font-size:.6rem; letter-spacing:.1em; text-transform:uppercase;
  font-variant-numeric:tabular-nums; white-space:nowrap; display:inline-flex; align-items:center; gap:.4rem;
  padding:.2rem .5rem; border-radius:2px; border:1px solid var(--rule);
}
.pill .dot{width:.42rem; height:.42rem; border-radius:50%;}
.pill--running{color:var(--run);   background:var(--run-bg);   border-color:var(--run-bd);}
.pill--done{color:var(--done);      background:var(--done-bg);  border-color:var(--done-bd);}
.pill--failed{color:var(--fail);    background:var(--fail-bg);  border-color:var(--fail-bd);}
.pill--blocked{color:var(--block);  background:var(--block-bg); border-color:var(--block-bd);}
.pill--queued{color:var(--queue);   background:var(--queue-bg); border-color:var(--queue-bd);}
.dot--running{background:var(--run);} .dot--done{background:var(--done);} .dot--failed{background:var(--fail);}
.dot--blocked{background:var(--block);} .dot--queued{background:var(--queue);}
.pill--running .dot{animation:pulse 1.6s ease-in-out infinite;}
@keyframes pulse{0%,100%{opacity:1;} 50%{opacity:.25;}}

/* empty state + colophon */
.empty{border:1px dashed var(--rule); border-radius:2px; padding:3rem 1.5rem; text-align:center; color:var(--muted); font-style:italic;}
.colophon{
  margin-top:2.4rem; padding-top:1.2rem; border-top:1px solid var(--rule);
  font-family:var(--mono); font-size:.66rem; letter-spacing:.05em; color:var(--faint);
  text-transform:uppercase; display:flex; flex-wrap:wrap; gap:.8rem; justify-content:space-between;
}
.colophon .live{color:var(--done);}
.colophon .live.stale{color:var(--fail);}

@media (max-width:34rem){
  body{font-size:1rem;}
  .wrap{padding:1.5rem 1.15rem 3rem;}
}
`;

// 3. Client app — one render function, shared by the initial paint (from the
//    embedded board) and every poll, so there is a single source of truth for
//    how a row looks. The dependency/file-overlap reasoning mirrors board.mjs
//    so the "waiting on" text matches the CLI report.
const APP = `
(function(){
  var ORDER = ['running','blocked','queued','failed','done'];
  var LABEL = {running:'Running',blocked:'Blocked',queued:'Queued',failed:'Failed',done:'Done'};
  var POLL_MS = 4000;
  var lastJSON = '', lastOk = Date.now();

  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function shortAgent(id){return id?String(id).slice(0,8):'';}
  function relTime(iso){
    if(!iso) return '';
    var t=Date.parse(iso); if(isNaN(t)) return '';
    var s=Math.max(0,Math.round((Date.now()-t)/1000));
    if(s<45) return 'just now';
    var m=Math.round(s/60); if(m<60) return m+'m ago';
    var h=Math.round(m/60); if(h<24) return h+'h ago';
    return Math.round(h/24)+'d ago';
  }

  // file-overlap + dependency reasoning, mirrored from board.mjs
  function norm(p){return String(p).replace(/^\\.\\//,'').replace(/\\/+$/,'').replace(/\\/\\*+$/,'');}
  function conflict(a,b){a=norm(a);b=norm(b);return a===b||a.indexOf(b+'/')===0||b.indexOf(a+'/')===0;}
  function blockers(board,t,claimers,doneIds){
    var deps=(t.blockedBy||[]).filter(function(id){return !doneIds.has(id);});
    var hits=[];
    if(board.mode==='guardrail'){
      claimers.forEach(function(c){
        if(c.id===t.id) return;
        var hit=(t.files||[]).some(function(p){return (c.files||[]).some(function(cp){return conflict(p,cp);});});
        if(hit) hits.push(c.id);
      });
    }
    return {deps:deps,hits:hits};
  }

  function pill(status){
    return '<span class="pill pill--'+status+'"><span class="dot dot--'+status+'"></span>'+esc(status)+'</span>';
  }

  function row(t,ctx){
    var s=t.status;

    // TASK: title + coarse-area subline (guardrail, active/queued work)
    var area=(ctx.board.mode==='guardrail'&&t.files&&t.files.length&&(s==='running'||s==='queued'))
      ? '<small>'+esc(t.files.join(', '))+'</small>' : '';

    // STATUS: pill + how long since the last update
    var age=t.updatedAt?'<span class="age">'+esc(relTime(t.updatedAt))+'</span>':'';

    // DETAIL: agent (running) / waiting (queued) / summary (done,failed) / needs input (blocked)
    var detail='';
    if(s==='running'){
      detail='<span class="agent">'+(t.agentId?'agent '+esc(shortAgent(t.agentId)):'in progress')+'</span>';
    } else if(s==='queued'){
      var b=blockers(ctx.board,t,ctx.claimers,ctx.doneIds);
      var why=[];
      if(b.deps.length) why.push('waiting on '+esc(b.deps.join(', '))+' (dependency)');
      if(b.hits.length) why.push('area held by '+esc(b.hits.join(', ')));
      detail=why.length ? '<span class="waiting">'+why.join(' \\u00b7 ')+'</span>'
                        : '<span class="waiting ready">ready to dispatch</span>';
    } else if(t.resultSummary){
      detail=esc(t.resultSummary);
    } else if(s==='blocked'){
      detail='<span class="waiting">needs input</span>';
    } else {
      detail='<span class="dash">\\u2014</span>';
    }

    return '<tr class="s-'+s+'">'
      +'<td class="id">'+esc(t.id)+'</td>'
      +'<td class="task">'+esc(t.title)+area+'</td>'
      +'<td class="status">'+pill(s)+age+'</td>'
      +'<td class="detail">'+detail+'</td>'
      +'</tr>';
  }

  function render(board){
    if(!board||!Array.isArray(board.tasks)) board={mode:'—',auto:false,tasks:[]};
    var tasks=board.tasks.slice();
    var doneIds=new Set(tasks.filter(function(t){return t.status==='done';}).map(function(t){return t.id;}));
    var claimers=tasks.filter(function(t){return t.status==='running';});
    var ctx={board:board,doneIds:doneIds,claimers:claimers};

    // counts per status
    var counts={running:0,blocked:0,queued:0,failed:0,done:0};
    tasks.forEach(function(t){if(counts[t.status]!=null)counts[t.status]++;});

    // header line: mode / auto / total, then the tallies
    document.getElementById('meta').innerHTML =
      'Mode <b>'+esc(board.mode||'—')+'</b> \\u00b7 Auto <b>'+(board.auto?'on':'off')+'</b> \\u00b7 <b>'+tasks.length+'</b> task'+(tasks.length===1?'':'s');
    document.getElementById('tallies').innerHTML = ORDER.map(function(st){
      return '<span class="tally'+(counts[st]?'':' zero')+'"><span class="dot dot--'+st+'"></span>'+esc(LABEL[st])+' <b>'+counts[st]+'</b></span>';
    }).join('');

    // list: running -> blocked -> queued -> failed -> done, then by id
    tasks.sort(function(a,b){
      var d=ORDER.indexOf(a.status)-ORDER.indexOf(b.status);
      return d||String(a.id).localeCompare(String(b.id));
    });
    var host=document.getElementById('list');
    if(tasks.length===0){
      host.innerHTML='<div class="empty">No tasks on the board yet. Hand work to Skyforge and rows will appear here.</div>';
    } else {
      host.innerHTML='<div class="ledger-scroll"><table>'
        +'<thead><tr><th>ID</th><th>Task</th><th class="c">Status</th><th>Detail</th></tr></thead>'
        +'<tbody>'+tasks.map(function(t){return row(t,ctx);}).join('')+'</tbody></table></div>';
    }
  }

  function stamp(ok){
    document.getElementById('stamp').textContent=new Date().toLocaleTimeString();
    var el=document.getElementById('live');
    if(ok){lastOk=Date.now(); el.className='live'; el.textContent='\\u25cf live';}
    else if(Date.now()-lastOk>POLL_MS*2){el.className='live stale'; el.textContent='\\u25cb reconnecting';}
  }

  // re-render only when the board actually changed; always re-stamp so the
  // "live" indicator keeps ticking and running pulses stay smooth
  function apply(board){
    var j=JSON.stringify(board);
    if(j!==lastJSON){lastJSON=j; render(board);}
  }

  function poll(){
    fetch('/board.json',{cache:'no-store'})
      .then(function(r){return r.json();})
      .then(function(b){apply(b); stamp(true);})
      .catch(function(){stamp(false);});
  }

  // initial paint from the embedded board (instant, no round-trip), then live poll
  apply(window.__BOARD__);
  stamp(true);
  setInterval(poll, POLL_MS);
})();
`;

// 4. Assemble the page, embedding the freshly-read board so first paint is
//    correct with zero loading flash. '<' in the data is neutralised so a task
//    title can never break out of the script tag.
function page(board) {
  const data = JSON.stringify(board).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>Skyforge Board</title><style>${CSS}</style></head><body>`
    + `<div class="wrap">`
    + `<header>`
    + `<p class="kicker">Skyforge · Factory Floor</p>`
    + `<h1>The Board</h1>`
    + `<p class="lede">Live status of every task on the line — the list refreshes itself as workers pick up, progress, and report in.</p>`
    + `</header>`
    + `<div class="line"><span class="meta" id="meta"></span><span class="tallies" id="tallies"></span></div>`
    + `<div id="list"></div>`
    + `<div class="colophon"><span>Skyforge · board at .skyforge/board.json · read-only view</span>`
    + `<span><span id="live" class="live">● live</span> · refreshed <span id="stamp">—</span></span></div>`
    + `</div>`
    + `<noscript><p style="font-family:var(--mono);color:var(--fail);padding:1rem;">This dashboard needs JavaScript to show live status.</p></noscript>`
    + `<script>window.__BOARD__=${data};</script>`
    + `<script>${APP}</script>`
    + `</body></html>`;
}

// 5. The server: '/board.json' is the poll endpoint, '/' serves the page.
//    Both read the board fresh; neither ever writes it.
const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (path === '/board.json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(readBoard()));
    return;
  }
  if (path === '/' || path === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(page(readBoard()));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

// If the port is already bound, a dashboard is already serving this board —
// reuse it: print the URL and exit cleanly rather than crashing.
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Skyforge dashboard already running: http://localhost:${PORT}`);
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`Skyforge dashboard: http://localhost:${PORT}`);
  console.log(`Reading board: ${BOARD}`);
});
