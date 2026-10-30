// PGN / move-list intake. Accepts full PGNs (one or many), or bare move
// lists like "e3 e5 2. g3 Bc5". Comments and variations are stripped,
// clock tags ([%clk h:mm:ss]) are kept per move.
import { Chess } from '../vendor/chess.js';

// Split a pasted blob into individual games.
export function splitGames(text) {
  const clean = text.replace(/\r/g, '').trim();
  if (!clean) return [];
  // A new game starts at a header block that follows move text.
  const games = [];
  let cur = [];
  let sawMoves = false;
  for (const line of clean.split('\n')) {
    const isHeader = /^\s*\[\w+\s+".*"\]\s*$/.test(line);
    if (isHeader && sawMoves) {
      games.push(cur.join('\n'));
      cur = [];
      sawMoves = false;
    }
    if (!isHeader && line.trim()) sawMoves = true;
    cur.push(line);
  }
  if (cur.join('').trim()) games.push(cur.join('\n'));
  return games;
}

function parseHeaders(text) {
  const headers = {};
  for (const m of text.matchAll(/^\s*\[(\w+)\s+"(.*)"\]\s*$/gm)) headers[m[1]] = m[2];
  return headers;
}

function clockToSeconds(s) {
  const parts = s.split(':').map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

// Tokenise move text into [{san, clock}] while dropping everything else.
function tokenize(moveText) {
  let t = moveText;
  // Remove nested variations.
  let prev;
  do { prev = t; t = t.replace(/\([^()]*\)/g, ' '); } while (t !== prev);
  const out = [];
  const re = /\{([^}]*)\}|;[^\n]*|(\$\d+)|(\d+\.(?:\.\.)?)|(1-0|0-1|1\/2-1\/2|\*)|([^\s{};$]+)/g;
  let m;
  while ((m = re.exec(t))) {
    if (m[1] !== undefined) {
      const clk = m[1].match(/\[%clk\s+([\d:.]+)\]/);
      if (clk && out.length) out[out.length - 1].clock = clockToSeconds(clk[1]);
      continue;
    }
    if (m[2] || m[3] || m[4]) continue;
    let tok = m[5];
    tok = tok.replace(/^\d+\.+/, ''); // "1.e4" glued forms
    if (!tok) continue;
    tok = tok.replace(/[!?]+$/, '').replace(/^0-0-0/, 'O-O-O').replace(/^0-0/, 'O-O');
    if (tok) out.push({ san: tok, clock: null });
  }
  return out;
}

// Parse one game. Returns {headers, startFen, moves:[{san, uci, fenBefore, fenAfter, color, clock, ...}]}
export function parseGame(text) {
  const headers = parseHeaders(text);
  const moveText = text.replace(/^\s*\[\w+\s+".*"\]\s*$/gm, '');
  const tokens = tokenize(moveText);
  const startFen = headers.FEN || undefined;
  const chess = startFen ? new Chess(startFen) : new Chess();
  const moves = [];
  for (const tok of tokens) {
    const fenBefore = chess.fen();
    let mv;
    try {
      mv = chess.move(tok.san, { strict: false });
    } catch {
      throw new Error(`Illegal or unreadable move "${tok.san}" after ${Math.ceil((moves.length + 1) / 2)} moves`);
    }
    moves.push({
      san: mv.san,
      uci: mv.from + mv.to + (mv.promotion || ''),
      from: mv.from,
      to: mv.to,
      piece: mv.piece,
      captured: mv.captured || null,
      promotion: mv.promotion || null,
      flags: mv.flags,
      color: mv.color,
      fenBefore,
      fenAfter: chess.fen(),
      clock: tok.clock,
    });
  }
  if (!moves.length) throw new Error('No moves found in that game.');
  return {
    headers,
    startFen: startFen || new Chess().fen(),
    moves,
    finalStatus: chess.isCheckmate() ? 'checkmate' : chess.isStalemate() ? 'stalemate' : chess.isDraw() ? 'draw' : null,
  };
}

// Work out which side the user played: explicit choice wins, then username match.
export function detectUserColor(headers, username, explicit) {
  if (explicit === 'w' || explicit === 'b') return explicit;
  const u = (username || '').trim().toLowerCase();
  if (u) {
    if ((headers.White || '').toLowerCase() === u) return 'w';
    if ((headers.Black || '').toLowerCase() === u) return 'b';
  }
  return null;
}

export function gameKey(game) {
  const h = game.headers;
  if (h.Link) return h.Link;
  const sans = game.moves.map((m) => m.san).join(' ');
  let hash = 0;
  for (let i = 0; i < sans.length; i++) hash = (hash * 31 + sans.charCodeAt(i)) | 0;
  return `${h.Date || ''}|${h.White || ''}|${h.Black || ''}|${hash}`;
}
