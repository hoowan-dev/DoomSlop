# DoomSlop

A minimal browser FPS built on [three.js](https://threejs.org/): enemies float toward you, you shoot them.

## Running it

Requires [Node.js](https://nodejs.org/) 20 or newer (Vite 8's floor).

```bash
npm install
npm run dev      # dev server with hot reload, serves http://localhost:5173/
npm run build    # production bundle into dist/
npm run preview  # serve the built bundle
```

The `dist/` JS bundle is ~540 kB (135 kB gzipped), nearly all of it three.js. Vite warns about the chunk size; for a single-screen game there's nothing worth code-splitting, so the warning is expected.

## Layout

| File | Responsibility |
| --- | --- |
| [index.html](index.html) | Canvas, HUD markup, click-to-start overlay |
| [src/main.js](src/main.js) | Renderer/scene setup, game loop, pause + game-over flow |
| [src/config.js](src/config.js) | All tunable numbers (speeds, damage, spawn rates) |
| [src/world.js](src/world.js) | Arena floor, walls, lighting |
| [src/input.js](src/input.js) | Pointer lock, held keys, mouse deltas |
| [src/player.js](src/player.js) | Camera-as-player, look/move state, health |
| [src/enemies.js](src/enemies.js) | Spawning, movement, contact damage, death |
| [src/weapon.js](src/weapon.js) | Hitscan raycast, fire rate |
| [src/effects.js](src/effects.js) | Pooled tracer lines and spark particles |
| [src/sound.js](src/sound.js) | Synthesized sound effects (Web Audio, no asset files) |
| [src/hud.js](src/hud.js) | DOM crosshair and readouts |
| [src/minimap.js](src/minimap.js) | Rotating top-down radar (2D canvas) |

## Playing

Click to lock the mouse, `WASD` to move, mouse to aim, hold click to fire, `Esc` to pause. Red floaters spawn at a random bearing 25 units out and close in; each is a one-shot kill worth 100. Touching you costs 25 HP and consumes the enemy, so four contacts ends the run. The spawn interval tightens from 1.6s to 0.45s over the first 90 seconds.

Every shot draws a hitscan tracer that rises from the bottom center of the screen to wherever the bullet landed, throws sparks off the muzzle, and throws hitsparks off the surface it struck — warm and bigger on an enemy, cool and paler on the floor or a wall. The arena is solid, so bullets stop at it rather than passing through; only a shot up over the open-topped walls hits nothing, and that one gets no hitsparks. Aim comes from the crosshair, not the muzzle, so the offset start point doesn't affect where shots land.

Four sound effects play: firing, killing an enemy, taking damage, and a click when you pause or resume (rising to resume, falling to pause). They're synthesized at runtime from oscillators and a noise buffer — there are no audio files to load. Audio starts on the click that locks the mouse, since browsers only allow it from a user gesture.

A circular radar in the top right shows you at the center and every enemy within 32 units as a red dot, with a pale wedge for your field of view. It rotates with you: you always point up the map and the world turns around you, so a dot above center is something ahead of you and a dot inside the wedge is something you can already see.

All balance numbers live in [src/config.js](src/config.js) — that's the file to edit if it's too easy or too hard. Effect tuning (tracer lifetime, spark counts, colors, gravity) is in the `EFFECTS` block there; pitches, durations and volume are in `SOUND`, where `masterVolume` turns everything down at once; the radar's size, range and colors are in `MINIMAP`.

## Not implemented

Multiple enemy types, weapon variety, a persistent high score, and mobile/touch controls. The arena is also a bare box — no cover, no level geometry.
