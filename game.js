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

// --- Tabla de records ---
const startScreen = document.getElementById('start-screen');
const startRecordsBody = document.getElementById('start-records-body');
const startBestComboEl = document.getElementById('start-best-combo');
const startMaxLinesEl = document.getElementById('start-max-lines');
const playBtn = document.getElementById('play-btn');
const resetRecordsBtn = document.getElementById('reset-records-btn');
const overlayRecords = document.getElementById('overlay-records');
const overlayRecordsBody = document.getElementById('overlay-records-body');
const overlayBestComboEl = document.getElementById('overlay-best-combo');
const overlayMaxLinesEl = document.getElementById('overlay-max-lines');
const nameEntry = document.getElementById('name-entry');
const nameInput = document.getElementById('name-input');
const saveScoreBtn = document.getElementById('save-score-btn');

const THEME_KEY = 'tetris-theme';
const HISCORE_KEY = 'tetris-highscores';
const MAX_SCORES = 5;
const NAME_MAX = 12;
const DEFAULT_NAME = 'Anónimo';

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId;
let gridColor = '#22222e';
// combo: racha de bloqueos consecutivos que limpiaron >=1 linea (partida actual)
// gameBestCombo: mayor valor de combo alcanzado en la partida actual
let combo = 0;
let gameBestCombo = 0;
// estado pendiente entre endGame() y el guardado del nombre
let pendingScores = null;
// running: true solo cuando hay una partida en curso (tras init()). Evita que
// el input de teclado toque globales aun sin inicializar en la pantalla de inicio.
let running = false;

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
    // combo: este bloqueo limpio linea, sube la racha y registra el maximo
    combo++;
    if (combo > gameBestCombo) gameBestCombo = combo;
    updateHUD();
  }
  return cleared;
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
  const cleared = clearLines();
  // el bloqueo no limpio nada: se corta la racha de combo
  if (!cleared) combo = 0;
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

// --- Persistencia de records en localStorage ---

function defaultHighscores() {
  return { scores: [], bestCombo: 0, maxLines: 0 };
}

// Lee y sanea los records. Cualquier dato corrupto devuelve el estado por defecto.
function loadHighscores() {
  try {
    const raw = localStorage.getItem(HISCORE_KEY);
    if (!raw) return defaultHighscores();
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !Array.isArray(data.scores)) {
      return defaultHighscores();
    }
    const scores = data.scores
      .filter(s => s && typeof s === 'object')
      .map(s => ({
        name: sanitizeName(s.name),
        score: Math.max(0, Math.floor(Number(s.score)) || 0),
        lines: Math.max(0, Math.floor(Number(s.lines)) || 0),
        level: Math.max(1, Math.floor(Number(s.level)) || 1),
        date: typeof s.date === 'string' ? s.date : '',
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SCORES);
    return {
      scores,
      bestCombo: Math.max(0, Math.floor(Number(data.bestCombo)) || 0),
      maxLines: Math.max(0, Math.floor(Number(data.maxLines)) || 0),
    };
  } catch (e) {
    return defaultHighscores();
  }
}

function saveHighscores(data) {
  try {
    localStorage.setItem(HISCORE_KEY, JSON.stringify(data));
  } catch (e) {}
}

// True si la puntuacion entra en el top MAX_SCORES
function qualifiesForTop(hs, sc) {
  if (sc <= 0) return false;
  if (hs.scores.length < MAX_SCORES) return true;
  return sc > hs.scores[hs.scores.length - 1].score;
}

// Recorta a NAME_MAX caracteres y aplica nombre por defecto si viene vacio
function sanitizeName(raw) {
  const trimmed = String(raw == null ? '' : raw).trim().slice(0, NAME_MAX);
  return trimmed || DEFAULT_NAME;
}

// Pinta la tabla de records usando solo textContent (nunca innerHTML)
function renderRecordsTable(tbody, scores, highlightIdx) {
  tbody.textContent = '';
  if (!scores.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'records-empty-cell';
    td.textContent = 'Sin récords todavía';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  scores.forEach((s, i) => {
    const tr = document.createElement('tr');
    if (i === highlightIdx) tr.className = 'highlight';
    const cells = [
      String(i + 1),
      s.name,
      Number(s.score).toLocaleString(),
      String(s.lines),
      String(s.level),
    ];
    for (const val of cells) {
      const td = document.createElement('td');
      td.textContent = val;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
}

function renderStartScreen() {
  const hs = loadHighscores();
  renderRecordsTable(startRecordsBody, hs.scores, -1);
  startBestComboEl.textContent = String(hs.bestCombo);
  startMaxLinesEl.textContent = String(hs.maxLines);
}

function showStartScreen() {
  renderStartScreen();
  overlay.classList.add('hidden');
  startScreen.classList.remove('hidden');
}

function resetRecords() {
  if (!confirm('¿Seguro que quieres borrar todos los récords? Esta acción no se puede deshacer.')) return;
  try { localStorage.removeItem(HISCORE_KEY); } catch (e) {}
  renderStartScreen();
}

// Guarda la entrada con el nombre introducido y resalta la fila recien insertada
function saveScoreEntry() {
  if (!pendingScores) return;
  const entry = {
    name: sanitizeName(nameInput.value),
    score,
    lines,
    level,
    date: new Date().toISOString().slice(0, 10),
  };
  pendingScores.scores.push(entry);
  pendingScores.scores.sort((a, b) => b.score - a.score);
  let idx = pendingScores.scores.indexOf(entry);
  pendingScores.scores = pendingScores.scores.slice(0, MAX_SCORES);
  if (idx >= MAX_SCORES) idx = -1;
  saveHighscores(pendingScores);
  overlayBestComboEl.textContent = String(pendingScores.bestCombo);
  overlayMaxLinesEl.textContent = String(pendingScores.maxLines);
  renderRecordsTable(overlayRecordsBody, pendingScores.scores, idx);
  nameEntry.classList.add('hidden');
  pendingScores = null;
}

function endGame() {
  gameOver = true;
  running = false;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;

  const hs = loadHighscores();
  // actualiza metricas extra y persiste ya (no dependen del nombre)
  if (gameBestCombo > hs.bestCombo) hs.bestCombo = gameBestCombo;
  if (lines > hs.maxLines) hs.maxLines = lines;
  saveHighscores(hs);

  overlayBestComboEl.textContent = String(hs.bestCombo);
  overlayMaxLinesEl.textContent = String(hs.maxLines);

  const qualifies = qualifiesForTop(hs, score);
  pendingScores = qualifies ? hs : null;
  renderRecordsTable(overlayRecordsBody, hs.scores, -1);
  nameEntry.classList.toggle('hidden', !qualifies);
  overlayRecords.classList.remove('hidden');
  overlay.classList.remove('hidden');
  if (qualifies) {
    nameInput.value = '';
    nameInput.focus();
  }
}

function togglePause() {
  if (!running || gameOver) return;
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

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  combo = 0;
  gameBestCombo = 0;
  pendingScores = null;
  paused = false;
  gameOver = false;
  running = true;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  overlayRecords.classList.add('hidden');
  nameEntry.classList.add('hidden');
  startScreen.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  // sin partida en curso (pantalla de inicio / game over) el teclado no hace nada
  if (!running) return;
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
playBtn.addEventListener('click', init);
resetRecordsBtn.addEventListener('click', resetRecords);
saveScoreBtn.addEventListener('click', saveScoreEntry);
nameInput.maxLength = NAME_MAX;
nameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); saveScoreEntry(); }
  e.stopPropagation();
});

showStartScreen();
