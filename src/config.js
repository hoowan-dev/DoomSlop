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
  spawnInterval: 1.6, // seconds between spawns
  spawnDistance: 25, // how far from the player they appear
  hoverHeight: 1.6,
  scoreValue: 100,
};

export const WEAPON = {
  fireInterval: 0.18, // seconds between shots
  range: 100,
};
