import * as THREE from 'three';
import { WORLD } from './config.js';

// The arena: a floor, four walls, and enough light to see them. Flat colors and
// no textures — that's the look.

export function createWorld(scene) {
  scene.background = new THREE.Color(0x14161c);
  scene.fog = new THREE.Fog(0x14161c, 20, WORLD.arenaSize);

  const size = WORLD.arenaSize;
  const half = size / 2;

  // Surfaces a shot can land on. The weapon raycasts these alongside the enemy
  // hitboxes so bullets stop at the arena instead of flying through it.
  const solids = [];

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshLambertMaterial({ color: 0x2a2f3a })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  solids.push(floor);

  // Grid on the floor gives a sense of speed while moving. Deliberately not a
  // solid: it's LineSegments sitting 1cm above the floor, so raycasting it would
  // scatter sparks off invisible wires just in front of the surface they belong on.
  const grid = new THREE.GridHelper(size, size / 2, 0x3d4455, 0x333a47);
  grid.position.y = 0.01;
  scene.add(grid);

  const wallMaterial = new THREE.MeshLambertMaterial({ color: 0x3a4050 });
  const wallGeometry = new THREE.PlaneGeometry(size, WORLD.wallHeight);

  // [x, z, yRotation] for each wall, all facing inward.
  const walls = [
    [0, -half, 0],
    [0, half, Math.PI],
    [-half, 0, Math.PI / 2],
    [half, 0, -Math.PI / 2],
  ];
  for (const [x, z, rotY] of walls) {
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
  return { bounds: { min: -half, max: half }, solids };
}
