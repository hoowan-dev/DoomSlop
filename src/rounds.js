import { ROUNDS } from './config.js';
import { randomBoss } from './bosses.js';

// The core loop, and the only module that knows what a "round" is:
//
//   fighting --(killsPerRound shot kills)--> incoming --> boss --> breather --+
//      ^                                                                      |
//      +----------------------------------------------------------------------+
//
// Kills arrive via enemyDefeated(), but nothing acts on them there — the handler
// only tallies, and every phase change happens in update(). That matters: the
// kill is reported from inside EnemyManager.damage(), so acting immediately
// would call removeAll()/spawnBoss() re-entrantly, mutating the enemy array from
// inside a method that is iterating it. A frame boundary is a cheap fix.
//
// Owned by main.js, which calls update() only while the game is running. Two
// things fall out of that: the inter-round timers pause with the game, and a
// queued announcement can't flash away behind the click-to-start overlay.

export class Rounds {
  /**
   * @param player needed only to refill health when a boss dies. Passed in
   *        directly rather than routed through a callback, matching
   *        EnemyManager — it already holds the player and calls takeDamage(),
   *        so a gameplay system moving health is the established shape here.
   * @param onAnnounce (text, sub) => void — main.js routes this to
   *        hud.announce(). Rounds has no DOM access, matching every other
   *        system here.
   */
  constructor(enemies, player, onAnnounce) {
    this.enemies = enemies;
    this.player = player;
    this.onAnnounce = onAnnounce;
    this.reset();
  }

  reset() {
    this.round = 1;
    this.kills = 0;
    this.bossDown = false;
    // Which boss is coming, from bosses.js. Null until one is drawn at the wipe;
    // cleared here so a retry can't carry the dead run's boss into the next flash.
    this.bossIdentity = null;
    // Speed first: setSpawning() derives the pending spawn timer from the current
    // multiplier, so re-enabling spawning before pushing round 1's scale would
    // open a retry with the dead run's compressed interval.
    this._startRound('fighting', 0);
    this.enemies.setSpawning(true);
  }

  /**
   * Begin a round: push its speed to the enemies and queue its flash. Both entry
   * points go through here — a restart from reset(), and the boss dying — so they
   * can't drift. A retry that reads round 1 while the floaters keep round 7's
   * speed is the bug this exists to prevent.
   */
  _startRound(phase, duration) {
    this.enemies.setSpeedScale(this.speedScale);
    this._enter(phase, duration, `ROUND ${this.round}`, this.speedLabel);
  }

  /**
   * Speed multiplier for the current round: 1 in round 1, then a flat
   * ROUNDS.speedStep more each round — 1.0, 1.5, 2.0 at the shipped 0.5. A step
   * added to the base rather than a rate compounded on the previous round, so the
   * ladder stays readable at a glance instead of drifting into 2.31x.
   *
   * Derived from the round number rather than accumulated in a field, so it can't
   * drift out of step with it.
   */
  get speedScale() {
    return 1 + ROUNDS.speedStep * (this.round - 1);
  }

  /** Second line of the round flash, e.g. `ENEMY SPEED: 1.32x`. */
  get speedLabel() {
    return `ENEMY SPEED: ${this.speedScale.toFixed(2)}x`;
  }

  /** True from the BOSS ROUND flash until the boss is dead. */
  get bossFight() {
    return this.phase === 'incoming' || this.phase === 'boss';
  }

  /** Readout text for the HUD, e.g. `ROUND 3` or `ROUND 3 BOSS`. */
  get label() {
    return this.bossFight ? `ROUND ${this.round} BOSS` : `ROUND ${this.round}`;
  }

  /**
   * Readout text for progress toward the boss, e.g. `KILLS 12/50`, or null
   * during the boss fight — there's nothing left to count then, and `label`
   * already says BOSS. The HUD hides the field on null rather than showing a
   * frozen `50/50` that looks like it's still counting.
   *
   * Reads killsPerRound at call time, so retuning it live is reflected here.
   */
  get progress() {
    return this.bossFight ? null : `KILLS ${this.kills}/${ROUNDS.killsPerRound}`;
  }

  /**
   * Something was shot dead. Wired to `enemies.onDefeat` by main.js.
   *
   * Contact kills never reach here — enemies.js only reports from damage(), not
   * from remove() — so a floater that reaches the player and vanishes doesn't
   * count toward the round. Same rule the score already follows: you have to
   * actually kill them.
   */
  enemyDefeated(enemy) {
    if (enemy.isBoss) this.bossDown = true;
    else this.kills++;
  }

  update(dt) {
    // Announcements are queued rather than fired at the transition, so reset()
    // can safely request one while the game is still paused.
    if (this._pending) {
      this.onAnnounce?.(this._pending.text, this._pending.sub);
      this._pending = null;
    }

    switch (this.phase) {
      case 'fighting':
        if (this.kills < ROUNDS.killsPerRound) return;
        // Wipe the field so the boss walks into an empty arena. removeAll(), not
        // clear() — clear() would restart the difficulty ramp every round.
        this.enemies.removeAll();
        this.enemies.setSpawning(false);
        // Drawn here rather than at the spawn a beat later, because the flash is
        // what names it — the announcement is the introduction.
        this.bossIdentity = randomBoss();
        this._enter('incoming', ROUNDS.bossDelay, 'BOSS ROUND', this.bossIdentity.name);
        return;

      case 'incoming':
        if ((this.timer -= dt) > 0) return;
        // Cleared here rather than on spawn, so a stray flag can't end the fight
        // on the frame it starts.
        this.bossDown = false;
        this.enemies.spawnBoss(this.bossIdentity);
        this.phase = 'boss';
        return;

      case 'boss':
        if (!this.bossDown) return;
        this.round++;
        this.kills = 0;
        // Killing the boss pays for a full heal. Without it damage accumulates
        // across rounds with no way to get it back, so a long run ends to
        // attrition from whatever floater happens to be next rather than to any
        // fight worth losing to. Here and not in reset(): a restart goes through
        // player.reset(), which is already full health.
        this.player.refillHealth();
        this._startRound('breather', ROUNDS.roundDelay);
        return;

      case 'breather':
        if ((this.timer -= dt) > 0) return;
        this.enemies.setSpawning(true);
        this.phase = 'fighting';
        return;
    }
  }

  /**
   * @param sub optional second line for the flash — the round's enemy speed on a
   *        round flash, the boss's name on BOSS ROUND. Kept out of `announcement`
   *        rather than newline-joined so the HUD can style the two lines
   *        differently, which is also why the two callers can put unrelated text
   *        there without the layout caring.
   */
  _enter(phase, duration, announcement, sub = null) {
    this.phase = phase;
    this.timer = duration;
    this._pending = { text: announcement, sub };
  }
}
