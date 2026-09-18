import * as THREE from 'three';
import { WEAPON } from './config.js';

// Hitscan gun: a ray straight down the camera's forward axis. No projectiles,
// no bullet drop, no reload.

// Scratch direction, overwritten each shot. Raycaster.set() copies it, so
// reusing one vector is safe.
const FORWARD = new THREE.Vector3();

export class Weapon {
  /**
   * @param onKill (score) => void — main.js keeps the tally, not the weapon.
   * @param onShot (hit|null) => void — fired on every shot for feedback.
   */
  constructor(camera, enemyManager, onKill, onShot) {
    this.camera = camera;
    this.enemies = enemyManager;
    this.onKill = onKill;
    this.onShot = onShot;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = WEAPON.range;
    this.cooldown = 0;
  }

  update(dt, firing) {
    this.cooldown = Math.max(0, this.cooldown - dt);

    if (firing && this.cooldown === 0) {
      this.fire();
      this.cooldown = WEAPON.fireInterval;
    }
  }

  fire() {
    // Origin at the camera, direction dead center of the screen.
    this.raycaster.set(this.camera.position, this.camera.getWorldDirection(FORWARD));

    const hits = this.raycaster.intersectObjects(this.enemies.hitboxes(), false);

    this.onShot?.(hits[0] ?? null);

    if (hits.length === 0) return;

    const score = this.enemies.damage(hits[0].object);
    if (score > 0) this.onKill?.(score);
  }
}
