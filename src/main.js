import * as THREE from 'three';
import { createWorld } from './world.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { EnemyManager } from './enemies.js';
import { PickupManager } from './pickups.js';
import { Weapon } from './weapon.js';
import { Effects } from './effects.js';
import { Sound } from './sound.js';
import { Hud } from './hud.js';
import { Minimap } from './minimap.js';
import { Rounds } from './rounds.js';
import { Portals } from './portals.js';
import { EFFECTS, PICKUP } from './config.js';
import * as config from './config.js';

// Bootstrap + game loop. Everything else hangs off here.

const canvas = document.getElementById('game');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 200);

const world = createWorld(scene);
const input = new Input(canvas);
const player = new Player(camera, input, world);
const hud = new Hud(camera);
const minimap = new Minimap(camera);

let score = 0;
const enemies = new EnemyManager(scene, player);
const pickups = new PickupManager(scene, player);
// Before Effects rather than after for no reason at all *except* one: both add lights
// to the scene at construction, and the count they add up to is what gets compiled
// into every material's shader. Either order is fine as long as both happen before the
// first render, which is the actual invariant (see effects.js).
// The renderer and camera are for the previews only: a portal draws the far side
// into its own target, through the player's own projection, which is what makes the
// square read as a window rather than a screen. See _aimView() in portals.js.
const portals = new Portals(scene, player, renderer, camera);
const effects = new Effects(scene);
const sound = new Sound();

// What a drop does. Every part of it is here rather than in pickups.js, which knows
// only that an item was taken: the pools are the player's, the sound is sound.js's,
// and the message is the HUD's. Same shape as the kill hook below — the manager
// reports, main.js decides what it means.
//
// Which item it was comes off `pickup.kind`, the same pointer-at-a-config-block an
// enemy carries. This branch *is* the drop table's semantics, and it's the whole of
// what an item type costs on the drop side: everything about being a floating,
// bobbing, expiring, collectable cube is already shared. The boots cost more than the
// armor cube did, but not here — the extra was a timer on the player and a row on the
// HUD, neither of which is anything to do with being a drop.
pickups.onCollect = (pickup) => {
  if (pickup.kind === PICKUP.armor) {
    // "+50 AP, capped at 50" is a refill from any starting value, so it's the same
    // all-or-nothing shape as the heal below. The blue flash is raised here rather
    // than from a player.onArmor hook because this is armor's only source — onHeal
    // exists to cover two callers (a medkit and a boss dying), and there's no second
    // one to cover here.
    player.refillArmor();
    sound.itemPickup();
    hud.notice('AP RESTORED', 'armor');
    hud.vignette('armor');
    return;
  }

  if (pickup.kind === PICKUP.boots) {
    // Both numbers come off the face block and are handed over, because the player
    // knows nothing about drops — the same arrangement as the two refills, where
    // main.js is the only thing that knows what walking over a cube means. The
    // multiplier is applied to speed and to jump *height*; player.js takes the square
    // root that second one needs.
    player.boost(PICKUP.boots.boost, PICKUP.boots.duration);
    sound.itemPickup();
    hud.notice('SUPER BOOTS', 'boots');
    hud.vignette('boots');
    return;
  }

  // The same all-or-nothing refill a boss kill pays out. Deliberately reused rather
  // than a partial heal: nothing in the game restores a fraction of the bar.
  // The green vignette is deliberately *not* here: it hangs off player.onHeal
  // below, so the refill after a boss dies flashes it too without rounds.js
  // needing to know the HUD exists.
  player.refillHealth();
  sound.itemPickup();
  hud.notice('HP RESTORED');
};

// The round loop. It drives enemies (wiping the field, gating spawns, summoning
// the boss) and the player (refilling health after a boss), and reports its
// announcements back out — so it needs them, but nothing needs it.
const rounds = new Rounds(enemies, player, portals, (text, sub) => hud.announce(text, sub));

// Damage originates in enemies.js, which never sees main.js — the hook is how
// feedback for a hit gets attached without enemies or the player knowing about the
// sound or the HUD.
player.onDamage = (amount, source) => {
  sound.playerDamaged();
  hud.vignette('damage');

  // Where it came from, as an angle around the crosshair. The bearing is the
  // player's to compute (it needs yaw and position) and the wedge is the HUD's to
  // draw, so this is the seam between them. `source` is the attacker's live
  // position vector and a floater is removed the instant after it hits, which is
  // why it's read here and now rather than stored.
  if (source) hud.hitFrom(player.bearingTo(source));
};

// The same edge-of-screen pulse, in green. On refillHealth() rather than on the two
// things that call it, which is what makes one line cover both a medkit and the
// refill for putting a boss down — rounds.js owns that second one and has no HUD
// access, deliberately. Red and green are one element flashing two colors, so the
// green can't read as anything but the opposite of the red.
player.onHeal = () => hud.vignette('heal');

// Stepping through a portal. Same shape as every other hook here: portals.js moved the
// player and reports that it did, and this is the only line in the codebase that knows
// a traversal makes a noise. Nothing is passed — there's nothing about *which* pair of
// walls was involved that the sound could use.
portals.onTraverse = () => sound.teleport();

// Likewise for kills: enemies.js reports a shot death, rounds.js counts it.
// Routing it through here keeps the two from knowing about each other.
enemies.onDefeat = (enemy) => {
  rounds.enemyDefeated(enemy);
  // The score popup needs both the payout and where to float it from, and this is
  // the only hook that carries the dead enemy itself — weapon's onKill gets the
  // points but not the position. Reported before the mesh is garbage.
  hud.scorePopup(enemy.kind.scoreValue, enemy.mesh.position);
  // The drop roll. Hanging it off this hook rather than off remove() is what gives
  // it the right rules for free: onDefeat fires only from damage(), so a floater
  // that reaches the player and a field wiped between rounds leave nothing behind.
  // You have to actually kill them — the same rule the score and the round count
  // already follow.
  pickups.maybeDrop(enemy.mesh.position);
};

const weapon = new Weapon(
  camera,
  enemies,
  world.solids,
  (earned) => {
    score += earned;
    sound.enemyKilled();
  },
  (shot) => {
    sound.shoot();
    // Hitmarker stays enemy-only. Shots also land on the floor and walls now, so
    // flashing it on every impact would drain it of meaning.
    hud.shotFired(shot.hitEnemy);
    effects.tracer(shot.muzzle, shot.endpoint);

    // The room lights up too, not just the streak. Same point the tracer starts
    // from, which is under and ahead of the eye.
    effects.muzzleFlash(shot.muzzle);

    // Sparks off the muzzle on every shot, sprayed forward.
    effects.burst(shot.muzzle, shot.direction, EFFECTS.muzzleSparks, EFFECTS.sparkColor);

    // Hitsparks wherever the bullet landed, sprayed off the surface normal.
    // Enemies get a bigger, warmer burst than scenery so kills still read.
    if (shot.hit) {
      effects.burst(
        shot.hit.point,
        shot.normal,
        shot.hitEnemy ? EFFECTS.impactSparks : EFFECTS.worldImpactSparks,
        shot.hitEnemy ? EFFECTS.impactColor : EFFECTS.worldImpactColor
      );
    }
  }
);

let running = false;
let gameOver = false;

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// Pointer lock drives pause: locked means playing, unlocked means paused.
hud.overlayEl.addEventListener('click', () => {
  // Browsers only allow audio to start from a user gesture, and this click is
  // the one the game always passes through — to start, to resume, and to retry.
  sound.resume();
  if (gameOver) restart();
  input.requestLock();
});

input.onLockChange = (locked) => {
  running = locked;
  if (locked) {
    hud.hideOverlay();
    sound.click(true);
  } else if (!gameOver) {
    hud.showOverlay('PAUSED', 'Click to resume');
    sound.click(false);
  }
  // Death also releases the lock, but endGame() owns that feedback — a pause
  // click on top of dying would read as the game acknowledging a keypress.
};

function restart() {
  // enemies.clear() first: it sweeps the field (including a live boss) without
  // reporting defeats, so rounds.reset() lands on an empty arena with no kills
  // credited for the wipe.
  enemies.clear();
  // The only caller: drops survive round changes on purpose, so this is the one
  // place a live one is ever swept off the floor.
  pickups.clear();
  effects.clear();
  hud.clearPopups();
  player.reset();
  rounds.reset();
  score = 0;
  gameOver = false;
}

function endGame() {
  gameOver = true;
  running = false;
  document.exitPointerLock();
  hud.showOverlay('YOU DIED', `Score ${score} — click to retry`);
}

// Timer (not the deprecated Clock) — connect() wires up the Page Visibility
// API so a backgrounded tab resumes with a sane delta instead of a huge one.
const timer = new THREE.Timer();
timer.connect(document);

function frame() {
  requestAnimationFrame(frame);

  timer.update();
  // Belt and suspenders on top of Timer's visibility handling: a single long
  // frame (GC pause, slow hitch) shouldn't tunnel anything through a wall.
  const dt = Math.min(timer.getDelta(), 0.1);

  if (running) {
    // Skip-round cheat. Read here rather than in input.js because "~ means skip a
    // round" is gameplay meaning, and input.js only reports hardware — it hands
    // over the edge, main.js decides what it's for. Before rounds.update() so the
    // flash it queues flushes on this frame instead of the next.
    if (input.consumePress('Backquote')) rounds.skip();

    // Music toggle, same shape as the skip above: input.js reports that a key went
    // down and main.js is the only thing that knows M means music. The press edge
    // and not isDown(), or one tap would toggle once per frame and land on whichever
    // state the frame count happened to leave it in. Only drained while running, so
    // like the skip it does nothing at the pause screen — presses are cleared when
    // pointer lock drops, so a tap there can't fire on the frame after resume.
    if (input.consumePress('KeyM')) sound.toggleMusic();

    player.update(dt);
    // Straight after the move that could have walked into one, and before everything
    // that reads where the player is: the enemies steer at the position they came out
    // at, the weapon fires from it, and the drop under the exit is collectable on the
    // same frame. It takes no dt — a traversal is a position test, not a timer.
    portals.update();
    enemies.update(dt);
    weapon.update(dt, input.firing);
    // After weapon.update, so a drop rolled by a kill this frame is on the floor and
    // bobbing at its hover height before it's ever drawn — spawned at the kill's X/Z,
    // it would otherwise paint one frame unmoved. Before the death check below, so
    // walking onto a medkit on the frame a floater lands its hit still saves you.
    pickups.update(dt);
    // After weapon.update, so a kill scored this frame advances the round this
    // frame rather than next. Only called while running, which is what keeps the
    // inter-round timers paused with the game.
    rounds.update(dt);
    // After weapon.update so a shot fired this frame renders its tracer
    // immediately rather than a frame late. Same for the score popups: a popup
    // spawned by a kill this frame has to be placed before it's shown, or it
    // paints once in the top-left corner.
    effects.update(dt);
    hud.updatePopups(dt);

    if (player.isDead()) endGame();
  }

  // Outside the running check, like the HUD: these stay drawn while paused
  // instead of going blank behind the overlay.
  hud.update(player.health, player.armor, score, rounds.label, rounds.progress);
  // Outside the running check like the rest of the HUD, so the row stays on screen
  // behind the pause overlay. It doesn't tick there — the countdown lives in
  // player.update() — so a paused buff holds its remaining seconds rather than
  // draining while the game is stopped.
  hud.updateBoost(player.boostTime, player.boostDuration);
  hud.updateBoss(enemies.boss);
  // Outside the running check like the rest of the HUD, so the row reads correctly
  // behind the pause overlay and on the start screen — which is where a player who
  // hasn't noticed the game is silent will be looking for it. The sound system owns
  // the state; this just reports it, and the HUD's own change cache means reading it
  // every frame costs a comparison.
  hud.updateMusic(sound.musicEnabled);
  // All three raw arrays, not hitboxes() — that allocates one per call, and this runs
  // every frame. Same shape as updateGlows below, for the same reason.
  minimap.draw(player, enemies.enemies, pickups.pickups, portals.portals);
  // The raw enemy array, like minimap.draw takes — hitboxes() would allocate one
  // every frame. Two arrays rather than one joined: the pools are separate, and
  // concatenating would allocate here too. After enemies.update()/pickups.update() so
  // the glows sit where the meshes ended up, and before render() so the light
  // positions are picked up this frame.
  effects.updateGlows(enemies.enemies, pickups.pickups, player.position);

  // Each portal's view of the far side, drawn into its own render target. Outside the
  // running check like the glows and the radar, so a doorway keeps showing the room it
  // leads to behind the pause overlay instead of freezing on a stale frame. Last before
  // the real render, because it renders too — it reads the camera player.update() moved
  // and it leaves the render target set back to the canvas for the line below.
  portals.renderViews();

  renderer.render(scene, camera);
}

// Dev-only handle for poking at game state from the console or a headless
// driver. `import.meta.env.DEV` is statically false in a production build, so
// Vite strips this block entirely.
if (import.meta.env.DEV) {
  window.__game = {
    player,
    enemies,
    pickups,
    weapon,
    effects,
    sound,
    hud,
    minimap,
    rounds,
    portals,
    input,
    // Live-tweakable: the config objects are read at use time, so changing a
    // value here takes effect on the next frame. Handy for balancing by hand.
    config,
    getScore: () => score,
    isRunning: () => running,
    isGameOver: () => gameOver,
  };
}

frame();
