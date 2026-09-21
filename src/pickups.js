import * as THREE from 'three';
import { PICKUP, PLAYER } from './config.js';
import { haloMaterial, haloSprite } from './glow.js';

// The drop system: what a defeated enemy leaves on the floor. One item so far, the
// health cube, which refills the bar outright.
//
// Owned by main.js, which rolls the drop chance from enemies.onDefeat and reports a
// collection back out through onCollect. That routing is what keeps this module and
// enemies.js ignorant of each other, and it's also where the drop gets its
// semantics for free: onDefeat fires only from damage(), so a floater that suicides
// into the player and a field wiped between rounds can't drop anything.
//
// Like every other system here it never schedules its own frame and never calls
// into another system's update().

// One geometry and one material for every drop, same reasoning as the shared enemy
// assets: at this fidelity per-item assets are pure waste.
const GEOMETRY = new THREE.BoxGeometry(PICKUP.size, PICKUP.size, PICKUP.size);

/**
 * The cross, drawn into a canvas at import time and used as the map on all six
 * faces. A texture rather than a sprite laid over the cube, because the cube
 * *rotates* — a billboarding sprite would sit still while the box turned under it,
 * and the whole read of the item is a cross tumbling toward you. Asset-free for the
 * same reason the halo texture is.
 */
const TEXTURE = (() => {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = PICKUP.bodyColor;
  ctx.fillRect(0, 0, size, size);

  // A painted-on border. Flat shading alone separates the faces under a light, but
  // this thing spends its life inside its own green glow, where two lit faces at
  // similar angles wash into one another and the cube loses its edges.
  ctx.strokeStyle = PICKUP.edgeColor;
  ctx.lineWidth = size * 0.06;
  ctx.strokeRect(0, 0, size, size);

  // Bars from 15% to 85% and 40% to 60% across: a fat, stubby cross that survives
  // being drawn 30 pixels tall on screen. A thin one reads as a plus sign at range.
  ctx.fillStyle = PICKUP.crossColor;
  ctx.fillRect(size * 0.4, size * 0.15, size * 0.2, size * 0.7);
  ctx.fillRect(size * 0.15, size * 0.4, size * 0.7, size * 0.2);

  return new THREE.CanvasTexture(canvas);
})();

const MATERIAL = new THREE.MeshLambertMaterial({ map: TEXTURE, flatShading: true });
const HALO_MATERIAL = haloMaterial(PICKUP.glow);

export class PickupManager {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;

    /**
     * `kind` is the config block this was made from, exactly as an enemy carries
     * one — which is what lets effects.js read a drop's glow the same way it reads
     * an enemy's, off `kind.glow`, with no knowledge of which it was handed.
     * @type {{mesh: THREE.Mesh, kind: object, life: number, age: number, phase: number}[]}
     */
    this.pickups = [];

    // Set by main.js: (pickup) => void, fired when the player walks over one. The
    // healing, the sound and the HUD message all hang off this, so this module
    // doesn't know what the item does — only that it was taken.
    this.onCollect = null;
  }

  /**
   * Roll for a drop at a defeat. Called from main.js's onDefeat hook with the dead
   * enemy's position; the roll lives here rather than at the call site so
   * PICKUP.dropChance has exactly one reader.
   *
   * @returns the new pickup, or null if the roll failed.
   */
  maybeDrop(position) {
    if (Math.random() >= PICKUP.dropChance) return null;
    return this.spawn(position);
  }

  /** A drop at this world point, floating at its own hover height. */
  spawn(position) {
    const mesh = new THREE.Mesh(GEOMETRY, MATERIAL);
    // The X/Z of the kill, but never its height: enemies die anywhere from the floor
    // to 6 units up, and an item hanging where a high floater happened to be shot
    // reads as a bug. No arena clamp is needed — enemies spawn in bounds and only
    // ever move toward a player who is clamped inside them.
    mesh.position.set(position.x, PICKUP.hoverHeight, position.z);

    mesh.add(haloSprite(HALO_MATERIAL, PICKUP.size, PICKUP.glow.haloScale));
    // Parented above, so this recursion reaches the halo. Nothing raycasts a pickup
    // — collection is a distance test — but a stale matrixWorld would leave the halo
    // at the world origin for the frame it spawned on.
    mesh.updateMatrixWorld();

    this.scene.add(mesh);

    const pickup = {
      mesh,
      kind: PICKUP,
      life: PICKUP.life,
      age: 0,
      // Random phase so a cluster of drops doesn't bob as one.
      phase: Math.random() * Math.PI * 2,
    };
    this.pickups.push(pickup);
    return pickup;
  }

  update(dt) {
    // Backwards: both expiry and collection splice the array mid-iteration.
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pickup = this.pickups[i];
      const mesh = pickup.mesh;

      pickup.age += dt;
      pickup.life -= dt;
      if (pickup.life <= 0) {
        this.remove(pickup);
        continue;
      }

      // Y is written outright rather than accumulated, so the bob can't drift off
      // the hover height over a long life.
      mesh.position.y =
        PICKUP.hoverHeight + Math.sin(pickup.phase + pickup.age * PICKUP.bobSpeed) * PICKUP.bobAmplitude;
      mesh.rotation.y += PICKUP.spin * dt;

      // Shrinking away over the last of its life. Uniform scale, so the halo goes
      // with it — a sprite's world matrix carries the parent's scale.
      mesh.scale.setScalar(Math.min(1, pickup.life / PICKUP.shrinkTime));

      // Collection is measured on the XZ plane only, like enemy contact in
      // enemies.js, and for the mirror-image reason: height isn't part of the test,
      // so a drop can be grabbed in mid-air on the way past. Jumping doesn't dodge
      // damage and it doesn't miss pickups either.
      const dx = this.player.position.x - mesh.position.x;
      const dz = this.player.position.z - mesh.position.z;
      const reach = PICKUP.radius + PLAYER.radius;

      if (dx * dx + dz * dz <= reach * reach) {
        // Removed before the callback runs, so whatever onCollect does — and it
        // heals, plays a sound and writes the HUD — can't see an item that's
        // already been taken.
        this.remove(pickup);
        this.onCollect?.(pickup);
      }
    }
  }

  remove(pickup) {
    const i = this.pickups.indexOf(pickup);
    if (i === -1) return;
    this.pickups.splice(i, 1);
    this.scene.remove(pickup.mesh);
  }

  /**
   * Drop everything on the floor. Only a player restart calls this — drops
   * deliberately survive a round change, so one left behind at the end of a round is
   * still there to be used in the boss fight. That's also why rounds.js has no
   * reference to this module: it has nothing to say to it.
   */
  clear() {
    for (const pickup of [...this.pickups]) this.remove(pickup);
  }
}
