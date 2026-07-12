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

const SKINS = {
  retro: {
    colors: COLORS,
    boardBg: null, // falls back to --board-bg CSS var
  },
  neon: {
    colors: [
      null,
      '#00e5ff', // I
      '#ffea00', // O
      '#d500f9', // T
      '#00e676', // S
      '#ff1744', // Z
      '#2979ff', // J
      '#ff9100', // L
    ],
    boardBg: '#000000',
  },
  pastel: {
    colors: [
      null,
      '#a8dadc', // I
      '#ffe8a3', // O
      '#d7bde2', // T
      '#b5ead7', // S
      '#ffb7b2', // Z
      '#c7ceea', // J
      '#ffdac1', // L
    ],
    boardBg: null,
  },
  pixel: {
    colors: COLORS,
    boardBg: null,
  },
};

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
const skinSelect = document.getElementById('skin-select');
const puEls = {
  bomb: document.getElementById('pu-bomb'),
  lightning: document.getElementById('pu-lightning'),
  freeze: document.getElementById('pu-freeze'),
};

const THEME_KEY = 'tetris-theme';
const SKIN_KEY = 'tetris-skin';
const GRID_COLORS = { dark: '#22222e', light: '#d8d8e4' };
const NEON_GRID_COLOR = '#1a1a1a';

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let freezeUntil, powerCounts, flash;
let currentSkin = 'retro';

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

function shadeColor(hex, percent) {
  const num = parseInt(hex.slice(1), 16);
  let r = (num >> 16) + percent;
  let g = ((num >> 8) & 0x00ff) + percent;
  let b = (num & 0x0000ff) + percent;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `#${(0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1)}`;
}

function roundedRectPath(context, x, y, w, h, r) {
  if (context.roundRect) {
    context.beginPath();
    context.roundRect(x, y, w, h, r);
    return;
  }
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

function drawBlockRetro(context, px, py, size, color) {
  context.fillStyle = color;
  context.fillRect(px + 1, py + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(px + 1, py + 1, size - 2, 4);
}

function drawBlockNeon(context, px, py, size, color) {
  context.save();
  context.shadowBlur = size * 0.5;
  context.shadowColor = color;
  context.fillStyle = color;
  context.fillRect(px + 2, py + 2, size - 4, size - 4);
  context.restore();
  context.strokeStyle = 'rgba(255,255,255,0.5)';
  context.lineWidth = 1;
  context.strokeRect(px + 2, py + 2, size - 4, size - 4);
}

function drawBlockPastel(context, px, py, size, color) {
  roundedRectPath(context, px + 1, py + 1, size - 2, size - 2, size * 0.25);
  context.fillStyle = color;
  context.fill();
  context.strokeStyle = 'rgba(255,255,255,0.5)';
  context.lineWidth = 1;
  context.stroke();
}

function drawBlockPixel(context, px, py, size, color) {
  context.fillStyle = color;
  context.fillRect(px + 1, py + 1, size - 2, size - 2);
  const light = shadeColor(color, 25);
  const dark = shadeColor(color, -25);
  const cell = Math.max(2, Math.floor((size - 2) / 4));
  for (let ry = 0; ry < 4; ry++) {
    for (let rx = 0; rx < 4; rx++) {
      context.fillStyle = (rx + ry) % 2 === 0 ? light : dark;
      context.fillRect(px + 1 + rx * cell, py + 1 + ry * cell, cell, cell);
    }
  }
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const skin = SKINS[currentSkin] || SKINS.retro;
  const color = skin.colors[colorIndex];
  const px = x * size;
  const py = y * size;
  context.globalAlpha = alpha ?? 1;
  switch (currentSkin) {
    case 'neon':
      drawBlockNeon(context, px, py, size, color);
      break;
    case 'pastel':
      drawBlockPastel(context, px, py, size, color);
      break;
    case 'pixel':
      drawBlockPixel(context, px, py, size, color);
      break;
    default:
      drawBlockRetro(context, px, py, size, color);
  }
  context.globalAlpha = 1;
}

function drawGrid() {
  if (currentSkin === 'neon') {
    ctx.strokeStyle = NEON_GRID_COLOR;
  } else {
    ctx.strokeStyle = document.body.classList.contains('light-mode') ? GRID_COLORS.light : GRID_COLORS.dark;
  }
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
  const skin = SKINS[currentSkin] || SKINS.retro;
  if (skin.boardBg) {
    ctx.fillStyle = skin.boardBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
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
  const skin = SKINS[currentSkin] || SKINS.retro;
  if (skin.boardBg) {
    nextCtx.fillStyle = skin.boardBg;
    nextCtx.fillRect(0, 0, nextCanvas.width, nextCanvas.height);
  }
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
  if (next.power)
    drawPowerIcon(nextCtx, offX + next.power.c, offY + next.power.r, NB, next.power.type);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
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
  next = randomPiece();
  spawn();
  updateHUD();
  updatePowerHUD();
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

function applySkin(skin) {
  currentSkin = SKINS[skin] ? skin : 'retro';
  if (skinSelect) skinSelect.value = currentSkin;
  document.body.dataset.skin = currentSkin;
  if (typeof current !== 'undefined' && current) {
    draw();
    drawNext();
  }
}

function initSkin() {
  const saved = localStorage.getItem(SKIN_KEY);
  applySkin(SKINS[saved] ? saved : 'retro');
}

if (skinSelect) {
  skinSelect.addEventListener('change', () => {
    const skin = skinSelect.value;
    localStorage.setItem(SKIN_KEY, skin);
    applySkin(skin);
  });
}

initTheme();
initSkin();
init();
