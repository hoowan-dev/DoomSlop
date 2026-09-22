import * as THREE from 'three';

// The halo: the soft aura burning around anything in the scene that carries a
// glow — every enemy (enemies.js) and every drop (pickups.js).
//
// It lives in its own module because both of those need the *same* texture. One
// CanvasTexture is shared by every halo in the game, with the per-thing color
// applied as the sprite material's tint over white, so there's nothing per-kind in
// the map itself. Leaving it in enemies.js and importing it from pickups.js would
// be a sideways dependency between two systems that otherwise know nothing about
// each other.
//
// The *light* half of the same glow is in effects.js, and both halves read the same
// `glow.color`. That pairing is the whole reason a `glow` block in config.js is one
// block: let the light and the aura drift apart and they stop reading as one effect.

/**
 * The halo's falloff, drawn into a canvas at import time rather than shipped as an
 * image. Same call as sound.js synthesizing its effects instead of loading samples:
 * it keeps the repo asset-free (the boss portraits are the one exception) and a
 * gradient this simple is less code than a file would be plumbing.
 */
export const HALO_TEXTURE = (() => {
  const size = 64; // it's a soft blur; more pixels would be storing noise
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext('2d');
  const r = size / 2;
  const gradient = ctx.createRadialGradient(r, r, 0, r, r, r);
  // Weighted toward the outer half on purpose. The body hides the middle of this
  // quad (see haloSprite), so the stops that actually get seen are the ones past
  // ~45% — a plain 1-to-0 ramp puts most of its brightness where the body is and
  // leaves the aura outside the silhouette almost invisible.
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
  gradient.addColorStop(0.45, 'rgba(255, 255, 255, 0.75)');
  gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.25)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  return new THREE.CanvasTexture(canvas);
})();

/**
 * One halo material per *kind of thing*, sharing the one texture above — the same
 * reasoning as the shared geometry in enemies.js. Callers build theirs at module
 * scope and hand it to every sprite they make.
 *
 * @param glow a `glow` block from config.js (ENEMY.glow, BOSS.glow, or one off a
 *        PICKUP face — PICKUP.health.glow / PICKUP.armor.glow).
 *        `color` is the same field the point light in effects.js reads, so the aura
 *        and the light it casts can't drift apart.
 *
 * Note this reads config at *import* time, unlike the light, which reads it per
 * frame: a driver retuning `glow.color` live will move the light and not the halo.
 */
export function haloMaterial(glow) {
  return new THREE.SpriteMaterial({
    map: HALO_TEXTURE,
    color: glow.color,
    opacity: glow.haloOpacity,
    transparent: true,
    blending: THREE.AdditiveBlending,
    // Depth *tested* but not written, and the contrast with the boss portrait is the
    // point: that one turns testing off because the orb's near facets would hide it.
    // A halo must keep it, or it would paint over nearer enemies and straight
    // through the arena walls. Not writing depth is what stops two overlapping
    // halos, or the portrait behind one, from cutting holes in each other.
    depthWrite: false,
  });
}

/**
 * A halo sized to a body, ready to be parented to it. Everything the boss portrait
 * gets for free applies here for the same reasons: it billboards (so the aura is
 * round from every angle with nothing per-frame driving it), it rides its parent and
 * vanishes with it, the parent's own spin can't turn it because a sprite takes only
 * position and scale off its world matrix, and weapon.js's non-recursive raycast
 * means it can never be a hit target.
 *
 * What makes it read as a halo rather than a blob painted over the body is depth
 * testing against the body it's centered on: the near surfaces hide the middle of
 * the quad, so what's left is the part outside the silhouette. The aura is the
 * *overhang* — which is why `haloScale` has to be over 1.
 *
 * @param diameter the body's width in world units. The silhouette's edge therefore
 *        lands at 1/haloScale of the gradient's radius, which is what decides how
 *        the aura reads — not its world size. See BOSS.glow in config.js, where a
 *        smaller scale on a much bigger body came out fainter, not bigger.
 */
export function haloSprite(material, diameter, haloScale) {
  const sprite = new THREE.Sprite(material);
  const size = diameter * haloScale;
  sprite.scale.set(size, size, 1);
  return sprite;
}
