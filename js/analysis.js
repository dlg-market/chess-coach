// THE BRAIN. Engine pass + scoring + tagging + habits + brief.
// buildAnalysis() is pure (engine evals in, analysis out) so it can be tested
// without running Stockfish.
import { Chess } from '../vendor/chess.js';
import { TAGS, HABIT_TAGS, tagLabel } from './lessons.js';

export const SCHEMA_VERSION = 1;
export const ENGINE_NAME = 'Stockfish 17.1 lite (WASM, single thread)';

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const MATE = 10000;

// Rating-adjusted cutoffs, in win-chance points lost (R5). Lower ratings get
// looser cutoffs so the review isn't buried in noise.
export function thresholds(rating) {
  if (rating && rating >= 1400) return { inaccuracy: 5, mistake: 10, blunder: 15 };
  if (rating && rating >= 800) return { inaccuracy: 6, mistake: 12, blunder: 18 };
  return { inaccuracy: 8, mistake: 14, blunder: 22 };
}

// ---------- scoring helpers ----------

export function scoreToCp(score) {
  if (!score) return 0;
  if (score.mate !== undefined) {
    if (score.mate === 0) return 0;
    return score.mate > 0 ? MATE - score.mate : -MATE - score.mate;
  }
  return score.cp;
}

export function winPct(cpWhite) {
  if (cpWhite >= MATE - 500) return 100;
  if (cpWhite <= -MATE + 500) return 0;
  const cp = Math.max(-1000, Math.min(1000, cpWhite));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

const wpFor = (cpWhite, color) => (color === 'w' ? winPct(cpWhite) : 100 - winPct(cpWhite));
const povCp = (cpWhite, color) => (color === 'w' ? cpWhite : -cpWhite);
const isMateFor = (cpWhite, color) => povCp(cpWhite, color) >= MATE - 500;
const isMatedFor = (cpWhite, color) => povCp(cpWhite, color) <= -MATE + 500;

export function moveAccuracy(loss) {
  return Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
}

export function fmtEval(cpWhite) {
  if (cpWhite >= MATE - 500) return `M${MATE - cpWhite}`;
  if (cpWhite <= -MATE + 500) return `-M${MATE + cpWhite}`;
  const v = cpWhite / 100;
  return (v > 0 ? '+' : '') + v.toFixed(1);
}

function material(chess, color) {
  let total = 0;
  for (const row of chess.board()) for (const sq of row) if (sq && sq.color === color) total += VALUE[sq.type];
  return total;
}

function nonPawnMaterial(chess) {
  let total = 0;
  for (const row of chess.board()) for (const sq of row) if (sq && sq.type !== 'p') total += VALUE[sq.type];
  return total;
}

const other = (c) => (c === 'w' ? 'b' : 'w');

function playUci(chess, uci) {
  return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
}

export function pvToSan(fen, pv, n = 6) {
  const chess = new Chess(fen);
  const out = [];
  for (const uci of (pv || []).slice(0, n)) {
    try { out.push(playUci(chess, uci).san); } catch { break; }
  }
  return out;
}

// Net material change for `pov` along a PV, stopping once captures settle.
function materialOutcome(fen, pv, pov, maxPlies = 8) {
  const chess = new Chess(fen);
  const start = material(chess, pov) - material(chess, other(pov));
  let captureSeen = false;
  let result = 0;
  const captures = [];
  for (let k = 0; k < Math.min(maxPlies, (pv || []).length); k++) {
    const uci = pv[k];
    const target = chess.get(uci.slice(2, 4));
    const piece = chess.get(uci.slice(0, 2));
    const isCap = !!target || (piece && piece.type === 'p' && uci[0] !== uci[2]);
    const isPromo = uci.length === 5;
    if (!isCap && !isPromo && captureSeen) break;
    if (!isCap && !isPromo && k >= 3) break;
    let mv;
    try { mv = playUci(chess, uci); } catch { break; }
    if (isCap) { captureSeen = true; captures.push({ ply: k, from: mv.from, to: mv.to, piece: mv.piece, captured: mv.captured, color: mv.color }); }
    result = material(chess, pov) - material(chess, other(pov)) - start;
  }
  return { net: result, captures };
}

function squaresBetween(a, b) {
  const fa = a.charCodeAt(0), ra = +a[1], fb = b.charCodeAt(0), rb = +b[1];
  const df = Math.sign(fb - fa), dr = Math.sign(rb - ra);
  if (!(fa === fb || ra === rb || Math.abs(fb - fa) === Math.abs(rb - ra))) return [];
  const out = [];
  let f = fa + df, r = ra + dr;
  while (f !== fb || r !== rb) { out.push(String.fromCharCode(f) + r); f += df; r += dr; }
  return out;
}

function phaseOf(chess, ply) {
  const npm = nonPawnMaterial(chess);
  if (npm <= 26) return 'endgame';
  if (ply < 20) return 'opening';
  return 'middlegame';
}

function parseIncrement(tc) {
  const m = (tc || '').match(/^(\d+)(?:\+(\d+))?/);
  return m ? { base: +m[1], inc: +(m[2] || 0) } : null;
}

// ---------- engine pass ----------

export async function runEngine(game, engine, { depth = 14, onProgress } = {}) {
  const fens = [game.startFen, ...game.moves.map((m) => m.fenAfter)];
  const evals = [];
  for (let i = 0; i < fens.length; i++) {
    const chess = new Chess(fens[i]);
    if (chess.isCheckmate()) {
      evals.push({ terminal: true, cp: chess.turn() === 'w' ? -MATE : MATE, lines: [] });
    } else if (chess.isStalemate() || chess.isInsufficientMaterial()) {
      evals.push({ terminal: true, cp: 0, lines: [] });
    } else {
      const r = await engine.analyse(fens[i], { depth, multipv: 2 });
      evals.push({ cp: scoreToCp(r.lines[0] && r.lines[0].score), lines: r.lines.map((l) => ({ cp: scoreToCp(l.score), pv: l.pv.slice(0, 10) })), depth: r.depth });
    }
    if (onProgress) onProgress(i + 1, fens.length);
  }
  return evals;
}

export async function analyzeGame(game, userColor, engine, opts = {}) {
  const evals = await runEngine(game, engine, opts);
  return buildAnalysis(game, userColor, evals, opts);
}

// ---------- the pure part ----------

export function buildAnalysis(game, userColor, evals, opts = {}) {
  const rating = opts.rating || +(game.headers[userColor === 'w' ? 'WhiteElo' : 'BlackElo']) || null;
  const th = thresholds(rating);
  const tc = parseIncrement(game.headers.TimeControl);
  const moves = [];
  const lastClock = { w: tc ? tc.base : null, b: tc ? tc.base : null };

  game.moves.forEach((m, i) => {
    const c = m.color;
    const ev0 = evals[i], ev1 = evals[i + 1];
    const best = ev0.lines[0];
    const second = ev0.lines[1];
    const playedIsBest = best && best.pv[0] === m.uci;
    const wpBefore = wpFor(ev0.cp, c);
    let wpAfter = wpFor(ev1.cp, c);
    if (playedIsBest) wpAfter = Math.max(wpAfter, wpBefore);
    const loss = Math.max(0, wpBefore - wpAfter);
    let cls = playedIsBest ? 'best' : loss < 2 ? 'excellent' : loss < th.inaccuracy ? 'good'
      : loss < th.mistake ? 'inaccuracy' : loss < th.blunder ? 'mistake' : 'blunder';
    // Already-decided positions: don't scold small slips (R5).
    if ((wpBefore >= 97 && wpAfter >= 90) || (wpBefore <= 3)) {
      if (['inaccuracy', 'mistake'].includes(cls)) cls = 'good';
    }
    const gap = best && second ? wpFor(best.cp, c) - wpFor(second.cp, c) : 0;
    const before = new Chess(m.fenBefore);
    const after = new Chess(m.fenAfter);
    let timeSpent = null;
    if (m.clock !== null && m.clock !== undefined && lastClock[c] !== null) {
      timeSpent = Math.max(0, lastClock[c] - m.clock + (tc ? tc.inc : 0));
      lastClock[c] = m.clock;
    }
    moves.push({
      ply: i + 1,
      moveNo: Math.floor(i / 2) + 1,
      moveLabel: `${Math.floor(i / 2) + 1}${c === 'w' ? '.' : '...'}`,
      color: c,
      san: m.san, uci: m.uci, from: m.from, to: m.to,
      fenBefore: m.fenBefore, fenAfter: m.fenAfter,
      clock: m.clock ?? null, timeSpent,
      evalBefore: ev0.cp, evalAfter: ev1.cp,
      wpBefore, wpAfter, loss, cls,
      acc: moveAccuracy(loss),
      bestUci: best ? best.pv[0] : null,
      bestSan: best ? pvToSan(m.fenBefore, best.pv, 1)[0] : null,
      bestLine: best ? pvToSan(m.fenBefore, best.pv, 6) : [],
      secondSan: second ? pvToSan(m.fenBefore, second.pv, 1)[0] : null,
      gap,
      refutationUci: ev1.lines[0] ? ev1.lines[0].pv[0] : null,
      refutationSan: ev1.lines[0] ? pvToSan(m.fenAfter, ev1.lines[0].pv, 1)[0] : null,
      refutationLine: ev1.lines[0] ? pvToSan(m.fenAfter, ev1.lines[0].pv, 6) : [],
      phase: phaseOf(before, i),
      tags: [], goodTags: [], why: null, primaryTag: null,
      _bestPv: best ? best.pv : [], _refPv: ev1.lines[0] ? ev1.lines[0].pv : [],
      _before: before, _after: after,
    });
  });

  // ----- tagging -----
  const severe = (cls) => cls === 'mistake' || cls === 'blunder';
  const flagged = (cls) => cls === 'inaccuracy' || severe(cls);
  moves.forEach((mv, i) => {
    const c = mv.color, opp = other(c);
    const prev = moves[i - 1];
    // Good-move tags
    if (mv.san.endsWith('#')) mv.goodTags.push('checkmate_delivered');
    else if (mv.san.endsWith('+')) {
      const ks = findKing(mv._after, opp);
      if (ks && mv._after.attackers(ks, c).length >= 2) mv.goodTags.push('double_check');
    }
    if (prev && prev.cls === 'blunder' && mv.loss < 2 && mv.wpAfter >= 60) mv.goodTags.push('punished_blunder');
    if (mv.cls === 'best' && mv.gap >= 20 && mv.wpBefore > 8 && mv.wpBefore < 97) mv.goodTags.push('only_move_found');
    else if (mv.cls === 'best' && mv.gap >= 12 && mv.wpBefore > 8 && mv.wpBefore < 97) mv.goodTags.push('strong_move');

    if (!flagged(mv.cls)) return;
    const tags = [];
    const evB = mv.evalBefore, evA = mv.evalAfter;
    if (isMatedFor(evA, c) && !isMatedFor(evB, c)) tags.push('allowed_mate');
    if (isMateFor(evB, c) && !isMateFor(evA, c)) tags.push('missed_mate');

    const matBefore = material(mv._before, c) - material(mv._before, opp);
    const matAfter = material(mv._after, c) - material(mv._after, opp);
    const ref = materialOutcome(mv.fenAfter, mv._refPv, c);
    const playedNet = matAfter - matBefore + ref.net;
    const bestOut = materialOutcome(mv.fenBefore, mv._bestPv, c);
    const swing = bestOut.net - playedNet;

    if (playedNet <= -2 && swing >= 2) {
      const firstOppCap = ref.captures.find((x) => x.color === opp);
      const wasCapture = !!mv._before.get(mv.to);
      if (wasCapture && firstOppCap && firstOppCap.to === mv.to && firstOppCap.ply === 0) {
        tags.push('bad_exchange');
      } else if (firstOppCap) {
        const s = firstOppCap.to;
        if (s === mv.to) mv.why = 'moved_into_attack';
        else {
          const attackedBefore = mv._before.isAttacked(s, opp);
          const defenders = mv._before.attackers(s, c);
          const slider = ['b', 'r', 'q'].includes(firstOppCap.piece);
          if (!attackedBefore && slider && squaresBetween(firstOppCap.from, s).includes(mv.from)) {
            mv.why = 'opened_line';
            tags.push('opened_line');
          } else if (attackedBefore && defenders.includes(mv.from)) mv.why = 'removed_defender';
          else if (attackedBefore) mv.why = 'ignored_threat';
          else mv.why = 'new_attack';
        }
        tags.push('hung_piece');
      }
    } else if (playedNet <= -1 && swing >= 1) {
      tags.push('hung_pawn');
    }

    // Fork check: the opponent's best reply attacks two valuable pieces at once.
    if (mv._refPv[0]) {
      const C = new Chess(mv.fenAfter);
      let r;
      try { r = playUci(C, mv._refPv[0]); } catch { r = null; }
      if (r) {
        const forker = VALUE[r.piece] || 0;
        const targets = [];
        for (const row of C.board()) for (const sq of row) {
          if (!sq || sq.color !== c || sq.square === r.to) continue;
          if (!C.attackers(sq.square, opp).includes(r.to)) continue;
          const valuable = sq.type === 'k' || (VALUE[sq.type] >= 3 && (VALUE[sq.type] > forker || !C.isAttacked(sq.square, c)));
          if (valuable) targets.push(sq.type);
        }
        if (targets.length >= 2 && (playedNet <= -2 || severe(mv.cls))) {
          tags.push(targets.includes('k') && targets.includes('q') ? 'forked_king_and_queen' : 'allowed_fork');
        }
      }
    }

    if (mv.bestUci !== mv.uci) {
      const bestIsCapture = !!mv._before.get(mv.bestUci.slice(2, 4));
      if (bestIsCapture && bestOut.net >= 2 && swing >= 2) tags.push('missed_capture');
      if (mv.bestSan && mv.bestSan.includes('+') && severe(mv.cls) && !tags.includes('missed_mate')) tags.push('missed_check_idea');
      if (mv.san.includes('+') && severe(mv.cls) && mv.bestSan && !mv.bestSan.includes('+')) tags.push('check_that_loses_tempo');
    }
    if (prev && (prev.cls === 'blunder' || prev.cls === 'mistake') && severe(mv.cls) && mv.wpBefore >= 60) tags.push('missed_punish');
    if (!tags.length && severe(mv.cls)) tags.push('quiet_mistake');

    const order = ['allowed_mate', 'missed_mate', 'forked_king_and_queen', 'opened_line', 'hung_piece', 'allowed_fork', 'bad_exchange',
      'missed_punish', 'missed_capture', 'hung_pawn', 'missed_check_idea', 'check_that_loses_tempo', 'quiet_mistake'];
    // One clear label per mistake (R6): drop tags a stronger one already explains.
    let t = [...new Set(tags)];
    const has = (x) => t.includes(x);
    if (has('allowed_fork') || has('forked_king_and_queen')) t = t.filter((x) => x !== 'hung_piece' && x !== 'hung_pawn');
    if (has('missed_capture')) t = t.filter((x) => x !== 'hung_pawn' && x !== 'missed_check_idea');
    if (has('missed_mate')) t = t.filter((x) => x !== 'missed_check_idea' && x !== 'missed_capture');
    if (has('allowed_mate')) t = t.filter((x) => x !== 'hung_piece' && x !== 'hung_pawn');
    mv.tags = t.sort((a, b) => order.indexOf(a) - order.indexOf(b)).slice(0, 2);
    if (!mv.tags.includes('hung_piece') && !mv.tags.includes('opened_line')) mv.why = null;
    mv.primaryTag = mv.tags[0] || null;
  });

  // Opponent blunders: what was the punishment?
  moves.forEach((mv, i) => {
    if (mv.color !== userColor && severe(mv.cls)) {
      const reply = moves[i + 1];
      mv.punishSan = reply ? reply.bestSan : mv.refutationSan;
    }
  });

  // ----- per-game summary -----
  const userMoves = moves.filter((m) => m.color === userColor);
  const oppMoves = moves.filter((m) => m.color !== userColor);
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  const counts = (list) => list.reduce((acc, m) => { acc[m.cls] = (acc[m.cls] || 0) + 1; return acc; }, {});
  const result = game.headers.Result || (game.finalStatus === 'checkmate' ? (game.moves.at(-1).color === 'w' ? '1-0' : '0-1') : '*');
  const userResult = result === '1/2-1/2' ? 'draw' : result === '*' ? 'unknown'
    : (result === '1-0') === (userColor === 'w') ? 'win' : 'loss';

  const habits = openingHygiene(moves, userColor);
  const conversion = conversionCheck(evals, userColor, userResult, moves);
  if (conversion.threw) {
    const worst = moves.find((m) => m.ply === conversion.worstPly);
    if (worst && !worst.tags.includes('threw_winning_position')) worst.tags.push('threw_winning_position');
  }
  const time = timeReport(moves, userColor, tc);
  if (time) {
    for (const p of time.lowClockMistakes) {
      const mv = moves.find((m) => m.ply === p);
      if (mv) mv.tags.push('time_trouble');
    }
  }

  const tagCounts = {};
  for (const m of userMoves) for (const t of m.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
  for (const h of habits.flags) tagCounts[h] = (tagCounts[h] || 0) + 1;
  const goodCounts = {};
  for (const m of userMoves) for (const t of m.goodTags) goodCounts[t] = (goodCounts[t] || 0) + 1;
  const phaseErrors = {};
  for (const m of userMoves) if (severe(m.cls)) phaseErrors[m.phase] = (phaseErrors[m.phase] || 0) + 1;

  // Key moments: user's worst moves, opponent blunders, user's best finds.
  const worst = userMoves.filter((m) => flagged(m.cls)).sort((a, b) => b.loss - a.loss).slice(0, 5);
  const oppBlunders = oppMoves.filter((m) => m.cls === 'blunder').sort((a, b) => b.loss - a.loss).slice(0, 3);
  const finds = userMoves.filter((m) => m.goodTags.length).sort((a, b) => goodRank(b) - goodRank(a)).slice(0, 3);
  const keyPlies = [...new Set([...worst, ...oppBlunders, ...finds].map((m) => m.ply))].sort((a, b) => a - b);

  const puzzles = buildPuzzles(moves, userColor);

  for (const m of moves) { delete m._before; delete m._after; delete m._bestPv; delete m._refPv; }

  const h = game.headers;
  const record = {
    schema: SCHEMA_VERSION,
    engine: ENGINE_NAME,
    depth: opts.depth || null,
    analysedAt: new Date().toISOString(),
    headers: h,
    startFen: game.startFen,
    userColor,
    result, userResult,
    termination: h.Termination || null,
    date: (h.UTCDate || h.Date || '').replace(/\./g, '-'),
    opponent: userColor === 'w' ? h.Black : h.White,
    userElo: +(userColor === 'w' ? h.WhiteElo : h.BlackElo) || null,
    oppElo: +(userColor === 'w' ? h.BlackElo : h.WhiteElo) || null,
    thresholds: th,
    moves,
    evals: evals.map((e) => e.cp),
    summary: {
      accuracy: { user: mean(userMoves.map((m) => m.acc)), opp: mean(oppMoves.map((m) => m.acc)) },
      counts: { user: counts(userMoves), opp: counts(oppMoves) },
      tagCounts, goodCounts, phaseErrors,
      habits, conversion, time,
      peakWp: conversion.peakWp,
    },
    keyPlies,
    puzzles,
  };
  record.brief = writeBrief(record);
  return record;
}

function goodRank(m) {
  const order = ['checkmate_delivered', 'double_check', 'only_move_found', 'punished_blunder', 'strong_move'];
  return 10 - Math.min(...m.goodTags.map((t) => order.indexOf(t)));
}

function findKing(chess, color) {
  for (const row of chess.board()) for (const sq of row) if (sq && sq.type === 'k' && sq.color === color) return sq.square;
  return null;
}

function openingHygiene(moves, userColor) {
  const mine = moves.filter((m) => m.color === userColor);
  const first10 = mine.slice(0, 10);
  const castle = mine.find((m) => m.san.startsWith('O-O'));
  const flags = [];
  if (!castle && mine.length >= 15) flags.push('no_castle');
  if (castle && castle.moveNo > 12) flags.push('late_castle');

  let undeveloped = null;
  const tenth = mine[Math.min(9, mine.length - 1)];
  if (tenth && mine.length >= 10) {
    const b = new Chess(tenth.fenAfter);
    const home = userColor === 'w' ? ['b1', 'g1', 'c1', 'f1'] : ['b8', 'g8', 'c8', 'f8'];
    undeveloped = home.filter((s) => { const p = b.get(s); return p && p.color === userColor && (p.type === 'n' || p.type === 'b'); }).length;
    if (undeveloped >= 2) flags.push('slow_development');
  }
  const queenMoves = first10.filter((m) => m.san.startsWith('Q')).length;
  if (queenMoves >= 2) flags.push('early_queen');
  const flankPawnMoves = first10.filter((m) => /^[abgh]/.test(m.san)).length;
  if (flankPawnMoves >= 3) flags.push('flank_pawns');

  // Track pieces by square to find repeat movers in the first 10 moves.
  const moveCount = {};
  const idAt = {};
  let nextId = 0;
  for (const m of first10) {
    if (m.san.startsWith('O-O')) continue;
    const id = idAt[m.from] ?? nextId++;
    delete idAt[m.from];
    idAt[m.to] = id;
    moveCount[id] = (moveCount[id] || 0) + 1;
  }
  if (Object.values(moveCount).some((n) => n >= 3)) flags.push('repeat_mover');

  let kingMoves = 0;
  for (const m of mine) {
    if (m.moveNo > 40 || m.phase === 'endgame') break;
    if (m.san.startsWith('K')) kingMoves++;
  }
  if (kingMoves >= 3) flags.push('king_walk');

  return { castled: !!castle, castleMove: castle ? castle.moveNo : null, undevelopedAt10: undeveloped, queenMovesFirst10: queenMoves, flankPawnMovesFirst10: flankPawnMoves, kingMoves, flags };
}

function conversionCheck(evals, userColor, userResult, moves) {
  let peakWp = 0, peakPly = 0;
  evals.forEach((e, i) => { const wp = wpFor(e.cp, userColor); if (wp > peakWp) { peakWp = wp; peakPly = i; } });
  const threw = peakWp >= 70 && userResult !== 'win' && userResult !== 'unknown';
  let worstPly = null;
  if (threw) {
    const after = moves.filter((m) => m.color === userColor && m.ply > peakPly).sort((a, b) => b.loss - a.loss);
    worstPly = after[0] ? after[0].ply : null;
  }
  return { peakWp, peakPly, peakEval: evals[peakPly] ? evals[peakPly].cp : 0, threw, worstPly };
}

function timeReport(moves, userColor, tc) {
  const mine = moves.filter((m) => m.color === userColor && m.timeSpent !== null);
  if (!mine.length) return null;
  const lowLine = tc ? Math.min(60, tc.base * 0.1) : 60;
  const low = mine.filter((m) => m.clock !== null && m.clock < lowLine);
  const lowClockMistakes = low.filter((m) => m.cls === 'mistake' || m.cls === 'blunder').map((m) => m.ply);
  const rushed = mine.filter((m) => (m.cls === 'mistake' || m.cls === 'blunder') && m.timeSpent < 5 && m.clock > 120).map((m) => m.ply);
  const longest = mine.reduce((a, b) => (b.timeSpent > a.timeSpent ? b : a));
  const avg = mine.reduce((a, m) => a + m.timeSpent, 0) / mine.length;
  return {
    avgSeconds: avg,
    longestThink: { ply: longest.ply, san: longest.san, seconds: longest.timeSpent },
    finalClock: mine.at(-1).clock,
    movesUnderLowClock: low.length,
    lowClockMistakes, rushed,
  };
}

function buildPuzzles(moves, userColor) {
  const out = [];
  moves.forEach((m, i) => {
    const severe = m.cls === 'mistake' || m.cls === 'blunder';
    if (!severe || !m.bestUci || m.gap < 15) return;
    if (m.color === userColor) {
      out.push({ fen: m.fenBefore, solution: m.bestUci, solutionSan: m.bestSan, line: m.bestLine, ply: m.ply, source: 'my_mistake', tag: m.primaryTag, played: m.san });
    }
  });
  // Positions where the opponent blundered and the user had to punish.
  moves.forEach((m, i) => {
    if (m.color === userColor || m.cls !== 'blunder') return;
    const reply = moves[i + 1];
    if (!reply || !reply.bestUci || reply.gap < 15) return;
    if (out.some((p) => p.ply === reply.ply)) return; // already a "my mistake" puzzle
    out.push({ fen: reply.fenBefore, solution: reply.bestUci, solutionSan: reply.bestSan, line: reply.bestLine, ply: reply.ply, source: 'punish', tag: reply.primaryTag || 'missed_punish', played: reply.san });
  });
  return out;
}

// ---------- the brief (what a coach, human or Claude, reads) ----------

export function writeBrief(r) {
  const s = r.summary;
  const h = r.headers;
  const lines = [];
  const col = r.userColor === 'w' ? 'White' : 'Black';
  lines.push(`# Game brief: ${h.White || '?'} vs ${h.Black || '?'} (${r.result})`);
  lines.push(`Date ${r.date || '?'} · You: ${col}${r.userElo ? ` (${r.userElo})` : ''} · Opponent ${r.opponent || '?'}${r.oppElo ? ` (${r.oppElo})` : ''} · ${r.userResult.toUpperCase()}${r.termination ? ` · ${r.termination}` : ''}`);
  lines.push(`Engine: ${r.engine}, depth ${r.depth || '?'}. Accuracy is approximate (Lichess-style formula, not chess.com's).`);
  lines.push('');
  const c = s.counts.user;
  lines.push(`## Numbers`);
  lines.push(`- Your accuracy ~${Math.round(s.accuracy.user)}% · opponent ~${Math.round(s.accuracy.opp)}%`);
  lines.push(`- Your blunders ${c.blunder || 0}, mistakes ${c.mistake || 0}, inaccuracies ${c.inaccuracy || 0} (cutoffs ${r.thresholds.inaccuracy}/${r.thresholds.mistake}/${r.thresholds.blunder} win-% points)`);
  lines.push(`- Opponent blunders ${s.counts.opp.blunder || 0}, mistakes ${s.counts.opp.mistake || 0}`);
  lines.push(`- Best position you reached: ${fmtEval(r.userColor === 'w' ? s.conversion.peakEval : -s.conversion.peakEval)} (win chance ${Math.round(s.conversion.peakWp)}%)${s.conversion.threw ? ' — **winning position not converted**' : ''}`);
  lines.push('');
  lines.push('## Critical moments (your moves)');
  const mine = r.moves.filter((m) => m.color === r.userColor && ['inaccuracy', 'mistake', 'blunder'].includes(m.cls)).sort((a, b) => b.loss - a.loss).slice(0, 5);
  if (!mine.length) lines.push('- None flagged.');
  for (const m of mine.sort((a, b) => a.ply - b.ply)) {
    const tags = m.tags.length ? ` [${m.tags.join(', ')}${m.why ? `; why: ${m.why}` : ''}]` : '';
    const clk = m.clock !== null ? ` · clock ${fmtClock(m.clock)}${m.timeSpent !== null ? `, spent ${Math.round(m.timeSpent)}s` : ''}` : '';
    lines.push(`- ${m.moveLabel} ${m.san} — ${m.cls.toUpperCase()}${tags}. Win ${Math.round(m.wpBefore)}% → ${Math.round(m.wpAfter)}% (${fmtEval(m.evalBefore)} → ${fmtEval(m.evalAfter)}). Best: ${m.bestLine.slice(0, 4).join(' ')}. Their best reply: ${m.refutationLine.slice(0, 4).join(' ')}${clk}`);
  }
  lines.push('');
  const opp = r.moves.filter((m) => m.color !== r.userColor && m.cls === 'blunder');
  if (opp.length) {
    lines.push('## Opponent blunders (did you punish?)');
    for (const m of opp) {
      const reply = r.moves[m.ply];
      const verdict = reply ? (reply.loss < 3 ? 'punished' : `NOT punished (you played ${reply.san}, ${reply.cls})`) : 'game ended';
      lines.push(`- ${m.moveLabel} ${m.san} — punish with ${m.punishSan || '?'} → ${verdict}`);
    }
    lines.push('');
  }
  const finds = r.moves.filter((m) => m.color === r.userColor && m.goodTags.length);
  if (finds.length) {
    lines.push('## Your best finds');
    for (const m of finds.slice(0, 5)) lines.push(`- ${m.moveLabel} ${m.san} [${m.goodTags.join(', ')}]`);
    lines.push('');
  }
  const hy = s.habits;
  lines.push('## Habits');
  lines.push(`- Castled: ${hy.castled ? `yes, move ${hy.castleMove}` : 'no'} · minor pieces undeveloped after move 10: ${hy.undevelopedAt10 ?? 'n/a'} · queen moves in first 10: ${hy.queenMovesFirst10} · flank pawn moves in first 10: ${hy.flankPawnMovesFirst10} · king moves before endgame: ${hy.kingMoves}`);
  if (hy.flags.length) lines.push(`- Flags: ${hy.flags.map((f) => HABIT_TAGS[f]?.label || f).join(', ')}`);
  if (s.time) {
    const t = s.time;
    lines.push(`- Clock: avg ${Math.round(t.avgSeconds)}s/move, longest think ${Math.round(t.longestThink.seconds)}s on ${t.longestThink.san}, finished with ${fmtClock(t.finalClock)}. Moves under low clock: ${t.movesUnderLowClock}. Mistakes in low clock: ${t.lowClockMistakes.length}. Mistakes played in <5s with time left: ${t.rushed.length}.`);
  } else {
    lines.push('- Clock: no clock data in this PGN.');
  }
  const pe = Object.entries(s.phaseErrors).map(([k, v]) => `${k} ${v}`).join(', ');
  if (pe) lines.push(`- Mistakes+blunders by phase: ${pe}`);
  lines.push('');
  const tc = Object.entries(s.tagCounts).sort((a, b) => b[1] - a[1]);
  if (tc.length) lines.push(`## Tag counts\n${tc.map(([t, n]) => `- ${t} (${tagLabel(t)}): ${n}`).join('\n')}\n`);
  lines.push('## Coaching rules');
  lines.push('Engine is truth: make no chess claims beyond this brief without an engine run. Give one focus, calibrated to the player\'s rating. Praise real finds. Be honest when unsure.');
  return lines.join('\n');
}

export function fmtClock(s) {
  if (s === null || s === undefined) return '?';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

// Across many games: what should the player work on next?
export function pickFocus(records) {
  const weights = {};
  const recent = records.slice(-10);
  for (const r of recent) {
    for (const [t, n] of Object.entries(r.summary.tagCounts)) {
      const sev = (TAGS[t] && TAGS[t].severity) || (HABIT_TAGS[t] ? 2 : 1);
      weights[t] = (weights[t] || 0) + n * sev;
    }
  }
  const ranked = Object.entries(weights).sort((a, b) => b[1] - a[1]);
  return ranked.map(([tag, score]) => ({ tag, score, games: recent.filter((r) => r.summary.tagCounts[tag]).length, of: recent.length }));
}
