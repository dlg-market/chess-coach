// Local storage: settings, analysed games, puzzles. Everything stays in this
// browser, so export a backup now and then (clearing site data erases it).
import { SCHEMA_VERSION } from './analysis.js';

const K = { settings: 'cc.settings', index: 'cc.index', game: (id) => `cc.game.${id}`, puzzles: 'cc.puzzles' };

const DEFAULT_SETTINGS = {
  username: 'clerv',
  rating: null,
  depth: 14,
  theme: 'cabin',
  sound: true,
  ambient: 'off',
  reduceMotion: false,
  autoplayMs: 1100,
};

function read(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (e) { console.warn('storage write failed', e); return false; }
}

export const store = {
  settings() { return { ...DEFAULT_SETTINGS, ...read(K.settings, {}) }; },
  saveSettings(s) { write(K.settings, s); },

  index() { return read(K.index, []); },
  getGame(id) { return read(K.game(id), null); },
  allGames() { return this.index().map((g) => this.getGame(g.id)).filter(Boolean); },

  saveGame(id, record) {
    record.id = id;
    if (!write(K.game(id), record)) throw new Error('Browser storage is full. Export a backup and delete old games.');
    const idx = this.index().filter((g) => g.id !== id);
    idx.push({
      id, date: record.date, opponent: record.opponent, userColor: record.userColor, userResult: record.userResult,
      accuracy: record.summary.accuracy.user, tags: Object.keys(record.summary.tagCounts), analysedAt: record.analysedAt,
      white: record.headers.White, black: record.headers.Black, result: record.result,
    });
    idx.sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.analysedAt || '').localeCompare(b.analysedAt || ''));
    write(K.index, idx);
    this.addPuzzles(id, record);
  },

  deleteGame(id) {
    localStorage.removeItem(K.game(id));
    write(K.index, this.index().filter((g) => g.id !== id));
    write(K.puzzles, this.puzzles().filter((p) => p.gameId !== id));
  },

  puzzles() { return read(K.puzzles, []); },
  savePuzzles(list) { write(K.puzzles, list); },
  addPuzzles(gameId, record) {
    const list = this.puzzles().filter((p) => p.gameId !== gameId);
    for (const p of record.puzzles || []) {
      list.push({ ...p, id: `${gameId}#${p.ply}`, gameId, box: 0, due: 0, attempts: 0, solved: 0, opponent: record.opponent, date: record.date });
    }
    this.savePuzzles(list);
  },

  exportAll() {
    return { app: 'chess-coach', schema: SCHEMA_VERSION, exportedAt: new Date().toISOString(), settings: this.settings(), games: this.allGames(), puzzles: this.puzzles() };
  },

  importAll(data) {
    if (!data || data.app !== 'chess-coach') throw new Error('Not a chess-coach backup file.');
    let n = 0;
    const puzzleState = new Map(this.puzzles().map((p) => [p.id, p]));
    for (const g of data.games || []) { this.saveGame(g.id, g); n++; }
    // Restore spaced-repetition progress from the backup.
    const merged = this.puzzles().map((p) => {
      const b = (data.puzzles || []).find((x) => x.id === p.id) || puzzleState.get(p.id);
      return b ? { ...p, box: b.box, due: b.due, attempts: b.attempts, solved: b.solved } : p;
    });
    this.savePuzzles(merged);
    if (data.settings) this.saveSettings({ ...this.settings(), ...data.settings });
    return n;
  },
};

// Leitner-style spaced repetition: miss -> back to box 0 (due now),
// solve -> next box with a longer gap.
const GAPS_DAYS = [0, 1, 3, 7, 16, 35];
export function schedule(p, correct) {
  const day = 86400000;
  p.attempts = (p.attempts || 0) + 1;
  if (correct) { p.solved = (p.solved || 0) + 1; p.box = Math.min(GAPS_DAYS.length - 1, (p.box || 0) + 1); }
  else p.box = 0;
  p.due = Date.now() + GAPS_DAYS[p.box] * day + (correct ? 0 : 60000);
  return p;
}
