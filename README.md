# DoomSlop

A minimal browser FPS built on [three.js](https://threejs.org/): enemies float toward you, you shoot them. Twenty-five kills summons a boss — one of five, drawn at random and named as it arrives; kill it and the next round starts.

## Running it

Requires [Node.js](https://nodejs.org/) 20 or newer (Vite 8's floor).

```bash
./start.sh       # install if needed, serve http://localhost:5173/, open a browser on it
```

That's the whole setup. It's a wrapper around the npm scripts below, which still work on their own:

```bash
npm install
npm run dev      # dev server with hot reload, serves http://localhost:5173/
npm run build    # production bundle into dist/
npm run preview  # serve the built bundle
```

[start.sh](start.sh) pins the port rather than letting Vite pick the next free one, so the URL above is the URL you get or an error saying why not. Pass `--no-open` to leave the browser alone, and `Ctrl-C` to stop the server.

The `dist/` JS bundle is ~590 kB (149 kB gzipped), nearly all of it three.js. Vite warns about the chunk size; for a single-screen game there's nothing worth code-splitting, so the warning is expected. The five boss portraits add ~2.7 MB of PNG alongside it, fetched in the background at load and long since decoded by the time a boss round arrives. The music is a 2.4 MB mp3 that is *not* fetched at load — it's off by default, so nothing downloads it until you press `M`.

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
| [src/world.js](src/world.js) | Arena floor, walls, lighting, and the walls-only shell the portals show |
| [src/input.js](src/input.js) | Pointer lock, held keys, mouse deltas |
| [src/player.js](src/player.js) | Camera-as-player, look/move/lean state, health and armor |
| [src/enemies.js](src/enemies.js) | Spawning, movement, contact damage, death |
| [src/pickups.js](src/pickups.js) | Dropped health, armor and boots cubes |
| [src/glow.js](src/glow.js) | The halo sprite shared by enemies and drops |
| [src/rounds.js](src/rounds.js) | Round/boss state machine and announcements |
| [src/bosses.js](src/bosses.js) | The five bosses: names and portrait materials |
| [src/weapon.js](src/weapon.js) | Hitscan raycast, fire rate |
| [src/effects.js](src/effects.js) | Pooled tracer lines and spark particles |
| [src/sound.js](src/sound.js) | Synthesized sound effects, plus the looped music bed |
| [src/hud.js](src/hud.js) | DOM crosshair, readouts, announcements, boss health bar, score popups |
| [src/minimap.js](src/minimap.js) | Rotating top-down radar (2D canvas) |
| [src/portals.js](src/portals.js) | The two wall portals: placement, the traversal test, and the view through each |
| [assets/images/](assets/images/) | The six boss portraits |
| [assets/audio/](assets/audio/) | The music bed — the only other asset file here |

## Playing

Click to lock the mouse, `WASD` to move, `Space` to jump, mouse to aim, hold click to fire, `Esc` to pause, `M` for music, `~` to skip a round. Strafing leans the view a couple of degrees into the press and levels it out when you let go — the only thing in the game that tilts the horizon, and it doesn't move your aim. Red floaters spawn at a random bearing 25 units out and close in; each is a one-shot kill worth 100.

They don't all arrive on one plane: each spawns somewhere between 0.9 and 6 units up, so a wave comes in mixed — some skimming the floor, some dropping in from well overhead — and levels out to a shared hover height of 1.6 as it closes. The descent is tied to ground covered rather than to time, so they finish coming down just as they reach you however fast the round is running. They never dive at you; height is something they shed on the way in, not part of the chase. The one way to meet one still up high is to charge it, and since contact damage is measured on the floor plane, that hit lands anyway. Touching you costs 25 HP and consumes the enemy, so four contacts ends the run. The spawn interval tightens from 1.6s to 0.45s over the first 90 seconds.

The jump is a flat one-metre hop lasting about two thirds of a second, and you steer normally in the air. It's movement, not defense: contact damage is measured on the floor plane, so being airborne doesn't dodge anything. There's no double jump, though a tap just before you land is remembered and fires on touchdown rather than being dropped.

The game is structured in rounds, announced by a flash of large text above the crosshair and tracked after the HP and SCORE readouts, alongside a `KILLS 12/25` count of how far you are from the boss. `ROUND 1` flashes as play begins. Shoot 25 floaters and the field is swept clear, `BOSS ROUND` flashes with the boss's name under it, and a large purple boss walks into the empty arena: 50 shots to kill, worth 5000, with a small health bar floating above its head. Kill it and `ROUND 2` flashes, the floaters come back, and it repeats.

Which boss you get is a coin toss between six, drawn fresh every boss round — so the same one can turn up twice running. Its portrait is plastered across the front of the orb, a little smaller than the orb itself so a ring of purple still shows around it, and it turns to face you wherever you stand. The name in the flash is always the face that walks in.

Two sections of the walls are portals: a glowing cyan doorway with a haze of blue spilling onto the wall and floor around it, and inside the square you can see the far side of the arena. Walk into one and you come out of the other, stepping into the arena off that wall with the heading you walked in with — so a portal in the wall behind you is a shortcut across the map, and the one chasing you has to take the long way. They're placed on two different walls at the start of every round, including after a retry and after a `~` skip, so the pair of shortcuts you learn lasts exactly one round. Bullets pass straight through the square, and so does a jump: taking one mid-hop keeps your arc. Stepping through plays a rising sci-fi whoosh — a pair of detuned tones climbing three octaves over a rush of swept noise.

The view inside the square is the real thing, not a picture: it's rendered from where your eye would be if you were standing on the far side, so walking past a portal shifts what's in it the way a window does and not the way a television does. It shows the **walls only** — no enemies, no drops, no glows — which is deliberate as well as cheap: what the doorway is for is telling you *where* you'd come out, and a floater drifting across it would be a threat you can't shoot. The far room is drawn a little brighter than it honestly would be, or the opening reads as more wall.

Killing the boss refills your health to full, so each round starts clean and a long run ends to a fight rather than to accumulated scratches. Your armor is left alone — that's earned, not handed back.

Shot kills sometimes leave something behind: a glowing cube that hovers, bobs and turns on the spot for 22 seconds, then shrinks away. Walk over it to take it. A green cross refills your health, a blue shield fills a 50-point armor pool that soaks damage ahead of it, and a yellow boot is SUPER BOOTS — triple move speed and triple jump *height* for 15 seconds, shown as a draining bar while it lasts. A second pair mid-buff restarts the clock rather than stacking. About one kill in seven drops something — four or five a round — and the roll for which of the three you get is weighted: armor is a minority of drops because health gets you out of trouble you're already in, and the boots are rarest because they're the only one that changes how the game plays rather than what the bars read. A drop survives a round change, so one saved from the end of a round is still there for the boss fight — but nothing survives a retry. Contact deaths and the between-round sweep drop nothing; you have to actually shoot them.

Health and armor are drawn as a pair of labelled bars at the bottom center of the screen, armor above health in the order damage comes off them, because at 18px in the corner health was being missed until the screen went red. Taking a hit flashes a red vignette and throws up a wedge around the crosshair pointing at whatever hit you; a heal flashes green, armor blue and the boots yellow, which is the same "look at your readouts" signal pointing in four directions.

Every round adds 50% to the enemies' speed, and the round flash says where you are on that ladder: `ROUND 3` with `ENEMY SPEED: 2.00x` under it. The steps are flat rather than compounding, so it reads 1.00x, 1.50x, 2.00x, 2.50x. It applies to the boss as well as the floaters, and the floaters also *arrive* that much more often — the same multiplier compresses the spawn interval, so a later round is both quicker and more crowded. Nothing else escalates — the boss always takes 50 shots and every round is the same number of kills long. There's no ceiling: by round 6 floaters are quicker than you are, and by round 10 so is the boss, after which backing away stops working.

Two things about the boss are worth knowing. It is **not** consumed when it reaches you — it has to be shot down, so it parks on you and hits for 20 HP every 1.2 seconds instead of dying on contact. It's also slower than a floater, so you can back away from it until the per-round speed step catches up with you. And only *shot* kills count toward the 25 — a floater that reaches you and vanishes costs you 25 HP and leaves the `KILLS` count where it was, the same rule the score already follows. The count hides itself during the boss fight, when there's nothing left to tally.

Every shot draws a hitscan tracer that rises from the bottom center of the screen to wherever the bullet landed, throws sparks off the muzzle, and throws hitsparks off the surface it struck — warm and bigger on an enemy, cool and paler on the floor or a wall. The arena is solid, so bullets stop at it rather than passing through; only a shot up over the open-topped walls hits nothing, and that one gets no hitsparks. Aim comes from the crosshair, not the muzzle, so the offset start point doesn't affect where shots land.

Everything dangerous or worth having burns: each enemy carries a halo around its body and throws a pool of colored light on the floor under it — red for a floater, purple for the boss — and so does every drop, in its own color. Shooting throws a brief flash of light off the muzzle, and each portal stands in its own wash of blue. One enemy's glow never lands on another: a crowd of floaters would otherwise wash each other flat and stop being countable, which is the one thing the glow exists to help with. Everything *else* does reach them — an enemy lights up when you fire at it and warms as it drifts over a drop — so the flash still reads as a flash on the thing you're shooting. The twelve nearest enemies get one, since the pool is fixed and a distant enemy holding a light while one in your face has none is the only arrangement you'd notice.

Every kill floats its payout in green — `+100` off a floater, `+5000` off the boss — rising and fading from the spot where it died, so you can see what a kill was worth without watching the score readout. It's anchored in the world, not on the screen: turn away mid-fade and it stays over the kill.

Six sound effects play: firing, killing an enemy, taking damage, a swelling choir when you pick something up, a rising whoosh when you take a portal, and a click when you pause or resume (rising to resume, falling to pause). They're synthesized at runtime from oscillators and a noise buffer — no audio files involved. Audio starts on the click that locks the mouse, since browsers only allow it from a user gesture.

The music is the one exception, and the one audio file: a looped segment of an mp3, off by default and toggled with `M` — the top-left panel shows which it is. Turning it on always starts the loop from the top rather than resuming where it left off, and once on it plays through pausing, dying and retrying without restarting. The loop is sample-accurate and gapless, which is why it's decoded into a buffer on the first press (a few hundred milliseconds, once) rather than played from an `<audio>` element.

A circular radar in the top right shows you at the center and every enemy within 32 units as a red dot — or a larger magenta one for the boss, which is five times a floater's size — with a pale wedge for your field of view. Drops show up too, as small upright glyphs rather than more colors of dot: a green cross, a blue shield, a yellow boot, each the symbol painted on the cube you're walking over to collect. They stay square to the screen as the map turns, and they're drawn *under* the enemy dots — a drop briefly covered costs nothing, where a closing floater hidden under a medkit gets you killed. It rotates with you: you always point up the map and the world turns around you, so a dot above center is something ahead of you and a dot inside the wedge is something you can already see.

The arena's four walls are drawn on it too, as a faint grey box you move around inside, with each portal a short cyan segment set into the wall it's cut from — the same cyan the doorway glows. That box is the only fixed thing on the radar, and it's what makes the circle a *position* rather than a window: being backed into a corner, and which way the nearest portal is, are now things you can read at a glance instead of having to turn around and look.

Mouse look ignores any single mouse event that reports more than 400 pixels of movement (`INPUT.maxLookDelta`). Pointer lock occasionally reports a cursor warp as one enormous movement, which lands as the view snapping to a heading you never aimed at; 400px is well past what a hand can do in the ~10ms one event covers, so real flicks are unaffected. Unread movement is also discarded whenever pointer lock changes, so a flick that ends as you hit Esc isn't replayed when you resume.

The controls are listed permanently in the top left, including one cheat: **`~` skips to the next round.** It abandons the current round wherever you are in it — mid-fight or mid-boss — wipes the field and starts the next one, with the usual `ROUND N` flash. It pays nothing for what it skips: no score for a boss you didn't kill, and no heal, so a damaged player stays damaged. Handy for reaching round 8 without grinding for it, and it works in the deployed build too, not just in dev.

A build number sits in the bottom right, dimmer and smaller than the readouts opposite it. It's a literal in [index.html](index.html) rather than anything generated — not `package.json`'s `version`, not a git hash, not a timestamp — so bumping it is a one-line edit in the file that shows it, and that's the only place it appears.

All balance numbers live in [src/config.js](src/config.js) — that's the file to edit if it's too easy or too hard. Effect tuning (tracer lifetime, spark counts, colors, gravity) is in the `EFFECTS` block there; pitches, durations and volume are in `SOUND`, where `masterVolume` turns everything down at once; the radar's size, range and colors are in `MINIMAP`, including `wallColor`/`wallThickness` for the arena box (dim on purpose — it's the backdrop, not a readout) and `portalColor`/`portalThickness` for the cyan segments, which are worth making *heavier* rather than longer if they're hard to spot, since a segment's ends are where the doorway's edges actually are; the score popups' lifetime, rise and pool size are in `POPUP` (their green is in `style.css`). `ENEMY.spawnHeightMin`/`spawnHeightMax` are the height band — set them both to `hoverHeight` for the old flat behaviour, or widen them for more vertical chaos, keeping both ends clear of the floor and the walls by the enemy radius. The boss's own stats are in `BOSS` (it has every field `ENEMY` does, plus `attackInterval` and `portraitScale`, the fraction of the orb its face covers; its height band is deliberately pinned to its hover height, so its entrance stays staged), and `ROUNDS.killsPerRound` is the kill quota — drop it to 5 if you want to see the boss without grinding for it. `ROUNDS.speedStep` is the 0.5 added per round, covering enemy speed and spawn rate together; set it to 0 for a flat difficulty curve, or 0.15 for a gentler climb. The drops are in `PICKUP`: `dropChance` is whether anything falls and `armorShare`/`bootsShare` split what it is (health is whatever's left over), with each cube's colors, glow and — for the boots — `duration` and `boost` on its own sub-block. `PLAYER.maxArmor` is the size of the armor pool, and `PLAYER.strafeRoll`/`strafeRollSpeed` are the strafe lean's angle and how fast it eases; a few degrees is a lean and eight is a list, so that one wants keeping small. The portals are in `PORTAL`: `size` is the doorway, `depth` how close counts as stepping through, `exitOffset` how far into the room you arrive — that last one **has to stay bigger than `depth`**, or you arrive inside the exit's own trigger and bounce between the pair — plus `margin` to keep them out of the corners and a `glow` block shaped like every other one in the file. `PORTAL.view` is the picture inside the square: `resolution` is the fraction of the screen each preview is rendered at and is the **one to turn down** if the game feels heavy, since two extra renders are paid for per screen pixel; `tint` is how much cyan is washed over the view; `brightness` is how far the far room sits above the fog, and it's the number to raise if a doorway reads as solid wall. The teleport sound is `SOUND.teleport` — `pitchFrom`/`pitchTo` are the climb, `detune` is how far the two tones sit apart, and the `noise*` fields are the rush of air under them. `EFFECTS.glowPool` is how many enemies can be lit at once — the number to turn *down* if a machine struggles, since the lights are paid for per screen pixel.

## Not implemented

Weapon variety, a persistent high score, and mobile/touch controls. There are two enemy tiers (floater and boss) and no more planned — the six bosses are one tier wearing six faces, identical in health, speed and payout. Adding a seventh is dropping a PNG into [assets/images/](assets/images/) and a line into [src/bosses.js](src/bosses.js). Boss health and the kill quota don't scale with the round either — `ROUNDS.speedStep` is the only thing that does, driving enemy speed and spawn rate together, alongside the within-round floater spawn ramp. The arena is also a bare box — no cover, no level geometry. The portals are the one thing in the walls, and they're mounted flat against them rather than standing in the room for exactly that reason: several things here (the boss's face drawing through its own body, a doorway that stops no bullets, contact measured on the floor plane) assume nothing can get between you and what you're shooting at.
