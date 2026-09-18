// Every tunable number in one place. Gameplay modules read from here rather
// than hardcoding values, so balancing is a single-file edit.

export const WORLD = {
  arenaSize: 60, // floor is arenaSize x arenaSize, centered on the origin
  wallHeight: 8,
};

export const PLAYER = {
  eyeHeight: 1.7,
  moveSpeed: 7, // units per second
  lookSensitivity: 0.0022, // radians per pixel of mouse movement
  maxHealth: 100,
  radius: 0.4, // for wall collision
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
  hoverHeight: 1.6,
  scoreValue: 100,
};

export const WEAPON = {
  fireInterval: 0.18, // seconds between shots
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
