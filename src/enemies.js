import * as THREE from 'three';
import { ENEMY } from './config.js';

// Spawns and drives the floaters. One shared geometry/material for all of them —
// with graphics this minimal there's no reason for per-enemy assets.

const GEOMETRY = new THREE.IcosahedronGeometry(ENEMY.radius, 0);
const MATERIAL = new THREE.MeshLambertMaterial({ color: 0xc8503c, flatShading: true });

export class EnemyManager {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;

    /** @type {{mesh: THREE.Mesh, health: number}[]} */
    this.enemies = [];
    this.spawnTimer = 0;
  }

  update(dt) {
    // TODO: spawn on a timer.
    //   this.spawnTimer -= dt;
    //   if (this.spawnTimer <= 0) { this.spawn(); this.spawnTimer = ENEMY.spawnInterval; }
    //   Ramp spawnInterval down over time if you want difficulty scaling.

    // TODO: float each enemy toward the player.
    //   Direction = player.position - mesh.position, flattened to the XZ plane
    //   (keep y at ENEMY.hoverHeight) and normalized, times ENEMY.speed * dt.
    //   Iterate backwards so removals mid-loop are safe.

    // TODO: contact damage.
    //   If the flat distance to the player is under ENEMY.radius + PLAYER.radius,
    //   call player.takeDamage(ENEMY.touchDamage) and remove the enemy.
  }

  spawn() {
    // TODO: pick a random angle, place the enemy ENEMY.spawnDistance away from
    // the player on that bearing, at ENEMY.hoverHeight.
    const mesh = new THREE.Mesh(GEOMETRY, MATERIAL);
    mesh.position.set(0, ENEMY.hoverHeight, -ENEMY.spawnDistance);
    this.scene.add(mesh);

    const enemy = { mesh, health: ENEMY.health };
    this.enemies.push(enemy);
    return enemy;
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
    this.spawnTimer = 0;
  }
}
