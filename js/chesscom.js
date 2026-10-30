// Chess.com Published-Data API (public, read-only, CORS-enabled).
// https://www.chess.com/news/view/published-data-api

const BASE = 'https://api.chess.com/pub/player';

async function getJson(url) {
  const res = await fetch(url);
  if (res.status === 404) throw new Error('Chess.com user not found.');
  if (res.status === 429) throw new Error('Chess.com is rate-limiting requests. Wait a minute and try again.');
  if (!res.ok) throw new Error(`Chess.com returned ${res.status}.`);
  return res.json();
}

// Most recent games first. Walks back through monthly archives until `count` games.
export async function recentGames(username, { count = 10, timeClass = null } = {}) {
  const u = encodeURIComponent(username.trim().toLowerCase());
  const { archives } = await getJson(`${BASE}/${u}/games/archives`);
  const out = [];
  for (const url of [...archives].reverse()) {
    const { games } = await getJson(url);
    for (const g of [...games].reverse()) {
      if (g.rules !== 'chess' || !g.pgn) continue;
      if (timeClass && g.time_class !== timeClass) continue;
      out.push({
        pgn: g.pgn, url: g.url, timeClass: g.time_class, endTime: g.end_time,
        white: g.white.username, black: g.black.username,
        whiteResult: g.white.result, blackResult: g.black.result,
        whiteRating: g.white.rating, blackRating: g.black.rating,
      });
      if (out.length >= count) return out;
    }
  }
  return out;
}

// Real rating from chess.com (R7: accuracy is not rating).
export async function ratings(username) {
  const u = encodeURIComponent(username.trim().toLowerCase());
  const s = await getJson(`${BASE}/${u}/stats`);
  const pick = (k) => (s[k] && s[k].last ? { rating: s[k].last.rating, best: s[k].best ? s[k].best.rating : null } : null);
  return { rapid: pick('chess_rapid'), blitz: pick('chess_blitz'), bullet: pick('chess_bullet'), daily: pick('chess_daily'), puzzles: s.tactics && s.tactics.highest ? s.tactics.highest.rating : null };
}
