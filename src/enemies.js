import * as THREE from 'three';
import { BOSS, ENEMY, PLAYER, WORLD } from './config.js';
import { randomBoss } from './bosses.js';
import { haloMaterial, haloSprite } from './glow.js';

// Spawns and drives the floaters and the round boss. One shared geometry/material
// per kind — with graphics this minimal there's no reason for per-enemy assets.

// The key light's direction in world.js, and the range of shade the two world
// lights were putting on a Lambert body — the low end is a facet seeing only the
// hemisphere's ground color, the high end one square to the key. Both matched by
// looking, like every other appearance number in here. See shaded() below.
const SHADE_DIR = new THREE.Vector3(1, 2, 1).normalize();
const SHADE_MIN = 0.05;
const SHADE_MAX = 0.52;

/**
 * Bakes a fixed-direction facet shade into a geometry's vertex colors.
 *
 * The bodies are unlit (see MATERIAL), which would otherwise cost them the facet
 * shading the world lights gave them — an icosahedron lit by nothing is a flat
 * hexagonal blob at any size, and the boss is a purple disc. A per-facet dot
 * product against one direction is all that shading ever *was* here, and nothing
 * in the arena moves the key light, so there's nothing to recompute per frame.
 *
 * What's given up is that the pattern rides the mesh's tumble rather than staying
 * put in the world: a facet turning toward the light no longer brightens. At a
 * floater's ~30 screen pixels that isn't visible, and on the boss the silhouette
 * and the portrait carry the read.
 */
function shaded(geometry) {
  // Every three vertices are one facet, and writing all three the same color is
  // what makes the shading flat. PolyhedronGeometry is already non-indexed;
  // guarded rather than assumed, since an indexed geometry shares vertices
  // between facets and would smear the shade across them.
  const geo = geometry.index ? geometry.toNonIndexed() : geometry;
  const position = geo.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const centroid = new THREE.Vector3();
  const corner = new THREE.Vector3();

  for (let i = 0; i < position.count; i += 3) {
    centroid.set(0, 0, 0);
    for (let v = 0; v < 3; v++) centroid.add(corner.fromBufferAttribute(position, i + v));
    // The geometry is a convex polyhedron centred on the origin, so a facet's
    // outward normal is the direction of its centroid. No cross product, and so
    // no winding order to get the sign of.
    centroid.normalize();

    // Hemispheric rather than a bare dot: a facet facing away from the key still
    // gets SHADE_MIN, the way the hemisphere light's ground color used to leave it
    // dark rather than black.
    const shade = SHADE_MIN + (SHADE_MAX - SHADE_MIN) * (0.5 + 0.5 * centroid.dot(SHADE_DIR));
    for (let v = 0; v < 3; v++) {
      const o = (i + v) * 3;
      colors[o] = shade;
      colors[o + 1] = shade;
      colors[o + 2] = shade;
    }
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

const GEOMETRY = shaded(new THREE.IcosahedronGeometry(ENEMY.radius, 0));

/**
 * Enemy bodies are deliberately **unlit**, and that's what keeps one enemy's glow
 * off its neighbours.
 *
 * three has no per-object light masking — `light.layers` is tested against the
 * *camera*, not against the mesh — so the only way a body can be immune to the
 * point lights riding every enemy around it is for its material not to read lights
 * at all. Without that, a cluster lights each other's facets flat red while the one
 * in the middle goes black, and a swarm stops being countable in exactly the
 * situation the glows exist for. It gets worse with every light added to
 * EFFECTS.glowPool and every unit added to ENEMY.glow.distance.
 *
 * `vertexColors` is the facet shading that buys back (shaded() above); it
 * multiplies this color, so the brightest facet lands near what a Lambert body's
 * lit side read at.
 *
 * What being unlit would otherwise cost is every *other* light too — the muzzle flash
 * going off in front of an enemy, the drop one is hovering over. Those are handed back
 * by hand: each enemy wears a **clone** of this material (see _add) and
 * effects.lightBodies() writes a CPU-evaluated light term into the clone's color every
 * frame, from the flash and the drops only. That's the one asset here not shared per
 * tier, and the reason is that a per-enemy dynamic color has nowhere else to live. This
 * template's own color is the base that term is added to, and is never written.
 */
const MATERIAL = new THREE.MeshBasicMaterial({ color: 0xc8503c, vertexColors: true });

// The boss gets its own pair rather than a scaled-up floater: at radius 3 the
// floater's 20 facets read as a handful of flat slabs, and a different hue is
// what makes it legible as a different tier of thing.
const BOSS_GEOMETRY = shaded(new THREE.IcosahedronGeometry(BOSS.radius, 1));
const BOSS_MATERIAL = new THREE.MeshBasicMaterial({ color: 0x9b30c4, vertexColors: true });

// One halo material per tier over the one shared texture, same reasoning as the
// shared geometry above. Both the texture and the material live in glow.js because
// the drops in pickups.js carry the same aura — see there.
const HALO_MATERIAL = haloMaterial(ENEMY.glow);
const BOSS_HALO_MATERIAL = haloMaterial(BOSS.glow);

// Scratch vector for steering, reused across every enemy every frame.
const STEER = new THREE.Vector3();

export class EnemyManager {
  constructor(scene, player) {
    this.scene = scene;
    this.player = player;

    /**
     * `kind` is the config block the enemy was spawned from (ENEMY or BOSS), so
     * per-enemy tunables are read from it rather than copied out field by field.
     * @type {{mesh: THREE.Mesh, kind: object, isBoss: boolean, health: number, cooldown: number}[]}
     */
    this.enemies = [];

    /** The live boss, or null. hud.js reads it to place the health bar. */
    this.boss = null;

    // Set by main.js: (enemy) => void, fired when an enemy is *shot* dead. This
    // is how rounds.js counts progress. It deliberately does not fire when an
    // enemy is removed for reaching the player — see damage().
    this.onDefeat = null;

    // Seconds since the round started; drives the difficulty ramp.
    this.elapsed = 0;

    // rounds.js switches this off for the boss fight.
    this.spawning = true;

    // Multiplier on every enemy's speed, pushed in by rounds.js. Owned there
    // because the round number is what drives it and this module has no idea
    // what round it is. Deliberately not touched by reset(): rounds.reset() is
    // the single writer, and it runs right after clear() on a restart.
    this.speedScale = 1;

    this.spawnTimer = 0;
    this.reset();
  }

  /** Back to round-one conditions. */
  reset() {
    this.elapsed = 0;
    // A full interval rather than 0, so a round (or a restart) opens with a
    // beat to get oriented instead of an enemy appearing on frame one.
    this.spawnTimer = ENEMY.spawnInterval;
  }

  /**
   * Toggled by rounds.js so the boss fights alone. Re-enabling restarts the
   * countdown, so a round resumes with a beat instead of a floater appearing on
   * the same frame spawning came back.
   */
  setSpawning(on) {
    this.spawning = on;
    if (on) this.spawnTimer = this.currentSpawnInterval();
  }

  /**
   * Called by rounds.js at the start of each round. It applies to the boss too:
   * both tiers read `kind.speed`, so there's one multiplier rather than one per
   * kind — a per-kind growth rate would be a config change, not a second field.
   *
   * It also drives the spawn rate (see currentSpawnInterval), so push it *before*
   * setSpawning(true) — that's what re-derives the pending timer.
   */
  setSpeedScale(scale) {
    this.speedScale = scale;
  }

  update(dt) {
    this.elapsed += dt;

    if (this.spawning) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        this.spawn();
        this.spawnTimer = this.currentSpawnInterval();
      }
    }

    // Backwards: removing on contact splices the array mid-iteration.
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      const { mesh, kind } = enemy;

      if (enemy.cooldown > 0) enemy.cooldown -= dt;

      // Steer on the XZ plane only. Height is handled separately below, as a
      // one-way settle toward the kind's hover height rather than as part of the
      // pursuit — so they never dive at the camera, and contact stays planar,
      // which is what keeps a jump from being a dodge.
      STEER.set(
        this.player.position.x - mesh.position.x,
        0,
        this.player.position.z - mesh.position.z
      );

      const distance = STEER.length();
      const touching = distance <= kind.radius + PLAYER.radius;

      if (touching && !enemy.isBoss) {
        // The mesh position goes along so the HUD can point at where the hit came
        // from. Passed rather than copied — remove() takes the mesh out of the
        // scene on the next line, so the hook has to read it synchronously.
        this.player.takeDamage(kind.touchDamage, mesh.position);
        this.remove(enemy);
        continue;
      }

      if (touching) {
        // The boss is not consumed on contact — it has to be shot down, or the
        // player could beat a 50-shot enemy by walking into it. So it sits on
        // the player and hits on a cooldown instead.
        if (enemy.cooldown <= 0) {
          this.player.takeDamage(kind.touchDamage, mesh.position);
          enemy.cooldown = kind.attackInterval;
        }
      } else {
        // distance > contact range > 0, so normalize is safe here.
        const step = kind.speed * this.speedScale * dt;
        mesh.position.addScaledVector(STEER.divideScalar(distance), step);

        // Level out toward the hover height, as a slope against the horizontal
        // step rather than a rate against dt — that's what makes the settle land
        // at the same place in the approach however fast the round is running.
        // Clamped to what's left so it stops exactly level instead of
        // oscillating across the target on a long frame.
        if (enemy.levelSlope > 0) {
          const remaining = kind.hoverHeight - mesh.position.y;
          mesh.position.y += Math.sign(remaining) * Math.min(enemy.levelSlope * step, Math.abs(remaining));
        }
      }

      // Slow tumble. Purely cosmetic, but it makes them read as alive.
      mesh.rotation.x += dt * 0.8 * kind.spin;
      mesh.rotation.y += dt * 1.1 * kind.spin;

      // Raycasting reads matrixWorld, and three only refreshes it during
      // render() — which happens after weapon.update() in the same frame. Push
      // it now, or shots this frame test against last frame's positions.
      mesh.updateMatrixWorld();
    }
  }

  /**
   * Spawn interval: ramping down as the round goes on, then compressed by the
   * round's speed multiplier.
   *
   * Rate scales with speed, so the interval *divides* by the multiplier — which
   * scales both ends of the ramp together. Scaling only `spawnInterval` would
   * flatten the ramp against a fixed `spawnIntervalMin` and the later rounds
   * would all converge on the same pressure.
   */
  currentSpawnInterval() {
    const ramp = 1 - Math.min(this.elapsed / ENEMY.rampDuration, 1);
    const interval = ENEMY.spawnIntervalMin + (ENEMY.spawnInterval - ENEMY.spawnIntervalMin) * ramp;
    return interval / this.speedScale;
  }

  spawn() {
    return this._add(ENEMY, false);
  }

  /**
   * Called by rounds.js once the BOSS ROUND announcement has landed.
   *
   * @param identity which boss it is, from bosses.js. Passed in because rounds.js
   *        picks it a beat earlier — the BOSS ROUND flash names it before it
   *        walks in. Defaults to a fresh pick so a bare spawnBoss() still works.
   */
  spawnBoss(identity = randomBoss()) {
    this.boss = this._add(BOSS, true, identity);
    return this.boss;
  }

  _add(kind, isBoss, identity = null) {
    // The geometry is shared and the material is *not*: effects.lightBodies() writes
    // the flash and the drops into each body's color every frame, which a shared
    // material would apply to the whole tier at whichever enemy was written last.
    // Disposed in remove().
    const template = isBoss ? BOSS_MATERIAL : MATERIAL;
    const mesh = new THREE.Mesh(isBoss ? BOSS_GEOMETRY : GEOMETRY, template.clone());
    const { x, z } = this._spawnPoint(kind.spawnDistance, kind.radius);
    // Mixed heights per spawn rather than one plane. `spawnDistance` stays the
    // *horizontal* distance — the height is on top of it, so a high spawn is
    // genuinely further away, and the arena bounds check in _spawnPoint() is
    // still comparing the right two numbers.
    const y = kind.spawnHeightMin + Math.random() * (kind.spawnHeightMax - kind.spawnHeightMin);
    mesh.position.set(x, y, z);

    mesh.add(this._halo(kind, isBoss));
    if (identity) mesh.add(this._portrait(kind, identity));

    // Without this the mesh carries an identity matrixWorld until the next
    // render, and a raycast would treat it as sitting at the world origin —
    // i.e. on top of the player. Recurses into the halo and the portrait, so
    // both have to be parented above rather than after this.
    mesh.updateMatrixWorld();

    this.scene.add(mesh);

    const enemy = {
      mesh,
      kind,
      isBoss,
      identity,
      health: kind.health,
      cooldown: 0,
      // The unlit base effects.lightBodies() adds its light term to. A reference to
      // the tier template's color, so it costs nothing and can't drift from it —
      // which also means it is read-only: writing it would retint the whole tier.
      bodyColor: template.color,
      // Vertical units to shed per horizontal unit travelled — a slope, not a
      // speed. Tied to ground covered rather than to time so the settle finishes
      // on arrival at any `speedScale`: a round-8 floater crosses the arena four
      // times faster and has to come down four times faster with it. Frozen at
      // spawn, so it's unaffected by the player moving the goalposts.
      levelSlope: Math.abs(y - kind.hoverHeight) / kind.spawnDistance,
    };
    this.enemies.push(enemy);
    return enemy;
  }

  /**
   * The glow burning around the body, as a sprite parented to the mesh. The sizing
   * rule and everything a parented sprite gets for free are in glow.js; all that's
   * decided here is which tier's material it wears.
   */
  _halo(kind, isBoss) {
    // Diameter, not radius — hence the 2, like the portrait below.
    return haloSprite(isBoss ? BOSS_HALO_MATERIAL : HALO_MATERIAL, kind.radius * 2, kind.glow.haloScale);
  }

  /**
   * The boss's face, as a sprite parented to its orb. A sprite rather than a
   * textured facet or a plane: it billboards, so the portrait faces the player
   * from every angle without anything per-frame to drive it. Parented rather than
   * tracked, so it rides the orb's movement and vanishes with it on removal —
   * and the orb's cosmetic tumble can't spin it, since a sprite takes only
   * position and scale off its world matrix.
   *
   * Never a hit target: weapon.js raycasts `hitboxes()` with recursion off, so the
   * cast never descends into children. That flag is load-bearing now — with it on,
   * a shot to the face would return the sprite, miss damage()'s `e.mesh === mesh`
   * lookup, and leave the boss unkillable from the front.
   */
  _portrait(kind, identity) {
    const sprite = new THREE.Sprite(identity.material);
    // Scale is world units (sizeAttenuation is on), so it shrinks with distance
    // like the orb it sits on. Diameter, not radius — hence the 2.
    const size = kind.radius * 2 * kind.portraitScale;
    sprite.scale.set(size, size, 1);
    return sprite;
  }

  /**
   * A point exactly `distance` from the player, on a random bearing, inside the
   * arena. Rejects out-of-bounds bearings rather than clamping them: clamping
   * would drag the point toward the player and can land it inside contact range
   * when the player is in a corner — an instant free hit.
   */
  _spawnPoint(distance, radius) {
    const limit = WORLD.arenaSize / 2 - radius;
    const px = this.player.position.x;
    const pz = this.player.position.z;
    const d = distance;

    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const x = px + Math.cos(angle) * d;
      const z = pz + Math.sin(angle) * d;
      if (Math.abs(x) <= limit && Math.abs(z) <= limit) return { x, z };
    }

    // Fallback: aim back toward the arena center. Always in bounds, provided
    // `distance` stays below the arena's half-width less `radius` — which is why
    // BOSS.spawnDistance carries that note in config.js.
    const toCenter = Math.atan2(-pz, -px);
    return {
      x: px + Math.cos(toCenter) * d,
      z: pz + Math.sin(toCenter) * d,
    };
  }

  /** Meshes to hand to the weapon's raycaster. */
  hitboxes() {
    return this.enemies.map((e) => e.mesh);
  }

  /** Called by weapon.js with the mesh a shot hit. Returns score earned. */
  damage(mesh, amount = 1) {
    const enemy = this.enemies.find((e) => e.mesh === mesh);
    if (!enemy) return 0;

    enemy.health -= amount;
    if (enemy.health > 0) return 0;

    this.remove(enemy);

    // Only a shot kill counts as a defeat. remove() on contact, and removeAll()
    // between rounds, deliberately stay silent — otherwise floaters suiciding
    // into the player would advance the round, and a restart would credit a kill
    // for every enemy it swept off the field.
    this.onDefeat?.(enemy);

    return enemy.kind.scoreValue;
  }

  remove(enemy) {
    const i = this.enemies.indexOf(enemy);
    if (i === -1) return;
    this.enemies.splice(i, 1);
    this.scene.remove(enemy.mesh);
    // The body material is a per-enemy clone (see _add), so it's ours to release —
    // a run's worth of them would otherwise pile up in the renderer's program cache.
    // The geometry and both sprite materials are shared and must not be touched.
    enemy.mesh.material.dispose();
    if (enemy === this.boss) this.boss = null;
  }

  /** Wipe the field and leave the round and ramp state alone. */
  removeAll() {
    for (const enemy of [...this.enemies]) this.remove(enemy);
  }

  /** Wipe the field *and* go back to round-one spawning. For restarts. */
  clear() {
    this.removeAll();
    this.reset();
  }
}
