import * as THREE from 'three';
import { PICKUP, PLAYER } from './config.js';
import { haloMaterial, haloSprite } from './glow.js';

// The drop system: what a defeated enemy leaves on the floor. Two items, and they're
// one cube with a different picture on it — the health cube refills the bar and the
// armor cube fills the AP pool that soaks damage ahead of it.
//
// Owned by main.js, which rolls the drop chance from enemies.onDefeat and reports a
// collection back out through onCollect. That routing is what keeps this module and
// enemies.js ignorant of each other, and it's also where the drop gets its
// semantics for free: onDefeat fires only from damage(), so a floater that suicides
// into the player and a field wiped between rounds can't drop anything. It's also
// why *this* module doesn't know what either item does — only main.js does.
//
// Like every other system here it never schedules its own frame and never calls
// into another system's update().

// One geometry for every drop of either kind, same reasoning as the shared enemy
// assets: at this fidelity per-item assets are pure waste. The size is the system's
// rather than the face's, so the two are interchangeable at a distance and only the
// picture tells them apart.
const GEOMETRY = new THREE.BoxGeometry(PICKUP.size, PICKUP.size, PICKUP.size);

/**
 * An icon drawn into a canvas at import time and used as the map on all six faces.
 * A texture rather than a sprite laid over the cube, because the cube *rotates* — a
 * billboarding sprite would sit still while the box turned under it, and the whole
 * read of the item is an icon tumbling toward you. Asset-free for the same reason
 * the halo texture is.
 *
 * @param face a PICKUP.health / PICKUP.armor block: the three colors.
 * @param drawIcon (ctx, size) => void, the one part that differs between the two.
 *        A callback rather than a shape name in config.js, because which marks make
 *        a cross or a shield is the drawing's business and not a tunable — the same
 *        split that leaves the proportions below hardcoded here while the colors
 *        live in config.
 */
function faceTexture(face, drawIcon) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = face.bodyColor;
  ctx.fillRect(0, 0, size, size);

  // A painted-on border. Flat shading alone separates the faces under a light, but
  // this thing spends its life inside its own glow, where two lit faces at similar
  // angles wash into one another and the cube loses its edges.
  ctx.strokeStyle = face.edgeColor;
  ctx.lineWidth = size * 0.06;
  ctx.strokeRect(0, 0, size, size);

  ctx.fillStyle = face.iconColor;
  drawIcon(ctx, size);

  return new THREE.CanvasTexture(canvas);
}

/**
 * Bars from 15% to 85% and 40% to 60% across: a fat, stubby cross that survives
 * being drawn 30 pixels tall on screen. A thin one reads as a plus sign at range.
 */
function drawCross(ctx, size) {
  ctx.fillRect(size * 0.4, size * 0.15, size * 0.2, size * 0.7);
  ctx.fillRect(size * 0.15, size * 0.4, size * 0.7, size * 0.2);
}

/**
 * A shield: flat across the top, straight down the shoulders, then curving in to a
 * point at the bottom. Filled rather than outlined for the same reason the cross is
 * fat — at 30 pixels an outline closes up into a blob — and the flat top is what
 * keeps it from reading as a heart or a spade once it's small.
 *
 * Same silhouette the minimap blip draws, which is the whole point of drawing it
 * twice: the thing on the radar has to be recognizable as the thing in the arena.
 */
function drawShield(ctx, size) {
  const top = size * 0.13;
  const bottom = size * 0.87;
  const left = size * 0.23;
  const right = size * 0.77;
  // Where the sides stop going straight down and start closing in. High enough that
  // the point is long rather than a nub, low enough to leave obvious shoulders.
  const waist = size * 0.5;
  // The control point for both sides, and it is deliberately *above* the bottom edge
  // rather than level with it. A quadratic leaves the end tangent pointing from the
  // control point at the endpoint, so a control at the bottom corner brings both sides
  // in horizontally and the two meet in a flat curve — which at the ~50px this is seen
  // at reads as a cup, not a shield. Pulled up, they converge at about 45 degrees and
  // come to a point. Taller than it is wide for the same reason, and to the same
  // proportions as the minimap blip.
  const pull = size * 0.62;

  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(right, top);
  ctx.lineTo(right, waist);
  ctx.quadraticCurveTo(right, pull, size * 0.5, bottom);
  ctx.quadraticCurveTo(left, pull, left, waist);
  ctx.closePath();
  ctx.fill();
}

/**
 * The per-face assets, built once at import time and looked up by the face block a
 * drop was spawned from. A Map rather than fields hung on the config blocks, which
 * would make config.js a place that holds three.js objects.
 *
 * One material and one halo material per face — the same "one per kind of thing"
 * rule the enemy tiers follow, and the halo materials still share the single texture
 * in glow.js. Both are built here rather than lazily on first drop because there are
 * two of them and a decode landing mid-fight is the kind of thing that stutters.
 */
const ASSETS = new Map(
  [
    [PICKUP.health, drawCross],
    [PICKUP.armor, drawShield],
  ].map(([face, drawIcon]) => [
    face,
    {
      material: new THREE.MeshLambertMaterial({ map: faceTexture(face, drawIcon), flatShading: true }),
      halo: haloMaterial(face.glow),
    },
  ])
);

export class PickupManager {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;

    /**
     * `kind` is the *face* block this was made from — PICKUP.health or PICKUP.armor
     * — exactly as an enemy carries a pointer at ENEMY or BOSS. That's what lets
     * effects.js read a drop's glow the same way it reads an enemy's, off
     * `kind.glow`, with no knowledge of which it was handed, and what main.js
     * branches on to decide what collecting one means. Everything physical about a
     * drop is shared and read off PICKUP itself; see config.js.
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
   * Two rolls, not one per item type: whether anything drops, then which of the two
   * it is. That keeps the overall drop rate a single number to tune — adding a third
   * item moves the split and leaves dropChance alone.
   *
   * @returns the new pickup, or null if the roll failed.
   */
  maybeDrop(position) {
    if (Math.random() >= PICKUP.dropChance) return null;
    return this.spawn(position, Math.random() < PICKUP.armorShare ? PICKUP.armor : PICKUP.health);
  }

  /**
   * A drop at this world point, floating at the shared hover height.
   *
   * @param kind which face — PICKUP.health or PICKUP.armor. Defaults to health, so a
   *        caller that doesn't care (a driver, the console) still gets a drop.
   */
  spawn(position, kind = PICKUP.health) {
    const assets = ASSETS.get(kind);
    const mesh = new THREE.Mesh(GEOMETRY, assets.material);
    // The X/Z of the kill, but never its height: enemies die anywhere from the floor
    // to 6 units up, and an item hanging where a high floater happened to be shot
    // reads as a bug. No arena clamp is needed — enemies spawn in bounds and only
    // ever move toward a player who is clamped inside them.
    mesh.position.set(position.x, PICKUP.hoverHeight, position.z);

    mesh.add(haloSprite(assets.halo, PICKUP.size, kind.glow.haloScale));
    // Parented above, so this recursion reaches the halo. Nothing raycasts a pickup
    // — collection is a distance test — but a stale matrixWorld would leave the halo
    // at the world origin for the frame it spawned on.
    mesh.updateMatrixWorld();

    this.scene.add(mesh);

    const pickup = {
      mesh,
      kind,
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
