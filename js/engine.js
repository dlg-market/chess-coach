// Stockfish (WASM, single-thread lite build) running in a Web Worker.
// Single-thread needs no special server headers, so it works on GitHub Pages.
// Scores are returned from WHITE's point of view.

export class Engine {
  constructor(url = 'vendor/stockfish/stockfish.js') {
    this.url = url;
    this.worker = null;
    this.ready = null;
    this.queue = Promise.resolve();
    this.listeners = new Set();
  }

  start() {
    if (this.ready) return this.ready;
    this.worker = new Worker(this.url);
    this.worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      for (const fn of [...this.listeners]) fn(line);
    };
    this.ready = (async () => {
      this.send('uci');
      await this.waitFor((l) => l === 'uciok');
      this.send('setoption name Hash value 32');
      this.send('isready');
      await this.waitFor((l) => l === 'readyok');
      this.send('ucinewgame');
    })();
    return this.ready;
  }

  send(cmd) { this.worker.postMessage(cmd); }

  waitFor(pred) {
    return new Promise((resolve) => {
      const fn = (line) => { if (pred(line)) { this.listeners.delete(fn); resolve(line); } };
      this.listeners.add(fn);
    });
  }

  // Analyse one position. Returns {lines:[{score:{cp|mate}, pv:[uci]}], depth}
  analyse(fen, { depth = 14, multipv = 2, movetime = null } = {}) {
    const job = async () => {
      await this.start();
      const sideToMove = fen.split(' ')[1];
      const lines = [];
      let reached = 0;
      const onInfo = (line) => {
        if (!line.startsWith('info') || !line.includes(' pv ')) return;
        const d = +(line.match(/ depth (\d+)/) || [])[1];
        const k = +((line.match(/ multipv (\d+)/) || [])[1] || 1);
        const cp = line.match(/ score cp (-?\d+)/);
        const mate = line.match(/ score mate (-?\d+)/);
        if (line.includes(' lowerbound') || line.includes(' upperbound')) return;
        const pv = line.split(' pv ')[1].trim().split(/\s+/);
        const sign = sideToMove === 'w' ? 1 : -1;
        const score = mate ? { mate: sign * +mate[1] } : { cp: sign * +cp[1] };
        lines[k - 1] = { score, pv, depth: d };
        reached = Math.max(reached, d);
      };
      this.listeners.add(onInfo);
      this.send(`setoption name MultiPV value ${multipv}`);
      this.send(`position fen ${fen}`);
      this.send(movetime ? `go movetime ${movetime}` : `go depth ${depth}`);
      const best = await this.waitFor((l) => l.startsWith('bestmove'));
      this.listeners.delete(onInfo);
      const bestMove = best.split(/\s+/)[1];
      const clean = lines.filter(Boolean);
      if (clean.length && clean[0].pv[0] !== bestMove && bestMove && bestMove !== '(none)') {
        clean.sort((a, b) => (a.pv[0] === bestMove ? -1 : b.pv[0] === bestMove ? 1 : 0));
      }
      return { lines: clean, depth: reached, bestMove };
    };
    const p = this.queue.then(job, job);
    this.queue = p.catch(() => {});
    return p;
  }

  // Play a move at limited strength (used by the puzzle "play it out" and future bots).
  async bestMove(fen, { depth = 10, skill = null } = {}) {
    await this.start();
    if (skill !== null) this.send(`setoption name Skill Level value ${skill}`);
    const r = await this.analyse(fen, { depth, multipv: 1 });
    if (skill !== null) this.send('setoption name Skill Level value 20');
    return r.bestMove;
  }

  stop() { if (this.worker) this.send('stop'); }

  terminate() {
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.ready = null;
    this.queue = Promise.resolve();
    this.listeners.clear();
  }
}
