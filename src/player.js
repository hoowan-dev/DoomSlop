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

    // The strafe lean. A third camera angle, but unlike the two above it isn't an
    // input the player aims with — it eases toward whatever the strafe keys ask for
    // and back to level when they let go, so it's state rather than a reading. Kept
    // here rather than in _roll() as a local for that reason.
    this.roll = 0;

    // Vertical velocity, non-zero only during a jump. There's no horizontal
    // counterpart: walking is positional (no acceleration or inertia), so this is
    // the one axis that needs state carried between frames.
    this.velocityY = 0;

    // The SUPER BOOTS buff. Seconds left and what it multiplies; `boostScale` below is
    // the only thing that should be read, since these two together are the state and a
    // reader that took the multiplier alone would keep applying it forever.
    //
    // The numbers arrive through boost() rather than being read out of config here,
    // because the player has no idea drops exist — the same reason refillArmor() takes
    // no argument and main.js is what knows a blue cube fills it.
    this.boostTime = 0;
    this.boostMultiplier = 1;
    // What boostTime started at, kept only so the HUD can draw the timer as a fraction
    // without having to know which item granted it.
    this.boostDuration = 0;

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

  /**
   * The live speed/jump multiplier: the boots' number while they're running, 1
   * otherwise. A getter over the timer rather than a field flipped back to 1 when it
   * expires, for the same reason `grounded` in _jump() is a height test — one piece of
   * state can't fall out of step with itself.
   */
  get boostScale() {
    return this.boostTime > 0 ? this.boostMultiplier : 1;
  }

  /**
   * Run the boots for `duration` seconds. Refreshes rather than stacks: a second pair
   * collected mid-buff restarts the clock at the same multiplier instead of cubing it,
   * which is both the reading a player expects and the only one that stays playable —
   * 9x move speed crosses this arena in under a second.
   *
   * @param multiplier applied to move speed directly and to jump *height*, which is
   *        where _jump() takes its square root. main.js reads both numbers off the face
   *        block and passes them in; see boostTime above for why they aren't imported.
   */
  boost(multiplier, duration) {
    this.boostMultiplier = multiplier;
    this.boostTime = duration;
    this.boostDuration = duration;
  }

  update(dt) {
    // Counted down here rather than in main.js so it pauses with the game for free —
    // update() is only called while running. Before the two things that read it, so
    // the frame it runs out is the first one moving at normal speed rather than the
    // last one moving fast.
    if (this.boostTime > 0) this.boostTime = Math.max(0, this.boostTime - dt);

    this._look();
    this._walk(dt);
    this._roll(dt);
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

    // Normalize before rotating so holding W+D isn't ~1.41x faster than W. The boost
    // multiplies the speed straight through — it applies in mid-air too, since air
    // control is the same _walk() call.
    dir
      .normalize()
      .applyAxisAngle(UP, this.yaw)
      .multiplyScalar(PLAYER.moveSpeed * this.boostScale * dt);

    this.position.x += dir.x;
    this.position.z += dir.z;
  }

  /**
   * The strafe lean: the view rolls slightly into a sideways press and levels out
   * when it's released. Purely cosmetic — roll is a rotation *about* the view axis,
   * so forward is untouched and a shot goes exactly where the crosshair is. The
   * muzzle does swing with it, because weapon.js takes its screen-space offset off
   * the camera's own right/up columns, which is what keeps the tracer starting from
   * the same spot on screen.
   */
  _roll(dt) {
    // Read off the keys rather than off the movement achieved: walking is positional
    // with no velocity to read, and a player strafing into a wall is still leaning.
    // A+D together cancel, like they do in _walk().
    const strafe = (this.input.isDown('KeyD') ? 1 : 0) - (this.input.isDown('KeyA') ? 1 : 0);

    // Negative because camera roll is a right-handed rotation about the view
    // direction, which is -Z: leaning *into* a press to the right means a negative
    // angle. The sign is easy to talk yourself into either way — it was settled by
    // strafing and looking at which way the horizon went.
    const target = -strafe * PLAYER.strafeRoll;

    // Eased rather than assigned. Snapping the horizon to a fixed tilt on the frame a
    // key goes down reads as the camera being knocked, which is the opposite of the
    // weight the lean is there to suggest — and the recovery matters more than the
    // tilt-in, since releasing a strafe key stops the player dead. An exponential
    // approach on a per-second rate, so both halves are the same shape and neither
    // depends on the frame rate. Clamped at 1 so a long frame can't overshoot past
    // the target and oscillate.
    this.roll += (target - this.roll) * Math.min(1, PLAYER.strafeRollSpeed * dt);
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

    // The *held* state, not the press edge, and that's what makes holding Space
    // bounce: the question is asked again on every grounded frame, so a key still
    // down when the player touches the floor launches on that frame. It also means a
    // press is never banked — a tap that goes down and up while airborne is gone by
    // landing and does nothing, which is deliberate: a queued jump fires from input
    // the player has already let go of.
    //
    // Double-jumping stays impossible for the reason it always was — the launch
    // needs `grounded`, and nothing reads the key anywhere else. isDown() is safe to
    // ask per-frame here (unlike the skip in main.js, which needs an edge) precisely
    // because `grounded` gates it: the launch takes the player off the floor, so the
    // repeat rate is the arc, not the frame rate.
    if (grounded && this.input.isDown('Space')) {
      // The *square root* of the boost, and that's the whole reason the multiplier is
      // interpreted here rather than just applied: the apex is jumpSpeed^2 / (2 *
      // gravity), so a hop three times as high needs sqrt(3) times the launch speed.
      // Multiplying jumpSpeed by 3 would be a nine-fold jump, which at this gravity
      // clears the arena walls and leaves the player airborne for two seconds.
      this.velocityY = PLAYER.jumpSpeed * Math.sqrt(this.boostScale);
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
    // Dying mid-strafe would otherwise open the retry with the horizon still tilted,
    // and nothing would level it until the player strafed again.
    this.roll = 0;
    // Dying mid-jump would otherwise carry that velocity into the retry, so the
    // new run opens still rising or still falling from the last one's hop.
    this.velocityY = 0;
    // Likewise the boots: they're something the last run earned, like armor, so the
    // new one starts without them. Only the timer is cleared — boostScale reads 1 off
    // that alone, so the multiplier left behind is inert.
    this.boostTime = 0;
    this._syncCamera();
  }

  _syncCamera() {
    this.camera.position.copy(this.position);
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    // YXZ order puts Z first in the composition, i.e. innermost, so this is a roll
    // about the already-aimed view axis rather than a third world-space turn. That's
    // also why it can't disturb the pitch clamp above.
    this.camera.rotation.z = this.roll;

    // Push the change into matrixWorld now rather than waiting for render().
    // weapon.js reads aim direction via camera.getWorldDirection(), which is
    // matrixWorld-derived — without this, every shot fires along the previous
    // frame's rotation and aiming lags a frame behind the mouse.
    this.camera.updateMatrixWorld();
  }
}
