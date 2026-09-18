import * as THREE from 'three';
import { WORLD } from './config.js';

// The arena: a floor, four walls, and enough light to see them. Flat colors and
// no textures — that's the look.

export function createWorld(scene) {
  scene.background = new THREE.Color(0x14161c);
  scene.fog = new THREE.Fog(0x14161c, 20, WORLD.arenaSize);

  const size = WORLD.arenaSize;
  const half = size / 2;

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshLambertMaterial({ color: 0x2a2f3a })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  // Grid on the floor gives a sense of speed while moving.
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
  }

  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x30333c, 1.1));

  const key = new THREE.DirectionalLight(0xffffff, 0.6);
  key.position.set(1, 2, 1);
  scene.add(key);

  // Bounds gameplay code can clamp against, inset by nothing — callers
  // subtract their own radius.
  return { bounds: { min: -half, max: half } };
}
