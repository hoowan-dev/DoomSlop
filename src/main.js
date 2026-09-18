import * as THREE from 'three';
import { createWorld } from './world.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { EnemyManager } from './enemies.js';
import { Weapon } from './weapon.js';
import { Hud } from './hud.js';

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
const weapon = new Weapon(camera, enemies, (earned) => {
  score += earned;
});

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

const clock = new THREE.Clock();

function frame() {
  requestAnimationFrame(frame);

  // Clamp dt so a backgrounded tab doesn't teleport everything on return.
  const dt = Math.min(clock.getDelta(), 0.1);

  if (running) {
    player.update(dt);
    enemies.update(dt);
    weapon.update(dt, input.firing);

    if (player.isDead()) endGame();
  }

  hud.update(player.health, score);
  renderer.render(scene, camera);
}

frame();
