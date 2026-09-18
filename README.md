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
| [src/hud.js](src/hud.js) | DOM crosshair and readouts |

## State: skeleton

The scaffolding runs — the arena renders, pointer lock and pause work, the loop ticks every system — but the gameplay itself is unwritten. Each stub carries `TODO` comments describing what to implement:

1. **[src/player.js](src/player.js)** — mouse look (yaw/pitch with clamped pitch), WASD movement relative to facing, arena bounds clamping.
2. **[src/enemies.js](src/enemies.js)** — spawn on a timer at a random bearing, steer toward the player on the XZ plane, damage the player on contact.
3. **[src/weapon.js](src/weapon.js)** — fire while held on a cooldown; the raycast and scoring plumbing is already wired.

Doing those three in order gets you a playable game. Everything else — hit feedback, difficulty ramp, sound, more enemy types — is on top of that.
