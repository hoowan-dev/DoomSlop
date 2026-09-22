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

    // Armor points: a second pool that takes damage ahead of health. Starts empty
    // and the only thing that ever fills it is an armor drop — refillHealth() and
    // reset() deliberately don't, which is what makes it a thing the player has to go
    // and get rather than something the game hands back.
    this.armor = 0;

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

    // Set by main.js: (amount, source) => void, fired when the player actually
    // loses health. Damage arrives from enemies.js, which main.js never sees, so
    // without this hook feedback for a hit has nowhere to attach.
    this.onDamage = null;

    // Set by main.js: () => void, fired by refillHealth(). The counterpart to
    // onDamage, and it exists for the same reason: the two callers that heal —
    // pickups.onCollect in main.js and the boss-death transition in rounds.js —
    // have nothing in common except this method, so hanging the feedback here is
    // what makes one flash cover both. rounds.js has no DOM access and shouldn't
    // grow any.
    this.onHeal = null;

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

  /**
   * @param source world position of whatever landed the hit, forwarded to
   *        onDamage so the HUD can point at it. Optional: the directional
   *        indicator is the only thing that wants it, and a hit with no attacker
   *        behind it is still a hit. Not copied — it's the attacker's live
   *        position vector and a floater is removed from the scene on the line
   *        after it hits, so a handler has to read it synchronously (same rule as
   *        hud.scorePopup's).
   */
  takeDamage(amount, source = null) {
    const before = this.health + this.armor;

    // Armor first, and only what it can't cover reaches health — so a hit landing on
    // 10 AP spends those 10 and puts the remaining 15 on the bar, rather than either
    // pool absorbing the whole thing. Health is floored at 0; armor can't go under it
    // because it never absorbs more than it has.
    const absorbed = Math.min(this.armor, amount);
    this.armor -= absorbed;
    this.health = Math.max(0, this.health - (amount - absorbed));

    // Only report a real loss, so a hit landing at 0 HP and no armor doesn't
    // re-trigger feedback for damage that didn't happen. Measured across both pools:
    // a hit soaked entirely by armor cost the player something real, so the sound and
    // the wedge still have to fire.
    if (this.health + this.armor < before) this.onDamage?.(amount, source);
  }

  /**
   * Where a world point lies relative to where the player is facing, as radians
   * clockwise from straight ahead. The HUD's hit indicator is the caller: an
   * on-screen bearing is a screen-space angle, but deriving it needs `yaw` and
   * `position`, which are this class's.
   *
   * XZ-planar, like every other spatial test in the game — a floater diving at
   * the player from above still reads as coming from its compass bearing, which
   * is the only thing an indicator around the crosshair can usefully say. Note
   * `pitch` deliberately isn't in it: looking up shouldn't swing the wedges.
   *
   * Same rotation as the minimap's, and for the same reason it comes out in the
   * right direction — world +X/+Z map to screen right/down once yaw is applied,
   * and clockwise-from-up is what both the radar and a ring of wedges want. The
   * sign is easy to talk yourself into; the hit driver sweeps (yaw, bearing)
   * pairs rather than trusting this paragraph.
   */
  bearingTo(point) {
    const dx = point.x - this.position.x;
    const dz = point.z - this.position.z;
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);

    // The offset rotated into view space: x is screen-right, y is screen-*down*,
    // hence the negation on the way into atan2, whose first argument is the one
    // that grows clockwise.
    return Math.atan2(dx * cos - dz * sin, -(dx * sin + dz * cos));
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
    // Armor is deliberately untouched. It's recoverable only from an armor drop, so
    // the reward for putting a boss down is a full bar and whatever buffer the player
    // had managed to keep — not a reset of both pools.

    // Reported unconditionally, unlike onDamage's "only a real loss" guard. A
    // refill at full health is still an event the player earned — the HP RESTORED
    // notice and the choir already fire on a medkit taken at 100 — so going quiet
    // here would leave one part of the same confirmation missing. onDamage's guard
    // is about a specific degenerate case (a hit landing on the death frame, over
    // the top of YOU DIED); there's no equivalent for healing.
    this.onHeal?.();
  }

  /**
   * Armor back to full, from an armor drop. The spec is "+50, capped at 50", which
   * from any starting value is a refill — hence the same all-or-nothing shape as
   * refillHealth() rather than an addArmor(amount) nobody would ever call with
   * anything but the cap.
   *
   * No onArmor hook to match onHeal, and that asymmetry is the rule working rather
   * than an omission: onHeal exists because *two* unrelated callers heal (a medkit
   * and a boss going down) and a hook is what lets one line of feedback cover both.
   * This has exactly one caller — main.js's own collect handler — so a hook would be
   * indirection with nothing to unify, and main.js flashes the HUD there directly.
   */
  refillArmor() {
    this.armor = PLAYER.maxArmor;
  }

  reset() {
    this.health = PLAYER.maxHealth;
    // Back to nothing, not to the cap: a new run starts with whatever armor the
    // player has earned in it, which at frame one is none.
    this.armor = 0;
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
