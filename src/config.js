// Every tunable number in one place. Gameplay modules read from here rather
// than hardcoding values, so balancing is a single-file edit.

export const WORLD = {
  arenaSize: 60, // floor is arenaSize x arenaSize, centered on the origin
  wallHeight: 8,
};

export const PLAYER = {
  eyeHeight: 1.7, // also the resting camera height, i.e. the ground for a jump
  moveSpeed: 7, // units per second
  lookSensitivity: 0.0022, // radians per pixel of mouse movement
  maxHealth: 100,
  radius: 0.4, // for wall collision

  // The jump, and the only vertical motion in the game. These two fully determine
  // it: the hop peaks at jumpSpeed^2 / (2 * gravity) — 1.06 units here — and lasts
  // 2 * jumpSpeed / gravity, or 0.65s. Raising jumpSpeed alone makes it both
  // higher and slower; raising gravity with it keeps it snappy.
  //
  // Two things to respect when retuning. `eyeHeight` plus that apex has to stay
  // under WORLD.wallHeight, or a jump lets the player see out over the arena. And
  // jumping is deliberately *not* a dodge — contact damage is measured on the XZ
  // plane (see enemies.js), so height buys nothing defensively no matter how high
  // this goes.
  jumpSpeed: 6.5, // initial upward velocity, units/sec
  gravity: 20, // units/sec^2
};

// Hardware-level input conditioning. Separate from PLAYER.lookSensitivity on
// purpose: that number is *interpretation* (pixels to radians) and belongs to
// player.js, while this one is noise rejection on the raw signal and belongs to
// input.js. Different owners, different blocks.
export const INPUT = {
  // Ceiling on a single mousemove's movementX/movementY, in pixels. An event over
  // this is discarded whole — see input.js. Chrome delivers at most one mousemove
  // per frame, so one event is ~10ms of hand movement: at PLAYER.lookSensitivity
  // 400px is a ~50 degree snap, already past what a human flick can produce in
  // that time. Pointer-lock cursor warps come in at half a screen width or more
  // (960px+ at 1920), so this sits with clear margin on both sides.
  maxLookDelta: 400,
};

export const ENEMY = {
  speed: 2.2, // units per second, straight at the player
  radius: 0.6,
  health: 1, // hits to kill
  touchDamage: 25, // damage dealt when an enemy reaches the player
  spawnInterval: 1.6, // seconds between spawns at the start of a round
  spawnIntervalMin: 0.45, // floor the interval ramps down to
  rampDuration: 90, // seconds to go from spawnInterval to spawnIntervalMin
  spawnDistance: 25, // how far from the player they appear
  // Where they *settle*, not where they appear: an enemy spawns somewhere in the
  // band below and levels out to this as it closes, so this is the height it
  // fights at.
  hoverHeight: 1.6,
  // The band they spawn in, so a wave arrives at mixed heights instead of all on
  // one plane — some dropping in from overhead, some skimming the floor. Both ends
  // have to clear the geometry: under `radius` the orb sinks into the floor, and
  // over WORLD.wallHeight - radius it pokes out above the walls.
  //
  // They converge on hoverHeight before they arrive, which is what keeps the
  // XZ-planar contact check honest — something still 6 units overhead landing a
  // hit would read as damage out of nowhere. Charging a fresh high spawn is the
  // one way to meet one before it has come down, and that's the player's doing.
  spawnHeightMin: 0.9,
  spawnHeightMax: 6,
  spin: 1, // multiplier on the cosmetic tumble rate
  scoreValue: 100,
};

// The round boss. Every field ENEMY has, because enemies.js reads whichever of
// the two blocks an enemy was spawned from — add a per-enemy tunable to one and
// it has to exist in the other. `attackInterval` is the exception: only the boss
// survives contact, so only the boss needs a rate limit on its hits.
//
// Pulled out of the block because three fields have to be the same number — see
// spawnHeightMin below, where being equal to the hover height is the point.
const BOSS_HOVER = 3.4;

export const BOSS = {
  speed: 1.3, // slower than a floater, and outrunnable until ROUNDS.speedStep carries it past PLAYER.moveSpeed (round 10 as shipped)
  radius: 3,
  health: 50, // shots to kill
  touchDamage: 20,
  // Unlike a floater the boss isn't consumed when it reaches the player — it has
  // to be shot down. Without a cooldown it would land a hit every frame and
  // erase a full health bar in a fraction of a second.
  attackInterval: 1.2,
  // Must stay below arenaSize/2 - radius, or every bearing is out of bounds and
  // _spawnPoint() falls through to its center-ward fallback on every attempt.
  spawnDistance: 20,
  hoverHeight: BOSS_HOVER,
  // The boss deliberately doesn't get the floaters' height variety: its entrance
  // is staged — named by the flash, alone in a wiped arena — and a radius-3 orb
  // arriving at a random altitude reads as a glitch rather than as variety. There's
  // barely room for it anyway, between its radius and WORLD.wallHeight. Both ends
  // equal to hoverHeight makes the settle in enemies.js a no-op for this tier.
  // Present as real fields rather than omitted because every enemy reads its
  // tunables off `kind`, where a missing one is an undefined that means NaN.
  spawnHeightMin: BOSS_HOVER,
  spawnHeightMax: BOSS_HOVER,
  spin: 0.35, // a floater's tumble rate on something this big looks frantic
  scoreValue: 5000, // 50 shots, priced at a floater's 100 apiece
  healthBarLift: 1.4, // world units above the boss's crown to float the bar
  // The portrait sprite plastered on the orb (see bosses.js), as a fraction of the
  // orb's *diameter*. Well under 1 on purpose: the ring of purple left around the
  // face is what still reads as the boss orb underneath it, and at 0.8 the face
  // crowded the silhouette enough that the orb read as a frame rather than a body.
  portraitScale: 0.6,
};

// The core loop: clear killsPerRound floaters, fight the boss, next round. See
// rounds.js, which owns the state machine.
export const ROUNDS = {
  killsPerRound: 25, // shot kills that summon the boss; contact deaths don't count
  // Dead air around the announcements, in seconds. Both are a little longer than
  // the 1.2s flash animation in style.css, so the text has landed before the boss
  // walks in / the floaters come back. They're also the only breather the player
  // gets in the whole game, so don't trim them much.
  bossDelay: 1.5, // BOSS ROUND flash -> boss appears
  roundDelay: 1.5, // boss dies -> floaters resume
  // Per-round difficulty step, *added* rather than compounded: round N moves at
  // 1 + speedStep * (N - 1), so the ladder is 1.00x, 1.50x, 2.00x, 2.50x. Named a
  // step rather than a growth rate because 0.5 here is half of round 1's speed
  // added every round, not 50% of the previous round's.
  //
  // It drives floater speed, boss speed, and the floater *spawn rate* (the
  // interval divides by it), so one number covers both how fast they come and how
  // many. The only thing that scales with the round — killsPerRound and boss
  // health deliberately don't. Note there's no ceiling: at 0.5 floaters pass
  // PLAYER.moveSpeed in round 6 and the boss in round 10, after which neither can
  // be outrun.
  speedStep: 0.5,
};

export const WEAPON = {
  fireInterval: 0.15, // seconds between shots
  range: 100,

  // Where the tracer starts, in normalized screen coordinates: (0, 0) is the
  // crosshair, -1 is the bottom/left edge of the view. Specified in screen
  // space rather than world units so the muzzle stays put on screen if the FOV
  // or window aspect changes — weapon.js converts it using the live camera.
  muzzleOffset: {
    screenX: 0, // horizontally centered
    screenY: -1.08, // just past the bottom edge, so tracers rise from off-screen
    forward: 1.6, // distance in front of the camera; sets depth, not screen position
    // The screen offset puts the muzzle ~1.3 units below eye level, which pitches
    // it under the floor once you aim down more than ~15° — the floor then clips
    // the start of the tracer. Clamping world Y to just above the floor trades
    // exact bottom-center placement (only while aiming steeply down) for a tracer
    // that stays visible.
    minHeight: 0.05,
  },
};

// Colors here are CSS strings, not the 0x literals the rest of this file uses —
// the minimap is a 2D canvas in the HUD, not three.js geometry.
export const MINIMAP = {
  size: 148, // diameter in CSS pixels
  range: 32, // world units from the center to the rim; enemies spawn at 25, so
  // they appear just inside the edge rather than popping in from nowhere
  background: 'rgba(12, 14, 20, 0.55)',

  coneRange: 26, // how far the view cone reaches, in world units
  coneColor: 'rgba(200, 220, 255, 0.16)',

  playerColor: '#ffffff',
  playerRadius: 3.5, // CSS pixels
  enemyColor: '#e2604a',
  enemyRadius: 2.6,
  // The boss is 5x a floater's world radius, so drawing it as an identical dot
  // would misrepresent the fight it is.
  bossColor: '#b957d9',
  bossRadius: 6,
};

// Floating "+100" over a kill. Timing lives here rather than in a CSS animation
// because hud.js has to drive the rise and the fade itself anyway — it's moving a
// world-anchored point every frame — and splitting the duration across two files
// is how the two copies drift apart. The color and font are in style.css.
export const POPUP = {
  pool: 12, // preallocated divs; a kill with the pool full recycles the oldest,
  // same rule as the tracer pool. At fireInterval 0.18 a single stream of kills
  // can only have ~5 alive at once, so this has plenty of slack.
  life: 0.9, // seconds on screen
  lift: 0.5, // world units above the kill point where it starts
  rise: 1.8, // further world units it drifts up over its life
  fadeAt: 0.45, // fraction of life left when it starts fading; holds opaque above this
};

// Every effect is a pitch-swept oscillator, most with a noise burst layered under
// it for attack. Durations in seconds, pitches in Hz, gains 0..1 before the
// master. See sound.js — nothing here is a file path; it's all synthesized.
export const SOUND = {
  masterVolume: 0.35, // leaves headroom for several effects at once

  shoot: {
    duration: 0.09, // short: at fireInterval 0.18 these would otherwise pile up
    gain: 0.35,
    pitchFrom: 160,
    pitchTo: 55,
    noiseGain: 0.3,
    cutoff: 2600,
  },
  kill: {
    duration: 0.22,
    gain: 0.3,
    pitchFrom: 640,
    pitchTo: 180,
    noiseDuration: 0.06, // just a tick of grit on the attack
    noiseGain: 0.15,
    cutoff: 4200,
  },
  damage: {
    duration: 0.35, // longest of the four — taking a hit should land
    gain: 0.45,
    pitchFrom: 200,
    pitchTo: 60,
    noiseGain: 0.4,
    cutoff: 900,
  },
  click: {
    duration: 0.06,
    gain: 0.25,
    pitchLow: 440, // swept low->high to resume, high->low to pause
    pitchHigh: 880,
  },
};

export const EFFECTS = {
  // Tracers are pooled; a shot fired while the pool is full reuses the oldest.
  tracerPool: 12,
  tracerLife: 0.07, // seconds — deliberately brief, it should read as a flash
  tracerColor: 0xffdca8,

  maxParticles: 500, // hard ceiling on live sparks
  muzzleSparks: 6,
  impactSparks: 20, // hitting an enemy
  worldImpactSparks: 14, // hitting floor or wall — smaller, so kills still read louder
  particleLife: 0.35,
  particleLifeJitter: 0.25, // fraction of life randomized per particle
  particleSpeed: 7, // units/sec, before jitter
  particleGravity: 11,
  particleSize: 3, // pixels — screen-space, not world units (see effects.js)
  sparkColor: 0xffc978, // muzzle
  impactColor: 0xff7a4a, // enemy hits — warm, tinted toward the enemy color
  worldImpactColor: 0xc3d5ff, // floor/wall hits — cool and pale, reads as stone chips
};
