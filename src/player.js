import * as THREE from 'three';
import { PLAYER } from './config.js';

// Owns the camera and the player's state. The camera *is* the player — there's
// no separate body mesh, since nothing renders from another viewpoint.

const UP = new THREE.Vector3(0, 1, 0);

export class Player {
  constructor(camera, input, world) {
    this.camera = camera;
    this.input = input;
    this.world = world;

    this.health = PLAYER.maxHealth;
    this.position = new THREE.Vector3(0, PLAYER.eyeHeight, 0);

    // Look angles kept separately from camera.rotation so pitch can be clamped
    // without gimbal weirdness. Apply them as YXZ Euler order.
    this.yaw = 0;
    this.pitch = 0;

    // Vertical velocity, non-zero only during a jump. There's no horizontal
    // counterpart: walking is positional (no acceleration or inertia), so this is
    // the one axis that needs state carried between frames.
    this.velocityY = 0;

    this.camera.rotation.order = 'YXZ';

    // Reused every frame so the loop doesn't allocate a Vector3 per tick.
    this._move = new THREE.Vector3();

    // Set by main.js: (amount) => void, fired when the player actually loses
    // health. Damage arrives from enemies.js, which main.js never sees, so
    // without this hook feedback for a hit has nowhere to attach.
    this.onDamage = null;

    this._syncCamera();
  }

  update(dt) {
    this._look();
    this._walk(dt);
    this._jump(dt);
    // Clamps X/Z only — the jump owns Y, and there's no ceiling to hit.
    this._clampToArena();
    this._syncCamera();
  }

  _look() {
    // Destructive read — exactly one caller per frame, or look input is eaten.
    const { x, y } = this.input.consumeMouseDelta();

    // Mouse deltas are already per-event pixels, so they must NOT be scaled by
    // dt: the distance moved is the input, independent of frame rate.
    this.yaw -= x * PLAYER.lookSensitivity;
    this.pitch -= y * PLAYER.lookSensitivity;

    // Stop just shy of straight up/down. Exactly +/-PI/2 makes forward
    // degenerate and the view can snap.
    const limit = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));

    // Keep yaw in range so it can't drift toward float imprecision in a long session.
    this.yaw = this.yaw % (Math.PI * 2);
  }

  _walk(dt) {
    const dir = this._move.set(0, 0, 0);

    // Forward is -Z in three's convention.
    if (this.input.isDown('KeyW')) dir.z -= 1;
    if (this.input.isDown('KeyS')) dir.z += 1;
    if (this.input.isDown('KeyA')) dir.x -= 1;
    if (this.input.isDown('KeyD')) dir.x += 1;

    if (dir.lengthSq() === 0) return;

    // Normalize before rotating so holding W+D isn't ~1.41x faster than W.
    dir.normalize().applyAxisAngle(UP, this.yaw).multiplyScalar(PLAYER.moveSpeed * dt);

    this.position.x += dir.x;
    this.position.z += dir.z;
  }

  /**
   * Vertical motion: the jump and the fall back out of it. Walking is unaffected,
   * so the player steers normally in mid-air.
   */
  _jump(dt) {
    // A height test rather than a grounded flag. The floor is flat and at a known
    // height, so there's no landing event to detect and no second piece of state
    // that can fall out of step with the position.
    const grounded = this.position.y <= PLAYER.eyeHeight;

    // Order matters: consumePress() is destructive, so testing `grounded` first
    // leaves the press queued while airborne instead of eating it. That buys jump
    // buffering for free — a tap a few frames before landing fires on touchdown
    // rather than being silently dropped, which is the difference between the
    // control feeling responsive and feeling like it missed. It also means a
    // mid-air tap can't double-jump: nothing reads the press until the player is
    // back on the floor.
    if (grounded && this.input.consumePress('Space')) {
      this.velocityY = PLAYER.jumpSpeed;
    }

    // Resting on the floor. Returning early rather than integrating is what keeps
    // gravity from accumulating an ever-larger downward velocity while standing
    // still — harmless at the clamp below, but it would launch the player on the
    // first frame the clamp was ever loosened.
    if (grounded && this.velocityY <= 0) {
      this.position.y = PLAYER.eyeHeight;
      this.velocityY = 0;
      return;
    }

    this.velocityY -= PLAYER.gravity * dt;
    this.position.y += this.velocityY * dt;

    // Landing. Snapped rather than left where the integration put it: the frame
    // that crosses the floor lands some way under it, and dt decides how far.
    if (this.position.y < PLAYER.eyeHeight) {
      this.position.y = PLAYER.eyeHeight;
      this.velocityY = 0;
    }
  }

  _clampToArena() {
    // Walls are at the raw bounds; inset by the player's radius so the camera
    // stops before it can see through them.
    const { min, max } = this.world.bounds;
    const lo = min + PLAYER.radius;
    const hi = max - PLAYER.radius;
    this.position.x = Math.max(lo, Math.min(hi, this.position.x));
    this.position.z = Math.max(lo, Math.min(hi, this.position.z));
  }

  takeDamage(amount) {
    const before = this.health;
    this.health = Math.max(0, this.health - amount);

    // Only report a real loss, so a hit landing at 0 HP doesn't re-trigger
    // feedback for damage that didn't happen.
    if (this.health < before) this.onDamage?.(amount);
  }

  isDead() {
    return this.health <= 0;
  }

  /**
   * Back to full. Called by rounds.js when a boss goes down — surviving the boss
   * is what pays for it. Deliberately all-or-nothing rather than a heal(amount)
   * inverse of takeDamage: nothing in the game restores a partial amount, and a
   * generic healer would invite one.
   */
  refillHealth() {
    this.health = PLAYER.maxHealth;
  }

  reset() {
    this.health = PLAYER.maxHealth;
    this.position.set(0, PLAYER.eyeHeight, 0);
    this.yaw = 0;
    this.pitch = 0;
    // Dying mid-jump would otherwise carry that velocity into the retry, so the
    // new run opens still rising or still falling from the last one's hop.
    this.velocityY = 0;
    this._syncCamera();
  }

  _syncCamera() {
    this.camera.position.copy(this.position);
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    // Push the change into matrixWorld now rather than waiting for render().
    // weapon.js reads aim direction via camera.getWorldDirection(), which is
    // matrixWorld-derived — without this, every shot fires along the previous
    // frame's rotation and aiming lags a frame behind the mouse.
    this.camera.updateMatrixWorld();
  }
}
