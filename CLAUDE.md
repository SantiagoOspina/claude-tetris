# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Classic Tetris implemented in vanilla JavaScript with HTML5 Canvas. No build process, no dependencies, no package.json — just static files served or opened directly.

## Running

No build/install/lint/test commands exist. To run the game:

```bash
start index.html        # Windows: open directly in browser
python3 -m http.server 8000   # or serve locally, then open localhost:8000
```

There is no test suite. Verify changes by opening `index.html` in a browser and playing.

## Architecture

Three files, all logic lives in `game.js` (~300 lines, single file, no modules):

- **`index.html`** — DOM shell: `#board` canvas (300×600, 10×20 grid of 30px blocks), `#next-canvas` for the next-piece preview, HUD spans (`#score`, `#lines`, `#level`), and a shared `#overlay` div used for both pause and game-over screens.
- **`style.css`** — dark/retro arcade visual theme only.
- **`game.js`** — all state and logic as module-level `let` variables (`board`, `current`, `next`, `score`, `lines`, `level`, `paused`, `gameOver`, `dropAccum`, `dropInterval`, `animId`) mutated directly by functions (no framework, no classes).

### Key mechanics

- **Board**: `ROWS × COLS` matrix; each cell is `0` (empty) or a piece color index `1–7`.
- **Pieces**: defined as square matrices in `PIECES`; rotation (`rotateCW`) transposes + reverses rows.
- **Collision** (`collide`): checks board bounds and existing locked cells.
- **Wall kicks** (`tryRotate`): after rotating, tries x-offsets `[0, -1, 1, -2, 2]` until one doesn't collide.
- **Game loop** (`loop`): driven by `requestAnimationFrame`; accumulates `dt` in `dropAccum`, drops the piece one row when it exceeds `dropInterval`.
- **Line clear** (`clearLines`): scans bottom-up, splices full rows out and unshifts empty rows at top.
- **Scoring**: `LINE_SCORES = [0, 100, 300, 500, 800]` × current level; hard drop = 2 pts/cell traveled, soft drop = 1 pt/row.
- **Leveling**: level = `floor(lines / 10) + 1`; `dropInterval = max(100, 1000 - (level-1)*90)` ms.
- **Ghost piece** (`ghostY`): projects current piece straight down to its landing row, drawn at `globalAlpha = 0.2`.
- **Game over**: triggered in `spawn()` when a freshly spawned piece immediately collides.

Everything is driven by keydown handlers at the bottom of `game.js` (arrows to move/rotate/soft-drop, Space for hard drop, P to pause) and a restart button that calls `init()`.
