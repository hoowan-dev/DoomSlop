import { SOUND } from './config.js';

// Synthesized sound effects — there are no audio files. Every effect is built
// from oscillators and one shared noise buffer via the Web Audio API, which
// keeps the project asset-free and suits a game whose visuals are flat colors
// and no textures.
//
// Owned by main.js: it calls resume() from the click that starts the game and
// triggers each effect. Nothing else in the codebase calls in here, and this
// module knows nothing about gameplay.

export class Sound {
  constructor() {
    // The AudioContext is built lazily in resume(), not here. Constructing one
    // before a user gesture leaves it suspended and logs an autoplay warning —
    // and the test drivers treat console warnings as failures.
    this.ctx = null;
    this.master = null;
    this.noise = null;
    this._initialized = false;
  }

  /**
   * Must be called from a real user gesture (the overlay click). Safe to call
   * repeatedly: browsers suspend the context when the tab is backgrounded, so
   * every click through the overlay gets another chance to wake it.
   */
  resume() {
    if (!this._initialized) {
      this._initialized = true;
      this._init();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  _init() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return; // no Web Audio support: every method below no-ops

    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.gain.value = SOUND.masterVolume;
    this.master.connect(this.ctx.destination);

    // One second of white noise, generated once and shared by every effect that
    // wants a percussive edge. This buffer is the expensive part of the noise
    // layer; regenerating it per shot would be pure waste.
    const length = Math.floor(this.ctx.sampleRate);
    this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }

  /** Dry low crack. Fires up to ~5.5 times a second, so it stays very short. */
  shoot() {
    const s = SOUND.shoot;
    this._tone('square', s.pitchFrom, s.pitchTo, s.duration, s.gain);
    this._noiseBurst(s.duration, s.noiseGain, s.cutoff);
  }

  /** Bright descending blip — reads as something popping. */
  enemyKilled() {
    const s = SOUND.kill;
    this._tone('triangle', s.pitchFrom, s.pitchTo, s.duration, s.gain);
    this._noiseBurst(s.noiseDuration, s.noiseGain, s.cutoff);
  }

  /** Low and harsh, and the longest of the four so a hit can't be missed. */
  playerDamaged() {
    const s = SOUND.damage;
    this._tone('sawtooth', s.pitchFrom, s.pitchTo, s.duration, s.gain);
    this._noiseBurst(s.duration, s.noiseGain, s.cutoff);
  }

  /**
   * UI click for the pause overlay. Rising when resuming, falling when pausing —
   * the same sound inverted, so the two read as a matched pair instead of as
   * unrelated beeps.
   */
  click(rising) {
    const s = SOUND.click;
    const from = rising ? s.pitchLow : s.pitchHigh;
    const to = rising ? s.pitchHigh : s.pitchLow;
    this._tone('sine', from, to, s.duration, s.gain);
  }

  /**
   * A pitch-swept oscillator with a percussive decay.
   *
   * Oscillator and BufferSource nodes are single-use by design — they can't be
   * restarted — so each sound builds fresh ones. That's idiomatic Web Audio, not
   * an oversight: unlike the particle pools, there is nothing here to reuse.
   */
  _tone(type, from, to, duration, gain) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    // Exponential rather than linear, so the sweep reads as a pitch drop instead
    // of a slide through the midrange.
    osc.frequency.exponentialRampToValueAtTime(to, t + duration);

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    // exponentialRampToValueAtTime rejects a target of 0, hence the epsilon.
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + duration);
  }

  /** Filtered white noise, layered under a tone to give it an attack. */
  _noiseBurst(duration, gain, cutoff) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;

    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = cutoff;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);

    src.connect(lowpass).connect(env).connect(this.master);

    // Start at a random point in the buffer so repeated shots don't replay an
    // identical noise fragment, which would make rapid fire sound synthetic.
    const offset = Math.random() * Math.max(0, this.noise.duration - duration);
    src.start(t, offset, duration);
  }
}
