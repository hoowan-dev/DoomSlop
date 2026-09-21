import * as THREE from 'three';
import { POPUP } from './config.js';

// The HUD is plain DOM on top of the canvas — cheaper and easier to style than
// anything drawn in the scene.

// Scratch vector for projecting world points (the boss's head, a score popup) to
// screen space, reused every frame so the loop doesn't allocate.
const PROJECTED = new THREE.Vector3();

export class Hud {
  /**
   * @param camera needed to project the world-anchored bits — the boss health bar
   *        and the score popups. Everything else here is a plain value read off
   *        game state.
   */
  constructor(camera) {
    this.camera = camera;

    this.healthEl = document.getElementById('health');
    this.scoreEl = document.getElementById('score');
    this.roundEl = document.getElementById('round');
    this.progressEl = document.getElementById('progress');
    this.overlayEl = document.getElementById('overlay');
    this.crosshairEl = document.getElementById('crosshair');
    this.flashEl = document.getElementById('muzzle');
    this.announceEl = document.getElementById('announce');
    this.announceTitleEl = document.getElementById('announce-title');
    this.announceSubEl = document.getElementById('announce-sub');
    this.bossBarEl = document.getElementById('bossbar');
    this.bossFillEl = document.getElementById('bossbar-fill');

    this._health = null;
    this._score = null;
    this._round = null;
    // undefined, not null: null is a real value for progress (it means "hide
    // this"), so it can't double as the never-written-yet sentinel.
    this._progress = undefined;
    this._bossFill = null;
    this._bossShown = false;
    this._hitTimer = null;

    this._buildPopups();
  }

  /**
   * Fixed pool of score popup divs. Built here rather than written into
   * index.html because the count is a config value, and preallocated rather than
   * created per kill for the same reason effects.js pools its particles: kills
   * come several a second and churning DOM nodes would give the GC steady work.
   */
  _buildPopups() {
    const parent = document.getElementById('popups');
    this.popups = [];

    for (let i = 0; i < POPUP.pool; i++) {
      const el = document.createElement('div');
      el.className = 'popup hidden';
      parent.appendChild(el);
      // `life` counts down; <= 0 means this slot is free. `origin` is the world
      // point it's anchored to, owned here so the caller's vector can be reused.
      this.popups.push({ el, life: 0, origin: new THREE.Vector3(), shown: false });
    }
  }

  /**
   * Big centered text: ROUND 1, BOSS ROUND, ROUND 2.
   *
   * @param sub optional second line under it — the round's enemy speed, or the
   *        boss's name on BOSS ROUND. Both already formatted by rounds.js; the HUD
   *        doesn't care which it got. Emptied rather than hidden when absent, since
   *        the line is in normal flow and an empty one collapses.
   */
  announce(text, sub = null) {
    this.announceTitleEl.textContent = text;
    this.announceSubEl.textContent = sub ?? '';

    // Same retrigger dance as the muzzle flash below — without the reflow, a
    // second announcement inside the animation window wouldn't replay it.
    this.announceEl.classList.remove('flash');
    void this.announceEl.offsetWidth;
    this.announceEl.classList.add('flash');
  }

  /**
   * Shot feedback. Both effects are CSS animations retriggered by removing and
   * re-adding the class — without the reflow between, a second shot inside the
   * animation window wouldn't replay it.
   */
  shotFired(didHit) {
    this.flashEl.classList.remove('firing');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('firing');

    if (!didHit) return;

    this.crosshairEl.classList.add('hit');
    clearTimeout(this._hitTimer);
    this._hitTimer = setTimeout(() => this.crosshairEl.classList.remove('hit'), 120);
  }

  /**
   * @param round already-formatted text from `rounds.label`.
   * @param progress already-formatted text from `rounds.progress`, or null to
   *        hide the field entirely (the boss fight has nothing to count).
   */
  update(health, score, round, progress) {
    // Only touch the DOM when a value actually changed.
    if (health !== this._health) {
      this.healthEl.textContent = `HP ${health}`;
      this._health = health;
    }
    if (score !== this._score) {
      this.scoreEl.textContent = `SCORE ${score}`;
      this._score = score;
    }
    if (round !== this._round) {
      this.roundEl.textContent = round;
      this._round = round;
    }
    if (progress !== this._progress) {
      this.progressEl.textContent = progress ?? '';
      this.progressEl.classList.toggle('hidden', progress === null);
      this._progress = progress;
    }
  }

  /**
   * Health bar floating over the boss's head, or hidden when there's no boss.
   *
   * The boss is a world object with no DOM anchor, so its screen position has to
   * be projected every frame. Everything the bar needs comes off `enemy.kind`
   * rather than the BOSS config block directly, which keeps this function
   * ignorant of which kind of enemy it was handed.
   */
  updateBoss(boss) {
    if (!boss) {
      this._showBossBar(false);
      return;
    }

    const lift = boss.kind.radius + boss.kind.healthBarLift;
    if (!this._place(this.bossBarEl, boss.mesh.position, lift)) {
      this._showBossBar(false);
      return;
    }

    this._showBossBar(true);

    const fill = Math.max(0, boss.health) / boss.kind.health;
    if (fill !== this._bossFill) {
      this.bossFillEl.style.width = `${fill * 100}%`;
      this._bossFill = fill;
    }
  }

  _showBossBar(show) {
    if (show === this._bossShown) return;
    this.bossBarEl.classList.toggle('hidden', !show);
    this._bossShown = show;
  }

  /**
   * A kill just scored: float the points up from where it died, in green.
   *
   * @param points what the player earned — the same number damage() returned, so
   *        the popup can't disagree with the score readout.
   * @param position the dead enemy's world position. Copied, not retained: the
   *        mesh is already out of the scene and about to be garbage.
   */
  scorePopup(points, position) {
    const popup = this._freePopup();
    popup.el.textContent = `+${points}`;
    popup.origin.copy(position);
    popup.life = POPUP.life;
  }

  /** A free slot, or failing that the one closest to expiring. */
  _freePopup() {
    let oldest = this.popups[0];
    for (const popup of this.popups) {
      if (popup.life <= 0) return popup;
      if (popup.life < oldest.life) oldest = popup;
    }
    return oldest;
  }

  /**
   * Drive the live popups. Called from main.js *after* weapon.update(), so a
   * popup spawned this frame gets positioned before it's ever shown — run it
   * first and a fresh popup paints one frame at the top-left corner.
   *
   * Only called while the game is running, so popups freeze rather than expiring
   * behind the pause overlay.
   */
  updatePopups(dt) {
    for (const popup of this.popups) {
      if (popup.life <= 0) continue;

      popup.life -= dt;
      if (popup.life <= 0) {
        this._showPopup(popup, false);
        continue;
      }

      // Ease-out rise: a quick hop off the kill that slows as it fades, which
      // reads as a pop rather than a drift.
      const remaining = popup.life / POPUP.life;
      const eased = 1 - remaining * remaining;

      if (!this._place(popup.el, popup.origin, POPUP.lift + POPUP.rise * eased)) {
        // Turned away from the kill. Hidden rather than released — turn back
        // inside its lifetime and it's still there.
        this._showPopup(popup, false);
        continue;
      }

      this._showPopup(popup, true);
      popup.el.style.opacity = Math.min(1, remaining / POPUP.fadeAt);
    }
  }

  _showPopup(popup, show) {
    if (show === popup.shown) return;
    popup.el.classList.toggle('hidden', !show);
    popup.shown = show;
  }

  /** Drop every popup. For a restart, so the next run starts clean. */
  clearPopups() {
    for (const popup of this.popups) {
      popup.life = 0;
      this._showPopup(popup, false);
    }
  }

  /**
   * Anchor a DOM element to a world point, `yOffset` units above it. Returns
   * false if the point is behind the camera, where project() mirrors x/y through
   * the origin and would place the element somewhere plausible-looking but wrong.
   * Off to the sides needs no such check — it just clips at the viewport edge.
   */
  _place(el, point, yOffset) {
    PROJECTED.copy(point);
    PROJECTED.y += yOffset;
    PROJECTED.project(this.camera);

    if (PROJECTED.z >= 1) return false;

    // NDC (-1..1, y up) to CSS pixels (y down). The canvas fills the window, so
    // innerWidth/innerHeight are the right extents. Both elements are centered on
    // the point by a CSS translate.
    el.style.left = `${(PROJECTED.x * 0.5 + 0.5) * window.innerWidth}px`;
    el.style.top = `${(-PROJECTED.y * 0.5 + 0.5) * window.innerHeight}px`;
    return true;
  }

  showOverlay(title, subtitle) {
    this.overlayEl.querySelector('h1').textContent = title;
    this.overlayEl.querySelector('p').textContent = subtitle;
    this.overlayEl.classList.remove('hidden');
  }

  hideOverlay() {
    this.overlayEl.classList.add('hidden');
  }
}
