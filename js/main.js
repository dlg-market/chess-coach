import { Chess } from '../vendor/chess.js';
import { splitGames, parseGame, detectUserColor, gameKey } from './pgn.js';
import { Engine } from './engine.js';
import { analyzeGame, winPct, fmtEval, fmtClock, pickFocus, pvToSan, scoreToCp } from './analysis.js';
import { Board } from './board.js';
import { store, schedule } from './store.js';
import { sound } from './sound.js';
import { recentGames, ratings } from './chesscom.js';
import { TAGS, HABIT_TAGS, HABIT_CARDS, tagLabel, caption } from './lessons.js';
import { SAMPLE_PGN } from './samples.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

let settings = store.settings();
const engine = new Engine();

// ---------------- shell ----------------

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

function showPage(name) {
  $$('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.page === name));
  $$('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${name}`));
  if (name === 'progress') renderProgress();
  if (name === 'library') renderLibrary();
  if (name === 'puzzles') openPuzzles();
  if (name !== 'review') stopAutoplay();
  try { localStorage.setItem('cc.page', name); } catch {}
}

$$('.tabs button').forEach((b) => b.addEventListener('click', () => { sound.unlock(); showPage(b.dataset.page); }));

function applySettings() {
  document.body.dataset.theme = settings.theme;
  document.body.classList.toggle('low-power', !!settings.reduceMotion);
  sound.setEnabled(settings.sound);
}

// ---------------- analyse ----------------

$('#cc-user').value = settings.username;

$('#pgn-file').addEventListener('change', async (e) => {
  const texts = await Promise.all([...e.target.files].map((f) => f.text()));
  $('#pgn-input').value = texts.join('\n\n');
  e.target.value = '';
});

$('#load-samples').addEventListener('click', () => {
  $('#pgn-input').value = SAMPLE_PGN;
  $('#side-select').value = 'auto';
  if (!settings.username) { settings.username = 'clerv'; store.saveSettings(settings); }
  toast('Loaded 6 games from your first coaching session.');
});

$('#analyse-btn').addEventListener('click', () => {
  sound.unlock();
  const text = $('#pgn-input').value;
  const chunks = splitGames(text);
  if (!chunks.length) return toast('Paste a game first.');
  const jobs = [];
  for (const chunk of chunks) {
    try {
      const game = parseGame(chunk);
      jobs.push({ game, side: $('#side-select').value });
    } catch (err) {
      toast(err.message, 5000);
    }
  }
  if (jobs.length) runQueue(jobs);
});

let ccGames = [];
$('#cc-fetch').addEventListener('click', async () => {
  const user = $('#cc-user').value.trim();
  if (!user) return toast('Enter your chess.com username.');
  if (user !== settings.username) { settings.username = user; store.saveSettings(settings); }
  $('#cc-list').innerHTML = '<p class="muted">Fetching…</p>';
  try {
    ccGames = await recentGames(user, { count: +$('#cc-count').value, timeClass: $('#cc-class').value || null });
    renderCcList();
  } catch (err) {
    $('#cc-list').innerHTML = `<p class="bad">${esc(err.message)}</p>`;
  }
});

function renderCcList() {
  const u = settings.username.toLowerCase();
  const known = new Set(store.index().map((g) => g.id));
  const lossesOnly = $('#cc-losses').checked;
  $('#cc-list').innerHTML = ccGames.map((g, i) => {
    const mine = g.white.toLowerCase() === u ? 'w' : 'b';
    const res = mine === 'w' ? g.whiteResult : g.blackResult;
    const outcome = res === 'win' ? 'win' : ['agreed', 'repetition', 'stalemate', 'insufficient', '50move', 'timevsinsufficient'].includes(res) ? 'draw' : 'loss';
    const opp = mine === 'w' ? `${g.black} (${g.blackRating})` : `${g.white} (${g.whiteRating})`;
    const done = known.has(g.url);
    const hidden = lossesOnly && outcome !== 'loss';
    const date = new Date(g.endTime * 1000).toLocaleDateString();
    return `<label class="cc-item ${hidden ? 'hide' : ''}"><input type="checkbox" data-i="${i}" ${!done && outcome === 'loss' ? 'checked' : ''}>
      <span class="pill ${outcome}">${outcome}</span><span>${mine === 'w' ? '♔' : '♚'} vs ${esc(opp)}</span>
      <span class="muted small">${date} · ${g.timeClass}${done ? ' · analysed' : ''}</span></label>`;
  }).join('') || '<p class="muted">No games found.</p>';
  $('#cc-actions').hidden = !ccGames.length;
}
$('#cc-losses').addEventListener('change', renderCcList);

$('#cc-analyse').addEventListener('click', () => {
  sound.unlock();
  const picked = $$('#cc-list .cc-item:not(.hide) input:checked').map((el) => ccGames[+el.dataset.i]);
  if (!picked.length) return toast('Tick at least one game.');
  const jobs = [];
  for (const g of picked) {
    try { jobs.push({ game: parseGame(g.pgn), side: 'auto' }); } catch (err) { toast(err.message, 5000); }
  }
  runQueue(jobs);
});

let running = false;
async function runQueue(jobs) {
  if (running) return toast('Already analysing. Wait for the current batch.');
  running = true;
  const card = $('#queue-card');
  card.hidden = false;
  const q = $('#queue');
  q.innerHTML = jobs.map((j, i) => {
    const h = j.game.headers;
    return `<div class="qrow" id="q-${i}"><span>${esc(h.White || 'White')} vs ${esc(h.Black || 'Black')} <span class="muted small">${esc(h.Date || '')}</span></span>
      <div class="bar"><div class="fill"></div></div><span class="qstatus muted small">waiting</span></div>`;
  }).join('');
  let lastId = null;
  for (let i = 0; i < jobs.length; i++) {
    const { game, side } = jobs[i];
    const row = $(`#q-${i}`);
    const color = detectUserColor(game.headers, settings.username, side === 'auto' ? null : side);
    if (!color) {
      row.querySelector('.qstatus').textContent = 'skipped: pick your side (username not in PGN)';
      continue;
    }
    const id = gameKey(game);
    try {
      const rec = await analyzeGame(game, color, engine, {
        depth: +settings.depth,
        rating: settings.rating ? +settings.rating : null,
        onProgress: (n, total) => {
          row.querySelector('.fill').style.width = `${(n / total) * 100}%`;
          row.querySelector('.qstatus').textContent = `${n}/${total} positions`;
        },
      });
      store.saveGame(id, rec);
      lastId = id;
      const c = rec.summary.counts.user;
      row.querySelector('.qstatus').innerHTML = `done · ~${Math.round(rec.summary.accuracy.user)}% · ${c.blunder || 0} blunders <a href="#" data-open="${esc(id)}">review</a>`;
    } catch (err) {
      console.error(err);
      row.querySelector('.qstatus').textContent = `error: ${err.message}`;
    }
  }
  running = false;
  updateDueBadge();
  if (lastId) {
    sound.alert();
    if (jobs.length === 1) openReview(lastId);
    else { loadReview(lastId); toast('Batch done. Open any game from the list, or check Progress.'); }
  }
}

$('#queue').addEventListener('click', (e) => {
  const a = e.target.closest('[data-open]');
  if (a) { e.preventDefault(); openReview(a.dataset.open); }
});

// ---------------- review ----------------

const reviewBoard = new Board($('#review-board'));
let R = null; // current record
let ply = 0;
let autoplay = null;

function openReview(id) {
  if (!loadReview(id)) return toast('Game not found.');
  showPage('review');
}

function loadReview(id) {
  const rec = store.getGame(id);
  if (!rec) return false;
  stopAutoplay();
  R = rec;
  $('#review-empty').hidden = true;
  $('#review').hidden = false;
  reviewBoard.setFlipped(R.userColor === 'b');
  reviewBoard.setPosition(R.startFen, { animate: false });
  ply = 0;
  renderReviewStatic();
  goTo(R.keyPlies[0] ? R.keyPlies[0] : 0, false);
  try { localStorage.setItem('cc.lastGame', id); } catch {}
  return true;
}

function renderReviewStatic() {
  const h = R.headers, s = R.summary;
  const userName = R.userColor === 'w' ? h.White : h.Black;
  const strip = (color) => {
    const name = color === 'w' ? h.White : h.Black;
    const elo = color === 'w' ? h.WhiteElo : h.BlackElo;
    const you = color === R.userColor ? ' <span class="you">you</span>' : '';
    return `<span class="dot ${color}"></span><b>${esc(name || (color === 'w' ? 'White' : 'Black'))}</b>${elo ? ` <span class="muted">${esc(elo)}</span>` : ''}${you}<span class="grow"></span><span class="clock" data-color="${color}"></span>`;
  };
  const topColor = R.userColor === 'w' ? 'b' : 'w';
  $('#strip-top').innerHTML = strip(topColor);
  $('#strip-bottom').innerHTML = strip(R.userColor);
  $('#game-title').innerHTML = `<span class="pill ${R.userResult}">${R.userResult}</span> ${esc(h.White)} vs ${esc(h.Black)} <span class="muted small">${esc(R.date)}${R.termination ? ' · ' + esc(R.termination) : ''}</span>`;
  const c = s.counts.user;
  $('#game-stats').innerHTML = [
    ['Accuracy', `~${Math.round(s.accuracy.user)}%`],
    ['Blunders', c.blunder || 0], ['Mistakes', c.mistake || 0], ['Inaccuracies', c.inaccuracy || 0],
    ['Peak', fmtEval(R.userColor === 'w' ? s.conversion.peakEval : -s.conversion.peakEval)],
  ].map(([k, v]) => `<div><span class="muted small">${k}</span><b>${v}</b></div>`).join('');

  // Move list
  const rows = [];
  for (let i = 0; i < R.moves.length; i += 2) {
    const w = R.moves[i], b = R.moves[i + 1];
    rows.push(`<span class="mno">${w.moveNo}.</span>${moveCell(w)}${b ? moveCell(b) : '<span></span>'}`);
  }
  $('#move-list').innerHTML = rows.join('');

  // Key moment chips
  $('#key-chips').innerHTML = R.keyPlies.map((p) => {
    const m = R.moves[p - 1];
    const mine = m.color === R.userColor;
    const label = mine && m.primaryTag ? tagLabel(m.primaryTag) : m.goodTags.length && mine ? tagLabel(m.goodTags[0]) : !mine ? 'their ' + m.cls : m.cls;
    const kind = mine ? (m.goodTags.length && !m.primaryTag ? 'good' : m.cls) : 'opp';
    return `<button class="chip ${kind}" data-ply="${p}">${m.moveLabel} ${esc(m.san)} · ${esc(label)}</button>`;
  }).join('') || '<span class="muted small">Clean game. Nothing big to flag.</span>';

  $('#brief-text').textContent = R.brief;
  drawGraph();
}

const SYMBOL = { blunder: '??', mistake: '?', inaccuracy: '?!', best: '', excellent: '', good: '' };
function moveCell(m) {
  const mine = m.color === R.userColor;
  const good = m.goodTags.length ? '!' : '';
  return `<button class="mv ${m.cls} ${mine ? 'mine' : 'theirs'}" data-ply="${m.ply}">${esc(m.san)}<sup>${SYMBOL[m.cls] || good}</sup></button>`;
}

$('#move-list').addEventListener('click', (e) => { const b = e.target.closest('[data-ply]'); if (b) { stopAutoplay(); goTo(+b.dataset.ply); } });
$('#key-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-ply]'); if (b) { stopAutoplay(); goTo(+b.dataset.ply); } });

function goTo(p, withSound = true) {
  if (!R) return;
  p = Math.max(0, Math.min(R.moves.length, p));
  const m = R.moves[p - 1];
  const fen = p === 0 ? R.startFen : m.fenAfter;
  const step = Math.abs(p - ply) === 1;
  reviewBoard.setPosition(fen, { lastMove: m ? { from: m.from, to: m.to } : null, animate: step && !settings.reduceMotion });
  if (withSound && m && step && p > ply) sound.move(m.san);
  ply = p;

  // Arrows: the punishing reply (red) and what you should have played (green).
  const arrows = [];
  const hl = {};
  if (m && $('#c-arrows').checked && m.color !== R.userColor && ['mistake', 'blunder'].includes(m.cls)) {
    // Their mistake: show how you could punish it.
    if (m.refutationUci) arrows.push({ from: m.refutationUci.slice(0, 2), to: m.refutationUci.slice(2, 4), color: 'good' });
  } else if (m && $('#c-arrows').checked && m.color === R.userColor && ['inaccuracy', 'mistake', 'blunder'].includes(m.cls)) {
    if (m.refutationUci) arrows.push({ from: m.refutationUci.slice(0, 2), to: m.refutationUci.slice(2, 4), color: 'bad' });
    if (m.bestUci) arrows.push({ from: m.bestUci.slice(0, 2), to: m.bestUci.slice(2, 4), color: 'good' });
    if (m.refutationUci) hl[m.refutationUci.slice(2, 4)] = 'bad';
  } else if (m && $('#c-arrows').checked && m.goodTags.length && m.color === R.userColor) {
    hl[m.to] = 'good';
  }
  reviewBoard.setArrows(arrows);
  reviewBoard.setHighlights(hl);

  // Eval bar (white's win chance)
  const cp = R.evals[p];
  const wp = winPct(cp);
  const fill = $('#evalbar .evalfill');
  fill.style.height = `${R.userColor === 'b' ? 100 - wp : wp}%`;
  $('#evalbar').classList.toggle('flipped', R.userColor === 'b');
  $('#evalbar .evaltext').textContent = fmtEval(cp);

  // Clocks
  for (const color of ['w', 'b']) {
    const last = [...R.moves.slice(0, p)].reverse().find((x) => x.color === color && x.clock !== null);
    const el = document.querySelector(`.clock[data-color="${color}"]`);
    if (el) el.textContent = last ? fmtClock(last.clock) : '';
  }

  $$('#move-list .mv').forEach((b) => b.classList.toggle('current', +b.dataset.ply === p));
  const cur = document.querySelector(`#move-list .mv[data-ply="${p}"]`);
  if (cur) { // scroll only the move list, never the page
    const box = $('#move-list');
    box.scrollTop = Math.max(0, cur.offsetTop - box.clientHeight / 2);
  }
  $$('#key-chips .chip').forEach((b) => b.classList.toggle('current', +b.dataset.ply === p));
  renderMoment(m);
  drawGraphCursor();
}

function renderMoment(m) {
  const box = $('#moment');
  if (!m) { box.innerHTML = `<p class="muted">Start position. Press ▶ to replay. It slows down at the key moments.</p>`; box.className = 'card compact moment'; return; }
  const mine = m.color === R.userColor;
  const flagged = ['inaccuracy', 'mistake', 'blunder'].includes(m.cls);
  const isKey = R.keyPlies.includes(m.ply);
  let html = `<div class="moment-head"><b>${m.moveLabel} ${esc(m.san)}</b> <span class="cls ${m.cls}">${m.cls}</span>
    <span class="muted small">${fmtEval(m.evalBefore)} → ${fmtEval(m.evalAfter)}${m.timeSpent !== null ? ` · ${Math.round(m.timeSpent)}s` : ''}</span></div>`;
  if (flagged || (isKey && (m.goodTags.length || !mine))) {
    html += `<p>${esc(caption(m, R.userColor))}</p>`;
    const t = mine && m.primaryTag && TAGS[m.primaryTag];
    const why = mine && m.why ? ` (${m.why.replace(/_/g, ' ')})` : '';
    if (t) html += `<div class="lesson"><b>${esc(t.label + why)}</b><p>${esc(t.lesson)}</p><p class="habit">Habit: ${esc(t.habit)}</p></div>`;
    if (flagged && m.bestLine.length) html += `<p class="small"><span class="linekey good">best</span> ${esc(m.bestLine.join(' '))}</p>`;
    if (flagged && m.refutationLine.length) html += `<p class="small"><span class="linekey bad">their reply</span> ${esc(m.refutationLine.join(' '))}</p>`;
  } else if (mine && m.goodTags.length) {
    html += `<p>${esc(TAGS[m.goodTags[0]].lesson)}</p>`;
  } else {
    html += `<p class="muted small">Engine's choice: ${esc(m.bestSan || '—')}${m.cls === 'best' ? ' (you matched it)' : ''}.</p>`;
  }
  box.innerHTML = html;
  box.className = `card compact moment ${mine ? m.cls : 'opp'}${isKey ? ' key' : ''}`;
}

function drawGraph() {
  const svg = $('#evalgraph');
  const n = R.evals.length - 1 || 1;
  const W = 600, H = 130;
  const pts = R.evals.map((cp, i) => {
    const wp = R.userColor === 'w' ? winPct(cp) : 100 - winPct(cp);
    return [(i / n) * W, H - (wp / 100) * H];
  });
  const area = `M0,${H} ` + pts.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ') + ` L${W},${H} Z`;
  let dots = '';
  for (const m of R.moves) {
    if (!['mistake', 'blunder'].includes(m.cls)) continue;
    const [x, y] = pts[m.ply];
    const mine = m.color === R.userColor;
    dots += `<circle cx="${x}" cy="${y}" r="${m.cls === 'blunder' ? 5 : 4}" class="gdot ${m.cls} ${mine ? 'mine' : 'theirs'}" vector-effect="non-scaling-stroke"/>`;
  }
  svg.innerHTML = `<rect x="0" y="0" width="${W}" height="${H}" class="gbg"/>
    <line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="gmid"/>
    <path d="${area}" class="garea"/>
    <line id="gcursor" x1="0" x2="0" y1="0" y2="${H}" class="gcursor"/>${dots}`;
}

function drawGraphCursor() {
  const c = $('#gcursor');
  if (!c || !R) return;
  const x = (ply / (R.evals.length - 1 || 1)) * 600;
  c.setAttribute('x1', x); c.setAttribute('x2', x);
}

$('#evalgraph').addEventListener('click', (e) => {
  if (!R) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const p = Math.round(((e.clientX - rect.left) / rect.width) * (R.evals.length - 1));
  stopAutoplay();
  goTo(p, false);
});

function nextKey(dir) {
  if (!R) return;
  const list = R.keyPlies;
  const target = dir > 0 ? list.find((p) => p > ply) : [...list].reverse().find((p) => p < ply);
  if (target !== undefined) goTo(target, false);
}

function startAutoplay() {
  if (!R) return;
  if (ply >= R.moves.length) goTo(0, false);
  $('#c-play').textContent = '❚❚';
  const tick = () => {
    if (!autoplay) return;
    if (ply >= R.moves.length) return stopAutoplay();
    if ($('#c-keyonly').checked) {
      const nxt = R.keyPlies.find((p) => p > ply);
      if (nxt === undefined) return stopAutoplay();
      // Fast-forward to just before the moment, then play it.
      goTo(nxt - 1, false);
      setTimeout(() => { if (autoplay) { goTo(nxt); autoplay = setTimeout(tick, settings.autoplayMs * 3.5); } }, 500);
      autoplay = -1;
      return;
    }
    goTo(ply + 1);
    const isKey = R.keyPlies.includes(ply);
    autoplay = setTimeout(tick, isKey ? settings.autoplayMs * 3.5 : settings.autoplayMs);
  };
  autoplay = setTimeout(tick, 200);
}
function stopAutoplay() {
  if (autoplay) clearTimeout(autoplay);
  autoplay = null;
  $('#c-play').textContent = '▶';
}

$('#c-start').addEventListener('click', () => { stopAutoplay(); goTo(0, false); });
$('#c-end').addEventListener('click', () => { stopAutoplay(); goTo(R ? R.moves.length : 0, false); });
$('#c-prev').addEventListener('click', () => { stopAutoplay(); goTo(ply - 1); });
$('#c-next').addEventListener('click', () => { stopAutoplay(); goTo(ply + 1); });
$('#c-prevkey').addEventListener('click', () => { stopAutoplay(); nextKey(-1); });
$('#c-nextkey').addEventListener('click', () => { stopAutoplay(); nextKey(1); });
$('#c-play').addEventListener('click', () => { sound.unlock(); autoplay ? stopAutoplay() : startAutoplay(); });
$('#c-flip').addEventListener('click', () => { reviewBoard.setFlipped(!reviewBoard.flipped); goTo(ply, false); });
$('#c-arrows').addEventListener('change', () => goTo(ply, false));

document.addEventListener('keydown', (e) => {
  if (!$('#page-review').classList.contains('active') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
  if (e.key === 'ArrowRight') { stopAutoplay(); goTo(ply + 1); }
  else if (e.key === 'ArrowLeft') { stopAutoplay(); goTo(ply - 1); }
  else if (e.key === 'Home') { stopAutoplay(); goTo(0, false); }
  else if (e.key === 'End') { stopAutoplay(); goTo(R.moves.length, false); }
  else if (e.key === 'ArrowUp') { stopAutoplay(); nextKey(-1); }
  else if (e.key === 'ArrowDown') { stopAutoplay(); nextKey(1); }
  else if (e.key === ' ') { e.preventDefault(); autoplay ? stopAutoplay() : startAutoplay(); }
  else return;
});

async function copyText(text, what) {
  try { await navigator.clipboard.writeText(text); toast(`${what} copied. Paste it to Claude.`); }
  catch { toast('Clipboard blocked. Use the download button instead.'); }
}
function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const fileBase = () => `${R.date || 'game'}-${(R.opponent || 'opponent').replace(/\W+/g, '')}`;
$('#copy-brief').addEventListener('click', () => R && copyText(R.brief, 'Brief'));
$('#dl-brief').addEventListener('click', () => R && download(`${fileBase()}-brief.md`, R.brief, 'text/markdown'));
$('#dl-json').addEventListener('click', () => R && download(`${fileBase()}-analysis.json`, JSON.stringify(R, null, 1), 'application/json'));

// ---------------- puzzles ----------------

const pzBoard = new Board($('#puzzle-board'), { onMove: onPuzzleMove });
let P = null; // current puzzle
let pzState = null; // {fen, tries, done, hinted}

function duePuzzles() {
  const src = $('#pz-source').value;
  return store.puzzles().filter((p) => (src === 'all' || p.source === src));
}

function updateDueBadge() {
  const n = store.puzzles().filter((p) => p.due <= Date.now()).length;
  const b = $('#due-badge');
  b.hidden = !n;
  b.textContent = n;
}

function openPuzzles() {
  const all = store.puzzles();
  $('#puzzle-empty').hidden = !!all.length;
  $('#puzzle').hidden = !all.length;
  if (!all.length) return;
  if (!P || pzState.done) nextPuzzle();
  renderPzStats();
}

function renderPzStats() {
  const all = duePuzzles();
  const due = all.filter((p) => p.due <= Date.now()).length;
  const mastered = all.filter((p) => p.box >= 3).length;
  $('#pz-stats').innerHTML = [['Due now', due], ['Total', all.length], ['Mastered', mastered]]
    .map(([k, v]) => `<div><span class="muted small">${k}</span><b>${v}</b></div>`).join('');
  updateDueBadge();
}

function nextPuzzle() {
  const list = duePuzzles();
  if (!list.length) { $('#pz-prompt').textContent = 'No puzzles for this filter.'; return; }
  const now = Date.now();
  const due = list.filter((p) => p.due <= now).sort((a, b) => a.box - b.box || a.due - b.due);
  const pick = due.length ? due[Math.floor(Math.random() * Math.min(3, due.length))]
    : [...list].sort((a, b) => a.due - b.due)[0];
  P = pick;
  pzState = { fen: P.fen, tries: 0, done: false, hinted: false, ahead: !due.length };
  const turn = P.fen.split(' ')[1];
  pzBoard.setFlipped(turn === 'b');
  pzBoard.setArrows([]);
  pzBoard.setHighlights({});
  pzBoard.setPosition(P.fen, { animate: false });
  pzBoard.enableInput(turn);
  const who = turn === 'w' ? 'White' : 'Black';
  const prompt = P.source === 'punish'
    ? `Your opponent just blundered. ${who} to move: punish it.`
    : `${who} to move. In the game you played ${P.played}. Find the better move.`;
  $('#pz-prompt').innerHTML = `${esc(prompt)} <span class="muted small">vs ${esc(P.opponent || '?')} · ${esc(P.date || '')}${pzState.ahead ? ' · (practising ahead of schedule)' : ''}</span>`;
  $('#pz-feedback').innerHTML = '<p class="muted">Tap a piece, then its square.</p>';
  $('#pz-feedback').className = 'card compact moment';
  const t = TAGS[P.tag];
  $('#pz-lesson').innerHTML = t ? `<b>Theme: ${esc(t.theme || t.label)}</b><p class="small muted">Lesson shows after you solve it.</p>` : '';
  renderPzStats();
}

async function onPuzzleMove(mv) {
  if (!P || pzState.done) return;
  const chess = new Chess(pzState.fen);
  let played;
  try { played = chess.move(mv); } catch { return; }
  const uci = played.from + played.to + (played.promotion || '');
  pzBoard.setPosition(chess.fen(), { lastMove: played, animate: !settings.reduceMotion });
  sound.move(played.san);
  let correct = uci === P.solution || (P.solution.length === 4 && uci === P.solution + 'q');
  if (!correct) {
    // Accept another move if the engine says it's just as good (mate is mate).
    $('#pz-feedback').innerHTML = '<p class="muted">Checking with the engine…</p>';
    if (chess.isCheckmate()) correct = true;
    else {
      try {
        const [a, b] = await Promise.all([
          engine.analyse(P.fen, { depth: 12, multipv: 1 }),
          engine.analyse(chess.fen(), { depth: 12, multipv: 1 }),
        ]);
        const side = P.fen.split(' ')[1];
        const wpBest = side === 'w' ? winPct(scoreToCp(a.lines[0].score)) : 100 - winPct(scoreToCp(a.lines[0].score));
        const wpMine = side === 'w' ? winPct(scoreToCp(b.lines[0].score)) : 100 - winPct(scoreToCp(b.lines[0].score));
        correct = wpBest - wpMine < 3 && wpMine > 60;
      } catch { /* engine unavailable: stick with the stored answer */ }
    }
  }
  if (correct) {
    pzState.done = true;
    pzBoard.disableInput();
    sound.good();
    if (!pzState.ahead) schedule(P, pzState.tries === 0 && !pzState.hinted);
    savePuzzle(P);
    const t = TAGS[P.tag];
    $('#pz-feedback').innerHTML = `<p class="good-text"><b>${played.san}${uci === P.solution ? '' : ' works too'}!</b> ${pzState.tries === 0 && !pzState.hinted ? 'First try.' : 'Got there.'}</p>
      <p class="small">Engine line: ${esc(P.line.join(' '))}</p>
      <p class="small muted">${pzState.tries === 0 && !pzState.hinted && !pzState.ahead ? `Next review in ${['now', '1 day', '3 days', '1 week', '16 days', '5 weeks'][P.box]}.` : 'This one will come back soon.'}</p>`;
    $('#pz-feedback').className = 'card compact moment best';
    if (t) $('#pz-lesson').innerHTML = `<b>${esc(t.label)}</b><p>${esc(t.lesson)}</p><p class="habit">Habit: ${esc(t.habit)}</p><p class="small muted">Drill: ${esc(t.drill)}</p>`;
    // Play out the rest of the line.
    playLine(chess, P.line.slice(1, 4));
  } else {
    pzState.tries++;
    sound.bad();
    if (pzState.tries === 1 && !pzState.ahead) { schedule(P, false); savePuzzle(P); }
    $('#pz-feedback').innerHTML = `<p class="bad-text"><b>${played.san}</b> isn't it. Try again.</p>`;
    $('#pz-feedback').className = 'card compact moment mistake';
    setTimeout(() => { pzBoard.setPosition(pzState.fen, { animate: !settings.reduceMotion }); pzBoard.enableInput(pzState.fen.split(' ')[1]); }, 700);
  }
}

function playLine(chess, sans) {
  let i = 0;
  const step = () => {
    if (i >= sans.length || !pzState.done) return;
    try {
      const m = chess.move(sans[i++]);
      pzBoard.setPosition(chess.fen(), { lastMove: m, animate: !settings.reduceMotion });
      sound.move(m.san);
      setTimeout(step, 800);
    } catch { /* line ended */ }
  };
  setTimeout(step, 900);
}

function savePuzzle(p) {
  const list = store.puzzles();
  const i = list.findIndex((x) => x.id === p.id);
  if (i >= 0) list[i] = p;
  store.savePuzzles(list);
  renderPzStats();
}

$('#pz-next').addEventListener('click', () => nextPuzzle());
$('#pz-source').addEventListener('change', () => nextPuzzle());
$('#pz-hint').addEventListener('click', () => {
  if (!P || pzState.done) return;
  pzState.hinted = true;
  pzBoard.setHighlights({ [P.solution.slice(0, 2)]: 'target' });
  $('#pz-feedback').innerHTML = `<p>Look at the highlighted piece.${TAGS[P.tag] ? ` Theme: ${esc(TAGS[P.tag].theme)}.` : ''}</p>`;
});
$('#pz-show').addEventListener('click', () => {
  if (!P || pzState.done) return;
  pzState.hinted = true;
  pzBoard.setArrows([{ from: P.solution.slice(0, 2), to: P.solution.slice(2, 4), color: 'good' }]);
  if (!pzState.ahead) { schedule(P, false); savePuzzle(P); }
  $('#pz-feedback').innerHTML = `<p>The answer is <b>${esc(P.solutionSan)}</b>. Play it on the board to continue.</p>`;
});

// ---------------- progress ----------------

async function renderProgress() {
  const recs = store.allGames();
  $('#progress-empty').hidden = !!recs.length;
  $('#progress').hidden = !recs.length;
  if (!recs.length) return;

  const focus = pickFocus(recs);
  const top = focus[0];
  const tInfo = top && (TAGS[top.tag] || HABIT_TAGS[top.tag]);
  const card = top && TAGS[top.tag] ? null : HABIT_CARDS.find((c) => c.id === (HABIT_TAGS[top?.tag] || {}).card);
  $('#focus-card').innerHTML = top ? `
    <div class="eyebrow">Your one focus for the next 5 games</div>
    <h2>${esc(tInfo.label)}</h2>
    <p>Showed up in ${top.games} of your last ${top.of} games. ${esc(tInfo.lesson)}</p>
    ${tInfo.habit ? `<p class="habit big">${esc(tInfo.habit)}</p>` : card ? `<p class="habit big">${esc(card.body)}</p>` : ''}
    ${tInfo.drill ? `<p class="small">Drill: ${esc(tInfo.drill)}</p>` : ''}
    ${focus[1] ? `<p class="muted small">Next up: ${esc(tagLabel(focus[1].tag))}${focus[2] ? `, then ${esc(tagLabel(focus[2].tag))}` : ''}.</p>` : ''}` : '<h2>No recurring problems yet</h2><p>Keep feeding it games.</p>';

  const n = recs.length;
  const wins = recs.filter((r) => r.userResult === 'win').length;
  const losses = recs.filter((r) => r.userResult === 'loss').length;
  const threw = recs.filter((r) => r.summary.conversion.threw).length;
  const castled = recs.filter((r) => r.summary.habits.castled).length;
  const avgAcc = recs.reduce((a, r) => a + r.summary.accuracy.user, 0) / n;
  const pz = store.puzzles();
  const tiles = [
    ['Games analysed', n],
    ['Record', `${wins}W ${losses}L ${n - wins - losses}D`],
    ['Avg accuracy', `~${Math.round(avgAcc)}%`],
    ['Winning but lost', `${threw} of ${losses || 0} losses`],
    ['Castled', `${castled} of ${n}`],
    ['Puzzles mastered', `${pz.filter((p) => p.box >= 3).length} / ${pz.length}`],
    ['Rapid rating', '<span id="live-rating">…</span>'],
  ];
  $('#tiles').innerHTML = tiles.map(([k, v]) => `<div class="tile"><span class="muted small">${k}</span><b>${v}</b></div>`).join('');
  if (settings.username) {
    ratings(settings.username).then((r) => {
      const el = $('#live-rating');
      if (el) el.textContent = r.rapid ? `${r.rapid.rating}${r.rapid.best ? ` (best ${r.rapid.best})` : ''}` : '—';
    }).catch(() => { const el = $('#live-rating'); if (el) el.textContent = 'offline'; });
  } else $('#live-rating').textContent = 'set username';

  drawAccuracy(recs);

  const totals = {};
  for (const r of recs) for (const [t, k] of Object.entries(r.summary.tagCounts)) totals[t] = (totals[t] || 0) + k;
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const max = sorted[0] ? sorted[0][1] : 1;
  $('#tag-bars').innerHTML = sorted.map(([t, k]) => `<div class="barrow"><span>${esc(tagLabel(t))}</span><div class="bar"><div class="fill" style="width:${(k / max) * 100}%"></div></div><b>${k}</b></div>`).join('') || '<p class="muted">Nothing recurring.</p>';

  $('#habit-cards').innerHTML = HABIT_CARDS.map((c) => `<div class="habit-card"><b>${esc(c.title)}</b><p>${esc(c.body)}</p></div>`).join('');

  const due = pz.filter((p) => p.due <= Date.now()).length;
  $('#plan').innerHTML = `<ol class="plan">
    <li><b>Daily:</b> clear your due puzzles (${due} now) plus 10 themed puzzles on <i>${esc(top ? (TAGS[top.tag]?.theme || 'tactics') : 'tactics')}</i>.</li>
    <li><b>Every game:</b> ${esc(top && TAGS[top.tag] ? TAGS[top.tag].habit : 'checks, captures, threats — mine first, then theirs.')}</li>
    <li><b>Castle by move 10.</b> You castled in ${castled} of ${n} games.</li>
    <li><b>Twice a week:</b> a slower game (15|10) so the habits get practised with time to think.</li>
    <li><b>Weekly:</b> K+Q and K+R checkmates against the engine until they take under a minute.</li>
    <li><b>After every loss:</b> analyse it here and find your first real mistake.</li></ol>`;
}

function drawAccuracy(recs) {
  const svg = $('#acc-chart');
  const W = 600, H = 200, pad = 28;
  const xs = (i) => pad + (recs.length === 1 ? (W - 2 * pad) / 2 : (i / (recs.length - 1)) * (W - 2 * pad));
  const ys = (v) => H - pad - (v / 100) * (H - 2 * pad);
  let s = '';
  for (const v of [25, 50, 75, 100]) s += `<line x1="${pad}" x2="${W - pad}" y1="${ys(v)}" y2="${ys(v)}" class="grid"/><text x="2" y="${ys(v) + 4}" class="axis">${v}</text>`;
  const pts = recs.map((r, i) => [xs(i), ys(r.summary.accuracy.user)]);
  s += `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" class="accline"/>`;
  recs.forEach((r, i) => { s += `<circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="5" class="accdot ${r.userResult}"><title>${esc(r.date)} vs ${esc(r.opponent)}: ~${Math.round(r.summary.accuracy.user)}% (${r.userResult})</title></circle>`; });
  svg.innerHTML = s;
}

function progressBrief() {
  const recs = store.allGames();
  const focus = pickFocus(recs);
  const lines = [`# Progress brief (${recs.length} games)`, ''];
  for (const r of recs) {
    const c = r.summary.counts.user;
    lines.push(`- ${r.date} vs ${r.opponent} (${r.userColor === 'w' ? 'W' : 'B'}) ${r.userResult}: ~${Math.round(r.summary.accuracy.user)}%, ${c.blunder || 0} blunders, ${c.mistake || 0} mistakes${r.summary.conversion.threw ? ', WINNING POSITION LOST' : ''}; tags: ${Object.keys(r.summary.tagCounts).join(', ') || 'none'}`);
  }
  lines.push('', '## Recurring (weighted, last 10 games)');
  for (const f of focus.slice(0, 6)) lines.push(`- ${f.tag}: in ${f.games}/${f.of} games (score ${f.score})`);
  const pz = store.puzzles();
  lines.push('', `Puzzles: ${pz.length} total, ${pz.filter((p) => p.box >= 3).length} mastered, ${pz.filter((p) => p.due <= Date.now()).length} due.`);
  lines.push('', 'Coach: pick ONE focus for the next 5 games, explain it simply, and give a drill. Engine data above is the only source of truth.');
  return lines.join('\n');
}
$('#copy-progress').addEventListener('click', () => copyText(progressBrief(), 'Progress brief'));

// ---------------- library ----------------

function renderLibrary() {
  const f = $('#lib-filter').value.trim().toLowerCase();
  const idx = store.index().slice().reverse().filter((g) => !f || (g.opponent || '').toLowerCase().includes(f) || g.tags.some((t) => t.includes(f) || tagLabel(t).toLowerCase().includes(f)));
  $('#lib-table').innerHTML = idx.length ? `<table class="lib"><thead><tr><th>Date</th><th>Opponent</th><th></th><th>Result</th><th>Acc.</th><th>Tags</th><th></th></tr></thead><tbody>${idx.map((g) => `
    <tr><td>${esc(g.date)}</td><td>${esc(g.opponent)}</td><td>${g.userColor === 'w' ? '♔' : '♚'}</td>
    <td><span class="pill ${g.userResult}">${g.userResult}</span></td><td>~${Math.round(g.accuracy)}%</td>
    <td class="small">${g.tags.slice(0, 4).map((t) => esc(tagLabel(t))).join(', ')}</td>
    <td class="nowrap"><button class="btn small" data-open="${esc(g.id)}">Review</button> <button class="btn small ghost" data-del="${esc(g.id)}" title="Delete">✕</button></td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">No games yet.</p>';
}
$('#lib-filter').addEventListener('input', renderLibrary);
$('#lib-table').addEventListener('click', (e) => {
  const o = e.target.closest('[data-open]');
  if (o) return openReview(o.dataset.open);
  const d = e.target.closest('[data-del]');
  if (d && confirm('Delete this game and its puzzles?')) { store.deleteGame(d.dataset.del); renderLibrary(); updateDueBadge(); }
});
$('#export-btn').addEventListener('click', () => {
  download(`chess-coach-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(store.exportAll()), 'application/json');
});
$('#import-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try { const n = store.importAll(JSON.parse(await f.text())); settings = store.settings(); applySettings(); fillSettings(); renderLibrary(); updateDueBadge(); toast(`Imported ${n} games.`); }
  catch (err) { toast(err.message, 5000); }
  e.target.value = '';
});

// ---------------- settings ----------------

function fillSettings() {
  $('#s-user').value = settings.username || '';
  $('#s-rating').value = settings.rating || '';
  $('#s-depth').value = String(settings.depth);
  $('#s-theme').value = settings.theme;
  $('#s-sound').checked = settings.sound;
  $('#s-ambient').value = settings.ambient === 'file' ? 'off' : settings.ambient;
  $('#s-motion').checked = settings.reduceMotion;
  $('#s-speed').value = String(settings.autoplayMs);
  $('#cc-user').value = settings.username || '';
}

function saveSettingsFromForm() {
  settings = {
    ...settings,
    username: $('#s-user').value.trim(),
    rating: $('#s-rating').value ? +$('#s-rating').value : null,
    depth: +$('#s-depth').value,
    theme: $('#s-theme').value,
    sound: $('#s-sound').checked,
    reduceMotion: $('#s-motion').checked,
    autoplayMs: +$('#s-speed').value,
  };
  store.saveSettings(settings);
  applySettings();
  $('#cc-user').value = settings.username;
}
['#s-user', '#s-rating', '#s-depth', '#s-theme', '#s-sound', '#s-motion', '#s-speed'].forEach((s) => $(s).addEventListener('change', saveSettingsFromForm));
$('#s-ambient').addEventListener('change', (e) => {
  sound.unlock();
  const v = e.target.value;
  if (v === 'file') return $('#s-ambient-file').click();
  settings.ambient = v;
  store.saveSettings(settings);
  sound.setAmbient(v);
});
$('#s-ambient-file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) { sound.setAmbient('file', f); toast(`Playing ${f.name} on loop (for this visit).`); }
});

// ---------------- boot ----------------

applySettings();
fillSettings();
updateDueBadge();
// Ambient audio needs a tap first (browser autoplay rules).
document.addEventListener('pointerdown', function once() {
  document.removeEventListener('pointerdown', once);
  if (settings.ambient && settings.ambient !== 'off' && settings.ambient !== 'file') sound.setAmbient(settings.ambient);
}, { once: true });

const last = (() => { try { return localStorage.getItem('cc.lastGame'); } catch { return null; } })();
if (last && store.getGame(last)) loadReview(last);
else if (store.index().length) loadReview(store.index().at(-1).id);
const startPage = (() => { try { return localStorage.getItem('cc.page'); } catch { return null; } })();
showPage(startPage && document.getElementById(`page-${startPage}`) ? startPage : 'analyse');

// Exposed for the test page and for debugging.
window.chessCoach = { engine, store, pvToSan };
