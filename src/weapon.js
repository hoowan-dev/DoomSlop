import * as THREE from 'three';
import { WEAPON } from './config.js';

// Hitscan gun: a ray straight down the camera's forward axis. No projectiles,
// no bullet drop, no reload.

export class Weapon {
  constructor(camera, enemyManager, onKill) {
    this.camera = camera;
    this.enemies = enemyManager;
    this.onKill = onKill; // (score) => void, so main.js can keep the tally

    this.raycaster = new THREE.Raycaster();
    this.raycaster.far = WEAPON.range;
    this.cooldown = 0;
  }

  update(dt, firing) {
    this.cooldown = Math.max(0, this.cooldown - dt);

    // TODO: fire while held, respecting the cooldown.
    //   if (firing && this.cooldown === 0) { this.fire(); this.cooldown = WEAPON.fireInterval; }
    //   Swap to a "was just pressed" check in input.js if you want single-shot.
  }

  fire() {
    // Origin at the camera, direction dead center of the screen.
    this.raycaster.set(
      this.camera.position,
      this.camera.getWorldDirection(new THREE.Vector3())
    );

    const hits = this.raycaster.intersectObjects(this.enemies.hitboxes(), false);
    if (hits.length === 0) return;

    const score = this.enemies.damage(hits[0].object);
    if (score > 0) this.onKill?.(score);

    // TODO: feedback — muzzle flash, a tracer line, a hit marker on the HUD.
  }
}
