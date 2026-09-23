import * as THREE from 'three';
import { PORTAL, WORLD } from './config.js';
import { HALO_TEXTURE } from './glow.js';
import { createShell } from './world.js';

// The two portals: squares of wall that lead to each other. Walk into one and you come
// out of the other, facing into the arena with the heading you walked in with. Each one
// shows a live perspective view of where it leads, so the square is a window rather
// than a colored panel with a rule attached to it.
//
// Placement is asked for by rounds.js at the start of every round; the traversal test
// is ticked by main.js right after player.update() and the previews are rendered by it
// just before the frame is drawn. Like every other system here it knows nothing about
// rounds, score or the HUD — it reaches into the player only to move them, and reports
// a traversal out through `onTraverse` so main.js can decide that means a sound.

const HALF = WORLD.arenaSize / 2;

/**
 * The four walls world.js builds, described from the inside.
 *
 * `normal` points into the arena and `run` is the axis the wall lies along, so a
 * portal's center is `base + run * u` for an along-wall offset `u`. `faceYaw` does
 * double duty and that's worth knowing before touching the turn below: it's the Y
 * rotation that turns a portal's quads to face inward, *and* it is the player's yaw
 * while walking into this wall. Both because a plane's front is local +Z, and a
 * camera at yaw Y looks along (-sin Y, 0, -cos Y) — so walking into the wall means
 * travelling along -normal, i.e. yaw = atan2(normal.x, normal.z).
 */
const WALLS = [
  { normal: new THREE.Vector3(0, 0, 1), run: new THREE.Vector3(1, 0, 0), base: new THREE.Vector3(0, 0, -HALF) },
  { normal: new THREE.Vector3(0, 0, -1), run: new THREE.Vector3(1, 0, 0), base: new THREE.Vector3(0, 0, HALF) },
  { normal: new THREE.Vector3(1, 0, 0), run: new THREE.Vector3(0, 0, 1), base: new THREE.Vector3(-HALF, 0, 0) },
  { normal: new THREE.Vector3(-1, 0, 0), run: new THREE.Vector3(0, 0, 1), base: new THREE.Vector3(HALF, 0, 0) },
];
for (const wall of WALLS) wall.faceYaw = Math.atan2(wall.normal.x, wall.normal.z);

// One geometry and one material per layer, shared by both portals — the same rule the
// enemy tiers and the pickup faces follow. Built at import time from config, so a
// driver retuning PORTAL live moves the light (read per frame) and not these.
const CORE_GEOMETRY = new THREE.PlaneGeometry(PORTAL.size, PORTAL.size);
const AURA_SIZE = PORTAL.size * PORTAL.glow.haloScale;
const AURA_GEOMETRY = new THREE.PlaneGeometry(AURA_SIZE, AURA_SIZE);

/**
 * The far side's walls, with nothing in them and no lights at all — built once here and
 * shared by both portals, since what each one *shows* differs only in where it's looked
 * at from. See createShell() in world.js for why it's a separate Scene (the arena's
 * light count is compiled into every material and must not move) and why it's unlit.
 *
 * Read at import time like the materials below, so a driver retuning PORTAL.view.brightness
 * live moves nothing. The tint next to it *is* live, which is the seam worth knowing:
 * one is baked into a scene's materials, the other is a uniform written every frame.
 */
const SHELL = createShell(PORTAL.view.brightness);

// Scratch for renderViews(), at module scope for the usual reason — it runs every frame,
// twice.
const FRUSTUM = new THREE.Frustum();
const VIEW_PROJECTION = new THREE.Matrix4();
const CULL_SPHERE = new THREE.Sphere();
const BUFFER_SIZE = new THREE.Vector2();

// A sphere that contains both of a portal's quads: half the diagonal of the larger one.
// Generous on purpose — a portal only clipping the edge of the screen still has to have
// its preview drawn, and the cost of being wrong the other way is a visibly blank window.
const CULL_RADIUS = (AURA_SIZE * Math.SQRT2) / 2;

/**
 * The half-turn in the middle of the view transform (see _aimView). One constant rather
 * than a makeRotationY() per frame.
 */
const FLIP = new THREE.Matrix4().makeRotationY(Math.PI);

/**
 * The core quad's material: the preview, tinted. **One per portal, unlike every other
 * asset in this file**, because each holds its own render target in `tView` — that's
 * the one thing the two can't share, and it's why this is a factory rather than a const.
 *
 * Two things in here are less obvious than they look:
 *
 * - **The UVs are screen-space, not the quad's own.** Clip position is carried through as
 *   a varying and divided by `w` in the fragment shader, which makes the doorway a
 *   *window*: the preview is rendered with the player's own projection, so sampling it at
 *   the fragment's screen position shows exactly what a hole in the wall would. Mapping
 *   the quad's 0..1 UVs over it instead would squeeze a 75-degree view into a 3-unit
 *   square and read as a fisheye television hung on the wall. The perspective divide is
 *   what keeps it correct at an angle — interpolating the divided value would shear it.
 * - **The output conversions have to be written out.** A WebGLRenderTarget holds linear
 *   values (the renderer skips output encoding when drawing into one) and a ShaderMaterial
 *   gets no conversion for free, so without the last two includes the preview comes out
 *   visibly darker than the wall around it.
 * - **The tint is mixed *after* that encode, and in linear space it does not work at all.**
 *   This arena is dark: a floor sits at a linear 0.015 and the fog it fades into at 0.007,
 *   so the whole preview lives inside a range of about 0.01 — while 0.22 of a saturated
 *   cyan is 0.19. Mixed before the encode, the tint is twenty times the picture and the
 *   square comes out a flat panel at any amount worth seeing. After it, both sides of the
 *   mix are display values in 0..1 and the amount is what it claims to be: a 0.22 tint
 *   keeps 78% of the preview's contrast. `uTint` stays a THREE.Color in the working space
 *   like every other color in the game, and `linearToOutputTexel` (three defines it in the
 *   fragment prefix for any non-raw material) is what brings it over to meet the picture.
 *
 * Fog is included for the same reason the shell has its own copy of it: the preview's fog
 * covers far-side distance, and this covers the distance from the doorway to the eye. Left
 * out, a portal across the arena stays crisp inside a wall that has hazed away.
 */
function viewMaterial(texture) {
  const uniforms = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
  uniforms.tView = { value: texture };
  uniforms.uTint = { value: new THREE.Color(PORTAL.glow.color) };
  uniforms.uTintAmount = { value: PORTAL.view.tint };

  return new THREE.ShaderMaterial({
    uniforms,
    fog: true, // defines USE_FOG, which the chunks below are all guarded on
    vertexShader: /* glsl */ `
      varying vec4 vPortalClip;

      #include <fog_pars_vertex>

      void main() {
        vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
        gl_Position = projectionMatrix * mvPosition;
        vPortalClip = gl_Position;

        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tView;
      uniform vec3 uTint;
      uniform float uTintAmount;

      varying vec4 vPortalClip;

      #include <fog_pars_fragment>

      void main() {
        vec2 uv = ( vPortalClip.xy / vPortalClip.w ) * 0.5 + 0.5;
        gl_FragColor = vec4( texture2D( tView, uv ).rgb, 1.0 );

        #include <tonemapping_fragment>
        #include <colorspace_fragment>

        gl_FragColor.rgb = mix(
          gl_FragColor.rgb,
          linearToOutputTexel( vec4( uTint, 1.0 ) ).rgb,
          uTintAmount
        );

        #include <fog_fragment>
      }
    `,
  });
}

/**
 * The aura, over the same texture every halo in the game uses — but as a plane rather
 * than through glow.js's `haloSprite()`, which billboards. A halo turns to face the
 * player because it surrounds a body; this one is mounted *on* a surface and has to lie
 * flat against it, or it would swing off the wall as the player walked past.
 *
 * Depth tested and not written, like every other halo: the wall behind it is further
 * away so it draws, and not writing depth keeps it from cutting a hole in the core
 * quad it overlaps.
 */
const AURA_MATERIAL = new THREE.MeshBasicMaterial({
  map: HALO_TEXTURE,
  color: PORTAL.glow.color,
  opacity: PORTAL.glow.haloOpacity,
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

export class Portals {
  /**
   * `renderer` and `camera` are here only for the previews — a portal needs the player's
   * own projection to render a view that lines up as a window, and somewhere to render it
   * to. Nothing else in this file touches either.
   */
  constructor(scene, player, renderer, camera) {
    this.scene = scene;
    this.player = player;
    this.renderer = renderer;
    this.camera = camera;

    // The shell is module state, shared by both portals — hung on the instance so a
    // driver can assert what's in it (walls only, no lights) without importing it.
    this.shell = SHELL;

    /**
     * Raised after a traversal, zero-argument, like player.onHeal. main.js attaches the
     * teleport sound to it. A hook rather than an import of sound.js for the reason every
     * other system here has one: this module reports what happened and main.js decides
     * what it means.
     */
    this.onTraverse = null;

    /**
     * Exactly two, built once here and moved on every placement rather than rebuilt.
     * The lights are the reason (see _build), and a fixed pair of meshes falls out of
     * it. Two rather than a list because a portal without a partner has nowhere to
     * lead: `_exitFor()` is the whole pairing, and a third would need a rule.
     */
    this.portals = [this._build(), this._build()];

    // Placed immediately so nothing can ever render an unplaced portal. rounds.js
    // re-places them a moment later, at the start of round 1 — this is about the gap
    // between construction and the first frame, not about the round.
    this.place();
  }

  _build() {
    const group = new THREE.Group();

    // Sized in renderViews() from the live drawing buffer rather than here, so a window
    // resize needs no seam in main.js — there's already a per-frame pass that knows the
    // right number. 1x1 until then; nothing samples it before the first render.
    //
    // **HalfFloatType is not an upgrade, it's the difference between a picture and a flat
    // panel.** A render target holds *linear* values — three forces the working color
    // space when drawing into one (there's no output encoding pass) — and this arena is
    // dark: its floor sits at a linear 0.010 and its walls at 0.007, which an 8-bit target
    // rounds to bytes 2 and 3 against a background of 2. The entire palette collapses into
    // two levels and the preview comes out a uniform smudge that a screenshot can't
    // distinguish from the cyan square it replaced. Half floats cost 2 bytes a channel at
    // half resolution, which is nothing, and the sRGB curve is then applied on the way out
    // by the fragment shader (see viewMaterial) where there's precision left to spend.
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });

    // The eye the preview is rendered from: the player's camera, reflected through the
    // pair of doorways. matrixAutoUpdate off because _aimView() writes matrixWorld
    // outright — with it on, updateMatrix() would recompose `matrix` from an untouched
    // position/quaternion and the renderer would copy *that* over the view we just built.
    // matrixWorldAutoUpdate stays on, which is what gets matrixWorldInverse refreshed
    // from what we wrote.
    const vcam = new THREE.PerspectiveCamera();
    vcam.matrixAutoUpdate = false;

    const core = new THREE.Mesh(CORE_GEOMETRY, viewMaterial(target.texture));
    const aura = new THREE.Mesh(AURA_GEOMETRY, AURA_MATERIAL);
    // Just off the wall, in the group's local frame — which points along the wall's
    // inward normal once the group is turned (see _set). Without this they'd be
    // coplanar with the wall and z-fight it.
    //
    // **The aura is behind the core, and that ordering is the whole reason the preview is
    // visible at all.** It's an additive cyan quad 2.2x the doorway at 0.7 opacity, so
    // drawn over the window it saturates every pixel of it and the portal goes back to
    // being the flat panel it was before this existed. Behind it, the opaque core writes
    // depth first and the aura's middle is depth-rejected, leaving only the overhang past
    // the square — which is exactly the arrangement that makes an enemy's halo a halo
    // rather than a blob painted over the body (see enemies.js). Same trick, and here it's
    // load-bearing twice over.
    aura.position.z = 0.02;
    core.position.z = 0.04;
    group.add(core, aura);
    this.scene.add(group);

    // One light per portal, added here and then never added, removed or hidden again.
    // effects.js owns the *pooled* lights and explains why at length; the invariant
    // that matters is that the scene's light count never changes after boot, since
    // it's compiled into every material's shader program. Two permanent portals
    // satisfy that without needing to be pooled — there's nothing to reassign.
    const light = new THREE.PointLight(PORTAL.glow.color, PORTAL.glow.intensity, PORTAL.glow.distance);
    this.scene.add(light);

    return {
      group,
      core,
      light,
      target,
      vcam,
      wall: null,
      center: new THREE.Vector3(),
      // The doorway's own frame and its inverse, rebuilt on every placement. See
      // _aimView() for what they're multiplied into.
      frame: new THREE.Matrix4(),
      frameInverse: new THREE.Matrix4(),
    };
  }

  /**
   * Put the pair on two different walls, at a random offset along each. Called by
   * rounds.js from _startRound(), so it covers a real round change, a skip and a
   * retry alike — and so a round change is the *only* thing that moves them.
   */
  place() {
    // Two distinct walls without a retry loop: pick the first, then step 1..3 walls
    // round from it.
    const first = Math.floor(Math.random() * WALLS.length);
    const second = (first + 1 + Math.floor(Math.random() * (WALLS.length - 1))) % WALLS.length;

    this._set(this.portals[0], WALLS[first]);
    this._set(this.portals[1], WALLS[second]);
  }

  _set(portal, wall) {
    // Anywhere along the wall but the corners, which is what PORTAL.margin buys.
    const u = (Math.random() * 2 - 1) * (HALF - PORTAL.margin);

    portal.wall = wall;
    // Standing on the floor, so the center is half a square up.
    portal.center.copy(wall.base).addScaledVector(wall.run, u);
    portal.center.y = PORTAL.size / 2;

    portal.group.position.copy(portal.center);
    portal.group.rotation.y = wall.faceYaw;

    // The doorway as a coordinate frame: the same rotation the quads get, at the same
    // place. Rebuilt here rather than derived from group.matrixWorld, which three only
    // refreshes during render() — the same trap the matrixWorld invariant records for
    // raycasting, and one a preview aimed on the first frame after a placement would hit.
    portal.frame.makeRotationY(wall.faceYaw).setPosition(portal.center);
    portal.frameInverse.copy(portal.frame).invert();

    // Out in the room rather than in the wall's plane — see PORTAL.lightOffset.
    portal.light.position.copy(portal.center).addScaledVector(wall.normal, PORTAL.lightOffset);

    // Re-read here rather than only at construction, so retuning PORTAL.glow live lands
    // at the next round start — roughly the reach a driver has into the enemy glows,
    // which effects.js re-reads every frame. The *materials* can't follow (built at
    // import time, above), so a live retune moves the light and not the aura.
    portal.light.color.set(PORTAL.glow.color);
    portal.light.intensity = PORTAL.glow.intensity;
    portal.light.distance = PORTAL.glow.distance;
  }

  /**
   * Teleport the player if they're standing in a portal. Ticked from main.js right
   * after player.update(), which is what makes the test see the position the player
   * actually walked to this frame.
   *
   * No dt and no cooldown: arriving PORTAL.exitOffset inside the exit wall is already
   * outside its own trigger depth, so there is no travel state to carry between
   * frames. That's a config constraint rather than a guard here — see exitOffset.
   */
  update() {
    for (const portal of this.portals) {
      if (!this._entering(portal)) continue;

      const exit = this._exitFor(portal);
      const { normal } = exit.wall;
      const x = exit.center.x + normal.x * PORTAL.exitOffset;
      const z = exit.center.z + normal.z * PORTAL.exitOffset;

      // The turn: the player was walking into the entry wall (yaw entry.faceYaw) and
      // comes out walking into the arena off the exit wall (yaw exit.faceYaw + PI, a
      // heading looking along that wall's inward normal). The difference is what's
      // handed to the player, so whatever they were looking at relative to the wall
      // they walked into is preserved relative to the one they come out of.
      const turn = exit.wall.faceYaw + Math.PI - portal.wall.faceYaw;
      this.player.teleport(x, z, turn);

      // After the move, so a handler reading the player sees where they arrived. Nothing
      // is passed: main.js turns it into a sound, and neither end of that needs to know
      // which pair of walls was involved.
      if (this.onTraverse) this.onTraverse();

      // One traversal per frame. The exit is outside its own trigger, so this is
      // belt-and-braces against a future third portal rather than load-bearing today.
      return;
    }
  }

  /**
   * Draw each portal's preview into its own target. Called from main.js immediately before
   * the frame is rendered, and outside the running check, so the doorways keep showing the
   * far side behind the pause overlay rather than going flat — the same call the glows and
   * the minimap get, for the same reason.
   *
   * It must run *after* player.update(): the view is the player's own camera pushed through
   * the pair of doorways, so a preview aimed before the move would be a frame behind the
   * wall it's painted on, which reads as the window sliding as you walk.
   */
  renderViews() {
    const { renderer, camera } = this;

    // Half of whatever the canvas is actually drawing at, pixel ratio included. Read per
    // frame rather than wired to a resize handler, which is what keeps this feature out of
    // main.js's setSize path entirely.
    renderer.getDrawingBufferSize(BUFFER_SIZE);
    const width = Math.max(1, Math.round(BUFFER_SIZE.x * PORTAL.view.resolution));
    const height = Math.max(1, Math.round(BUFFER_SIZE.y * PORTAL.view.resolution));

    // Two extra renders is what this costs, and under a software rasterizer that cost is
    // per fragment — so a portal behind the player must not pay it. Culled here rather
    // than left to three, which would still have run the whole render before discarding
    // every object in it.
    VIEW_PROJECTION.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    FRUSTUM.setFromProjectionMatrix(VIEW_PROJECTION);

    for (const portal of this.portals) {
      CULL_SPHERE.center.copy(portal.center);
      CULL_SPHERE.radius = CULL_RADIUS;
      if (!FRUSTUM.intersectsSphere(CULL_SPHERE)) continue;

      if (portal.target.width !== width || portal.target.height !== height) {
        portal.target.setSize(width, height);
      }

      this._aimView(portal);
      renderer.setRenderTarget(portal.target);
      renderer.render(SHELL, portal.vcam);
    }

    // Back to the canvas, or main.js's own render would land in whichever target went
    // last. Null rather than a saved value: nothing here is ever called mid-target.
    renderer.setRenderTarget(null);
  }

  /**
   * Put `portal`'s virtual camera where the player's eye would be if the two doorways were
   * one hole in the wall.
   *
   * The transform is `exit.frame * Ry(PI) * entry.frame^-1`, applied to the player's camera:
   * out of the entry doorway's frame, turned to face the other way, and into the exit
   * doorway's. **Its rotation part is exactly Ry(turn) for the same `turn` update() hands
   * to player.teleport()** — Ry(exitYaw) * Ry(PI) * Ry(-entryYaw) — which is what makes the
   * preview and the arrival provably the same transform rather than two that happen to
   * agree. Get one backwards and the view spins relative to where you come out.
   *
   * That lands the camera **behind the exit wall**, at the same perpendicular distance the
   * player is standing from the entry wall, looking along the exit's inward normal. Outside
   * the box, which sounds wrong and isn't: the shell's walls are single-sided, so the exit
   * wall is back-facing from there and culls away, leaving the view looking through the
   * hole it makes into the room. The floor and the other three walls stay front-facing.
   *
   * The projection is *copied*, not rebuilt. That's not a shortcut — the screen-space UVs in
   * viewMaterial() are only a window if the preview was rendered through the player's own
   * frustum, so sharing the matrix is the requirement. Copying it also means the resize
   * handler's updateProjectionMatrix() reaches the previews for free.
   */
  _aimView(portal) {
    const exit = this._exitFor(portal);
    const { vcam } = portal;

    vcam.matrixWorld
      .copy(exit.frame)
      .multiply(FLIP)
      .multiply(portal.frameInverse)
      .multiply(this.camera.matrixWorld);

    vcam.projectionMatrix.copy(this.camera.projectionMatrix);
    vcam.projectionMatrixInverse.copy(this.camera.projectionMatrixInverse);
  }

  /** The other one. The whole pairing rule, and why there are exactly two. */
  _exitFor(portal) {
    return portal === this.portals[0] ? this.portals[1] : this.portals[0];
  }

  /**
   * Is the player inside this portal's square?
   *
   * Planar, with no height test, like enemy contact and pickup collection — the same
   * call for the same reason: a solid rule everywhere beats a special case here. The
   * visible consequence is that a jump through a portal works even at the top of a
   * SUPER BOOTS hop, where the eye is over the square. That reads as the portal being
   * a doorway in a wall rather than a hoop to thread.
   */
  _entering(portal) {
    const { position } = this.player;
    const { normal, run } = portal.wall;
    const dx = position.x - portal.center.x;
    const dz = position.z - portal.center.z;

    // Straight out from the wall plane. Not floored at 0: the clamp in player.js
    // stops anyone getting behind a wall, but if something ever did, being past it
    // should still count as having gone through.
    if (dx * normal.x + dz * normal.z > PORTAL.depth) return false;

    // ...and along the wall from the middle of the square. Half-width, not half-width
    // plus the player's radius: the doorway is the square you can see, so brushing
    // the edge of the glow shouldn't take you.
    return Math.abs(dx * run.x + dz * run.z) <= PORTAL.size / 2;
  }
}
