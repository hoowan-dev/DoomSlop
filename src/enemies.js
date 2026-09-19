import * as THREE from 'three';
import { BOSS, ENEMY, PLAYER, WORLD } from './config.js';

// Spawns and drives the floaters and the round boss. One shared geometry/material
// per kind — with graphics this minimal there's no reason for per-enemy assets.

const GEOMETRY = new THREE.IcosahedronGeometry(ENEMY.radius, 0);
const MATERIAL = new THREE.MeshLambertMaterial({ color: 0xc8503c, flatShading: true });

// The boss gets its own pair rather than a scaled-up floater: at radius 3 the
// floater's 20 facets read as a handful of flat slabs, and a different hue is
// what makes it legible as a different tier of thing.
const BOSS_GEOMETRY = new THREE.IcosahedronGeometry(BOSS.radius, 1);
const BOSS_MATERIAL = new THREE.MeshLambertMaterial({ color: 0x9b30c4, flatShading: true });

// Scratch vector for steering, reused across every enemy every frame.
const STEER = new THREE.Vector3();

export class EnemyManager {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;

    /**
     * `kind` is the config block the enemy was spawned from (ENEMY or BOSS), so
     * per-enemy tunables are read from it rather than copied out field by field.
     * @type {{mesh: THREE.Mesh, kind: object, isBoss: boolean, health: number, cooldown: number}[]}
     */
    this.enemies = [];

    /** The live boss, or null. hud.js reads it to place the health bar. */
    this.boss = null;

    // Set by main.js: (enemy) => void, fired when an enemy is *shot* dead. This
    // is how rounds.js counts progress. It deliberately does not fire when an
    // enemy is removed for reaching the player — see damage().
    this.onDefeat = null;

    // Seconds since the round started; drives the difficulty ramp.
    this.elapsed = 0;

    // rounds.js switches this off for the boss fight.
    this.spawning = true;

    // Multiplier on every enemy's speed, pushed in by rounds.js. Owned there
    // because the round number is what drives it and this module has no idea
    // what round it is. Deliberately not touched by reset(): rounds.reset() is
    // the single writer, and it runs right after clear() on a restart.
    this.speedScale = 1;

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

  /**
   * Toggled by rounds.js so the boss fights alone. Re-enabling restarts the
   * countdown, so a round resumes with a beat instead of a floater appearing on
   * the same frame spawning came back.
   */
  setSpawning(on) {
    this.spawning = on;
    if (on) this.spawnTimer = this.currentSpawnInterval();
  }

  /**
   * Called by rounds.js at the start of each round. It applies to the boss too:
   * both tiers read `kind.speed`, so there's one multiplier rather than one per
   * kind — a per-kind growth rate would be a config change, not a second field.
   *
   * It also drives the spawn rate (see currentSpawnInterval), so push it *before*
   * setSpawning(true) — that's what re-derives the pending timer.
   */
  setSpeedScale(scale) {
    this.speedScale = scale;
  }

  update(dt) {
    this.elapsed += dt;

    if (this.spawning) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawn();
        this.spawnTimer = this.currentSpawnInterval();
      }
    }

    // Backwards: removing on contact splices the array mid-iteration.
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      const { mesh, kind } = enemy;

      if (enemy.cooldown > 0) enemy.cooldown -= dt;

      // Steer on the XZ plane only — they hover at a fixed height rather than
      // diving at the camera, which keeps them readable against the floor.
      STEER.set(
        this.player.position.x - mesh.position.x,
        0,
        this.player.position.z - mesh.position.z
      );

      const distance = STEER.length();
      const touching = distance <= kind.radius + PLAYER.radius;

      if (touching && !enemy.isBoss) {
        this.player.takeDamage(kind.touchDamage);
        this.remove(enemy);
        continue;
      }

      if (touching) {
        // The boss is not consumed on contact — it has to be shot down, or the
        // player could beat a 50-shot enemy by walking into it. So it sits on
        // the player and hits on a cooldown instead.
        if (enemy.cooldown <= 0) {
          this.player.takeDamage(kind.touchDamage);
          enemy.cooldown = kind.attackInterval;
        }
      } else {
        // distance > contact range > 0, so normalize is safe here.
        const speed = kind.speed * this.speedScale;
        mesh.position.addScaledVector(STEER.divideScalar(distance), speed * dt);
      }

      // Slow tumble. Purely cosmetic, but it makes them read as alive.
      mesh.rotation.x += dt * 0.8 * kind.spin;
      mesh.rotation.y += dt * 1.1 * kind.spin;

      // Raycasting reads matrixWorld, and three only refreshes it during
      // render() — which happens after weapon.update() in the same frame. Push
      // it now, or shots this frame test against last frame's positions.
      mesh.updateMatrixWorld();
    }
  }

  /**
   * Spawn interval: ramping down as the round goes on, then compressed by the
   * round's speed multiplier.
   *
   * Rate scales with speed, so the interval *divides* by the multiplier — which
   * scales both ends of the ramp together. Scaling only `spawnInterval` would
   * flatten the ramp against a fixed `spawnIntervalMin` and the later rounds
   * would all converge on the same pressure.
   */
  currentSpawnInterval() {
    const ramp = 1 - Math.min(this.elapsed / ENEMY.rampDuration, 1);
    const interval = ENEMY.spawnIntervalMin + (ENEMY.spawnInterval - ENEMY.spawnIntervalMin) * ramp;
    return interval / this.speedScale;
  }

  spawn() {
    return this._add(ENEMY, false);
  }

  /** Called by rounds.js once the BOSS ROUND announcement has landed. */
  spawnBoss() {
    this.boss = this._add(BOSS, true);
    return this.boss;
  }

  _add(kind, isBoss) {
    const mesh = new THREE.Mesh(
      isBoss ? BOSS_GEOMETRY : GEOMETRY,
      isBoss ? BOSS_MATERIAL : MATERIAL
    );
    const { x, z } = this._spawnPoint(kind.spawnDistance, kind.radius);
    mesh.position.set(x, kind.hoverHeight, z);

    // Without this the mesh carries an identity matrixWorld until the next
    // render, and a raycast would treat it as sitting at the world origin —
    // i.e. on top of the player.
    mesh.updateMatrixWorld();

    this.scene.add(mesh);

    const enemy = { mesh, kind, isBoss, health: kind.health, cooldown: 0 };
    this.enemies.push(enemy);
    return enemy;
  }

  /**
   * A point exactly `distance` from the player, on a random bearing, inside the
   * arena. Rejects out-of-bounds bearings rather than clamping them: clamping
   * would drag the point toward the player and can land it inside contact range
   * when the player is in a corner — an instant free hit.
   */
  _spawnPoint(distance, radius) {
    const limit = WORLD.arenaSize / 2 - radius;
    const px = this.player.position.x;
    const pz = this.player.position.z;
    const d = distance;

    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const x = px + Math.cos(angle) * d;
      const z = pz + Math.sin(angle) * d;
      if (Math.abs(x) <= limit && Math.abs(z) <= limit) return { x, z };
    }

    // Fallback: aim back toward the arena center. Always in bounds, provided
    // `distance` stays below the arena's half-width less `radius` — which is why
    // BOSS.spawnDistance carries that note in config.js.
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

    // Only a shot kill counts as a defeat. remove() on contact, and removeAll()
    // between rounds, deliberately stay silent — otherwise floaters suiciding
    // into the player would advance the round, and a restart would credit a kill
    // for every enemy it swept off the field.
    this.onDefeat?.(enemy);

    return enemy.kind.scoreValue;
  }

  remove(enemy) {
    const i = this.enemies.indexOf(enemy);
    if (i === -1) return;
    this.enemies.splice(i, 1);
    this.scene.remove(enemy.mesh);
    if (enemy === this.boss) this.boss = null;
  }

  /** Wipe the field and leave the round and ramp state alone. */
  removeAll() {
    for (const enemy of [...this.enemies]) this.remove(enemy);
  }

  /** Wipe the field *and* go back to round-one spawning. For restarts. */
  clear() {
    this.removeAll();
    this.reset();
  }
}
