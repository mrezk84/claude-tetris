# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

Sin build, sin dependencias, sin `package.json`, sin tests automatizados. Para ejecutar:

```bash
open index.html            # macOS
python3 -m http.server 8000  # o cualquier servidor estático, luego http://localhost:8000
```

No hay linter ni suite de tests configurados. Verificar cambios abriendo `index.html` en el navegador y probando manualmente.

## Arquitectura

Tetris vanilla en un único `game.js` (~300 líneas), sin módulos ni build step. Todo el estado del juego vive en variables globales top-level (`board`, `current`, `next`, `score`, `lines`, `level`, `paused`, `gameOver`, `dropInterval`, etc.), reinicializadas en `init()`.

Piezas de flujo clave a entender antes de modificar la lógica:

- **Representación de piezas**: cada tetrominó es una matriz cuadrada en `PIECES[]` donde el valor de celda es el índice de color (1–7, ver `COLORS[]`); `0` = celda vacía. `randomPiece()` clona la forma para no mutar la plantilla original.
- **Rotación** (`rotateCW`): transposición + reverso de filas, sin matrices de rotación por pieza (no usa el sistema SRS estándar). `tryRotate()` aplica wall kicks probando offsets `[0, -1, 1, -2, 2]` en x hasta encontrar uno sin colisión.
- **Colisión** (`collide(shape, ox, oy)`): única fuente de verdad para límites del tablero y solapamiento; se reutiliza para movimiento, rotación, ghost piece y detección de game over en `spawn()`.
- **Loop del juego** (`loop`, vía `requestAnimationFrame`): acumula delta time en `dropAccum`; cuando supera `dropInterval` intenta bajar la pieza o dispara `lockPiece()` (merge al tablero → `clearLines()` → `spawn()` de la siguiente pieza).
- **Progresión de nivel**: `dropInterval = max(100, 1000 - (level-1)*90)`, recalculado en `clearLines()` cada vez que `level` sube (cada 10 líneas).
- **Rendering**: `draw()` redibuja todo el canvas cada frame (grid, tablero fijo, ghost piece con `globalAlpha=0.2`, pieza actual); no hay dirty-rect ni optimización de redibujado.
- **Input**: un único listener `keydown` global que ignora todo si `paused || gameOver` (excepto `KeyP`).

Al tunear `COLS`/`ROWS`/`BLOCK` en `game.js`, hay que actualizar en paralelo `width`/`height` del `<canvas id="board">` en `index.html` (deben coincidir con `COLS × BLOCK` y `ROWS × BLOCK`).
