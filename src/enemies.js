import * as THREE from 'three';
import { ENEMY, PLAYER, WORLD } from './config.js';

// Spawns and drives the floaters. One shared geometry/material for all of them —
// with graphics this minimal there's no reason for per-enemy assets.

const GEOMETRY = new THREE.IcosahedronGeometry(ENEMY.radius, 0);
const MATERIAL = new THREE.MeshLambertMaterial({ color: 0xc8503c, flatShading: true });

// Scratch vector for steering, reused across every enemy every frame.
const STEER = new THREE.Vector3();

export class EnemyManager {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;

    /** @type {{mesh: THREE.Mesh, health: number}[]} */
    this.enemies = [];

    // Seconds since the round started; drives the difficulty ramp.
    this.elapsed = 0;

    this.spawnTimer = 0;
    this.reset();
  }

  /** Back to round-one conditions. */
  reset() {
    this.elapsed = 0;
    // A full interval rather than 0, so a round (or a restart) opens with a
    // beat to get oriented instead of an enemy appearing on frame one.
    this.spawnTimer = ENEMY.spawnInterval;
  }

  update(dt) {
    this.elapsed += dt;

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawn();
      this.spawnTimer = this.currentSpawnInterval();
    }

    const contactRange = ENEMY.radius + PLAYER.radius;

    // Backwards: removing on contact splices the array mid-iteration.
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      const mesh = enemy.mesh;

      // Steer on the XZ plane only — they hover at a fixed height rather than
      // diving at the camera, which keeps them readable against the floor.
      STEER.set(
        this.player.position.x - mesh.position.x,
        0,
        this.player.position.z - mesh.position.z
      );

      const distance = STEER.length();

      if (distance <= contactRange) {
        this.player.takeDamage(ENEMY.touchDamage);
        this.remove(enemy);
        continue;
      }

      // distance > contactRange > 0, so normalize is safe here.
      mesh.position.addScaledVector(STEER.divideScalar(distance), ENEMY.speed * dt);

      // Slow tumble. Purely cosmetic, but it makes them read as alive.
      mesh.rotation.x += dt * 0.8;
      mesh.rotation.y += dt * 1.1;

      // Raycasting reads matrixWorld, and three only refreshes it during
      // render() — which happens after weapon.update() in the same frame. Push
      // it now, or shots this frame test against last frame's positions.
      mesh.updateMatrixWorld();
    }
  }

  /** Spawn interval, ramping down as the round goes on. */
  currentSpawnInterval() {
    const ramp = 1 - Math.min(this.elapsed / ENEMY.rampDuration, 1);
    return ENEMY.spawnIntervalMin + (ENEMY.spawnInterval - ENEMY.spawnIntervalMin) * ramp;
  }

  spawn() {
    const mesh = new THREE.Mesh(GEOMETRY, MATERIAL);
    const { x, z } = this._spawnPoint();
    mesh.position.set(x, ENEMY.hoverHeight, z);

    // Without this the mesh carries an identity matrixWorld until the next
    // render, and a raycast would treat it as sitting at the world origin —
    // i.e. on top of the player.
    mesh.updateMatrixWorld();

    this.scene.add(mesh);

    const enemy = { mesh, health: ENEMY.health };
    this.enemies.push(enemy);
    return enemy;
  }

  /**
   * A point exactly ENEMY.spawnDistance from the player, on a random bearing,
   * inside the arena. Rejects out-of-bounds bearings rather than clamping them:
   * clamping would drag the point toward the player and can land it inside
   * contact range when the player is in a corner — an instant free hit.
   */
  _spawnPoint() {
    const limit = WORLD.arenaSize / 2 - ENEMY.radius;
    const px = this.player.position.x;
    const pz = this.player.position.z;
    const d = ENEMY.spawnDistance;

    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const x = px + Math.cos(angle) * d;
      const z = pz + Math.sin(angle) * d;
      if (Math.abs(x) <= limit && Math.abs(z) <= limit) return { x, z };
    }

    // Fallback: aim back toward the arena center. Since spawnDistance is
    // smaller than the arena's half-width, this point is always in bounds.
    const toCenter = Math.atan2(-pz, -px);
    return {
      x: px + Math.cos(toCenter) * d,
      z: pz + Math.sin(toCenter) * d,
    };
  }

  /** Meshes to hand to the weapon's raycaster. */
  hitboxes() {
    return this.enemies.map((e) => e.mesh);
  }

  /** Called by weapon.js with the mesh a shot hit. Returns score earned. */
  damage(mesh, amount = 1) {
    const enemy = this.enemies.find((e) => e.mesh === mesh);
    if (!enemy) return 0;

    enemy.health -= amount;
    if (enemy.health > 0) return 0;

    this.remove(enemy);
    return ENEMY.scoreValue;
  }

  remove(enemy) {
    const i = this.enemies.indexOf(enemy);
    if (i === -1) return;
    this.enemies.splice(i, 1);
    this.scene.remove(enemy.mesh);
  }

  clear() {
    for (const enemy of [...this.enemies]) this.remove(enemy);
    this.reset();
  }
}
