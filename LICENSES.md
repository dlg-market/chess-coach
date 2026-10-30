# Third-party components

| Component | Version | License | Source | Files |
|---|---|---|---|---|
| Stockfish (WASM build by nmrugg/stockfish.js) | 17.1 lite, single-thread | GPL-3.0 | npm `stockfish@17.1.0` | `vendor/stockfish/` (license text in `vendor/stockfish/Copying.txt`) |
| chess.js | 1.4.0 | BSD-2-Clause | npm `chess.js@1.4.0` | `vendor/chess.js` (license in `vendor/chess.js.LICENSE`) |
| cburnett chess pieces, by Colin M.L. Burnett | — | CC BY-SA 3.0 | lichess-org/lila `public/piece/cburnett` | `assets/pieces/` |

Data:

- **chess.com Published-Data API**: read-only public data, fetched live in the browser. Nothing is redistributed.
- Sounds are synthesised in code, so there are no audio files to license.

## If this is ever distributed or sold

Stockfish is GPLv3. Shipping it inside an app generally means the combined app
has to be offered under the GPL with source available. That's fine for a
personal tool or a free open-source site. For a paid product, get proper
advice first. This note is not legal advice.

Don't copy chess.com puzzles, branding or UI, or text from books and videos.
Positions are fine; explanations should be your own words.
