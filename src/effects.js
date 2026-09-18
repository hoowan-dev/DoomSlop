import * as THREE from 'three';
import { EFFECTS } from './config.js';

// Transient shot visuals: hitscan tracers and spark bursts. Everything here is
// pooled and preallocated — effects fire several times a second, so allocating
// geometry or Vector3s per shot would hand the GC steady work during play.
//
// Owned by main.js, which ticks update() and calls clear() on restart. Weapon
// stays out of it: it reports where a shot went, it doesn't draw.

const SCRATCH = new THREE.Vector3();
const TINT = new THREE.Color();

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this._initTracers();
    this._initParticles();
  }

  _initTracers() {
    this.tracers = [];
    this.nextTracer = 0;

    for (let i = 0; i < EFFECTS.tracerPool; i++) {
      const geometry = new THREE.BufferGeometry();
      // Two vertices, rewritten on every use.
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));

      // linewidth is ignored by the WebGL renderer — tracers are always 1px.
      // That suits the flat look, so there's nothing to work around.
      const material = new THREE.LineBasicMaterial({
        color: EFFECTS.tracerColor,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      const line = new THREE.Line(geometry, material);
      line.visible = false;
      line.frustumCulled = false; // endpoints move every shot; culling would fight it
      this.scene.add(line);

      this.tracers.push({ line, life: 0, born: false });
    }
  }

  _initParticles() {
    const max = EFFECTS.maxParticles;

    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);

    // Pool of particle state, reused forever. `live` is a prefix count: slots
    // [0, live) are active, and a dead particle is swapped with the last live
    // one so the active range stays contiguous for drawRange.
    this.pool = Array.from({ length: max }, () => ({
      x: 0, y: 0, z: 0,
      vx: 0, vy: 0, vz: 0,
      life: 0,
      maxLife: 1,
      r: 1, g: 1, b: 1,
    }));
    this.live = 0;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geometry.setDrawRange(0, 0);

    const material = new THREE.PointsMaterial({
      size: EFFECTS.particleSize,
      // Screen-space size. With the default (world-space) attenuation, muzzle
      // sparks spawn ~0.5 units from the camera and blow up into screen-filling
      // squares. Constant pixel size also suits the flat look.
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      // Additive means fading a particle's color toward black reads as fading
      // out, which avoids needing per-particle alpha (PointsMaterial has none).
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
  }

  /** A hitscan streak from `from` to `to`. */
  tracer(from, to) {
    // Round-robin: with a pool this size the oldest tracer has nearly always
    // expired, and stealing a live one costs a frame of one streak at worst.
    const slot = this.tracers[this.nextTracer];
    this.nextTracer = (this.nextTracer + 1) % this.tracers.length;

    const p = slot.line.geometry.attributes.position;
    p.setXYZ(0, from.x, from.y, from.z);
    p.setXYZ(1, to.x, to.y, to.z);
    p.needsUpdate = true;

    slot.line.visible = true;
    slot.line.material.opacity = 1;
    slot.life = EFFECTS.tracerLife;

    // update() runs after the shot that spawned this, and tracerLife is shorter
    // than a clamped worst-case frame — without a grace frame a tracer fired on
    // a hitched frame would be retired before it ever drew.
    slot.born = true;
  }

  /**
   * A spark burst at `origin`, sprayed into the hemisphere around `axis`
   * (pass the surface normal, or the reversed shot direction for an impact).
   */
  burst(origin, axis, count, color) {
    const tint = TINT.set(color);

    for (let i = 0; i < count; i++) {
      if (this.live >= this.pool.length) return; // ceiling reached, drop the rest

      const particle = this.pool[this.live++];

      particle.x = origin.x;
      particle.y = origin.y;
      particle.z = origin.z;

      // Random direction, then biased toward `axis` so the spray reads as
      // coming off the surface instead of being an even ball.
      SCRATCH.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1);
      if (SCRATCH.lengthSq() === 0) SCRATCH.set(0, 1, 0);
      SCRATCH.normalize().addScaledVector(axis, 1.1).normalize();

      const speed = EFFECTS.particleSpeed * (0.35 + Math.random() * 0.65);
      particle.vx = SCRATCH.x * speed;
      particle.vy = SCRATCH.y * speed;
      particle.vz = SCRATCH.z * speed;

      const jitter = 1 - EFFECTS.particleLifeJitter * Math.random();
      particle.maxLife = EFFECTS.particleLife * jitter;
      particle.life = particle.maxLife;

      particle.r = tint.r;
      particle.g = tint.g;
      particle.b = tint.b;
    }
  }

  update(dt) {
    this._updateTracers(dt);
    this._updateParticles(dt);
  }

  _updateTracers(dt) {
    for (const slot of this.tracers) {
      if (slot.life <= 0) continue;

      if (slot.born) {
        slot.born = false; // draw once at full opacity before aging
        continue;
      }

      slot.life -= dt;
      if (slot.life <= 0) {
        slot.line.visible = false;
        continue;
      }
      slot.line.material.opacity = slot.life / EFFECTS.tracerLife;
    }
  }

  _updateParticles(dt) {
    for (let i = 0; i < this.live; i++) {
      const particle = this.pool[i];

      particle.life -= dt;
      if (particle.life <= 0) {
        // Swap the dead particle with the last live one and shrink the range.
        // Re-test index i, since a new particle now occupies it.
        this.live--;
        this.pool[i] = this.pool[this.live];
        this.pool[this.live] = particle;
        i--;
        continue;
      }

      particle.vy -= EFFECTS.particleGravity * dt;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.z += particle.vz * dt;

      // Sparks die on the floor rather than sinking through it.
      if (particle.y < 0.02) {
        particle.y = 0.02;
        particle.vy = 0;
        particle.vx *= 0.5;
        particle.vz *= 0.5;
      }

      const o = i * 3;
      this.positions[o] = particle.x;
      this.positions[o + 1] = particle.y;
      this.positions[o + 2] = particle.z;

      // Additive blending: scaling color toward black is the fade-out.
      const fade = particle.life / particle.maxLife;
      this.colors[o] = particle.r * fade;
      this.colors[o + 1] = particle.g * fade;
      this.colors[o + 2] = particle.b * fade;
    }

    const geometry = this.points.geometry;
    geometry.setDrawRange(0, this.live);
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.color.needsUpdate = true;
  }

  /** Drop everything in flight — called on restart so effects don't survive death. */
  clear() {
    this.live = 0;
    this.points.geometry.setDrawRange(0, 0);
    for (const slot of this.tracers) {
      slot.life = 0;
      slot.born = false;
      slot.line.visible = false;
    }
  }
}
