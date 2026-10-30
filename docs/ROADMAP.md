# Roadmap: built vs the master plan

This maps the folder-tree plan (`../../Chess structure draft.txt`) to what
exists now. Status: **done**, **partial**, **next**, **later**.

## Decisions taken (the plan said to decide these first)

- **R9 (one codebase):** done. The brain is ported to JavaScript (`js/analysis.js`). The old Python skill can become a thin wrapper later, or be retired.
- **R1 (private site):** decided. A static site, run locally or on GitHub Pages. Games live in browser storage, so nothing personal is published even if the site is public.
- **R10 (browser engine):** done. Stockfish 17.1 lite single-thread runs in a Web Worker, so no special headers are needed.
- **R2 (chess.com API):** verified and built. It's CORS-enabled, so the browser fetches games and ratings directly.
- **R4 (clocks):** verified. API PGNs carry `[%clk]` tags, and the clock reader is built.

## 01 analysis core
- done: parser (PGN and bare lists, 0-0 fix, comments/variations), side detection by username, clock reader, engine pass (top two lines), win %, move classes, accuracy (approx), phase detection, rating-adjusted thresholds (R5), mistake tags including `opened_line`, `forked_king_and_queen`, `missed_punish`, `check_that_loses_tempo`, `time_trouble` (R6), tag dedupe, good-move tags, opening hygiene, king walk, conversion check, brief, analysis JSON with `schema` version, tests.
- next: `pin`, `skewer`, `back_rank`, `trapped_piece`, `overloaded_defender` tags; strategic tags (`development_lag`, `trading_when_behind`, `not_simplifying_when_ahead`).

## 02 game intake
- done: paste box, file upload, chess.com import, batch runner, duplicate detection (by game link), game library.
- later: Lichess import.

## 03 review and replay
- done: 2D board, piece animation for any square pair, board independent of the background, autoplay with speed, jump to key moments, slow-down on critical moments, step back/forward, arrows and squares, what went well, eval graph, key-moment picker, captions from the lesson library.
- next: what-if sandbox (play another move from a critical spot and the engine replies).
- later: share/export a replay as an image or link.

## 04 tutor brain
- done: coaching rules (in every brief), lesson library per tag, habit cards, training plan, rule-based narrator.
- next: level playbooks inside the app (800-1200, 1200-1600), a tone/teaching-style setting.
- later: learning-science notes with sources (R15), theory curriculum (R17).

## 05 puzzles
- done: from my games (mine and opponent blunders I should have punished, with a big best-vs-second gap, R12), engine-verified alternatives, puzzle player, tag-to-theme map, spaced repetition.
- next: preloaded themed sets from the Lichess puzzle database, as a filtered subset (R13), and a puzzle rating.

## 06 stats and progress
- done: progress log (library), trends, skill bars, focus picker, real rating from chess.com (R7), current profile.
- next: goals and streaks.

## 07 openings lab, 08 middlegame/endgame lab, 09 bots
- later (P4). `engine.bestMove(fen, {skill})` already exists for level bots. K+Q and K+R mate practice is the first thing to build in 08. Conversion practice matches the "winning but lost" pattern.

## 10 environment and skin
- done: clinical and cabin themes, firelight flicker, CRT glow and scanlines, move/capture/check/mate sounds, ambience (fire, rain, your own loop), low-power mode, reduced-motion support.
- later (P5): full 3D cabin in Three.js with baked lighting (R8).

## 11 app shell
- done: six pages, mobile-first layout, local storage, backup export/import, settings, local server, licenses file.

## 12 Claude integration
- done: copy brief (per game) and copy progress brief (across games), .md and .json downloads.
- later: Claude inside an artifact (R10), optional API path.

## Known limits
- Accuracy won't match chess.com's number.
- localStorage holds roughly 150 to 300 games. Move to IndexedDB if the library outgrows it.
- Tags are heuristics. When one is wrong, add the game to `tests/` with the right answer before fixing the rule.
