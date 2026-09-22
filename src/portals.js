import * as THREE from 'three';
import { PORTAL, WORLD } from './config.js';
import { HALO_TEXTURE } from './glow.js';

// The two portals: squares of wall that lead to each other. Walk into one and you come
// out of the other, facing into the arena with the heading you walked in with.
//
// Placement is asked for by rounds.js at the start of every round; the traversal test
// is ticked by main.js right after player.update(). Like every other system here it
// reports nothing and knows nothing about rounds, score or the HUD — the only thing it
// reaches into is the player, and only to move them.

const HALF = WORLD.arenaSize / 2;

/**
 * The four walls world.js builds, described from the inside.
 *
 * `normal` points into the arena and `run` is the axis the wall lies along, so a
 * portal's center is `base + run * u` for an along-wall offset `u`. `faceYaw` does
 * double duty and that's worth knowing before touching the turn below: it's the Y
 * rotation that turns a portal's quads to face inward, *and* it is the player's yaw
 * while walking into this wall. Both because a plane's front is local +Z, and a
 * camera at yaw Y looks along (-sin Y, 0, -cos Y) — so walking into the wall means
 * travelling along -normal, i.e. yaw = atan2(normal.x, normal.z).
 */
const WALLS = [
  { normal: new THREE.Vector3(0, 0, 1), run: new THREE.Vector3(1, 0, 0), base: new THREE.Vector3(0, 0, -HALF) },
  { normal: new THREE.Vector3(0, 0, -1), run: new THREE.Vector3(1, 0, 0), base: new THREE.Vector3(0, 0, HALF) },
  { normal: new THREE.Vector3(1, 0, 0), run: new THREE.Vector3(0, 0, 1), base: new THREE.Vector3(-HALF, 0, 0) },
  { normal: new THREE.Vector3(-1, 0, 0), run: new THREE.Vector3(0, 0, 1), base: new THREE.Vector3(HALF, 0, 0) },
];
for (const wall of WALLS) wall.faceYaw = Math.atan2(wall.normal.x, wall.normal.z);

// One geometry and one material per layer, shared by both portals — the same rule the
// enemy tiers and the pickup faces follow. Built at import time from config, so a
// driver retuning PORTAL live moves the light (read per frame) and not these.
const CORE_GEOMETRY = new THREE.PlaneGeometry(PORTAL.size, PORTAL.size);
const AURA_SIZE = PORTAL.size * PORTAL.glow.haloScale;
const AURA_GEOMETRY = new THREE.PlaneGeometry(AURA_SIZE, AURA_SIZE);

// Unlit, so the doorway is a hole of light rather than a blue patch of wall that goes
// dark when nothing is glowing near it. Nothing here is a hit target: the arena's
// `solids` are what weapon.js raycasts, and a portal is deliberately not in that list,
// so shots pass through the square exactly as the player does.
const CORE_MATERIAL = new THREE.MeshBasicMaterial({ color: PORTAL.glow.color });

/**
 * The aura, over the same texture every halo in the game uses — but as a plane rather
 * than through glow.js's `haloSprite()`, which billboards. A halo turns to face the
 * player because it surrounds a body; this one is mounted *on* a surface and has to lie
 * flat against it, or it would swing off the wall as the player walked past.
 *
 * Depth tested and not written, like every other halo: the wall behind it is further
 * away so it draws, and not writing depth keeps it from cutting a hole in the core
 * quad it overlaps.
 */
const AURA_MATERIAL = new THREE.MeshBasicMaterial({
  map: HALO_TEXTURE,
  color: PORTAL.glow.color,
  opacity: PORTAL.glow.haloOpacity,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

export class Portals {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;

    /**
     * Exactly two, built once here and moved on every placement rather than rebuilt.
     * The lights are the reason (see _build), and a fixed pair of meshes falls out of
     * it. Two rather than a list because a portal without a partner has nowhere to
     * lead: `_exitFor()` is the whole pairing, and a third would need a rule.
     */
    this.portals = [this._build(), this._build()];

    // Placed immediately so nothing can ever render an unplaced portal. rounds.js
    // re-places them a moment later, at the start of round 1 — this is about the gap
    // between construction and the first frame, not about the round.
    this.place();
  }

  _build() {
    const group = new THREE.Group();

    const core = new THREE.Mesh(CORE_GEOMETRY, CORE_MATERIAL);
    const aura = new THREE.Mesh(AURA_GEOMETRY, AURA_MATERIAL);
    // Just off the wall, in the group's local frame — which points along the wall's
    // inward normal once the group is turned (see _set). Without this they'd be
    // coplanar with the wall and z-fight it. The aura in front of the core for the
    // same reason, and because additive-over-solid is the order that reads.
    core.position.z = 0.02;
    aura.position.z = 0.04;
    group.add(core, aura);
    this.scene.add(group);

    // One light per portal, added here and then never added, removed or hidden again.
    // effects.js owns the *pooled* lights and explains why at length; the invariant
    // that matters is that the scene's light count never changes after boot, since
    // it's compiled into every material's shader program. Two permanent portals
    // satisfy that without needing to be pooled — there's nothing to reassign.
    const light = new THREE.PointLight(PORTAL.glow.color, PORTAL.glow.intensity, PORTAL.glow.distance);
    this.scene.add(light);

    return { group, light, wall: null, center: new THREE.Vector3() };
  }

  /**
   * Put the pair on two different walls, at a random offset along each. Called by
   * rounds.js from _startRound(), so it covers a real round change, a skip and a
   * retry alike — and so a round change is the *only* thing that moves them.
   */
  place() {
    // Two distinct walls without a retry loop: pick the first, then step 1..3 walls
    // round from it.
    const first = Math.floor(Math.random() * WALLS.length);
    const second = (first + 1 + Math.floor(Math.random() * (WALLS.length - 1))) % WALLS.length;

    this._set(this.portals[0], WALLS[first]);
    this._set(this.portals[1], WALLS[second]);
  }

  _set(portal, wall) {
    // Anywhere along the wall but the corners, which is what PORTAL.margin buys.
    const u = (Math.random() * 2 - 1) * (HALF - PORTAL.margin);

    portal.wall = wall;
    // Standing on the floor, so the center is half a square up.
    portal.center.copy(wall.base).addScaledVector(wall.run, u);
    portal.center.y = PORTAL.size / 2;

    portal.group.position.copy(portal.center);
    portal.group.rotation.y = wall.faceYaw;

    // Out in the room rather than in the wall's plane — see PORTAL.lightOffset.
    portal.light.position.copy(portal.center).addScaledVector(wall.normal, PORTAL.lightOffset);

    // Re-read here rather than only at construction, so retuning PORTAL.glow live lands
    // at the next round start — roughly the reach a driver has into the enemy glows,
    // which effects.js re-reads every frame. The *materials* can't follow (built at
    // import time, above), so a live retune moves the light and not the aura.
    portal.light.color.set(PORTAL.glow.color);
    portal.light.intensity = PORTAL.glow.intensity;
    portal.light.distance = PORTAL.glow.distance;
  }

  /**
   * Teleport the player if they're standing in a portal. Ticked from main.js right
   * after player.update(), which is what makes the test see the position the player
   * actually walked to this frame.
   *
   * No dt and no cooldown: arriving PORTAL.exitOffset inside the exit wall is already
   * outside its own trigger depth, so there is no travel state to carry between
   * frames. That's a config constraint rather than a guard here — see exitOffset.
   */
  update() {
    for (const portal of this.portals) {
      if (!this._entering(portal)) continue;

      const exit = this._exitFor(portal);
      const { normal } = exit.wall;
      const x = exit.center.x + normal.x * PORTAL.exitOffset;
      const z = exit.center.z + normal.z * PORTAL.exitOffset;

      // The turn: the player was walking into the entry wall (yaw entry.faceYaw) and
      // comes out walking into the arena off the exit wall (yaw exit.faceYaw + PI, a
      // heading looking along that wall's inward normal). The difference is what's
      // handed to the player, so whatever they were looking at relative to the wall
      // they walked into is preserved relative to the one they come out of.
      const turn = exit.wall.faceYaw + Math.PI - portal.wall.faceYaw;
      this.player.teleport(x, z, turn);

      // One traversal per frame. The exit is outside its own trigger, so this is
      // belt-and-braces against a future third portal rather than load-bearing today.
      return;
    }
  }

  /** The other one. The whole pairing rule, and why there are exactly two. */
  _exitFor(portal) {
    return portal === this.portals[0] ? this.portals[1] : this.portals[0];
  }

  /**
   * Is the player inside this portal's square?
   *
   * Planar, with no height test, like enemy contact and pickup collection — the same
   * call for the same reason: a solid rule everywhere beats a special case here. The
   * visible consequence is that a jump through a portal works even at the top of a
   * SUPER BOOTS hop, where the eye is over the square. That reads as the portal being
   * a doorway in a wall rather than a hoop to thread.
   */
  _entering(portal) {
    const { position } = this.player;
    const { normal, run } = portal.wall;
    const dx = position.x - portal.center.x;
    const dz = position.z - portal.center.z;

    // Straight out from the wall plane. Not floored at 0: the clamp in player.js
    // stops anyone getting behind a wall, but if something ever did, being past it
    // should still count as having gone through.
    if (dx * normal.x + dz * normal.z > PORTAL.depth) return false;

    // ...and along the wall from the middle of the square. Half-width, not half-width
    // plus the player's radius: the doorway is the square you can see, so brushing
    // the edge of the glow shouldn't take you.
    return Math.abs(dx * run.x + dz * run.z) <= PORTAL.size / 2;
  }
}
