import * as THREE from 'three';
import { createWorld } from './world.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { EnemyManager } from './enemies.js';
import { Weapon } from './weapon.js';
import { Effects } from './effects.js';
import { Hud } from './hud.js';
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
const hud = new Hud();

let score = 0;
const enemies = new EnemyManager(scene, player);
const effects = new Effects(scene);

const weapon = new Weapon(
  camera,
  enemies,
  world.solids,
  (earned) => {
    score += earned;
  },
  (shot) => {
    // Hitmarker stays enemy-only. Shots also land on the floor and walls now, so
    // flashing it on every impact would drain it of meaning.
    hud.shotFired(shot.hitEnemy);
    effects.tracer(shot.muzzle, shot.endpoint);

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
  if (gameOver) restart();
  input.requestLock();
});

input.onLockChange = (locked) => {
  running = locked;
  if (locked) hud.hideOverlay();
  else if (!gameOver) hud.showOverlay('PAUSED', 'Click to resume');
};

function restart() {
  enemies.clear();
  effects.clear();
  player.reset();
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
    player.update(dt);
    enemies.update(dt);
    weapon.update(dt, input.firing);
    // After weapon.update so a shot fired this frame renders its tracer
    // immediately rather than a frame late.
    effects.update(dt);

    if (player.isDead()) endGame();
  }

  hud.update(player.health, score);
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
