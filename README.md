# DoomSlop

A minimal browser FPS built on [three.js](https://threejs.org/): enemies float toward you, you shoot them. Twenty-five kills summons a boss — one of five, drawn at random and named as it arrives; kill it and the next round starts.

## Running it

Requires [Node.js](https://nodejs.org/) 20 or newer (Vite 8's floor).

```bash
npm install
npm run dev      # dev server with hot reload, serves http://localhost:5173/
npm run build    # production bundle into dist/
npm run preview  # serve the built bundle
```

The `dist/` JS bundle is ~570 kB (145 kB gzipped), nearly all of it three.js. Vite warns about the chunk size; for a single-screen game there's nothing worth code-splitting, so the warning is expected. The five boss portraits add ~2.7 MB of PNG alongside it, fetched in the background at load and long since decoded by the time a boss round arrives.

## Deploying

Live at [hoowan-dev.github.io/DoomSlop](https://hoowan-dev.github.io/DoomSlop/), published by [.github/workflows/deploy.yml](.github/workflows/deploy.yml) on every push to `main`.

Two things make that work, and the site breaks without either:

- **`dist/` is gitignored, so Pages has to be set to "GitHub Actions" as its source**, not "Deploy from a branch". A branch deploy publishes `index.html` and `src/` untransformed, and `import * as THREE from 'three'` is a bare specifier no browser can resolve — you get the static HUD markup on a black page and a module error in the console.
- **[vite.config.js](vite.config.js) sets `base: './'`**, because Pages serves the project from a `/DoomSlop/` subpath rather than a domain root. Vite's default `/` emits `/assets/index-xxx.js`, which resolves above the project and 404s. The boss portraits ride on the same setting: [src/bosses.js](src/bosses.js) reaches them with ES imports rather than literal paths, so Vite emits them into the bundle and rewrites the URLs for it. Fetching `assets/images/kyle.png` by hand would skip that and 404 under the prefix.

Neither failure is visible locally: `npm run dev` and `npm run preview` both serve from the root, where a base of `/` works fine. To actually test it, serve `dist/` behind a path prefix — that's what the `doomslop-pages.mjs` driver does.

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
| [src/rounds.js](src/rounds.js) | Round/boss state machine and announcements |
| [src/bosses.js](src/bosses.js) | The five bosses: names and portrait materials |
| [src/weapon.js](src/weapon.js) | Hitscan raycast, fire rate |
| [src/effects.js](src/effects.js) | Pooled tracer lines and spark particles |
| [src/sound.js](src/sound.js) | Synthesized sound effects (Web Audio, no asset files) |
| [src/hud.js](src/hud.js) | DOM crosshair, readouts, announcements, boss health bar, score popups |
| [src/minimap.js](src/minimap.js) | Rotating top-down radar (2D canvas) |
| [assets/images/](assets/images/) | The five boss portraits — the only asset files here |

## Playing

Click to lock the mouse, `WASD` to move, `Space` to jump, mouse to aim, hold click to fire, `Esc` to pause, `~` to skip a round. Red floaters spawn at a random bearing 25 units out and close in; each is a one-shot kill worth 100.

They don't all arrive on one plane: each spawns somewhere between 0.9 and 6 units up, so a wave comes in mixed — some skimming the floor, some dropping in from well overhead — and levels out to a shared hover height of 1.6 as it closes. The descent is tied to ground covered rather than to time, so they finish coming down just as they reach you however fast the round is running. They never dive at you; height is something they shed on the way in, not part of the chase. The one way to meet one still up high is to charge it, and since contact damage is measured on the floor plane, that hit lands anyway. Touching you costs 25 HP and consumes the enemy, so four contacts ends the run. The spawn interval tightens from 1.6s to 0.45s over the first 90 seconds.

The jump is a flat one-metre hop lasting about two thirds of a second, and you steer normally in the air. It's movement, not defense: contact damage is measured on the floor plane, so being airborne doesn't dodge anything. There's no double jump, though a tap just before you land is remembered and fires on touchdown rather than being dropped.

The game is structured in rounds, announced by a flash of large text above the crosshair and tracked after the HP and SCORE readouts, alongside a `KILLS 12/25` count of how far you are from the boss. `ROUND 1` flashes as play begins. Shoot 25 floaters and the field is swept clear, `BOSS ROUND` flashes with the boss's name under it, and a large purple boss walks into the empty arena: 50 shots to kill, worth 5000, with a small health bar floating above its head. Kill it and `ROUND 2` flashes, the floaters come back, and it repeats.

Which boss you get is a coin toss between five, drawn fresh every boss round — so the same one can turn up twice running. Its portrait is plastered across the front of the orb, a little smaller than the orb itself so a ring of purple still shows around it, and it turns to face you wherever you stand. The name in the flash is always the face that walks in.

Killing the boss refills your health to full, so each round starts clean and a long run ends to a fight rather than to accumulated scratches. Nothing else heals — floater kills don't, and neither does reaching the boss round.

Every round adds 50% to the enemies' speed, and the round flash says where you are on that ladder: `ROUND 3` with `ENEMY SPEED: 2.00x` under it. The steps are flat rather than compounding, so it reads 1.00x, 1.50x, 2.00x, 2.50x. It applies to the boss as well as the floaters, and the floaters also *arrive* that much more often — the same multiplier compresses the spawn interval, so a later round is both quicker and more crowded. Nothing else escalates — the boss always takes 50 shots and every round is the same number of kills long. There's no ceiling: by round 6 floaters are quicker than you are, and by round 10 so is the boss, after which backing away stops working.

Two things about the boss are worth knowing. It is **not** consumed when it reaches you — it has to be shot down, so it parks on you and hits for 20 HP every 1.2 seconds instead of dying on contact. It's also slower than a floater, so you can back away from it until the per-round speed step catches up with you. And only *shot* kills count toward the 25 — a floater that reaches you and vanishes costs you 25 HP and leaves the `KILLS` count where it was, the same rule the score already follows. The count hides itself during the boss fight, when there's nothing left to tally.

Every shot draws a hitscan tracer that rises from the bottom center of the screen to wherever the bullet landed, throws sparks off the muzzle, and throws hitsparks off the surface it struck — warm and bigger on an enemy, cool and paler on the floor or a wall. The arena is solid, so bullets stop at it rather than passing through; only a shot up over the open-topped walls hits nothing, and that one gets no hitsparks. Aim comes from the crosshair, not the muzzle, so the offset start point doesn't affect where shots land.

Every kill floats its payout in green — `+100` off a floater, `+5000` off the boss — rising and fading from the spot where it died, so you can see what a kill was worth without watching the score readout. It's anchored in the world, not on the screen: turn away mid-fade and it stays over the kill.

Four sound effects play: firing, killing an enemy, taking damage, and a click when you pause or resume (rising to resume, falling to pause). They're synthesized at runtime from oscillators and a noise buffer — there are no audio files to load. Audio starts on the click that locks the mouse, since browsers only allow it from a user gesture.

A circular radar in the top right shows you at the center and every enemy within 32 units as a red dot — or a larger magenta one for the boss, which is five times a floater's size — with a pale wedge for your field of view. It rotates with you: you always point up the map and the world turns around you, so a dot above center is something ahead of you and a dot inside the wedge is something you can already see.

Mouse look ignores any single mouse event that reports more than 400 pixels of movement (`INPUT.maxLookDelta`). Pointer lock occasionally reports a cursor warp as one enormous movement, which lands as the view snapping to a heading you never aimed at; 400px is well past what a hand can do in the ~10ms one event covers, so real flicks are unaffected. Unread movement is also discarded whenever pointer lock changes, so a flick that ends as you hit Esc isn't replayed when you resume.

The controls are listed permanently in the top left, including one cheat: **`~` skips to the next round.** It abandons the current round wherever you are in it — mid-fight or mid-boss — wipes the field and starts the next one, with the usual `ROUND N` flash. It pays nothing for what it skips: no score for a boss you didn't kill, and no heal, so a damaged player stays damaged. Handy for reaching round 8 without grinding for it, and it works in the deployed build too, not just in dev.

A build number sits in the bottom right, dimmer and smaller than the readouts opposite it. It's a literal in [index.html](index.html) rather than anything generated — not `package.json`'s `version`, not a git hash, not a timestamp — so bumping it is a one-line edit in the file that shows it, and that's the only place it appears.

All balance numbers live in [src/config.js](src/config.js) — that's the file to edit if it's too easy or too hard. Effect tuning (tracer lifetime, spark counts, colors, gravity) is in the `EFFECTS` block there; pitches, durations and volume are in `SOUND`, where `masterVolume` turns everything down at once; the radar's size, range and colors are in `MINIMAP`; the score popups' lifetime, rise and pool size are in `POPUP` (their green is in `style.css`). `ENEMY.spawnHeightMin`/`spawnHeightMax` are the height band — set them both to `hoverHeight` for the old flat behaviour, or widen them for more vertical chaos, keeping both ends clear of the floor and the walls by the enemy radius. The boss's own stats are in `BOSS` (it has every field `ENEMY` does, plus `attackInterval` and `portraitScale`, the fraction of the orb its face covers; its height band is deliberately pinned to its hover height, so its entrance stays staged), and `ROUNDS.killsPerRound` is the kill quota — drop it to 5 if you want to see the boss without grinding for it. `ROUNDS.speedStep` is the 0.5 added per round, covering enemy speed and spawn rate together; set it to 0 for a flat difficulty curve, or 0.15 for a gentler climb.

## Not implemented

Weapon variety, a persistent high score, and mobile/touch controls. There are two enemy tiers (floater and boss) and no more planned — the five bosses are one tier wearing five faces, identical in health, speed and payout. Adding a sixth is dropping a PNG into [assets/images/](assets/images/) and a line into [src/bosses.js](src/bosses.js). Boss health and the kill quota don't scale with the round either — `ROUNDS.speedStep` is the only thing that does, driving enemy speed and spawn rate together, alongside the within-round floater spawn ramp. The arena is also a bare box — no cover, no level geometry.
