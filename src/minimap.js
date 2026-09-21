import { MINIMAP } from './config.js';

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
   */
  draw(player, enemies, pickups) {
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

    // Cone first, so enemy dots sit on top of it rather than under it. Drops go
    // under the enemies deliberately: they don't move, so one being covered for a
    // moment costs nothing, where a threat hidden under a medkit is the arrangement
    // that gets the player killed.
    this._drawCone(ctx, scale);
    this._drawPickups(ctx, scale, player, pickups);
    this._drawEnemies(ctx, scale, player, enemies);
    this._drawPlayer(ctx);

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
   * Health drops, as small upright crosses. Placement is identical to the enemy
   * dots' — the same single ctx.rotate(player.yaw) with raw world offsets plotted
   * into it, which is the one thing about this canvas that's easy to get subtly
   * wrong and the thing the minimap driver actually measures.
   *
   * The per-item counter-rotation is what keeps the cross *upright* while the map
   * turns under it. The dots don't need it because a circle is rotation-invariant;
   * a cross left in the rotated frame would lean over into an X at most headings and
   * stop reading as the symbol painted on the cube.
   */
  _drawPickups(ctx, scale, player, pickups) {
    const rangeSq = MINIMAP.range * MINIMAP.range;
    const arm = MINIMAP.pickupArm;

    ctx.save();
    ctx.rotate(player.yaw);
    ctx.fillStyle = MINIMAP.pickupColor;

    for (const item of pickups) {
      const dx = item.mesh.position.x - player.position.x;
      const dz = item.mesh.position.z - player.position.z;
      if (dx * dx + dz * dz > rangeSq) continue;

      ctx.save();
      ctx.translate(dx * scale, dz * scale);
      ctx.rotate(-player.yaw);
      // Two overlapping bars rather than a stroked path: the arms are a couple of
      // pixels wide, where a lineWidth that small lands between device pixels and
      // comes out grey.
      ctx.fillRect(-arm, -MINIMAP.pickupThickness / 2, arm * 2, MINIMAP.pickupThickness);
      ctx.fillRect(-MINIMAP.pickupThickness / 2, -arm, MINIMAP.pickupThickness, arm * 2);
      ctx.restore();
    }

    ctx.restore();
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
