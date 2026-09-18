# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state: playable

The full loop works — look, move, shoot, enemies spawn and close in, contact damage, death, restart. There are no `TODO` stubs left. Difficulty ramps by shortening the spawn interval from `ENEMY.spawnInterval` to `ENEMY.spawnIntervalMin` over `ENEMY.rampDuration`.

On top of that, `rounds.js` runs the round structure: clear `ROUNDS.killsPerRound` floaters, fight a boss alone in an empty arena, next round. There are two enemy tiers (floater and boss) and no more planned.

Not implemented (deliberately, not oversights): weapon variety, persistent high score, mobile/touch controls. Neither boss health nor `killsPerRound` scales with the round number — every round is the same length and the boss is the same fight, which is a balance decision and not a missing feature.

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
- `%TEMP%\doomslop-gameplay.mjs` — 19 assertions covering look/move/bounds/spawn/steering/shooting/damage/death/restart. Run it after any gameplay change.
- `%TEMP%\doomslop-effects.mjs` — 33 assertions on tracer origin/endpoints/lifetime, hitsparks on each surface type, and particle spawn/decay/pool-ceiling, plus effect screenshots. The muzzle assertions project the tracer's start point to NDC and sweep the pitch range, since "bottom center of the screen" is only checkable in screen space.
- `%TEMP%\doomslop-hitsparks.mjs` — screenshots of a floor hit and a wall hit. Assertions can't tell whether sparks *read*; two bugs this project has already had (screen-filling muzzle sparks, a long diagonal tracer) passed every assertion and were only caught by looking.
- `%TEMP%\doomslop-minimap.mjs` — 10 assertions on the minimap, plus a full-screen and a close-up screenshot. It reads pixels back off the minimap canvas with `getImageData` and finds the centroid of the enemy dot, then sweeps 25 (yaw, bearing) pairs asserting each dot lands at the right *bearing* clockwise from straight up. Numbers, not eyeballs: a mirrored or quarter-turn-off radar looks entirely plausible in a screenshot. Filter Chrome's `willReadFrequently` warning in any replacement — the driver's own readback triggers it, not the game. The full-screen shot is the best check of all: with enemies at known bearings, the dots inside the cone and the enemies visible in the 3D view have to be on the same sides, which no amount of self-consistent minimap math can fake.
- `%TEMP%\doomslop-rounds.mjs` — 41 assertions on the round loop: announcement order and that nothing flashes behind the click-to-start overlay, the field wipe at `killsPerRound`, the boss's size/health/score, the health bar's screen position relative to the boss's head, boss contact damage arriving on a cooldown rather than every frame, the `KILLS n/50` progress field (counts shot kills, ignores contact deaths, hidden for the boss fight, back to zero next round), and that a retry returns to round 1. It also screenshots the readout mid-round, since four fields on one line can crowd or wrap and no assertion would notice. Two traps it encodes: **score assertions must be relative** (the driver has already banked floater kills by the time it reaches the boss, so asserting an absolute total is asserting the driver's own history), and **the opening announcement is a race** — `isRunning()` flips inside the pointer-lock handler, which can land before the frame that flushes the announcement, so wait on it rather than sampling once. Its announcement screenshot uses a stretched `animationDuration` *plus* a negative `animationDelay` to park the flash on its opaque plateau; stretching alone lands inside the fade-in and looks worse than doing nothing.
- `%TEMP%\doomslop-popups.mjs` — 27 assertions on the score popups, plus a screenshot. The placement checks re-derive the expected pixel from raw trigonometry (`fov`, `aspect`, distance) instead of three's projection, so they can't agree with `hud.js` by sharing its bug, and one case kills on each side of the crosshair — a popup pinned to the screen center passes every "dead ahead" check. **Sample animation over wall-clock fractions of the configured life, not a frame count:** headless Chrome runs uncapped here (~95fps), so counting frames covers a much smaller and less predictable slice than you'd expect, which shows up as "it never fades" and "the ease-out looks linear" — any easing curve is nearly straight over a short enough early window. Its screenshot kills one of two floaters placed symmetrically about the crosshair, so the popup landing opposite the survivor is visible rather than argued.
- `%TEMP%\doomslop-sound.mjs` — 19 assertions on the audio. It taps the master gain with an `AnalyserNode` and measures peak amplitude, so it proves each effect actually *generates signal* rather than merely not throwing — the audio equivalent of looking at a screenshot. Also covers autoplay hygiene, event wiring, and clipping under sustained fire.

When a driver places an enemy by hand, **keep it above the floor.** The arena is solid, so a target buried under `y=0` is legitimately unhittable — a test that positions one there is testing nothing. This is how the gameplay driver used to place its target.

`main.js` exposes `window.__game` (player, enemies, weapon, effects, sound, hud, minimap, rounds, input, config, score/state getters) behind `import.meta.env.DEV`, which is how the gameplay driver reaches in. Vite strips it from production builds — verified by grepping `dist/`.

Two things the gameplay driver learned the hard way, worth preserving in any replacement:

- **Let real frames elapse after setting player state.** Writing `player.yaw` then immediately calling `weapon.fire()` tests the harness, not the game — `_syncCamera()` hasn't run. Wait ~120ms.
- **Freeze `enemies.spawnTimer` to a huge value** during targeted assertions, or the spawn timer injects an extra enemy mid-check and the count assertions fail spuriously.
- **Read effect buffers after a frame boundary.** `effects.update()` writes `drawRange` and the position buffer later in the same frame as the shot, so reading them synchronously after `fire()` sees stale values. `await` a `requestAnimationFrame` first.
- **`window.__game.config` lets a driver retune live** (the config objects are read at use time). The effects screenshots stretch `tracerLife`/`particleLife` this way, since a 0.07s tracer is otherwise impossible to capture.

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
- **Enemies share one geometry and one material** at module scope in `enemies.js`. At this fidelity per-enemy assets are pure waste. Iterate the enemy array backwards when removing mid-loop. The boss gets its own module-scope pair rather than a scaled-up floater — at radius 3 a 20-facet icosahedron reads as a few flat slabs, and the different hue is what makes it legible as a different tier of thing.
  - **Every enemy carries `kind`, a pointer at the config block it was spawned from** (`ENEMY` or `BOSS`), and `update()` reads speed/radius/damage/spin off that rather than off an import. So a new per-enemy tunable has to be added to *both* blocks — one of them missing it is an `undefined` that silently means "0" or "NaN", not an error.
  - **`BOSS.spawnDistance` must stay below `arenaSize/2 - BOSS.radius`.** `_spawnPoint()` rejects bearings that land out of bounds; if the distance exceeds the limit then *every* bearing is out of bounds and it falls through to its center-ward fallback on every attempt, so the boss always arrives from the same spot.

- **`rounds.js` owns the phase machine, and it's the only module that knows what a "round" is.** `fighting → incoming → boss → breather → fighting`. It drives `EnemyManager` (wiping the field, gating spawns, summoning the boss) and reports announcements out through a callback, so it needs the manager but nothing needs it. It has no DOM access, like every other system here.
  - **Kills are tallied in `enemyDefeated()` but every phase change happens in `update()`.** The kill is reported from inside `EnemyManager.damage()`, so acting on it immediately would call `removeAll()`/`spawnBoss()` re-entrantly — mutating the enemy array from inside a method that's iterating it. Deferring to the next frame boundary is the cheap fix; don't "simplify" it back.
  - **`rounds.js` formats its own readout strings** — `label` (`ROUND 3`, `ROUND 3 BOSS`) and `progress` (`KILLS 12/50`) — and `hud.update()` just writes them. `progress` returns **null during the boss fight**, which the HUD treats as "hide the field": a frozen `50/50` sitting there looks like it's still counting. Because null is a real value, the HUD's change-cache for it starts as `undefined`, not null.
  - **Announcements are queued in `_pending` and flushed at the top of `update()`**, which main.js only calls while running. That's what keeps `reset()` from flashing `ROUND 1` behind the click-to-start overlay, and it's why the inter-round timers pause with the game.
  - **`removeAll()` vs `clear()` is load-bearing.** `clear()` also calls `reset()`, which zeroes `elapsed` — using it for the between-rounds wipe would restart the difficulty ramp every round and the game would never get harder. The round wipe uses `removeAll()`; only a player restart uses `clear()`.
  - **`onDefeat` fires only from `damage()`, never from `remove()` or `removeAll()`.** Contact deaths and between-round sweeps stay silent, so floaters suiciding into the player can't advance the round and a restart can't credit a kill for every enemy it swept. Same rule the score already follows: you have to actually kill them.
  - **The boss is not consumed on contact.** Floaters are removed when they touch the player; the boss sits on them and hits on an `attackInterval` cooldown instead. Removing it on touch would let a 50-shot enemy be beaten by walking into it, and with no cooldown it would land a hit every frame and erase a full health bar in a fraction of a second.
- **`hud.js` anchors two things to world points, both DOM, both through `_place()`:** the boss health bar and the floating `+points` score popups. `_place()` projects, converts NDC to CSS pixels, and returns false for anything behind the camera — `project()` mirrors x/y through the origin there and would put the element somewhere plausible-looking but wrong. Off to the sides needs no such check; it clips at the viewport edge. Keep both callers on that one helper rather than reimplementing the `z >= 1` rule.
  - **Score popups are pooled**, like everything in `effects.js` — a fixed set of divs built in `_buildPopups()` from `POPUP.pool`, with a kill on a full pool recycling the one closest to expiring. Kills come several a second, so creating and dropping DOM nodes per kill would give the GC steady work.
  - **`hud.updatePopups(dt)` must run after `weapon.update()` in the frame.** A popup spawned by a kill this frame is placed by that call; run it earlier and a fresh popup paints one frame at the top-left corner before jumping to the kill.
  - **The popup's rise and fade are driven in JS, not by a CSS animation**, so `POPUP.life` is the single source of truth. `#announce` does it the other way — its 1.2s is in `style.css` and `ROUNDS.bossDelay`/`roundDelay` have to be kept longer by hand. That coupling is tolerable for one number; don't add a second. The popup's *color and font* are still CSS, like the rest of the HUD.
  - The popup's number comes from `enemy.kind.scoreValue` via `enemies.onDefeat`, while the score tally comes from `damage()`'s **return value** forwarded through the weapon's `onKill`. Same number, two hooks — safe only because `damage()` has exactly one real caller. A second caller would make the popup and the readout disagree.
- **`effects.js` draws; `weapon.js` doesn't.** The weapon has no scene access — it reports `{ muzzle, endpoint, direction, hit }` through `onShot` and main.js turns that into tracers and sparks. Keep it that way; handing `Weapon` a scene reference is the easy wrong move.
  - The vectors in that shot object are **module-scope scratch**, overwritten on the next shot. Handlers must consume them synchronously, never retain them.
  - Everything in `effects.js` is preallocated: a fixed tracer pool and a particle pool with a contiguous `[0, live)` active prefix, dead particles swapped with the last live one so `drawRange` stays valid. Effects fire several times a second, so per-shot allocation would give the GC steady work during play.
  - Ray origin is the **eye** (so aim matches the crosshair exactly), but the tracer is drawn from an offset **muzzle**. These are deliberately different points.
  - **The arena is solid.** `createWorld` returns a `solids` array (floor + four walls) and `weapon.fire()` raycasts it in the *same* cast as the enemy hitboxes, so the nearest surface wins. Don't split this into two casts — an enemy behind a wall would become hittable through it. The floor grid is deliberately excluded from `solids`: it's `LineSegments` 1cm above the floor, and raycasting it would scatter sparks off invisible wires.
  - **`shot.hitEnemy` is what gates gameplay, not `shot.hit`.** Scenery stops bullets and throws sparks but deals no damage, awards no score, and must not flash the crosshair hitmarker — otherwise the marker fires on every shot and stops meaning anything.
  - `shot.normal` is the **world-space** surface normal, already flipped to face back toward the shooter. `face.normal` is object-local and enemies tumble, so it has to be run through a normal matrix; `_impactNormal()` does that and falls back to the reversed shot direction if a hit carries no face data.
  - **`WEAPON.muzzleOffset` is specified in screen space, not world units** — `screenX`/`screenY` are normalized device coords (`0,0` is the crosshair, `-1` is the bottom/left edge) and `forward` only sets depth. `weapon.fire()` converts them using the live `camera.fov`/`aspect`, so the muzzle holds its on-screen spot when the FOV or window changes. Expressing it as a world offset instead looks right at one FOV and drifts at every other.
  - That offset puts the muzzle ~1.3 units *below* the eye, which swings it under the floor past ~15° of downward pitch and lets the floor clip the start of the tracer. `muzzleOffset.minHeight` clamps world Y to stop that. Don't remove it without re-running the pitch sweep in the effects driver.

- **`sound.js` synthesizes everything; there are no audio assets.** Oscillators plus one shared noise buffer, via the Web Audio API. That's a deliberate match for the flat-color visuals and keeps the repo asset-free — don't add sample files without a reason.
  - **The `AudioContext` is built lazily, inside `resume()`.** Constructing one at import time leaves it suspended and logs an autoplay warning, and the drivers treat console warnings as failures. `resume()` is called from the overlay click, which is the one gesture every path (start, resume, retry) passes through.
  - `OscillatorNode`/`AudioBufferSourceNode` are single-use by spec — they can't be restarted, so each sound builds fresh ones. Unlike the effects pools, there is nothing poolable here; that is not an oversight.
  - **Damage feedback hangs off `player.onDamage`.** `enemies.js` calls `player.takeDamage()` directly and main.js never sees it, so without that hook there is nowhere to attach a hit sound. `takeDamage` only fires it when health actually drops, so a hit landing at 0 HP stays silent.
  - Death releases the pointer lock, which would otherwise fire the pause click on top of dying. `onLockChange` gates the click on `!gameOver` for that reason.

- **`minimap.js` is a 2D canvas, not three.js.** It's part of the HUD layer, drawn with the Canvas 2D API on its own `<canvas id="minimap">`; the scene never contains it and the WebGL renderer never touches it. Same reasoning as the rest of the HUD — cheaper and far easier to style than in-scene geometry. Consequently `MINIMAP` colors in `config.js` are **CSS strings**, not the `0x` literals everything else uses.
  - **The map rotates; the player doesn't.** The player sits pinned at the center pointing up and the world spins around them, so map-up is always straight ahead. That's why the view cone is drawn *fixed*, pointing up, rather than swung around by the yaw — swinging it would be the non-rotating (north-up) convention, and doing both at once is the classic way to get a radar that's subtly wrong.
  - The whole rotation is one `ctx.rotate(player.yaw)` before plotting enemies at their raw world `(dx, dz)` offsets. Positive `yaw` is the right amount in the right direction only because world `+X/+Z` map to canvas `+x/+y` and canvas rotation is clockwise; flipping either convention needs `-yaw`. Verify with the minimap driver rather than by reasoning — this sign is easy to talk yourself into.
  - Cone half-angle is the **horizontal** FOV, `atan(tan(vFov/2) * aspect)`, read from the live camera. `camera.fov` is vertical, so using it directly draws a cone narrower than what the player actually sees.
  - main.js passes `enemies.enemies` (the raw `{mesh, health}[]`), not `hitboxes()` — the latter allocates a new array via `.map()` and this runs every frame.
  - `draw()` is called **outside** the `if (running)` check, alongside `hud.update()`, so the radar stays visible behind the pause overlay instead of going blank.
  - The circular mask is CSS `border-radius: 50%` *and* a `ctx.clip()` arc. Both, deliberately: the CSS handles the rim border, the clip keeps a dot near the rim from being drawn into the square's corners. Note that a clip region survives until `restore()`, hence the `save()`/`restore()` around the whole frame.

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
- **`PointsMaterial` uses `sizeAttenuation: false`** in `effects.js`, making `EFFECTS.particleSize` a **pixel** value rather than world units. With the default world-space attenuation, muzzle sparks spawning ~0.5 units from the camera rendered as screen-filling squares. Don't "fix" this back.
- `LineBasicMaterial.linewidth` is ignored by the WebGL renderer — tracers are always 1px. That suits the look, so there's nothing to work around.
- `PointsMaterial` has no per-particle alpha, so particle fade-out is done by scaling vertex color toward black under `AdditiveBlending`. That only reads as a fade against a dark background; it would look wrong on a light one.

## Conventions

Plain ES modules, no TypeScript, no JSX, no build step beyond Vite. The HUD is DOM on top of the canvas (`hud.js`, `minimap.js`, `style.css`), not drawn in the scene — cheaper and easier to style. Comments explain *why* a boundary exists, not what a line does; match that density.
