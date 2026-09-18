import { ROUNDS } from './config.js';

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
   * @param onAnnounce (text) => void — main.js routes this to hud.announce().
   *        Rounds has no DOM access, matching every other system here.
   */
  constructor(enemies, onAnnounce) {
    this.enemies = enemies;
    this.onAnnounce = onAnnounce;
    this.reset();
  }

  reset() {
    this.round = 1;
    this.kills = 0;
    this.bossDown = false;
    this.phase = 'fighting';
    this.timer = 0;
    this.enemies.setSpawning(true);
    this._pending = `ROUND ${this.round}`;
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
      this.onAnnounce?.(this._pending);
      this._pending = null;
    }

    switch (this.phase) {
      case 'fighting':
        if (this.kills < ROUNDS.killsPerRound) return;
        // Wipe the field so the boss walks into an empty arena. removeAll(), not
        // clear() — clear() would restart the difficulty ramp every round.
        this.enemies.removeAll();
        this.enemies.setSpawning(false);
        this._enter('incoming', ROUNDS.bossDelay, 'BOSS ROUND');
        return;

      case 'incoming':
        if ((this.timer -= dt) > 0) return;
        // Cleared here rather than on spawn, so a stray flag can't end the fight
        // on the frame it starts.
        this.bossDown = false;
        this.enemies.spawnBoss();
        this.phase = 'boss';
        return;

      case 'boss':
        if (!this.bossDown) return;
        this.round++;
        this.kills = 0;
        this._enter('breather', ROUNDS.roundDelay, `ROUND ${this.round}`);
        return;

      case 'breather':
        if ((this.timer -= dt) > 0) return;
        this.enemies.setSpawning(true);
        this.phase = 'fighting';
        return;
    }
  }

  _enter(phase, duration, announcement) {
    this.phase = phase;
    this.timer = duration;
    this._pending = announcement;
  }
}
