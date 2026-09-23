import { MINIMAP, PICKUP, PORTAL, WORLD } from './config.js';

// Top-down radar in the corner of the HUD. Drawn on its own 2D canvas rather
// than in the scene — three.js never sees it, matching the rest of the HUD.
//
// The map *rotates with the player*: they stay pinned at the center facing up
// and the world spins around them, so "up" on the map is always straight ahead.
// That's why the view cone is drawn fixed, pointing up, instead of being swung
// around by the yaw.
//
// Owned by main.js, which calls draw() once per frame.

export class Minimap {
  constructor(camera) {
    // Needed for the view cone: the cone's width is the camera's real
    // horizontal FOV, so it shows what the player can actually see.
    this.camera = camera;

    this.canvas = document.getElementById('minimap');
    this.ctx = this.canvas.getContext('2d');

    this.size = 0;
    this.dpr = 0;
  }

  /**
   * Match the backing store to the device pixel ratio, or the dots come out
   * mushy on a HiDPI screen. Capped at 2 like the main renderer. Cheap enough to
   * re-check every frame, which also means a live MINIMAP.size tweak takes hold.
   */
  _resize() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (this.size === MINIMAP.size && this.dpr === dpr) return;

    this.size = MINIMAP.size;
    this.dpr = dpr;
    this.canvas.width = Math.round(this.size * dpr);
    this.canvas.height = Math.round(this.size * dpr);
    this.canvas.style.width = `${this.size}px`;
    this.canvas.style.height = `${this.size}px`;
  }

  /**
   * @param player read for position and yaw.
   * @param enemies the live enemy array (EnemyManager.enemies). Taken raw rather
   *        than via hitboxes(), which builds a new array per call — that would be
   *        an allocation every frame.
   * @param pickups the live drop array (PickupManager.pickups). A second array
   *        rather than one joined list, for the same reason effects.updateGlows
   *        takes two: concatenating would allocate every frame, and the two are
   *        drawn differently anyway.
   * @param portals the live portal array (Portals.portals). A third array for the same
   *        reason, and read for `wall.run` and `center` only — the map never asks which
   *        leads where, since both ends are drawn identically.
   */
  draw(player, enemies, pickups, portals) {
    this._resize();

    const ctx = this.ctx;
    const size = this.size;
    const radius = size / 2;
    // World units -> CSS pixels. The rim of the circle is MINIMAP.range away.
    const scale = radius / MINIMAP.range;

    // save/restore around the whole frame: a clip region set on a 2D context
    // persists until restored, so without this the clips would stack up.
    ctx.save();

    // Draw in CSS pixels and let the transform handle the DPR scaling.
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    // Clip to the circle so nothing spills into the square corners.
    ctx.beginPath();
    ctx.arc(radius, radius, radius, 0, Math.PI * 2);
    ctx.clip();

    ctx.fillStyle = MINIMAP.background;
    ctx.fillRect(0, 0, size, size);

    ctx.translate(radius, radius);

    // Walls first of all, under even the cone: they're the room everything else is
    // standing in, and the cone is a haze thrown across it. Then the cone, so enemy
    // dots sit on top of it rather than under it. Drops go under the enemies
    // deliberately: they don't move, so one being covered for a moment costs nothing,
    // where a threat hidden under a medkit is the arrangement that gets the player
    // killed.
    this._drawWalls(ctx, scale, player, portals);
    this._drawCone(ctx, scale);
    this._drawPickups(ctx, scale, player, pickups);
    this._drawEnemies(ctx, scale, player, enemies);
    this._drawPlayer(ctx);

    ctx.restore();
  }

  /**
   * The arena, and the two portals set into it. The only *static* geometry on this
   * canvas: the walls are a fixed box of side WORLD.arenaSize and the player moves
   * around inside it, which is what turns the circle from an arbitrary window into a
   * position — being backed into a corner is now something the radar says.
   *
   * Plotted through the same single ctx.rotate(player.yaw) with raw world offsets that
   * the enemy dots and the drop glyphs use, and for the same reason: the map turns and
   * the things on it don't, so anything that needs to stay upright is the exception
   * rather than the rule. A square has nothing to keep upright — it turns with the room,
   * which is the whole point of drawing it — so unlike a glyph it takes no
   * counter-rotation.
   *
   * The whole box is stroked rather than clipped to the visible arc: the circular clip
   * already set on the context handles the three quarters of it that are off the map, and
   * working out which walls are in range would cost more than one rect() call.
   */
  _drawWalls(ctx, scale, player, portals) {
    const half = WORLD.arenaSize / 2;

    ctx.save();
    ctx.rotate(player.yaw);

    ctx.beginPath();
    ctx.rect(
      (-half - player.position.x) * scale,
      (-half - player.position.z) * scale,
      WORLD.arenaSize * scale,
      WORLD.arenaSize * scale
    );
    ctx.lineWidth = MINIMAP.wallThickness;
    ctx.strokeStyle = MINIMAP.wallColor;
    ctx.stroke();

    // Each portal drawn *over* its own stretch of wall, along that wall's run axis, so
    // the cyan is a section of the outline rather than a mark stuck next to it — a
    // doorway is a hole in a wall, and the map should say so. Centered on the line for
    // the same reason, which is what leaves it reading as part of the box.
    //
    // No counter-rotation here either: unlike a glyph, a segment's *direction* is
    // information, and it has to lie along the wall as drawn.
    ctx.lineWidth = MINIMAP.portalThickness;
    ctx.strokeStyle = MINIMAP.portalColor;
    for (const portal of portals) {
      const hx = portal.wall.run.x * (PORTAL.size / 2);
      const hz = portal.wall.run.z * (PORTAL.size / 2);
      const dx = portal.center.x - player.position.x;
      const dz = portal.center.z - player.position.z;

      ctx.beginPath();
      ctx.moveTo((dx - hx) * scale, (dz - hz) * scale);
      ctx.lineTo((dx + hx) * scale, (dz + hz) * scale);
      ctx.stroke();
    }

    ctx.restore();
  }

  /** The view cone, fixed pointing up because the map itself does the rotating. */
  _drawCone(ctx, scale) {
    // Canvas angles start on the +x axis and increase clockwise (y points down),
    // so straight up is -PI/2.
    const up = -Math.PI / 2;
    const half = this._halfHorizontalFov();

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, MINIMAP.coneRange * scale, up - half, up + half);
    ctx.closePath();
    ctx.fillStyle = MINIMAP.coneColor;
    ctx.fill();
  }

  _drawEnemies(ctx, scale, player, enemies) {
    const rangeSq = MINIMAP.range * MINIMAP.range;

    ctx.save();
    // The whole trick: rotating by +yaw maps the player's forward axis onto
    // canvas-up, so a point plotted at its raw world offset lands where it
    // should relative to where the player is looking.
    ctx.rotate(player.yaw);

    for (const enemy of enemies) {
      // World XZ -> map XY: +X is right, +Z is down. Height is ignored; they all
      // hover at the same level anyway.
      const dx = enemy.mesh.position.x - player.position.x;
      const dz = enemy.mesh.position.z - player.position.z;

      // Skip anything past the rim rather than relying on the clip, so far-off
      // enemies cost nothing to draw.
      if (dx * dx + dz * dz > rangeSq) continue;

      // The boss is 5x a floater's world radius — an identical dot would
      // misrepresent it. Colors are set per-dot rather than once outside the
      // loop for the same reason.
      ctx.beginPath();
      ctx.arc(
        dx * scale,
        dz * scale,
        enemy.isBoss ? MINIMAP.bossRadius : MINIMAP.enemyRadius,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = enemy.isBoss ? MINIMAP.bossColor : MINIMAP.enemyColor;
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Drops, as small upright icons: a cross for health, a shield for armor, a boot for
   * the boots. The same symbols painted on the cubes themselves, which is what ties a
   * blip to the thing you walk over to collect — none of them is a dot, because both
   * dots on this canvas are things trying to kill you.
   *
   * Placement is identical to the enemy dots' — the same single ctx.rotate(player.yaw)
   * with raw world offsets plotted into it, which is the one thing about this canvas
   * that's easy to get subtly wrong and the thing the minimap driver actually
   * measures.
   *
   * The per-item counter-rotation is what keeps each icon *upright* while the map
   * turns under it. The dots don't need it because a circle is rotation-invariant; a
   * cross left in the rotated frame leans over into an X at most headings, and a
   * shield hanging sideways stops reading as a shield at all.
   *
   * Which icon is decided by comparing `kind` against the config blocks rather than
   * by a shape name stored in one: how a shield is drawn belongs to the thing drawing
   * it, and config.js holds the color and the size.
   */
  _drawPickups(ctx, scale, player, pickups) {
    const rangeSq = MINIMAP.range * MINIMAP.range;

    ctx.save();
    ctx.rotate(player.yaw);

    for (const item of pickups) {
      const dx = item.mesh.position.x - player.position.x;
      const dz = item.mesh.position.z - player.position.z;
      if (dx * dx + dz * dz > rangeSq) continue;

      ctx.save();
      ctx.translate(dx * scale, dz * scale);
      ctx.rotate(-player.yaw);
      this._blip(ctx, item.kind);
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * One drop's glyph, drawn at the origin of a frame that's already been positioned
   * and turned back upright. Split out so the dispatch is one place: health is the
   * fall-through here for the same reason it's the fall-through in the drop roll, so
   * a face added to config.js without a line here still draws *something*.
   */
  _blip(ctx, kind) {
    if (kind === PICKUP.armor) {
      ctx.fillStyle = MINIMAP.armorColor;
      this._shield(ctx, MINIMAP.armorArm);
      return;
    }
    if (kind === PICKUP.boots) {
      ctx.fillStyle = MINIMAP.bootsColor;
      this._boot(ctx, MINIMAP.bootsArm);
      return;
    }
    ctx.fillStyle = MINIMAP.healthColor;
    this._cross(ctx, MINIMAP.healthArm, MINIMAP.healthThickness);
  }

  /**
   * Two overlapping bars rather than a stroked path: the arms are a couple of pixels
   * wide, where a lineWidth that small lands between device pixels and comes out grey.
   */
  _cross(ctx, arm, thickness) {
    ctx.fillRect(-arm, -thickness / 2, arm * 2, thickness);
    ctx.fillRect(-thickness / 2, -arm, thickness, arm * 2);
  }

  /**
   * The armor shield, centered on the origin and filled. Same silhouette as the one
   * painted on the cube (pickups.js) — flat top, straight shoulders, curving to a
   * point — and the proportions live here with it for the same reason: they're the
   * shape rather than a tunable. Filled rather than outlined because at 6 pixels
   * across an outline closes up into a smudge.
   *
   * Taller than it is wide, which is what separates it from the round dots at a
   * glance even before the color does.
   */
  _shield(ctx, arm) {
    const top = -arm * 1.15;
    const bottom = arm * 1.5;
    const waist = arm * 0.25;
    // Above the bottom edge rather than level with it, so the two sides converge to a
    // point instead of meeting in a flat curve — see drawShield() in pickups.js, where
    // the same construction is drawn ten times the size and the difference is the
    // whole read of the icon.
    const pull = arm * 0.6;

    ctx.beginPath();
    ctx.moveTo(-arm, top);
    ctx.lineTo(arm, top);
    ctx.lineTo(arm, waist);
    ctx.quadraticCurveTo(arm, pull, 0, bottom);
    ctx.quadraticCurveTo(-arm, pull, -arm, waist);
    ctx.closePath();
    ctx.fill();
  }

  /**
   * The boots, centered on the origin and filled, facing right. Same three-part
   * construction as drawBoot() in pickups.js — a boldly flared collar, a leg narrower and
   * squatter than both, a sole overhanging the heel — so the blip and the cube read as one
   * item. That build is also what stops either of them reading as a capital L, which is the
   * trap this shape has; see drawBoot() for why the obvious shaft-over-foot version doesn't
   * survive being small, and why the steps in the width have to be large rather than merely
   * present. `arm` is half the height.
   *
   * The one place it deviates from the cube's icon is the overall aspect: the cube's is
   * squat, where this stays taller than it is wide. That's what separates it from the round
   * dots at a glance, before the color does — the same job the shield's proportions do —
   * and it's affordable here because the collar and the sole carry the read on their own.
   *
   * Facing right rather than up even though everything else on this canvas is
   * direction-agnostic: a boot seen from above isn't a recognizable shape, so this is
   * deliberately a side-on pictogram and its orientation says nothing about the world.
   */
  _boot(ctx, arm) {
    const top = -arm;
    const sole = arm;
    const cuffBot = -arm * 0.6; // a deep collar band, so the leg below it stays squat
    const cuffL = -arm * 0.7; // and one that overhangs the leg by a wide margin
    const cuffR = arm * 0.06;
    const legL = -arm * 0.54;
    const legR = -arm * 0.08; // the shin
    const ankle = -arm * 0.2;
    const toe = arm * 0.9;
    const soleL = -arm * 0.8; // the sole overhangs the leg behind the heel

    ctx.beginPath();
    ctx.moveTo(cuffL, top);
    ctx.lineTo(cuffR, top);
    ctx.lineTo(cuffR, cuffBot);
    ctx.lineTo(legR, cuffBot); // step in under the collar
    ctx.lineTo(legR, ankle);
    ctx.quadraticCurveTo(arm * 0.2, arm * 0.2, arm * 0.5, arm * 0.03); // the instep dip
    ctx.quadraticCurveTo(toe, -arm * 0.03, toe, arm * 0.49); // the rounded toe cap
    ctx.lineTo(toe, sole);
    ctx.lineTo(soleL, sole);
    ctx.quadraticCurveTo(soleL, arm * 0.31, legL, arm * 0.14); // the rounded heel
    ctx.lineTo(legL, cuffBot);
    ctx.lineTo(cuffL, cuffBot);
    ctx.closePath();
    ctx.fill();
  }

  /** The player: always dead center, since the map moves and they don't. */
  _drawPlayer(ctx) {
    ctx.beginPath();
    ctx.arc(0, 0, MINIMAP.playerRadius, 0, Math.PI * 2);
    ctx.fillStyle = MINIMAP.playerColor;
    ctx.fill();
  }

  /**
   * Half the *horizontal* field of view, in radians. camera.fov is the vertical
   * one, so it has to be converted through the aspect ratio — using it directly
   * would draw a cone far too narrow on a wide window and misreport what the
   * player can see.
   */
  _halfHorizontalFov() {
    const vertical = (this.camera.fov * Math.PI) / 180;
    return Math.atan(Math.tan(vertical / 2) * this.camera.aspect);
  }
}
