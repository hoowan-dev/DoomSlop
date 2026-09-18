# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state: playable

The full loop works — look, move, shoot, enemies spawn and close in, contact damage, death, restart. There are no `TODO` stubs left. Difficulty ramps by shortening the spawn interval from `ENEMY.spawnInterval` to `ENEMY.spawnIntervalMin` over `ENEMY.rampDuration`.

Not implemented (deliberately, not oversights): sound, multiple enemy types, weapon variety, persistent high score, mobile/touch controls.

## Commands

```bash
npm run dev      # Vite dev server on http://localhost:5173/, hot reload
npm run build    # production bundle into dist/
npm run preview  # serve the built bundle
```

**There is no test suite, linter, or formatter configured.** Don't invent `npm test` — it will fail. Verification is done by running the app (see below).

### Node on PATH

Node 24 LTS lives at `C:\Program Files\nodejs`, but an agent shell's environment may predate the install and not have it on PATH. If `node: command not found`, prefix it:

```bash
export PATH="/c/Program Files/nodejs:$PATH"
```

## Verifying changes

`npm run build` catches import/syntax breakage cheaply (it transforms every module). But a clean build proves nothing about rendering — WebGL failures are runtime-only and silent.

To actually check the game runs, drive headless Chrome. `playwright-core` is installed **globally** (deliberately not a project dependency), and two driver scripts live outside the repo:

- `%TEMP%\doomslop-preview.mjs` — navigates, screenshots, dumps console errors.
- `%TEMP%\doomslop-gameplay.mjs` — 18 assertions covering look/move/bounds/spawn/steering/shooting/damage/death/restart. Run it after any gameplay change.

`main.js` exposes `window.__game` (player, enemies, weapon, input, score/state getters) behind `import.meta.env.DEV`, which is how the gameplay driver reaches in. Vite strips it from production builds — verified by grepping `dist/`.

Two things the gameplay driver learned the hard way, worth preserving in any replacement:

- **Let real frames elapse after setting player state.** Writing `player.yaw` then immediately calling `weapon.fire()` tests the harness, not the game — `_syncCamera()` hasn't run. Wait ~120ms.
- **Freeze `enemies.spawnTimer` to a huge value** during targeted assertions, or the spawn timer injects an extra enemy mid-check and the count assertions fail spuriously.

Two more assertions worth keeping:

- Read `#health` / `#score` text. They start as literal `HP --` / `SCORE --` in the HTML and are only filled in by `hud.update()`, so `HP 100` proves the loop actually reached the HUD rather than dying at import time.
- Always check `console --errors` / `pageerror`. A dark scene and a failed scene are hard to tell apart in a screenshot.

Headless Chrome needs `--use-angle=swiftshader --enable-unsafe-swiftshader` or WebGL won't come up at all. Pointer lock *does* work headless, so the click-to-play path is testable.

## Architecture

`src/main.js` owns everything: it constructs the renderer, scene, camera, and each system, then drives them from one `requestAnimationFrame` loop. Systems never call each other's `update()` and never schedule their own frames — if something needs to run per-frame, main.js calls it.

Boundaries that are load-bearing:

- **`config.js` is the only place tunable numbers live.** Speeds, damage, spawn rates, sensitivity. Gameplay code reads from it; it must not hardcode values. Balancing should stay a single-file edit.
- **`input.js` reports hardware, not intent.** Held keys, accumulated mouse delta, whether the trigger is down. It has no notion of "forward" or "shoot" — `player.js` and `weapon.js` interpret. Keep gameplay meaning out of it.
  - `consumeMouseDelta()` is destructive: it returns the accumulated delta and zeroes it. Exactly one caller per frame, or look input gets eaten.
  - Losing pointer lock clears held keys and the trigger, so nothing sticks after Esc or alt-tab.
- **The camera *is* the player.** No body mesh — nothing renders from another viewpoint. `player.js` keeps `yaw`/`pitch` separately from `camera.rotation` and applies them via `YXZ` Euler order so pitch can be clamped without gimbal problems. Mutate `player.position`/`yaw`/`pitch`, then let `_syncCamera()` push to the camera.
- **Pointer lock drives pause.** Locked means running; unlocked means paused. `running` is derived from the lock state via `input.onLockChange`, not tracked independently. Game over calls `document.exitPointerLock()`, and the overlay doubles as the pause and death screen.
- **Score flows weapon → main via callback.** `Weapon` takes an `onKill(score)` and doesn't own the tally; `EnemyManager.damage()` returns points earned and the weapon forwards them. Enemies and the weapon stay ignorant of the score.
- **Enemies share one geometry and one material** at module scope in `enemies.js`. At this fidelity per-enemy assets are pure waste. Iterate the enemy array backwards when removing mid-loop.

## The matrixWorld invariant (read this before touching hit detection)

`Raycaster` reads `object.matrixWorld` and **never refreshes it**, and three only recomputes world matrices inside `renderer.render()` — which runs *after* every system's `update()` in a frame. So anything that mutates a transform and is then raycast in the same frame must call `updateMatrixWorld()` itself.

Three places depend on this, and dropping any of them produces a silent aiming bug rather than an error:

- `Player._syncCamera()` — without it, `weapon.fire()` aims along the *previous* frame's rotation and aiming lags the mouse by a frame.
- `EnemyManager.update()` after moving each mesh — without it, shots test against last frame's enemy positions.
- `EnemyManager.spawn()` — most severe. A new mesh has an identity `matrixWorld`, so until the next render a raycast treats it as sitting at the **world origin**, not where it spawned.

If shots visibly pass through enemies, suspect a missing `updateMatrixWorld()` before suspecting the raycaster.

## three.js notes

- **Use `THREE.Timer`, not `THREE.Clock`.** Clock is deprecated in the pinned version and warns. Timer is exported from core; `timer.connect(document)` wires up the Page Visibility API so a backgrounded tab resumes with a sane delta. Call `timer.update()` once per frame before `getDelta()`.
- The per-frame delta is additionally clamped to `0.1s` so a GC pause can't tunnel anything through a wall.
- `require('three/package.json')` throws — three doesn't export it. Use `npm ls` to check the installed version.
- Graphics are intentionally minimal: flat colors, `MeshLambertMaterial`, no textures, no shadows. Match that when adding visuals.

## Conventions

Plain ES modules, no TypeScript, no JSX, no build step beyond Vite. The HUD is DOM on top of the canvas (`hud.js` + `style.css`), not drawn in the scene — cheaper and easier to style. Comments explain *why* a boundary exists, not what a line does; match that density.
