// Raw input plumbing: pointer lock, held keys, and accumulated mouse movement.
// This is deliberately gameplay-free — it reports what the hardware did and
// lets player.js / weapon.js decide what it means.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();

    // Mouse movement accumulated since the last consumeMouseDelta() call.
    this.mouseDX = 0;
    this.mouseDY = 0;

    // True while the primary mouse button is held.
    this.firing = false;

    this.locked = false;
    this.onLockChange = null; // set by main.js to show/hide the overlay

    this._bind();
  }

  _bind() {
    document.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
    });
    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) {
        // Dropping lock (Esc, alt-tab) should never leave keys or the trigger stuck.
        this.keys.clear();
        this.firing = false;
      }
      this.onLockChange?.(this.locked);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });

    document.addEventListener('mousedown', (e) => {
      if (this.locked && e.button === 0) this.firing = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.firing = false;
    });
  }

  requestLock() {
    this.canvas.requestPointerLock();
  }

  isDown(code) {
    return this.keys.has(code);
  }

  /** Returns the mouse movement since the last call and resets the accumulator. */
  consumeMouseDelta() {
    const delta = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return delta;
  }
}
