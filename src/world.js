import * as THREE from 'three';
import { WORLD } from './config.js';

// The arena: a floor, four walls, and enough light to see them. Flat colors and
// no textures — that's the look.
//
// Two scenes come out of here. createWorld() builds the real one, lit and
// shootable; createShell() builds the walls-only copy the portals show as a
// preview of the far side. Both read the same colors and the same wall table
// below, because a shell that drifted from the arena would read as a window onto
// a *different* room — which is the one thing it must not look like.

const HALF = WORLD.arenaSize / 2;

// Every color in the arena, in one place so the shell can't disagree with the
// room it's a picture of.
const SURFACE = {
  background: 0x14161c,
  fogNear: 20,
  floor: 0x2a2f3a,
  wall: 0x3a4050,
  gridMajor: 0x3d4455,
  gridMinor: 0x333a47,
};

// [x, z, yRotation] for each wall, all facing inward. Single-sided by
// consequence: a wall is a plane, and the shell depends on that (see createShell).
const WALL_PLACEMENTS = [
  [0, -HALF, 0],
  [0, HALF, Math.PI],
  [-HALF, 0, Math.PI / 2],
  [HALF, 0, -Math.PI / 2],
];

export function createWorld(scene) {
  scene.background = new THREE.Color(SURFACE.background);
  scene.fog = new THREE.Fog(SURFACE.background, SURFACE.fogNear, WORLD.arenaSize);

  const size = WORLD.arenaSize;

  // Surfaces a shot can land on. The weapon raycasts these alongside the enemy
  // hitboxes so bullets stop at the arena instead of flying through it.
  const solids = [];

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshLambertMaterial({ color: SURFACE.floor })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  solids.push(floor);

  // Grid on the floor gives a sense of speed while moving. Deliberately not a
  // solid: it's LineSegments sitting 1cm above the floor, so raycasting it would
  // scatter sparks off invisible wires just in front of the surface they belong on.
  const grid = new THREE.GridHelper(size, size / 2, SURFACE.gridMajor, SURFACE.gridMinor);
  grid.position.y = 0.01;
  scene.add(grid);

  const wallMaterial = new THREE.MeshLambertMaterial({ color: SURFACE.wall });
  const wallGeometry = new THREE.PlaneGeometry(size, WORLD.wallHeight);

  for (const [x, z, rotY] of WALL_PLACEMENTS) {
    const wall = new THREE.Mesh(wallGeometry, wallMaterial);
    wall.position.set(x, WORLD.wallHeight / 2, z);
    wall.rotation.y = rotY;
    scene.add(wall);
    solids.push(wall);
  }

  // These never move, but a raycast still reads matrixWorld and three only
  // refreshes it during render(). Without this a shot on the very first frame
  // would test an unrotated floor and four walls stacked at the origin.
  for (const solid of solids) solid.updateMatrixWorld();

  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x30333c, 1.1));

  const key = new THREE.DirectionalLight(0xffffff, 0.6);
  key.position.set(1, 2, 1);
  scene.add(key);

  // Bounds gameplay code can clamp against, inset by nothing — callers
  // subtract their own radius. `solids` is the shootable surface list.
  return { bounds: { min: -HALF, max: HALF }, solids };
}

/**
 * The arena's shell: the same floor, grid and four walls with nothing in them and
 * no lights at all. This is what a portal shows of the far side, rendered from a
 * virtual camera behind the exit wall (see portals.js).
 *
 * Three things about it are load-bearing:
 *
 * - **It is a separate Scene, which is the whole reason it's cheap and safe.** A
 *   light count is compiled into every material's shader program, so the preview
 *   must not add or remove anything from the main scene's fixed 18; here there are
 *   no lights to count, and these materials compile against zero.
 * - **Unlit, with the lit look faked by a flat `brightness` multiplier.** The spec
 *   is walls only, no objects and no lighting, and MeshBasicMaterial is what makes
 *   "no lighting" free rather than a second lighting rig to keep in step. That
 *   multiplier is deliberately *not* the arena's average light level, which was
 *   measured and comes out near 0.4: a flat term has no per-face N·L and no key-light
 *   gradient, so matching the average matches the arena's brightness and none of what
 *   makes the arena legible, and the preview came out as flat as the panel it
 *   replaced. It runs bright instead — see PORTAL.view.brightness.
 * - **The grid is in it.** Without the floor lines the preview is two or three flat
 *   panels of near-identical color and has no perspective read at all — the
 *   converging grid is the only thing in an empty box that says how far away the
 *   far wall is, which is the entire point of a *perspective* preview.
 *
 * The walls stay single-sided, which is what lets the virtual camera sit outside
 * the box: the exit wall is back-facing from there and culls away, leaving the view
 * looking through the hole it makes into the room beyond.
 */
export function createShell(brightness) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SURFACE.background);
  // Same fog as the arena, so the far wall falls off at the same rate through the
  // doorway as it does around it. Without it the preview reads brighter than the
  // room at every distance and the square stops looking like an opening.
  scene.fog = new THREE.Fog(SURFACE.background, SURFACE.fogNear, WORLD.arenaSize);

  const size = WORLD.arenaSize;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ color: dim(SURFACE.floor, brightness) })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const grid = new THREE.GridHelper(
    size,
    size / 2,
    dim(SURFACE.gridMajor, brightness),
    dim(SURFACE.gridMinor, brightness)
  );
  grid.position.y = 0.01;
  scene.add(grid);

  const wallMaterial = new THREE.MeshBasicMaterial({ color: dim(SURFACE.wall, brightness) });
  const wallGeometry = new THREE.PlaneGeometry(size, WORLD.wallHeight);

  for (const [x, z, rotY] of WALL_PLACEMENTS) {
    const wall = new THREE.Mesh(wallGeometry, wallMaterial);
    wall.position.set(x, WORLD.wallHeight / 2, z);
    wall.rotation.y = rotY;
    scene.add(wall);
  }

  return scene;
}

/**
 * An sRGB hex scaled down in the *linear* working space, which is where a
 * brightness factor means what it says — new Color() converts on the way in, and
 * halving a linear value is halving the light, not the byte.
 */
function dim(hex, brightness) {
  return new THREE.Color(hex).multiplyScalar(brightness);
}
