import * as THREE from 'three';
import { WEAPON } from './config.js';

// Hitscan gun: a ray straight down the camera's forward axis. No projectiles,
// no bullet drop, no reload.

// Scratch vectors, overwritten each shot. Raycaster.set() copies what it's
// given, so reusing these is safe.
const FORWARD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const UP = new THREE.Vector3();
const MUZZLE = new THREE.Vector3();
const ENDPOINT = new THREE.Vector3();
const NORMAL = new THREE.Vector3();
const NORMAL_MATRIX = new THREE.Matrix3();

// Raycast target list, rebuilt in place each shot so firing doesn't allocate.
const TARGETS = [];

export class Weapon {
  /**
   * @param solids static arena surfaces (floor, walls) from createWorld, raycast
   *        alongside the enemies so a shot lands on whatever is nearest.
   * @param onKill (score) => void — main.js keeps the tally, not the weapon.
   * @param onShot (shot) => void — fired on every shot for feedback, where shot
   *        is { muzzle, endpoint, direction, hit, normal, hitEnemy }. The weapon
   *        reports where the shot went; it has no scene access and draws nothing.
   */
  constructor(camera, enemyManager, solids, onKill, onShot) {
    this.camera = camera;
    this.enemies = enemyManager;
    this.solids = solids;
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

    // Enemies and arena surfaces in one cast, so the nearest thing wins: an
    // enemy behind a wall isn't hittable through it, and a wall behind an enemy
    // doesn't steal the hit.
    TARGETS.length = 0;
    for (const mesh of this.enemies.hitboxes()) TARGETS.push(mesh);
    for (const solid of this.solids) TARGETS.push(solid);

    const hits = this.raycaster.intersectObjects(TARGETS, false);
    const hit = hits[0] ?? null;

    // Only enemies take damage and award score. Everything else is scenery, but
    // it still stops the bullet and throws sparks.
    const hitEnemy = hit !== null && !this.solids.includes(hit.object);

    // The ray is cast from the eye so aim matches the crosshair exactly, but
    // the *tracer* is drawn from an offset muzzle. Drawing it from the eye
    // would put it edge-on and make it nearly invisible.
    const { screenX, screenY, forward, minHeight } = WEAPON.muzzleOffset;
    RIGHT.setFromMatrixColumn(this.camera.matrixWorld, 0);
    UP.setFromMatrixColumn(this.camera.matrixWorld, 1);

    // Half-extents of the view frustum `forward` units out, so the screen-space
    // offset above lands where it claims to regardless of FOV or aspect.
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * forward;
    const halfWidth = halfHeight * this.camera.aspect;

    MUZZLE.copy(this.camera.position)
      .addScaledVector(FORWARD, forward)
      .addScaledVector(RIGHT, screenX * halfWidth)
      .addScaledVector(UP, screenY * halfHeight);

    // Aiming down swings the muzzle below the floor, which clips the start of the
    // tracer. Keep it above ground — see the note on minHeight in config.js.
    MUZZLE.y = Math.max(MUZZLE.y, minHeight);

    if (hit) {
      ENDPOINT.copy(hit.point);
    } else {
      // Nothing was struck — only possible shooting up over the open-topped
      // arena. The tracer runs out to range and no impact sparks play.
      ENDPOINT.copy(this.camera.position).addScaledVector(FORWARD, WEAPON.range);
    }

    // Scratch vectors — the handler must consume them synchronously, not retain them.
    this.onShot?.({
      muzzle: MUZZLE,
      endpoint: ENDPOINT,
      direction: FORWARD,
      hit,
      normal: hit ? this._impactNormal(hit) : null,
      hitEnemy,
    });

    if (!hitEnemy) return;

    const score = this.enemies.damage(hit.object);
    if (score > 0) this.onKill?.(score);
  }

  /**
   * World-space spray axis for the impact sparks. `face.normal` is in object
   * space and enemies tumble, so it has to be transformed; the result is then
   * flipped if it points downrange, so sparks never spray into the surface.
   */
  _impactNormal(hit) {
    if (!hit.face) return NORMAL.copy(FORWARD).negate(); // no face data: spray back at the shooter

    NORMAL.copy(hit.face.normal)
      .applyMatrix3(NORMAL_MATRIX.getNormalMatrix(hit.object.matrixWorld))
      .normalize();

    if (NORMAL.dot(FORWARD) > 0) NORMAL.negate();
    return NORMAL;
  }
}
