'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const POWERS = ['bomb', 'lightning', 'freeze'];
const POWER_ICONS = { bomb: '💣', lightning: '⚡', freeze: '❄️' };
const POWER_CHANCE = 0.15;
const FREEZE_MS = 5000;
const FLASH_MS = 150;

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');
const puEls = {
  bomb: document.getElementById('pu-bomb'),
  lightning: document.getElementById('pu-lightning'),
  freeze: document.getElementById('pu-freeze'),
};

const leaderboardListEl = document.getElementById('leaderboard-list');
const bestComboEl = document.getElementById('best-combo');
const maxLinesEl = document.getElementById('max-lines');
const resetScoresBtn = document.getElementById('reset-scores-btn');
const nameInputRow = document.getElementById('name-input-row');
const nameInput = document.getElementById('name-input');
const saveNameBtn = document.getElementById('save-name-btn');
const overlayLeaderboardListEl = document.getElementById('overlay-leaderboard-list');
const overlayBestComboEl = document.getElementById('overlay-best-combo');
const overlayMaxLinesEl = document.getElementById('overlay-max-lines');

const THEME_KEY = 'tetris-theme';
const SCORES_KEY = 'tetris-scores';
const STATS_KEY = 'tetris-stats';
const MAX_SCORES = 5;
const GRID_COLORS = { dark: '#22222e', light: '#d8d8e4' };

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let freezeUntil, powerCounts, flash;
let runBestCombo;

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  const piece = { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
  if (Math.random() < POWER_CHANCE) {
    const cells = [];
    for (let r = 0; r < shape.length; r++)
      for (let c = 0; c < shape[r].length; c++)
        if (shape[r][c]) cells.push({ r, c });
    const cell = cells[Math.floor(Math.random() * cells.length)];
    const powerType = POWERS[Math.floor(Math.random() * POWERS.length)];
    piece.power = { type: powerType, r: cell.r, c: cell.c };
  }
  return piece;
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    if (cleared > runBestCombo) runBestCombo = cleared;
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  const power = current.power;
  merge();
  if (power) {
    activatePower(power.type, current.x + power.c, current.y + power.r);
  }
  clearLines();
  spawn();
}

function activatePower(type, bx, by) {
  const cells = [];
  if (type === 'bomb') {
    for (let r = by - 1; r <= by + 1; r++)
      for (let c = bx - 1; c <= bx + 1; c++)
        if (r >= 0 && r < ROWS && c >= 0 && c < COLS) {
          board[r][c] = 0;
          cells.push({ r, c });
        }
  } else if (type === 'lightning') {
    for (let c = 0; c < COLS; c++) {
      board[by][c] = 0;
      cells.push({ r: by, c });
    }
    for (let r = 0; r < ROWS; r++) {
      board[r][bx] = 0;
      cells.push({ r, c: bx });
    }
  } else if (type === 'freeze') {
    freezeUntil = performance.now() + FREEZE_MS;
  }
  if (cells.length) flash = { cells, until: performance.now() + FLASH_MS };
  powerCounts[type]++;
  updatePowerHUD();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function updatePowerHUD() {
  puEls.bomb.textContent = powerCounts.bomb;
  puEls.lightning.textContent = powerCounts.lightning;
  puEls.freeze.textContent = powerCounts.freeze;
}

function drawPowerIcon(context, x, y, size, type) {
  context.save();
  context.font = `${Math.floor(size * 0.6)}px sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(POWER_ICONS[type], x * size + size / 2, y * size + size / 2 + 1);
  context.restore();
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = document.body.classList.contains('light-mode') ? GRID_COLORS.light : GRID_COLORS.dark;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);

  if (current.power)
    drawPowerIcon(ctx, current.x + current.power.c, current.y + current.power.r, BLOCK, current.power.type);

  if (flash && performance.now() < flash.until) {
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    for (const { r, c } of flash.cells) ctx.fillRect(c * BLOCK, r * BLOCK, BLOCK, BLOCK);
  } else if (flash) {
    flash = null;
  }
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
  if (next.power)
    drawPowerIcon(nextCtx, offX + next.power.c, offY + next.power.r, NB, next.power.type);
}

function getScores() {
  try {
    const raw = JSON.parse(localStorage.getItem(SCORES_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveScores(scores) {
  localStorage.setItem(SCORES_KEY, JSON.stringify(scores));
}

function getStats() {
  try {
    const raw = JSON.parse(localStorage.getItem(STATS_KEY));
    return raw && typeof raw === 'object'
      ? { bestCombo: raw.bestCombo || 0, maxLines: raw.maxLines || 0 }
      : { bestCombo: 0, maxLines: 0 };
  } catch {
    return { bestCombo: 0, maxLines: 0 };
  }
}

function saveStats(stats) {
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

function updateStats(combo, linesInRun) {
  const stats = getStats();
  if (combo > stats.bestCombo) stats.bestCombo = combo;
  if (linesInRun > stats.maxLines) stats.maxLines = linesInRun;
  saveStats(stats);
  return stats;
}

function qualifiesForTop(scores, s) {
  return s > 0 && (scores.length < MAX_SCORES || s > scores[scores.length - 1].score);
}

function renderScoreList(listEl, scores, highlightEntry) {
  listEl.innerHTML = '';
  if (!scores.length) {
    const li = document.createElement('li');
    li.className = 'leaderboard-empty';
    li.textContent = 'Sin récords aún';
    listEl.appendChild(li);
    return;
  }
  scores.forEach((entry, i) => {
    const li = document.createElement('li');
    li.textContent = `${i + 1}. ${entry.name} — ${entry.score.toLocaleString()}`;
    if (entry === highlightEntry) li.classList.add('highlight');
    listEl.appendChild(li);
  });
}

function refreshLeaderboardUI(highlightEntry) {
  const scores = getScores();
  const stats = getStats();
  renderScoreList(leaderboardListEl, scores, highlightEntry);
  bestComboEl.textContent = stats.bestCombo;
  maxLinesEl.textContent = stats.maxLines;
  renderScoreList(overlayLeaderboardListEl, scores, highlightEntry);
  overlayBestComboEl.textContent = stats.bestCombo;
  overlayMaxLinesEl.textContent = stats.maxLines;
}

function submitScoreName() {
  const name = nameInput.value.trim().slice(0, 10) || 'Jugador';
  const entry = { name, score, lines };
  const scores = getScores();
  scores.push(entry);
  scores.sort((a, b) => b.score - a.score);
  scores.length = Math.min(scores.length, MAX_SCORES);
  saveScores(scores);
  nameInputRow.classList.add('hidden');
  refreshLeaderboardUI(scores.includes(entry) ? entry : null);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  updateStats(runBestCombo, lines);
  const scores = getScores();
  if (qualifiesForTop(scores, score)) {
    nameInputRow.classList.remove('hidden');
    nameInput.value = '';
    refreshLeaderboardUI(null);
    overlay.classList.remove('hidden');
    nameInput.focus();
  } else {
    nameInputRow.classList.add('hidden');
    refreshLeaderboardUI(null);
    overlay.classList.remove('hidden');
  }
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    nameInputRow.classList.add('hidden');
    refreshLeaderboardUI(null);
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  if (ts >= freezeUntil) {
    dropAccum += dt;
    if (dropAccum >= dropInterval) {
      dropAccum = 0;
      if (!collide(current.shape, current.x, current.y + 1)) {
        current.y++;
      } else {
        lockPiece();
      }
    }
  }
  if (gameOver) return;
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  freezeUntil = 0;
  powerCounts = { bomb: 0, lightning: 0, freeze: 0 };
  flash = null;
  runBestCombo = 0;
  next = randomPiece();
  spawn();
  updateHUD();
  updatePowerHUD();
  nameInputRow.classList.add('hidden');
  refreshLeaderboardUI(null);
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

saveNameBtn.addEventListener('click', submitScoreName);
nameInput.addEventListener('keydown', e => {
  if (e.code === 'Enter') submitScoreName();
});

resetScoresBtn.addEventListener('click', () => {
  localStorage.removeItem(SCORES_KEY);
  localStorage.removeItem(STATS_KEY);
  refreshLeaderboardUI(null);
});

function applyTheme(theme) {
  document.body.classList.toggle('light-mode', theme === 'light');
  themeToggle.checked = theme === 'light';
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === 'light' ? 'light' : 'dark');
}

themeToggle.addEventListener('change', () => {
  const theme = themeToggle.checked ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
});

initTheme();
init();
