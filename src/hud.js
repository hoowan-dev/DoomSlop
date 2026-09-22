import * as THREE from 'three';
import { HITMARK, PLAYER, POPUP } from './config.js';

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
    this.healthFillEl = document.getElementById('healthbar-fill');
    this.armorEl = document.getElementById('armor');
    this.armorFillEl = document.getElementById('armorbar-fill');
    this.bootsEl = document.getElementById('boots');
    this.bootsTimeEl = document.getElementById('bootstime');
    this.bootsFillEl = document.getElementById('bootsbar-fill');
    this.scoreEl = document.getElementById('score');
    this.roundEl = document.getElementById('round');
    this.progressEl = document.getElementById('progress');
    this.overlayEl = document.getElementById('overlay');
    this.crosshairEl = document.getElementById('crosshair');
    this.flashEl = document.getElementById('muzzle');
    this.announceEl = document.getElementById('announce');
    this.announceTitleEl = document.getElementById('announce-title');
    this.announceSubEl = document.getElementById('announce-sub');
    this.noticeEl = document.getElementById('notice');
    this.vignetteEl = document.getElementById('vignette');
    this.bossBarEl = document.getElementById('bossbar');
    this.bossFillEl = document.getElementById('bossbar-fill');
    this.musicEl = document.getElementById('musicstate');

    this._health = null;
    this._armor = null;
    this._bootsShown = false;
    this._bootsSeconds = null;
    this._score = null;
    this._round = null;
    // undefined, not null: null is a real value for progress (it means "hide
    // this"), so it can't double as the never-written-yet sentinel.
    this._progress = undefined;
    this._bossFill = null;
    this._bossShown = false;
    this._musicOn = null;
    this._hitTimer = null;

    this._buildPopups();
    this._buildHitMarks();
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
   * A one-line message under the crosshair: "HP RESTORED", "AP RESTORED" or
   * "SUPER BOOTS" when a drop is taken. Separate from announce() rather than a third argument to it — that
   * one owns the center of the screen and is driven by the round machine, which times
   * ROUNDS.bossDelay against its animation. This has no such coupling, and nothing
   * waits on it, so its whole duration is the CSS.
   *
   * @param kind 'heal', 'armor' or 'boots', doubling as the CSS class that colors it, exactly
   *        as vignette()'s argument does — so there's no mapping table here to keep in
   *        step with the stylesheet. Tinted rather than left one color because the
   *        vignette that goes up with it is the item's color, and a green message
   *        under a blue flash reads as two unrelated events.
   */
  notice(text, kind = 'heal') {
    this.noticeEl.textContent = text;

    // Same retrigger dance as the announcement and the muzzle flash: without the
    // reflow between, a second pickup inside the animation window wouldn't replay it.
    // The tint comes off with it, so back-to-back drops of different kinds can't leave
    // one message wearing the other's color.
    this.noticeEl.classList.remove('flash', 'heal', 'armor', 'boots');
    void this.noticeEl.offsetWidth;
    this.noticeEl.classList.add(kind, 'flash');
  }

  /**
   * Fixed pool of hit-direction wedges, built here rather than in index.html for
   * the same reason the popups are: the count is a config value.
   *
   * Two nested divs per slot, and the nesting is what makes this work. The outer
   * one carries the bearing as an inline `rotate()` and the inner one carries the
   * CSS animation — which animates `transform` to kick the wedge outward, and
   * would overwrite the rotation if they shared an element. Nested, the inner
   * translate runs in the outer's already-rotated frame, so "outward" is radial
   * for free at any bearing.
   */
  _buildHitMarks() {
    const parent = document.getElementById('hitmarks');
    this.hitMarks = [];

    for (let i = 0; i < HITMARK.pool; i++) {
      const el = document.createElement('div');
      el.className = 'hitmark';
      const wedge = document.createElement('div');
      wedge.className = 'wedge';
      el.appendChild(wedge);
      parent.appendChild(el);
      this.hitMarks.push({ el, wedge });
    }

    // Round-robin rather than the popups' free-slot search: these have no
    // lifetime here to search on — the CSS animation is their whole duration, so
    // the HUD never learns when one ended. With a pool several times what a
    // simultaneous swarm can land, walking the ring can only ever clobber the
    // oldest, which is the same rule _freePopup() falls back to anyway.
    this._nextHitMark = 0;
  }

  /**
   * A wedge pointing at whatever just hit the player.
   *
   * @param bearing radians clockwise from straight ahead, from
   *        player.bearingTo(). CSS rotate() is clockwise for positive angles and
   *        takes radians directly, so the angle needs no conversion — it's the
   *        same convention the minimap draws enemy dots in.
   */
  hitFrom(bearing) {
    const mark = this.hitMarks[this._nextHitMark];
    this._nextHitMark = (this._nextHitMark + 1) % this.hitMarks.length;

    mark.el.style.transform = `rotate(${bearing}rad)`;

    // Same retrigger dance as every other CSS-driven flash here. On the inner
    // element, since that's the one holding the animation.
    mark.wedge.classList.remove('flash');
    void mark.wedge.offsetWidth;
    mark.wedge.classList.add('flash');
  }

  /**
   * Full-screen tint pulsing in from the edges: red on taking a hit, green on
   * collecting health, blue on armor, yellow on the boots. One element and one animation
   * for all of them, with the color swapped by the class — they're the same event shape
   * ("what you can survive just changed, look at the bars") pointing in different
   * directions, and splitting them into an overlay each would let the fades drift
   * apart.
   *
   * @param kind 'damage', 'heal', 'armor' or 'boots'. Doubles as the CSS class, so
   *        there's no mapping table to keep in step with the stylesheet.
   */
  vignette(kind) {
    // The tint classes come off with the animation: a heal landing inside a
    // damage flash has to replace its color, not sit on top of it.
    this.vignetteEl.classList.remove('flash', 'damage', 'heal', 'armor', 'boots');
    void this.vignetteEl.offsetWidth;
    this.vignetteEl.classList.add(kind, 'flash');
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
   * @param armor the player's AP. Sits next to `health` in the signature because
   *        they're the same kind of thing drawn the same way — see `_vital()`.
   * @param round already-formatted text from `rounds.label`.
   * @param progress already-formatted text from `rounds.progress`, or null to
   *        hide the field entirely (the boss fight has nothing to count).
   */
  update(health, armor, score, round, progress) {
    // Only touch the DOM when a value actually changed.
    if (health !== this._health) {
      this._vital(this.healthEl, this.healthFillEl, 'HP', health, PLAYER.maxHealth);
      this._health = health;
    }
    if (armor !== this._armor) {
      this._vital(this.armorEl, this.armorFillEl, 'AP', armor, PLAYER.maxArmor);
      this._armor = armor;
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
   * One of the two bottom-center pools: the number and the bar under `#vitals`.
   *
   * Both are written together, off the caller's single change check, rather than each
   * tracking its own — they're two views of one value and must not be able to
   * disagree. The fraction is clamped even though takeDamage() already floors both
   * pools at 0, because they're also written directly (player.reset(), and the
   * drivers), and CSS ignores a negative width outright: the bar would sit at
   * whatever it last was rather than emptying.
   *
   * One helper for both pools rather than two copies, because "a number over a bar"
   * is the whole of what either one is — a third pool would be a third call, not more
   * code here.
   */
  _vital(labelEl, fillEl, label, value, max) {
    labelEl.textContent = `${label} ${value}`;
    const fill = Math.max(0, Math.min(1, value / max));
    fillEl.style.width = `${fill * 100}%`;
  }

  /**
   * The SUPER BOOTS row, on top of the two pools: a yellow bar draining from full with
   * `SB <seconds>` under it. Its own method rather than a sixth argument to update(),
   * for the same reason updateBoss() is one — this isn't a value the HUD paints every
   * frame regardless, it's a thing that isn't there most of the time.
   *
   * Deliberately *not* run through _vital(), even though it's a number over a bar. That
   * helper exists to make a level and its label two views of one value, and here they
   * aren't: the bar drains continuously while the number steps in whole seconds, so
   * writing them from one value would either give a bar that jumps once a second or a
   * label reading SB 6.4283.
   *
   * @param remaining seconds of buff left, straight off player.boostTime.
   * @param duration what it started at (player.boostDuration), so the fraction can be
   *        drawn without this file knowing which item grants it or for how long.
   */
  updateBoost(remaining, duration) {
    const active = remaining > 0;

    if (active !== this._bootsShown) {
      this.bootsEl.classList.toggle('hidden', !active);
      this._bootsShown = active;
    }

    // Nothing to write behind a hidden row, and skipping it also means the next buff
    // starts from a full bar rather than briefly showing the last one's final frame.
    if (!active) return;

    // Ceiled, so the final second reads SB 1 for the whole of it rather than SB 0.
    const seconds = Math.ceil(remaining);
    if (seconds !== this._bootsSeconds) {
      this.bootsTimeEl.textContent = `SB ${seconds}`;
      this._bootsSeconds = seconds;
    }

    // The one fill in the HUD written every frame rather than off a change check:
    // it's draining continuously, so "did it change" is always yes. It's also the one
    // with no CSS transition, for the same reason — see style.css.
    const fill = duration > 0 ? Math.max(0, Math.min(1, remaining / duration)) : 0;
    this.bootsFillEl.style.width = `${fill * 100}%`;
  }

  /**
   * Whether the music is on, written into the M row of #controls — the one element
   * in that panel JS touches, and the reason the row's action text carries an id
   * where the other five are literals.
   *
   * It lives in the controls list rather than in a corner of its own for two
   * reasons: every other corner is taken (radar, readout, vitals, build number),
   * and a player wondering about the silence is asking one question — "is the music
   * on, and what turns it on?" — which the key and the state answer together.
   *
   * Change-cached like the rest of the HUD, and it earns it more than most: this
   * moves on a keypress, so the cache means a per-frame call costs one comparison.
   */
  updateMusic(enabled) {
    if (enabled === this._musicOn) return;
    this._musicOn = enabled;

    this.musicEl.textContent = enabled ? 'MUSIC ON' : 'MUSIC OFF';
    // Lit when on, dim with the rest of the panel when off — the state has to be
    // readable at a glance from a row that's deliberately quiet, and brightness
    // says "this one is active" without a second color to interpret.
    this.musicEl.classList.toggle('on', enabled);
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

  /**
   * The subtitle is found with querySelector('p'), which takes the *first*
   * paragraph — so the overlay has to stay at one. It used to carry a second one
   * listing the controls, which is why this is worth saying: that list is
   * #controls now, and re-adding it here as a <p> above this one would silently
   * turn the controls into the pause message.
   */
  showOverlay(title, subtitle) {
    this.overlayEl.querySelector('h1').textContent = title;
    this.overlayEl.querySelector('p').textContent = subtitle;
    this.overlayEl.classList.remove('hidden');
  }

  hideOverlay() {
    this.overlayEl.classList.add('hidden');
  }
}
