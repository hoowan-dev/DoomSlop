import { SOUND } from './config.js';

// Music is *imported*, not fetched from a runtime path, for the same reason the
// boss portraits are (see bosses.js): Vite rewrites the import to the emitted
// hashed URL, which inherits the './' base from vite.config.js. A literal
// 'assets/audio/doom.mp3' would resolve against the page URL and 404 under the
// GitHub Pages subpath.
import MUSIC_URL from '../assets/audio/doom.mp3';

// Sound effects are synthesized — built from oscillators and one shared noise
// buffer via the Web Audio API, which suits a game whose visuals are flat colors
// and no textures. The music bed is the one audio file, and the one thing here
// that isn't generated: a minute and a half of music isn't something oscillators
// produce. Don't take that as licence to add sample files for the effects.
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
    this.music = null;
    this.musicSource = null;
    this.noise = null;
    this._initialized = false;
    this._musicStarted = false;
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
    // After the resume, so the source isn't scheduled against a suspended clock.
    // Idempotent — see _startMusic(); every click after the first is a no-op.
    this._startMusic();
  }

  _init() {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return; // no Web Audio support: every method below no-ops

    this.ctx = new Ctx();

    this.master = this.ctx.createGain();
    this.master.gain.value = SOUND.masterVolume;
    this.master.connect(this.ctx.destination);

    // The music gets its own node to the destination rather than going through
    // `master`, for two reasons. masterVolume is headroom for several *effects*
    // stacking, which a single sustained bed doesn't participate in; and the sound
    // driver taps `master` with an AnalyserNode to measure whether each effect
    // generates signal, which music underneath would swamp. SOUND.music.gain is
    // therefore an absolute level, not a fraction of masterVolume.
    this.music = this.ctx.createGain();
    this.music.gain.value = SOUND.music.gain;
    this.music.connect(this.ctx.destination);

    // One second of white noise, generated once and shared by every effect that
    // wants a percussive edge. This buffer is the expensive part of the noise
    // layer; regenerating it per shot would be pure waste.
    const length = Math.floor(this.ctx.sampleRate);
    this.noise = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  }

  /**
   * Starts the looping music bed, once, and then never touches it again — there is
   * deliberately no stop(), no restart and no seek anywhere in the codebase. That
   * absence *is* the implementation of "keeps playing through a pause, a round
   * change, a death and a retry": nothing in the game can reach the source, and
   * pausing only stops main.js's frame loop, which the AudioContext's own clock
   * doesn't depend on. Anyone adding audio teardown to a reset path should expect
   * to break that.
   *
   * The loop window is a segment of the track rather than the whole file, which is
   * why this is an AudioBufferSourceNode and not an <audio> element: loopStart /
   * loopEnd are sample-accurate and gapless, where seeking an element from a
   * timeupdate handler is quantized to ~250ms and audibly stutters at the seam.
   * The cost is decoding the whole file up front, which is a few hundred ms on one
   * click, once.
   *
   * The guard is set *before* the await rather than after. Two clicks in quick
   * succession would both land while the decode is in flight, and the second source
   * wouldn't replace the first — an AudioBufferSourceNode is single-use, so it would
   * start a second copy of the track playing over the top of it.
   */
  _startMusic() {
    if (this._musicStarted || !this.ctx) return;
    this._musicStarted = true;

    fetch(MUSIC_URL)
      .then((res) => res.arrayBuffer())
      .then((bytes) => this.ctx.decodeAudioData(bytes))
      .then((buffer) => {
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true;
        src.loopStart = SOUND.music.loopStart;
        // A loopEnd past the end of the buffer is not an error — the spec treats it
        // as the buffer's end — so an over-long window would quietly play the track
        // out rather than fail. Clamping makes the config honest about what's
        // playing; the sound driver asserts the number didn't need clamping.
        src.loopEnd = Math.min(SOUND.music.loopEnd, buffer.duration);
        src.connect(this.music);
        // Offset to loopStart, so the trimmed lead-in never plays — not even on the
        // first pass, which start(t) with no offset would include.
        src.start(this.ctx.currentTime, src.loopStart);
        this.musicSource = src;
      })
      .catch((err) => {
        // Music failing must not take the effects down with it. Releasing the guard
        // lets the next overlay click retry, and the warning is the only signal a
        // missing or undecodable file would otherwise give — the drivers treat
        // console warnings as failures, which is the right outcome here.
        this._musicStarted = false;
        console.warn('music failed to start:', err);
      });
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
   * Collecting a drop, either kind: a short choir chord that swells instead of
   * cracking. One sound for both items rather than one each — the notice, the vignette
   * and the bar that fills all say *which* item it was, where a second chord would
   * only say it again in the one channel that can't be glanced at.
   *
   * Eight sine voices — a major triad plus the octave, each doubled a few cents
   * either side of pitch. The doubling is the whole trick: the pairs beat slowly
   * against each other, which is the chorusing that makes a unison sound like
   * several people rather than one organ pipe. They enter low to high so the chord
   * blooms upward rather than landing as a block.
   */
  itemPickup() {
    const s = SOUND.pickup;
    s.ratios.forEach((ratio, i) => {
      for (const detune of [-s.detune, s.detune]) {
        this._voice(s.root * ratio, detune, i * s.stagger, s.attack, s.duration, s.gain);
      }
    });
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

  /**
   * One held, detuned voice of a chord. The counterpart to _tone(): that one sweeps
   * its pitch and decays percussively, while this holds a pitch and *fades in*, which
   * is the difference between an event and a sustained note.
   *
   * @param delay seconds from now before this voice enters, so a chord can be
   *        staggered. Its duration runs from its own start, not from the chord's.
   * @param detune cents off `freq`, which is what turns doubled voices into a
   *        section. Kept on the node rather than folded into the frequency so the
   *        number in config stays readable as an interval.
   */
  _voice(freq, detune, delay, attack, duration, gain) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;

    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.detune.value = detune;

    const env = this.ctx.createGain();
    // From an epsilon rather than 0 so the fade out below can be exponential too —
    // and a linear attack, because an exponential one from near-silence is
    // indistinguishable from a click at this length.
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + attack);
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
