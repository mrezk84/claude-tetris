'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

// Celda hueca de la tuerca: solida (bloquea colision y cuenta para la linea)
// pero se dibuja vacia. Es truthy, asi collide/merge/clearLines la tratan como llena.
const HOLE = -1;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - pale blue
  '#ffb74d', // L - orange
  '#9e9e9e', // Tuerca - gris metalico
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
  [[8,8,8],[8,HOLE,8],[8,8,8]],               // Tuerca (reto: agujero central)
];

const LINE_SCORES = [0, 100, 300, 500, 800];

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
const themeToggleBtn = document.getElementById('theme-toggle');
const skinSelect = document.getElementById('skin-select');

const THEME_KEY = 'tetris-theme';
const SKIN_KEY = 'tetris-skin';

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let gridColor = '#22222e';

// ---- Skins visuales ----
// Cada entrada de SKINS aporta su paleta (colors[1..8]) y su forma de pintar
// un bloque solido. El early-return de celda vacia y el caso HOLE (agujero de
// la tuerca) viven en drawBlock, comun a todas las skins.

function drawBlockRetro(context, x, y, color, size, alpha) {
  // Comportamiento historico EXACTO: fillRect + highlight superior tenue.
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawBlockNeon(context, x, y, color, size, alpha) {
  const px = x * size + 2;
  const py = y * size + 2;
  const s = size - 4;
  context.globalAlpha = alpha ?? 1;
  context.shadowColor = color;
  context.shadowBlur = 12;
  context.fillStyle = color;
  context.fillRect(px, py, s, s);
  // el resplandor ya quedo pintado: apagarlo antes de los detalles internos
  context.shadowBlur = 0;
  context.fillStyle = 'rgba(0,0,0,0.55)';
  context.fillRect(px + 3, py + 3, s - 6, s - 6);
  context.strokeStyle = color;
  context.lineWidth = 2;
  context.strokeRect(px + 1, py + 1, s - 2, s - 2);
  // reset defensivo: nunca dejar shadowBlur activo o contamina el grid y el resto del frame
  context.shadowBlur = 0;
  context.shadowColor = 'transparent';
  context.globalAlpha = 1;
}

function roundRectPath(context, px, py, w, h, r) {
  if (typeof context.roundRect === 'function') {
    context.beginPath();
    context.roundRect(px, py, w, h, r);
    return;
  }
  // fallback para Safari < 16 (macOS 12 no trae ctx.roundRect)
  context.beginPath();
  context.moveTo(px + r, py);
  context.arcTo(px + w, py, px + w, py + h, r);
  context.arcTo(px + w, py + h, px, py + h, r);
  context.arcTo(px, py + h, px, py, r);
  context.arcTo(px, py, px + w, py, r);
  context.closePath();
}

function drawBlockPastel(context, x, y, color, size, alpha) {
  const px = x * size + 1.5;
  const py = y * size + 1.5;
  const s = size - 3;
  const r = Math.max(3, size * 0.22);
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  roundRectPath(context, px, py, s, s, r);
  context.fill();
  // brillo suave en la mitad superior
  context.fillStyle = 'rgba(255,255,255,0.2)';
  roundRectPath(context, px + 2, py + 2, s - 4, (s - 4) * 0.42, Math.max(2, size * 0.16));
  context.fill();
  context.globalAlpha = 1;
}

function shadeColor(hex, amt) {
  // hex tipo #rrggbb; amt en [-1, 1]: negativo oscurece, positivo aclara
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const f = t => Math.max(0, Math.min(255, Math.round(amt < 0 ? t * (1 + amt) : t + (255 - t) * amt)));
  return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
}

// Los tonos derivados de un color son constantes: cachearlos evita rehacer
// parseInt/shade por cada celda y frame en el hot path de draw().
const pixelShadeCache = new Map();
function pixelShades(color) {
  let shades = pixelShadeCache.get(color);
  if (!shades) {
    shades = {
      light: shadeColor(color, 0.32),
      dark: shadeColor(color, -0.34),
      edge: shadeColor(color, -0.15),
    };
    pixelShadeCache.set(color, shades);
  }
  return shades;
}

function drawBlockPixel(context, x, y, color, size, alpha) {
  const px = x * size + 1;
  const py = y * size + 1;
  const s = size - 2;
  const { light, dark, edge } = pixelShades(color);
  const cell = Math.max(3, Math.floor(size / 6));
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(px, py, s, s);
  // dithering: tablero de celdas claras sobre el tono base
  for (let gy = 0; gy < s; gy += cell) {
    for (let gx = 0; gx < s; gx += cell) {
      if (((gx / cell) + (gy / cell)) % 2 === 0) {
        context.fillStyle = light;
        context.fillRect(px + gx, py + gy, Math.min(cell, s - gx), Math.min(cell, s - gy));
      }
    }
  }
  // borde tipo sprite: dos tonos derivados del color base
  context.fillStyle = dark;
  context.fillRect(px, py, s, 2);
  context.fillRect(px, py, 2, s);
  context.fillStyle = edge;
  context.fillRect(px, py + s - 2, s, 2);
  context.fillRect(px + s - 2, py, 2, s);
  context.globalAlpha = 1;
}

const SKINS = {
  retro: {
    label: 'Retro',
    colors: COLORS,
    drawBlock: drawBlockRetro,
  },
  neon: {
    label: 'Neón',
    colors: [null, '#00e5ff', '#ffea00', '#d500f9', '#00e676', '#ff1744', '#2979ff', '#ff9100', '#b0bec5'],
    drawBlock: drawBlockNeon,
  },
  pastel: {
    label: 'Pastel',
    colors: [null, '#a0e7e5', '#fbe7a8', '#dcc0ec', '#bce3cd', '#f4b8b8', '#c2d5f5', '#f6d3ad', '#d3d3d8'],
    drawBlock: drawBlockPastel,
  },
  pixel: {
    label: 'Pixel art',
    colors: [null, '#3aa8b8', '#d9b23e', '#9a55b0', '#5fa86b', '#c25a5a', '#6a92c9', '#d18b3e', '#808080'],
    drawBlock: drawBlockPixel,
  },
};

let currentSkin = 'retro';
let activeSkin = SKINS.retro;

function refreshGridColor() {
  gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid-color').trim();
}

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * (PIECES.length - 1)) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
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
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
    return;
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const skin = activeSkin;
  if (colorIndex === HOLE) {
    // Agujero de la tuerca: solido pero visualmente vacio. Un contorno tenue
    // comunica que la celda esta ocupada (p. ej. al apoyar otra pieza encima).
    context.globalAlpha = (alpha ?? 1) * 0.25;
    context.strokeStyle = skin.colors[8];
    context.lineWidth = 2;
    context.strokeRect(x * size + 4, y * size + 4, size - 8, size - 8);
    context.globalAlpha = 1;
    return;
  }
  // Delegar el pintado del bloque solido en la skin activa.
  skin.drawBlock(context, x, y, skin.colors[colorIndex], size, alpha);
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
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

  if (gameOver || !current) return;

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
  if (gameOver || paused) return;
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
      if (gameOver) {
        draw();
        return;
      }
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggleBtn.textContent = theme === 'light' ? '☀️' : '🌙';
  themeToggleBtn.setAttribute('aria-label', theme === 'light' ? 'Cambiar a modo oscuro' : 'Cambiar a modo claro');
  refreshGridColor();
}

function toggleTheme() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const theme = isLight ? 'dark' : 'light';
  applyTheme(theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
}

function applySkin(skin) {
  if (!SKINS[skin]) skin = 'retro';
  currentSkin = skin;
  activeSkin = SKINS[skin];
  document.documentElement.setAttribute('data-skin', skin);
  if (skinSelect) skinSelect.value = skin;
  // La skin sobrescribe --board-bg / --grid-color en CSS: re-leer el valor real.
  refreshGridColor();
  // Repintar de forma explicita: en pausa o game over el rAF esta parado y no
  // volveria a dibujar por si solo.
  if (board) draw();
  if (next) drawNext();
}

function changeSkin(skin) {
  applySkin(skin);
  try { localStorage.setItem(SKIN_KEY, currentSkin); } catch (e) {}
}

themeToggleBtn.addEventListener('click', toggleTheme);
if (skinSelect) skinSelect.addEventListener('change', e => changeSkin(e.target.value));
applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

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
  next = randomPiece();
  spawn();
  updateHUD();
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

init();

// Aplicar la skin persistida despues de init(): board/current/next ya existen,
// asi el primer repintado explicito no falla.
(function () {
  let saved = 'retro';
  try { saved = localStorage.getItem(SKIN_KEY) || 'retro'; } catch (e) {}
  applySkin(saved);
})();
