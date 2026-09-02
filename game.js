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

// Menu de pausa: overlay con dos vistas (gameover / menu) y el menu
// con dos sub-vistas (principal / lista de controles).
const overlayGameover = document.getElementById('overlay-gameover');
const overlayMenu = document.getElementById('overlay-menu');
const menuMain = document.getElementById('menu-main');
const menuControls = document.getElementById('menu-controls');
const resumeBtn = document.getElementById('resume-btn');
const menuRestartBtn = document.getElementById('menu-restart-btn');
const controlsBtn = document.getElementById('controls-btn');
const controlsBackBtn = document.getElementById('controls-back-btn');
const startLevelSelect = document.getElementById('start-level-select');

const THEME_KEY = 'tetris-theme';
const START_LEVEL_KEY = 'tetris-start-level';
const MAX_START_LEVEL = 15;

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
// startLevel: nivel base de la partida EN CURSO (lo lee init() y clearLines()).
// configuredStartLevel: eleccion del selector, se persiste y solo pasa a
// startLevel al reiniciar; asi tocar el selector no altera la partida actual.
let startLevel = 1;
let configuredStartLevel = 1;
let gridColor = '#22222e';

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
    // Parte del nivel inicial elegido en el menu; si no, se perderia
    // al limpiar la primera linea.
    level = startLevel + Math.floor(lines / 10);
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
  if (colorIndex === HOLE) {
    // Agujero de la tuerca: solido pero visualmente vacio. Un contorno tenue
    // comunica que la celda esta ocupada (p. ej. al apoyar otra pieza encima).
    context.globalAlpha = (alpha ?? 1) * 0.25;
    context.strokeStyle = COLORS[8];
    context.lineWidth = 2;
    context.strokeRect(x * size + 4, y * size + 4, size - 8, size - 8);
    context.globalAlpha = 1;
    return;
  }
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
  // El overlay alterna entre vista-menu y vista-gameover, nunca las mezcla.
  overlayMenu.classList.add('hidden');
  overlayGameover.classList.remove('hidden');
  overlay.classList.remove('hidden');
}

function showMenuMain() {
  menuControls.classList.add('hidden');
  menuMain.classList.remove('hidden');
}

function showMenuControls() {
  menuMain.classList.add('hidden');
  menuControls.classList.remove('hidden');
}

function openMenu() {
  showMenuMain();
  startLevelSelect.value = String(configuredStartLevel);
  overlayGameover.classList.add('hidden');
  overlayMenu.classList.remove('hidden');
  overlay.classList.remove('hidden');
}

function closeMenu() {
  overlay.classList.add('hidden');
  overlayMenu.classList.add('hidden');
  showMenuMain();
  // Evita que Space/Enter sobre un boton enfocado lo reactive al reanudar.
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    closeMenu();
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    openMenu();
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
  gridColor = getComputedStyle(document.documentElement).getPropertyValue('--grid-color').trim();
}

function toggleTheme() {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const theme = isLight ? 'dark' : 'light';
  applyTheme(theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
}

themeToggleBtn.addEventListener('click', toggleTheme);
applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');

// ---- Selector de nivel inicial ----
function readStartLevel() {
  try {
    const stored = parseInt(localStorage.getItem(START_LEVEL_KEY), 10);
    if (stored >= 1 && stored <= MAX_START_LEVEL) return stored;
  } catch (e) {}
  return 1;
}

for (let i = 1; i <= MAX_START_LEVEL; i++) {
  const opt = document.createElement('option');
  opt.value = String(i);
  opt.textContent = String(i);
  startLevelSelect.appendChild(opt);
}

configuredStartLevel = readStartLevel();
startLevel = configuredStartLevel;
startLevelSelect.value = String(configuredStartLevel);

startLevelSelect.addEventListener('change', () => {
  const v = parseInt(startLevelSelect.value, 10);
  configuredStartLevel = (v >= 1 && v <= MAX_START_LEVEL) ? v : 1;
  try { localStorage.setItem(START_LEVEL_KEY, String(configuredStartLevel)); } catch (e) {}
});

resumeBtn.addEventListener('click', () => { if (paused) togglePause(); });
menuRestartBtn.addEventListener('click', init);
controlsBtn.addEventListener('click', showMenuControls);
controlsBackBtn.addEventListener('click', showMenuMain);

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  // La eleccion del selector se aplica solo aqui, al empezar partida nueva.
  startLevel = configuredStartLevel;
  level = startLevel;
  paused = false;
  gameOver = false;
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  overlayMenu.classList.add('hidden');
  overlayGameover.classList.remove('hidden');
  showMenuMain();
  // Quita el foco de cualquier boton del menu para que Space/Enter no lo reactive.
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  // Escape abre/cierra el menu, pero no hace nada en game over.
  if (e.code === 'Escape') {
    if (gameOver) return;
    // Si el foco esta en el selector de nivel, Escape solo lo abandona
    // (cerrar su desplegable nativo) y no reanuda la partida.
    if (document.activeElement === startLevelSelect) { startLevelSelect.blur(); return; }
    togglePause();
    return;
  }
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
