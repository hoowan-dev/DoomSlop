import * as THREE from 'three';

// The boss roster: one entry per portrait in assets/images. Its own module rather
// than a block in config.js, which is numbers only — the sizing knob for these
// lives there as BOSS.portraitScale, but the roster itself is assets.
//
// The images are *imported*, not fetched from a runtime path. Vite rewrites each
// import to the emitted hashed URL, which inherits the './' base from
// vite.config.js; a literal 'assets/images/david.png' would resolve against the
// page URL and 404 under the GitHub Pages subpath. It also means the files don't
// have to live in public/ to survive a build.
import david from '../assets/images/david.png';
import evan from '../assets/images/evan.png';
import kyle from '../assets/images/kyle.png';
import michael from '../assets/images/michael.png';
import nawwaf from '../assets/images/nawwaf.png';
import will from '../assets/images/will.png';

const LOADER = new THREE.TextureLoader();

// The one place the roster is written down. Keys become the enum's keys *and* each
// boss's displayed name, so there's no second list to keep in step.
const PORTRAITS = {
  DAVID: david,
  EVAN: evan,
  KYLE: kyle,
  MICHAEL: michael,
  NAWWAF: nawwaf,
  WILL: will,
};

/**
 * One shared material per boss, built at module scope for the same reason
 * enemies.js shares its geometry and materials: only one boss is ever on the
 * field, and a round is a long time to hold a copy per roster entry of anything.
 *
 * Loading starts at import time, which is the point — reaching a boss takes
 * ROUNDS.killsPerRound kills, so every portrait is long since decoded by the time
 * one is spawned and there is no lazy path to get wrong.
 *
 * depthTest is off because the sprite is parented to the boss mesh at its center,
 * where the near facets of a radius-3 icosahedron would hide nearly all of it.
 * That's safe *here* specifically: the arena is one open box with nothing standing
 * in it, and floater spawning is off for the boss fight, so nothing can
 * legitimately occlude a boss. It would be wrong in a level with cover.
 */
function material(url) {
  const map = LOADER.load(url);
  map.colorSpace = THREE.SRGBColorSpace; // photographs, not data — decode as sRGB
  return new THREE.SpriteMaterial({ map, depthTest: false, depthWrite: false });
}

/**
 * The bosses, keyed by name: BOSSES.KYLE. Each entry carries its own `name` so a
 * value passed around on its own still knows what to announce itself as.
 */
export const BOSSES = Object.freeze(
  Object.fromEntries(
    Object.entries(PORTRAITS).map(([name, url]) => [name, { name, material: material(url) }])
  )
);

const ROSTER = Object.values(BOSSES);

/**
 * Which boss shows up this round. A uniform pick with no memory, so the same one
 * can turn up twice running — at this roster size that's the occasional repeat,
 * not a rotation worth tracking state for.
 */
export function randomBoss() {
  return ROSTER[Math.floor(Math.random() * ROSTER.length)];
}
