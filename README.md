# Chess Coach

A personal chess tutor that runs entirely in the browser. Paste a game (or pull
it from chess.com), Stockfish analyses every move on your own device, and a
rule-based tutor turns the engine's numbers into key moments, lessons, puzzles
from your own mistakes, and one thing to focus on next. No server, no API bill.

Stockfish does the calculating, and the coach (this app, or Claude reading the
brief) does the teaching.

## Run it

Windows: double-click `start.bat`. Anywhere else:

```bash
python serve.py
```

Then open http://localhost:8765. It has to be served over http; opening
`index.html` straight from disk won't load the engine.

To put it online, push this folder to a GitHub repo and turn on GitHub Pages.
The engine is the single-threaded build, so it needs none of the special
headers that Pages can't send. Pages sites are public, but your games stay in
your own browser's storage, not on the site.

## What's in it (Phase 1 plus some of Phase 2)

| Area | What works |
|---|---|
| Intake | Paste one or many PGNs or bare move lists; upload .pgn; **import from chess.com by username** (clock times included); sample games from the first coaching session |
| Analysis core | Stockfish 17.1 (WASM) at depth 10/14/18, top two lines per position; win %, move classes, approximate accuracy; cutoffs adjusted to your rating; phase detection |
| Tags | `allowed_mate`, `missed_mate`, `hung_piece` (why: moved into attack / ignored threat / removed defender / opened line), `hung_pawn`, `allowed_fork`, `forked_king_and_queen`, `opened_line`, `bad_exchange`, `missed_capture`, `missed_check_idea`, `missed_punish`, `check_that_loses_tempo`, `quiet_mistake`, `threw_winning_position`, `time_trouble`. Duplicates are removed, leaving one clear label per mistake |
| Good moves | `only_move_found`, `strong_move`, `double_check`, `checkmate_delivered`, `punished_blunder` |
| Habits | Castling, development by move 10, early queen, flank pawns, repeat movers, king walks |
| Clock | Time per move, low-clock mistakes, mistakes played in under 5 seconds with time left |
| Review | Board with smooth piece animation; autoplay that slows down on key moments; "key moments only" mode; arrows (green = best, red = their punishment); eval bar; clickable win-chance graph; move list colour-coded; lesson card per moment |
| Puzzles | Built from your own mistakes and from opponent blunders you should have punished; engine accepts equally good alternatives; hints; spaced repetition (1, 3, 7, 16, 35 days) |
| Progress | One focus for the next 5 games; record, accuracy trend, "winning but lost" count, castling rate, live chess.com rating; what keeps costing you; habit cards; training plan |
| Library | Every analysed game; filter by opponent or tag; delete; **export/import backup** |
| Claude | "Copy brief" on every game and "Copy progress brief" across games: paste either into Claude for a narrative coaching session |
| Look and sound | "Cabin at night" theme (flickering amber firelight, blue-green CRT glow, scanlines) and "Clinical" theme; synthesised move/capture/check sounds; fireplace or rain ambience, or your own audio loop; low-power mode |

## Files

```
index.html          the app shell (6 pages)
css/app.css         both themes, board, layout (mobile first)
js/pgn.js           PGN and move-list parsing, clock tags, side detection
js/engine.js        Stockfish worker wrapper (UCI)
js/analysis.js      THE BRAIN: scoring, tagging, habits, conversion, clock, puzzles, brief
js/lessons.js       tutor lesson library, habit cards, caption templates
js/board.js         2D board, diff-based animation, arrows, tap-to-move
js/store.js         localStorage, backups, spaced repetition
js/chesscom.js      chess.com public API (games + ratings)
js/sound.js         WebAudio sounds and ambience (no audio files)
js/samples.js       the six games from the first session
tests/index.html    known-answer tests: open http://localhost:8765/tests/
fixtures/           sample PGNs
vendor/             Stockfish 17.1 lite single-thread, chess.js 1.4.0
assets/pieces/      cburnett piece set
docs/ROADMAP.md     what's built vs the master plan, and what's next
```

## Tests

Open http://localhost:8765/tests/ after any change to tags or thresholds. It
checks the parser and scoring, then runs the engine on the sample games and
confirms the known answers (for example: 26...Nd4+ is a double check, 10...exf4
opened a line, 9.Nf3 missed a mate). All 26 pass at depth 14.

## Notes and limits

- **Accuracy is approximate.** It uses the Lichess-style formula, not chess.com's. Your rating comes from chess.com, never from accuracy.
- **Storage is per browser.** Clearing site data erases your games. Use Export backup.
- **Tags are rules layered on engine numbers**, so they can occasionally be wrong. The engine evaluations themselves are the ground truth.
- Stockfish is GPLv3. If this is ever sold or distributed, the GPL applies to the engine and probably the app. See LICENSES.md.
