import * as THREE from 'three';
import { createWorld } from './world.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { EnemyManager } from './enemies.js';
import { Weapon } from './weapon.js';
import { Effects } from './effects.js';
import { Sound } from './sound.js';
import { Hud } from './hud.js';
import { Minimap } from './minimap.js';
import { Rounds } from './rounds.js';
import { EFFECTS } from './config.js';
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
const effects = new Effects(scene);
const sound = new Sound();

// The round loop. It drives enemies (wiping the field, gating spawns, summoning
// the boss) and the player (refilling health after a boss), and reports its
// announcements back out — so it needs them, but nothing needs it.
const rounds = new Rounds(enemies, player, (text, sub) => hud.announce(text, sub));

// Damage originates in enemies.js, which never sees main.js — the hook is how
// feedback for a hit gets attached without enemies or player knowing about sound.
player.onDamage = () => sound.playerDamaged();

// Likewise for kills: enemies.js reports a shot death, rounds.js counts it.
// Routing it through here keeps the two from knowing about each other.
enemies.onDefeat = (enemy) => {
  rounds.enemyDefeated(enemy);
  // The score popup needs both the payout and where to float it from, and this is
  // the only hook that carries the dead enemy itself — weapon's onKill gets the
  // points but not the position. Reported before the mesh is garbage.
  hud.scorePopup(enemy.kind.scoreValue, enemy.mesh.position);
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

    player.update(dt);
    enemies.update(dt);
    weapon.update(dt, input.firing);
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
  hud.update(player.health, score, rounds.label, rounds.progress);
  hud.updateBoss(enemies.boss);
  minimap.draw(player, enemies.enemies);
  // The raw enemy array, like minimap.draw takes — hitboxes() would allocate one
  // every frame. After enemies.update() so the glows sit where the meshes ended up,
  // and before render() so the light positions are picked up this frame.
  effects.updateGlows(enemies.enemies, player.position);

  renderer.render(scene, camera);
}

// Dev-only handle for poking at game state from the console or a headless
// driver. `import.meta.env.DEV` is statically false in a production build, so
// Vite strips this block entirely.
if (import.meta.env.DEV) {
  window.__game = {
    player,
    enemies,
    weapon,
    effects,
    sound,
    hud,
    minimap,
    rounds,
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
