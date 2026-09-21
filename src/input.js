import { INPUT } from './config.js';

// Raw input plumbing: pointer lock, held keys, and accumulated mouse movement.
// This is deliberately gameplay-free — it reports what the hardware did and
// lets player.js / weapon.js decide what it means.
//
// "What the hardware did" still means filtering what it plainly didn't do: see
// the spike rejection in the mousemove handler. That's signal conditioning, not
// gameplay meaning, and it has to happen here because it's only decidable
// per-event — by the time player.js reads the accumulator the events are summed.

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();

    // Keys that went down since the last consumePress() for each, as opposed to
    // `keys`, which is what's held right now. Held state is wrong for anything
    // that should happen once per press — a per-frame isDown() check on a skip or
    // a toggle fires every frame the key is down, sixty times for one tap.
    this.presses = new Set();

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
      // e.repeat filters the OS auto-repeat, so holding the key is one press and
      // not a stream of them. Codes, not `e.key`: `~` only arrives as a key with
      // Shift held, while Backquote is the physical key either way.
      if (!e.repeat) this.presses.add(e.code);
    });
    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;

      // Drop whatever was accumulated but never read. player.js only consumes the
      // accumulator while the game is running, so movement that lands after the
      // last update() of a session — a flick that ends in the same breath as Esc —
      // would otherwise sit here through the whole pause and be applied as one jump
      // on resume. Cleared in both directions: on release because that input is
      // stale, on acquire because anything queued before the first frame belongs to
      // aiming the click, not to looking around.
      this.mouseDX = 0;
      this.mouseDY = 0;
      // Unread presses go with it, for the same reason: main.js only drains these
      // while running, so a tap that lands during a pause would otherwise fire on
      // the frame after resume.
      this.presses.clear();

      if (!this.locked) {
        // Dropping lock (Esc, alt-tab) should never leave keys or the trigger stuck.
        this.keys.clear();
        this.firing = false;
      }
      this.onLockChange?.(this.locked);
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;

      // Reject the event whole if either axis is implausible. Under pointer lock
      // the browser can hand back a movementX of half a screen width in a single
      // event when the underlying cursor gets warped, which lands as the view
      // teleporting to a new heading. Discarded rather than clamped: a spike is a
      // bad reading, so the honest response is to have seen nothing, where
      // clamping would still swing the view 50 degrees on made-up data. The cost
      // is that a genuinely superhuman flick loses one event's worth of turn —
      // cheap next to arriving at a heading you never aimed at.
      if (Math.abs(e.movementX) > INPUT.maxLookDelta) return;
      if (Math.abs(e.movementY) > INPUT.maxLookDelta) return;

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

  /**
   * True if `code` went down since this was last asked, and consumes it — so one
   * physical tap reads true exactly once, to exactly one caller. Destructive like
   * consumeMouseDelta(), and for the same reason: an edge is a single event, and
   * two readers of one event means one of them is wrong.
   */
  consumePress(code) {
    return this.presses.delete(code);
  }

  /** Returns the mouse movement since the last call and resets the accumulator. */
  consumeMouseDelta() {
    const delta = { x: this.mouseDX, y: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return delta;
  }
}
