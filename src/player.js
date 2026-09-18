import * as THREE from 'three';
import { PLAYER } from './config.js';

// Owns the camera and the player's state. The camera *is* the player — there's
// no separate body mesh, since nothing renders from another viewpoint.

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

    this.camera.rotation.order = 'YXZ';
    this._syncCamera();
  }

  update(dt) {
    // TODO: mouse look.
    //   const { x, y } = this.input.consumeMouseDelta();
    //   this.yaw   -= x * PLAYER.lookSensitivity;
    //   this.pitch -= y * PLAYER.lookSensitivity;
    //   clamp pitch to +/- (Math.PI / 2 - 0.01) so you can't flip over.

    // TODO: movement.
    //   Build a direction from KeyW/KeyS/KeyA/KeyD, rotate it by this.yaw so
    //   it's camera-relative, normalize it (so diagonals aren't faster),
    //   scale by PLAYER.moveSpeed * dt, and add to this.position.

    // TODO: keep the player inside the arena.
    //   Clamp position.x/z to world.bounds inset by PLAYER.radius.

    this._syncCamera();
  }

  takeDamage(amount) {
    // TODO: subtract, clamp at 0, and let main.js notice this.isDead().
    this.health = Math.max(0, this.health - amount);
  }

  isDead() {
    return this.health <= 0;
  }

  reset() {
    this.health = PLAYER.maxHealth;
    this.position.set(0, PLAYER.eyeHeight, 0);
    this.yaw = 0;
    this.pitch = 0;
    this._syncCamera();
  }

  _syncCamera() {
    this.camera.position.copy(this.position);
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
  }
}
