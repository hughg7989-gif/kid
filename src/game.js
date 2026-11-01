/* Toddler Toy Car 3D - Infinite Procedural World with Modular Vehicles & Roads */

import { SoundEngine } from './audio.js';
import { VEHICLES, getVehicleById } from './vehicles/index.js';

// ==========================================
// 1. CONFIGURATION & PERSISTENT ROOM PAIRING
// ==========================================
// Infinite World Dimensions
const WORLD_SPAN = 360;        // Active world bounding box size (-180 to +180 relative to car)
const HALF_SPAN = WORLD_SPAN / 2;
const GRID_CELL_SIZE = 12;     // Spatial hash cell size
const GRID_DIM = Math.ceil(WORLD_SPAN / GRID_CELL_SIZE); // 30x30 spatial cells
const ROAD_INTERVAL = 90;      // Roads run every 90 units along X and Z

// Persistent Room Code (Never changes across reloads unless user resets)
let persistentRoomCode = localStorage.getItem('toycar_pc_room_code');
if (!persistentRoomCode || persistentRoomCode.length < 4) {
  persistentRoomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
  localStorage.setItem('toycar_pc_room_code', persistentRoomCode);
}
const fullPeerId = 'toycar-' + persistentRoomCode;

// Active Vehicle State (Remembered in localStorage)
const savedVehicleId = localStorage.getItem('toycar_active_vehicle') || 'car';
let currentVehicleDef = getVehicleById(savedVehicleId);

// Steering Invert Toggle (can be toggled on PC or phone)
let invertSteeringPC = localStorage.getItem('toycar_pc_invert') === '1';

// Sound Engine
const soundEngine = new SoundEngine();

// ==========================================
// 2. PROCEDURAL MULTI-TYPE OBSTACLE COUNTS
// ==========================================
// Obstacle categories:
// 0: Trees (Pine & Apple Trees)
// 1: Suburban Houses
// 2: Farm Barns
// 3: Farm Hay Bales
// 4: Toddler Toy Blocks
// 5: Streetlamps & Traffic Cones

const COUNT_TREES = 1400;
const COUNT_HOUSES = 300;
const COUNT_BARNS = 120;
const COUNT_HAYBALES = 400;
const COUNT_TOYBLOCKS = 400;
const COUNT_STREETLAMPS = 240;

const TOTAL_OBSTACLES = COUNT_TREES + COUNT_HOUSES + COUNT_BARNS + COUNT_HAYBALES + COUNT_TOYBLOCKS + COUNT_STREETLAMPS;

// Data-Oriented Design (Structure of Arrays - SoA)
const obstacleSoA = {
  positions: new Float32Array(TOTAL_OBSTACLES * 2), // [x, z, x, z, ...]
  radii: new Float32Array(TOTAL_OBSTACLES),
  states: new Uint8Array(TOTAL_OBSTACLES),          // 0 = Active, 1 = Crumbling, 2 = Smashed
  types: new Uint8Array(TOTAL_OBSTACLES),           // 0: Tree, 1: House, 2: Barn, 3: Hay, 4: Block, 5: Lamp
  instanceIndices: new Uint32Array(TOTAL_OBSTACLES),
  crumbleProgress: new Float32Array(TOTAL_OBSTACLES),
  tipDirs: new Float32Array(TOTAL_OBSTACLES * 2),
  initialMatrices: new Float32Array(TOTAL_OBSTACLES * 16),
  baseScales: new Float32Array(TOTAL_OBSTACLES),
};

// Spatial Hash Grid (30x30 cells wrapping around car)
const spatialGrid = new Array(GRID_DIM * GRID_DIM);
for (let i = 0; i < spatialGrid.length; i++) {
  spatialGrid[i] = [];
}

function clearSpatialGrid() {
  for (let i = 0; i < spatialGrid.length; i++) {
    spatialGrid[i].length = 0;
  }
}

function getGridIndex(relX, relZ) {
  const cx = Math.floor((relX + HALF_SPAN) / GRID_CELL_SIZE);
  const cz = Math.floor((relZ + HALF_SPAN) / GRID_CELL_SIZE);
  if (cx < 0 || cx >= GRID_DIM || cz < 0 || cz >= GRID_DIM) return -1;
  return cz * GRID_DIM + cx;
}

function insertIntoGrid(obstacleIdx, relX, relZ) {
  const gIdx = getGridIndex(relX, relZ);
  if (gIdx >= 0) {
    spatialGrid[gIdx].push(obstacleIdx);
  }
}

// ==========================================
// 3. THREE.JS SCENE, LIGHTING & PROCEDURAL ROAD MAP
// ==========================================
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa5d8ff); // Sky blue
scene.fog = new THREE.Fog(0xa5d8ff, 70, 260);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.5, 500);
camera.position.set(0, 15, -24);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
container.appendChild(renderer.domElement);

// Warm sunlight & cool hemisphere bounce
const hemiLight = new THREE.HemisphereLight(0xfffdf5, 0x38bdf8, 0.7);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfffaed, 1.2);
sunLight.position.set(50, 100, 70);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 300;
sunLight.shadow.camera.left = -60;
sunLight.shadow.camera.right = 60;
sunLight.shadow.camera.top = 60;
sunLight.shadow.camera.bottom = -60;
sunLight.shadow.bias = -0.0005;
scene.add(sunLight);
scene.add(sunLight.target);

// Procedural Meadow & Road Grid Texture (Repeats every ROAD_INTERVAL = 90 units)
function createEndlessRoadTexture() {
  const size = 1024;
  const cvs = document.createElement('canvas');
  cvs.width = size;
  cvs.height = size;
  const ctx = cvs.getContext('2d');

  // 1. Lush grass base
  ctx.fillStyle = '#86efac';
  ctx.fillRect(0, 0, size, size);

  // Soft grass checkerboard pattern
  ctx.fillStyle = '#6ee7b7';
  const tileSize = 64;
  for (let x = 0; x < size; x += tileSize) {
    for (let y = 0; y < size; y += tileSize) {
      if ((x / tileSize + y / tileSize) % 2 === 0) {
        ctx.fillRect(x, y, tileSize, tileSize);
      }
    }
  }

  // Cute flower dots in grassy areas
  const flowerColors = ['#fef08a', '#f472b6', '#ffffff', '#fed7aa'];
  for (let i = 0; i < 90; i++) {
    const fx = Math.random() * size;
    const fy = Math.random() * size;
    // Don't place in roads (center bands)
    if (Math.abs(fx - size / 2) > 90 && Math.abs(fy - size / 2) > 90) {
      ctx.fillStyle = flowerColors[i % flowerColors.length];
      ctx.beginPath();
      ctx.arc(fx, fy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 2. Asphalt Roads (Crossroad through center)
  const roadWidth = 140; // in canvas pixels (~12.3 world units)
  const center = size / 2;

  // Sidewalk curbs
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(center - roadWidth / 2 - 8, 0, roadWidth + 16, size);
  ctx.fillRect(0, center - roadWidth / 2 - 8, size, roadWidth + 16);

  // Dark asphalt surface
  ctx.fillStyle = '#334155';
  ctx.fillRect(center - roadWidth / 2, 0, roadWidth, size);
  ctx.fillRect(0, center - roadWidth / 2, size, roadWidth);

  // White road boundary lines
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(center - roadWidth / 2 + 6, 0, 4, size);
  ctx.fillRect(center + roadWidth / 2 - 10, 0, 4, size);
  ctx.fillRect(0, center - roadWidth / 2 + 6, size, 4);
  ctx.fillRect(0, center + roadWidth / 2 - 10, size, 4);

  // Dashed Yellow Centerlines
  ctx.fillStyle = '#facc15';
  for (let y = 0; y < size; y += 40) {
    // Skip inside intersection
    if (Math.abs(y - center) > roadWidth / 2 + 10) {
      ctx.fillRect(center - 3, y + 8, 6, 24);
    }
  }
  for (let x = 0; x < size; x += 40) {
    if (Math.abs(x - center) > roadWidth / 2 + 10) {
      ctx.fillRect(x + 8, center - 3, 24, 6);
    }
  }

  // Zebra Pedestrian Crossings at intersection
  ctx.fillStyle = '#ffffff';
  for (let k = -50; k <= 50; k += 20) {
    // North crossing
    ctx.fillRect(center + k - 5, center - roadWidth / 2 - 25, 12, 20);
    // South crossing
    ctx.fillRect(center + k - 5, center + roadWidth / 2 + 5, 12, 20);
    // West crossing
    ctx.fillRect(center - roadWidth / 2 - 25, center + k - 5, 20, 12);
    // East crossing
    ctx.fillRect(center + roadWidth / 2 + 5, center + k - 5, 20, 12);
  }

  const texture = new THREE.CanvasTexture(cvs);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // Repeat so 1 cycle = ROAD_INTERVAL (90 units)
  const repeats = WORLD_SPAN / ROAD_INTERVAL; // 4.0
  texture.repeat.set(repeats * 2, repeats * 2);
  texture.encoding = THREE.sRGBEncoding;
  return texture;
}

// Endless Ground Plane (tracks player position so it never ends)
const groundGeo = new THREE.PlaneGeometry(WORLD_SPAN * 2, WORLD_SPAN * 2);
const groundMat = new THREE.MeshStandardMaterial({
  map: createEndlessRoadTexture(),
  roughness: 0.85,
  metalness: 0.1,
});
const groundMesh = new THREE.Mesh(groundGeo, groundMat);
groundMesh.rotation.x = -Math.PI / 2;
groundMesh.receiveShadow = true;
scene.add(groundMesh);

// Helper for geometry merging
function mergeGeometries(geos) {
  if (window.THREE && THREE.BufferGeometryUtils && THREE.BufferGeometryUtils.mergeBufferGeometries) {
    return THREE.BufferGeometryUtils.mergeBufferGeometries(geos, false);
  }
  return geos[0];
}

const setGeoColor = (geo, colorHex) => {
  const col = new THREE.Color(colorHex);
  const count = geo.attributes.position.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
};

// ==========================================
// 4. PROCEDURAL ENVIRONMENT GEOMETRIES
// ==========================================

// 1. Varied Trees: Pine & Fruit Trees
function createTreeGeometry() {
  const trunk = new THREE.CylinderGeometry(0.35, 0.55, 3.2, 7);
  trunk.translate(0, 1.6, 0);

  const foliage1 = new THREE.ConeGeometry(2.3, 3.2, 7);
  foliage1.translate(0, 3.6, 0);

  const foliage2 = new THREE.ConeGeometry(1.7, 2.6, 7);
  foliage2.translate(0, 5.0, 0);

  const foliage3 = new THREE.ConeGeometry(1.1, 2.0, 7);
  foliage3.translate(0, 6.1, 0);

  // Red apples / fruits on tree
  const apple1 = new THREE.SphereGeometry(0.25, 6, 6);
  apple1.translate(0.9, 4.0, 0.7);

  const apple2 = apple1.clone();
  apple2.translate(-1.8, 0.6, -0.4);

  const apple3 = apple1.clone();
  apple3.translate(0.4, 1.2, -1.5);

  setGeoColor(trunk, 0x854d0e);     // Wood trunk
  setGeoColor(foliage1, 0x22c55e);  // Forest green
  setGeoColor(foliage2, 0x16a34a);  // Mid green
  setGeoColor(foliage3, 0x15803d);  // Deep green
  setGeoColor(apple1, 0xef4444);    // Red apple
  setGeoColor(apple2, 0xef4444);
  setGeoColor(apple3, 0xef4444);

  return mergeGeometries([trunk, foliage1, foliage2, foliage3, apple1, apple2, apple3]);
}

// 2. Suburban Houses (Base + Pitched Roof + Chimney + Door)
function createHouseGeometry() {
  const base = new THREE.BoxGeometry(4.2, 3.2, 4.2);
  base.translate(0, 1.6, 0);

  const roof = new THREE.ConeGeometry(3.8, 2.4, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 4.4, 0);

  const chimney = new THREE.BoxGeometry(0.8, 1.6, 0.8);
  chimney.translate(1.1, 4.5, 0.9);

  const door = new THREE.BoxGeometry(1.2, 2.0, 0.2);
  door.translate(0, 1.0, 2.11);

  setGeoColor(base, 0xf8fafc);     // Crisp white house walls
  setGeoColor(roof, 0xe11d48);     // Crimson roof
  setGeoColor(chimney, 0x64748b);  // Stone chimney
  setGeoColor(door, 0x0284c7);     // Blue door

  return mergeGeometries([base, roof, chimney, door]);
}

// 3. Country Farm Barns (Red barn with gambrel roof & hayloft window)
function createBarnGeometry() {
  const barnBody = new THREE.BoxGeometry(5.2, 3.6, 6.0);
  barnBody.translate(0, 1.8, 0);

  const roofLower = new THREE.BoxGeometry(5.6, 1.4, 6.2);
  roofLower.translate(0, 4.0, 0);

  const roofPeak = new THREE.ConeGeometry(3.6, 1.8, 4);
  roofPeak.rotateY(Math.PI / 4);
  roofPeak.translate(0, 5.2, 0);

  const barnDoor = new THREE.BoxGeometry(2.4, 2.4, 0.25);
  barnDoor.translate(0, 1.2, 3.02);

  const loftWindow = new THREE.BoxGeometry(1.2, 1.2, 0.25);
  loftWindow.translate(0, 3.8, 3.02);

  // Silo next to barn
  const silo = new THREE.CylinderGeometry(1.4, 1.4, 6.0, 12);
  silo.translate(3.8, 3.0, 0);

  const siloDome = new THREE.SphereGeometry(1.4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  siloDome.translate(3.8, 6.0, 0);

  setGeoColor(barnBody, 0xb91c1c);   // Traditional Barn Red
  setGeoColor(roofLower, 0x475569);  // Dark metal roof
  setGeoColor(roofPeak, 0x475569);
  setGeoColor(barnDoor, 0xffffff);   // White trim X barn doors
  setGeoColor(loftWindow, 0xffffff);
  setGeoColor(silo, 0x94a3b8);       // Silver grain silo
  setGeoColor(siloDome, 0x64748b);

  return mergeGeometries([barnBody, roofLower, roofPeak, barnDoor, loftWindow, silo, siloDome]);
}

// 4. Farm Hay Bales (Yellow Cylinders lying flat)
function createHayBaleGeometry() {
  const bale = new THREE.CylinderGeometry(1.1, 1.1, 2.4, 12);
  bale.rotateZ(Math.PI / 2);
  bale.translate(0, 1.1, 0);

  setGeoColor(bale, 0xfacc15); // Golden hay yellow
  return bale;
}

// 5. Toddler Toy Blocks (Colorful Giant ABC Toy Cubes)
function createToyBlockGeometry() {
  const cube = new THREE.BoxGeometry(2.2, 2.2, 2.2);
  cube.translate(0, 1.1, 0);

  // Star / letter accent on top
  const accent = new THREE.BoxGeometry(1.4, 0.1, 1.4);
  accent.translate(0, 2.21, 0);

  setGeoColor(cube, 0x06b6d4);   // Bright cyan block
  setGeoColor(accent, 0xfef08a); // Yellow star cap

  return mergeGeometries([cube, accent]);
}

// 6. Streetlamps along roads (Posts with glowing lanterns)
function createStreetlampGeometry() {
  const pole = new THREE.CylinderGeometry(0.12, 0.16, 4.5, 8);
  pole.translate(0, 2.25, 0);

  const arm = new THREE.BoxGeometry(0.12, 0.12, 1.2);
  arm.translate(0, 4.4, 0.5);

  const lamp = new THREE.BoxGeometry(0.45, 0.55, 0.45);
  lamp.translate(0, 4.2, 1.0);

  setGeoColor(pole, 0x1e293b); // Dark metal pole
  setGeoColor(arm, 0x1e293b);
  setGeoColor(lamp, 0xfef08a); // Glowing warm lantern

  return mergeGeometries([pole, arm, lamp]);
}

// Instantiate InstancedMeshes
const instancedMeshes = {
  trees: new THREE.InstancedMesh(createTreeGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), COUNT_TREES),
  houses: new THREE.InstancedMesh(createHouseGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), COUNT_HOUSES),
  barns: new THREE.InstancedMesh(createBarnGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), COUNT_BARNS),
  haybales: new THREE.InstancedMesh(createHayBaleGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), COUNT_HAYBALES),
  toyblocks: new THREE.InstancedMesh(createToyBlockGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }), COUNT_TOYBLOCKS),
  streetlamps: new THREE.InstancedMesh(createStreetlampGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), COUNT_STREETLAMPS),
};

// Enable shadows and disable frustum culling on instanced meshes spanning the terrain
Object.values(instancedMeshes).forEach((mesh) => {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
});

// Helper: Check if a position is on a road (roads every ROAD_INTERVAL = 90 units, width ~13 units)
function isOnRoad(x, z, margin = 4.0) {
  const modX = Math.abs(((x % ROAD_INTERVAL) + ROAD_INTERVAL) % ROAD_INTERVAL);
  const modZ = Math.abs(((z % ROAD_INTERVAL) + ROAD_INTERVAL) % ROAD_INTERVAL);
  const roadHalfWidth = 6.5 + margin;
  const isNearRoadX = modX < roadHalfWidth || modX > ROAD_INTERVAL - roadHalfWidth;
  const isNearRoadZ = modZ < roadHalfWidth || modZ > ROAD_INTERVAL - roadHalfWidth;
  return isNearRoadX || isNearRoadZ;
}

// Populate Environment Obstacles across initial world
let globalObsIdx = 0;
const dummyObj = new THREE.Object3D();

function populateObstacleGroup(mesh, count, typeId, baseRadius, canBeOnRoad = false) {
  for (let i = 0; i < count; i++) {
    let x, z;
    let attempts = 0;
    do {
      x = (Math.random() - 0.5) * WORLD_SPAN;
      z = (Math.random() - 0.5) * WORLD_SPAN;
      attempts++;
    } while (attempts < 25 && !canBeOnRoad && isOnRoad(x, z, 3.0));

    const scale = 0.8 + Math.random() * 0.4;
    const rotY = Math.random() * Math.PI * 2;

    dummyObj.position.set(x, 0, z);
    dummyObj.rotation.set(0, rotY, 0);
    dummyObj.scale.set(scale, scale, scale);
    dummyObj.updateMatrix();

    mesh.setMatrixAt(i, dummyObj.matrix);

    const idx = globalObsIdx++;
    obstacleSoA.positions[idx * 2] = x;
    obstacleSoA.positions[idx * 2 + 1] = z;
    obstacleSoA.radii[idx] = baseRadius * scale;
    obstacleSoA.states[idx] = 0; // Active
    obstacleSoA.types[idx] = typeId;
    obstacleSoA.instanceIndices[idx] = i;
    obstacleSoA.crumbleProgress[idx] = 0;
    obstacleSoA.baseScales[idx] = scale;

    const m = dummyObj.matrix.elements;
    for (let k = 0; k < 16; k++) {
      obstacleSoA.initialMatrices[idx * 16 + k] = m[k];
    }

    insertIntoGrid(idx, x, z);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

// Populate all categories
populateObstacleGroup(instancedMeshes.trees, COUNT_TREES, 0, 1.3, false);
populateObstacleGroup(instancedMeshes.houses, COUNT_HOUSES, 1, 2.5, false);
populateObstacleGroup(instancedMeshes.barns, COUNT_BARNS, 2, 3.4, false);
populateObstacleGroup(instancedMeshes.haybales, COUNT_HAYBALES, 3, 1.4, false);
populateObstacleGroup(instancedMeshes.toyblocks, COUNT_TOYBLOCKS, 4, 1.5, true); // Toy blocks can sit on roadside!
populateObstacleGroup(instancedMeshes.streetlamps, COUNT_STREETLAMPS, 5, 0.9, true); // Lamps sit right at road edges!

// ==========================================
// 5. MODULAR VEHICLE SPAWNING & KINEMATICS
// ==========================================
let currentVehicleMesh = null;
let currentWheels = [];

const carState = {
  x: 0,
  z: 0,
  angle: 0,
  targetAngle: 0,
  currentSpeed: currentVehicleDef.baseSpeed,
  collisionCount: 0,
};

function mountVehicle(vehicleDef) {
  if (currentVehicleMesh) {
    scene.remove(currentVehicleMesh);
  }
  currentVehicleDef = vehicleDef;
  const { group, wheels } = vehicleDef.createMesh(THREE, mergeGeometries);
  currentVehicleMesh = group;
  currentWheels = wheels;
  scene.add(currentVehicleMesh);

  soundEngine.setVehicle(vehicleDef);
  localStorage.setItem('toycar_active_vehicle', vehicleDef.id);

  // Update UI badge
  const vehicleNameBadge = document.getElementById('vehicleNameBadge');
  if (vehicleNameBadge) {
    vehicleNameBadge.textContent = `${vehicleDef.icon} ${vehicleDef.name}`;
  }
}

mountVehicle(currentVehicleDef);

// ==========================================
// 6. POPPING PUFF PARTICLES (ON HIT)
// ==========================================
const MAX_PARTICLES = 160;
const particleGeo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
const particleMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
const particleInstancedMesh = new THREE.InstancedMesh(particleGeo, particleMat, MAX_PARTICLES);
particleInstancedMesh.frustumCulled = false;
scene.add(particleInstancedMesh);

const particlePool = {
  active: new Uint8Array(MAX_PARTICLES),
  x: new Float32Array(MAX_PARTICLES),
  y: new Float32Array(MAX_PARTICLES),
  z: new Float32Array(MAX_PARTICLES),
  vx: new Float32Array(MAX_PARTICLES),
  vy: new Float32Array(MAX_PARTICLES),
  vz: new Float32Array(MAX_PARTICLES),
  life: new Float32Array(MAX_PARTICLES),
  maxLife: new Float32Array(MAX_PARTICLES),
};

const zeroScaleMat = new THREE.Matrix4().makeScale(0, 0, 0);
for (let i = 0; i < MAX_PARTICLES; i++) {
  particleInstancedMesh.setMatrixAt(i, zeroScaleMat);
}
particleInstancedMesh.instanceMatrix.needsUpdate = true;

function spawnParticles(x, y, z, count = 12) {
  let spawned = 0;
  for (let i = 0; i < MAX_PARTICLES && spawned < count; i++) {
    if (particlePool.active[i] === 0) {
      particlePool.active[i] = 1;
      particlePool.x[i] = x;
      particlePool.y[i] = y;
      particlePool.z[i] = z;
      const angle = Math.random() * Math.PI * 2;
      const speed = 3.0 + Math.random() * 5.0;
      particlePool.vx[i] = Math.cos(angle) * speed;
      particlePool.vy[i] = 4.0 + Math.random() * 6.0;
      particlePool.vz[i] = Math.sin(angle) * speed;
      particlePool.life[i] = 0.5 + Math.random() * 0.3;
      particlePool.maxLife[i] = particlePool.life[i];
      spawned++;
    }
  }
}

function updateParticles(dt) {
  let needsUpdate = false;
  const pObj = new THREE.Object3D();

  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (particlePool.active[i] === 1) {
      particlePool.life[i] -= dt;
      if (particlePool.life[i] <= 0) {
        particlePool.active[i] = 0;
        particleInstancedMesh.setMatrixAt(i, zeroScaleMat);
        needsUpdate = true;
      } else {
        particlePool.vy[i] -= 16.0 * dt;
        particlePool.x[i] += particlePool.vx[i] * dt;
        particlePool.y[i] = Math.max(0.2, particlePool.y[i] + particlePool.vy[i] * dt);
        particlePool.z[i] += particlePool.vz[i] * dt;

        const progress = particlePool.life[i] / particlePool.maxLife[i];
        const s = progress * 1.2;
        pObj.position.set(particlePool.x[i], particlePool.y[i], particlePool.z[i]);
        pObj.scale.set(s, s, s);
        pObj.rotation.x += dt * 5.0;
        pObj.rotation.y += dt * 4.0;
        pObj.updateMatrix();

        particleInstancedMesh.setMatrixAt(i, pObj.matrix);
        needsUpdate = true;
      }
    }
  }
  if (needsUpdate) {
    particleInstancedMesh.instanceMatrix.needsUpdate = true;
  }
}

// ==========================================
// 7. CRUMBLING & INFINITE WRAPPING SYSTEM
// ==========================================
function getMeshForType(typeId) {
  switch (typeId) {
    case 0: return instancedMeshes.trees;
    case 1: return instancedMeshes.houses;
    case 2: return instancedMeshes.barns;
    case 3: return instancedMeshes.haybales;
    case 4: return instancedMeshes.toyblocks;
    case 5: return instancedMeshes.streetlamps;
    default: return instancedMeshes.trees;
  }
}

const scratchMatrix = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const tipAxis = new THREE.Vector3();
const tipQuat = new THREE.Quaternion();

function updateCrumblingAndInfiniteWrapping(dt) {
  const meshUpdates = new Set();
  clearSpatialGrid();

  for (let i = 0; i < TOTAL_OBSTACLES; i++) {
    let ox = obstacleSoA.positions[i * 2];
    let oz = obstacleSoA.positions[i * 2 + 1];

    // Calculate position relative to car
    let dx = ox - carState.x;
    let dz = oz - carState.z;
    let shifted = false;

    // Infinite Seamless Toroidal Wrapping: If obstacle gets > HALF_SPAN behind the car,
    // seamlessly shift it forward ahead of the car!
    if (dx > HALF_SPAN) {
      ox -= WORLD_SPAN;
      dx -= WORLD_SPAN;
      shifted = true;
    } else if (dx < -HALF_SPAN) {
      ox += WORLD_SPAN;
      dx += WORLD_SPAN;
      shifted = true;
    }

    if (dz > HALF_SPAN) {
      oz -= WORLD_SPAN;
      dz -= WORLD_SPAN;
      shifted = true;
    } else if (dz < -HALF_SPAN) {
      oz += WORLD_SPAN;
      dz += WORLD_SPAN;
      shifted = true;
    }

    if (shifted) {
      obstacleSoA.positions[i * 2] = ox;
      obstacleSoA.positions[i * 2 + 1] = oz;
      // Re-activate obstacle ahead in horizon!
      obstacleSoA.states[i] = 0;
      obstacleSoA.crumbleProgress[i] = 0;

      // Rebuild initial matrix at new world coordinates
      const s = obstacleSoA.baseScales[i];
      dummyObj.position.set(ox, 0, oz);
      dummyObj.rotation.set(0, (i * 1.3) % (Math.PI * 2), 0);
      dummyObj.scale.set(s, s, s);
      dummyObj.updateMatrix();

      const m = dummyObj.matrix.elements;
      for (let k = 0; k < 16; k++) {
        obstacleSoA.initialMatrices[i * 16 + k] = m[k];
      }

      const mTarget = getMeshForType(obstacleSoA.types[i]);
      mTarget.setMatrixAt(obstacleSoA.instanceIndices[i], dummyObj.matrix);
      meshUpdates.add(mTarget);
    }

    // Insert active obstacles into spatial grid for $O(1)$ collision check
    if (obstacleSoA.states[i] === 0) {
      insertIntoGrid(i, dx, dz);
    }

    // Process crumbling animation
    if (obstacleSoA.states[i] === 1) {
      obstacleSoA.crumbleProgress[i] += dt * 2.4;
      const progress = Math.min(1.0, obstacleSoA.crumbleProgress[i]);
      const instIdx = obstacleSoA.instanceIndices[i];
      const targetMesh = getMeshForType(obstacleSoA.types[i]);

      for (let k = 0; k < 16; k++) {
        scratchMatrix.elements[k] = obstacleSoA.initialMatrices[i * 16 + k];
      }
      scratchMatrix.decompose(scratchPosition, scratchQuaternion, scratchScale);

      const tipX = obstacleSoA.tipDirs[i * 2];
      const tipZ = obstacleSoA.tipDirs[i * 2 + 1];
      tipAxis.set(-tipZ, 0, tipX).normalize();
      tipQuat.setFromAxisAngle(tipAxis, progress * (Math.PI * 0.45));
      scratchQuaternion.multiply(tipQuat);

      const scaleFactor = Math.max(0.001, 1.0 - progress);
      scratchScale.multiplyScalar(scaleFactor);
      scratchPosition.y -= progress * 1.5;

      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);
      targetMesh.setMatrixAt(instIdx, scratchMatrix);
      meshUpdates.add(targetMesh);

      if (progress >= 1.0) {
        obstacleSoA.states[i] = 2; // Smashed
      }
    }
  }

  // Flag needsUpdate on modified instanced meshes
  meshUpdates.forEach(m => {
    m.instanceMatrix.needsUpdate = true;
  });
}

// Angular interpolation (Shortest-path lerp)
function lerpAngle(from, to, t) {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return from + diff * t;
}

// ==========================================
// 8. COLLISION DETECTION & VEHICLE DRIVE
// ==========================================
function checkCollisionsAndDrive(dt) {
  // 1. Smoothly interpolate steering towards target angle
  carState.angle = lerpAngle(carState.angle, carState.targetAngle, Math.min(1.0, dt * 5.5));

  // 2. Continuous Gentle Drive (NO WALLS - infinite cruising!)
  const forwardX = Math.sin(carState.angle);
  const forwardZ = Math.cos(carState.angle);

  carState.x += forwardX * carState.currentSpeed * dt;
  carState.z += forwardZ * carState.currentSpeed * dt;

  // 3. Move endless ground plane under car so terrain never ends
  groundMesh.position.set(carState.x, 0, carState.z);

  // 4. Query Spatial Hash Grid ($O(1)$ constant time lookup around car)
  // Car is at center (relX = 0, relZ = 0)
  const centerCellX = Math.floor(HALF_SPAN / GRID_CELL_SIZE);
  const centerCellZ = Math.floor(HALF_SPAN / GRID_CELL_SIZE);

  let isCollidingThisFrame = false;
  const vehicleRadius = currentVehicleDef.id === 'bus' ? 2.2 : (currentVehicleDef.id === 'truck' ? 2.0 : 1.7);

  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const cx = centerCellX + dx;
      const cz = centerCellZ + dz;
      if (cx >= 0 && cx < GRID_DIM && cz >= 0 && cz < GRID_DIM) {
        const cellIdx = cz * GRID_DIM + cx;
        const obstacles = spatialGrid[cellIdx];
        for (let k = 0; k < obstacles.length; k++) {
          const obsIdx = obstacles[k];
          if (obstacleSoA.states[obsIdx] === 0) {
            const ox = obstacleSoA.positions[obsIdx * 2];
            const oz = obstacleSoA.positions[obsIdx * 2 + 1];
            const diffX = carState.x - ox;
            const diffZ = carState.z - oz;
            const distSq = diffX * diffX + diffZ * diffZ;
            const minDist = vehicleRadius + obstacleSoA.radii[obsIdx];

            if (distSq < minDist * minDist) {
              isCollidingThisFrame = true;
              obstacleSoA.states[obsIdx] = 1; // Crumbling
              obstacleSoA.crumbleProgress[obsIdx] = 0;
              obstacleSoA.tipDirs[obsIdx * 2] = forwardX;
              obstacleSoA.tipDirs[obsIdx * 2 + 1] = forwardZ;

              const typeId = obstacleSoA.types[obsIdx];
              const soundType = typeId === 1 ? 'house' : (typeId === 2 ? 'barn' : (typeId === 3 ? 'hay' : (typeId === 4 ? 'block' : 'tree')));
              soundEngine.playTopple(soundType);
              spawnParticles(ox, 2.0, oz, 16);

              carState.collisionCount++;
              const scoreText = document.getElementById('scoreText');
              if (scoreText) scoreText.textContent = `${carState.collisionCount} Smashed!`;

              if (carState.collisionCount % 10 === 0) {
                soundEngine.playCheer();
              }
            }
          }
        }
      }
    }
  }

  // 5. Smooth Speed Dynamics: Slow down slightly to ~30% when crashing through, NEVER stop completely!
  const targetSpeed = isCollidingThisFrame ? currentVehicleDef.minSlowdownSpeed : currentVehicleDef.baseSpeed;
  const accelRate = isCollidingThisFrame ? 18.0 : 6.0;
  carState.currentSpeed += (targetSpeed - carState.currentSpeed) * Math.min(1.0, dt * accelRate);

  soundEngine.updateEnginePitch(carState.currentSpeed / currentVehicleDef.baseSpeed);

  // 6. Update Vehicle 3D Transform
  if (currentVehicleMesh) {
    currentVehicleMesh.position.set(carState.x, 0, carState.z);
    currentVehicleMesh.rotation.y = carState.angle;

    // Wheel rolling animation
    const rollSpeed = (carState.currentSpeed / 0.6) * dt;
    for (let w = 0; w < currentWheels.length; w++) {
      currentWheels[w].children[0].rotation.x += rollSpeed;
    }
  }

  // 7. Update Third-Person Chase Camera
  const camDist = currentVehicleDef.id === 'bus' ? 19.0 : 16.0;
  const camHeight = currentVehicleDef.id === 'bus' ? 9.5 : 8.5;

  const desiredCamX = carState.x - Math.sin(carState.angle) * camDist;
  const desiredCamZ = carState.z - Math.cos(carState.angle) * camDist;
  const desiredCamY = camHeight;

  camera.position.x += (desiredCamX - camera.position.x) * Math.min(1.0, dt * 5.0);
  camera.position.y += (desiredCamY - camera.position.y) * Math.min(1.0, dt * 5.0);
  camera.position.z += (desiredCamZ - camera.position.z) * Math.min(1.0, dt * 5.0);

  camera.lookAt(carState.x, 1.6, carState.z);

  // Sunlight tracks car position
  sunLight.position.set(carState.x + 50, 100, carState.z + 70);
  sunLight.target.position.set(carState.x, 0, carState.z);
}

// ==========================================
// 9. PEERJS WEBRTC PAIRING & INPUT HANDLING
// ==========================================
const roomCodeVal = document.getElementById('roomCodeVal');
const pairingOverlay = document.getElementById('pairingOverlay');
const phoneControllerLink = document.getElementById('phoneControllerLink');
const desktopModeBtn = document.getElementById('desktopModeBtn');
const connDot = document.getElementById('connDot');
const connStatusText = document.getElementById('connStatusText');
const hornBubble = document.getElementById('hornBubble');
const speedValue = document.getElementById('speedValue');
const headingValue = document.getElementById('headingValue');
const inputModeValue = document.getElementById('inputModeValue');
const invertTogglePCBtn = document.getElementById('invertTogglePCBtn');

if (roomCodeVal) roomCodeVal.textContent = persistentRoomCode;

const phoneUrl = `${window.location.origin}/phone.html?peer=${fullPeerId}`;
if (phoneControllerLink) phoneControllerLink.href = phoneUrl;

// Generate QR Code with persistent URL
const qrContainer = document.getElementById('qrcode');
if (qrContainer && window.QRCode) {
  new QRCode(qrContainer, {
    text: phoneUrl,
    width: 190,
    height: 190,
    colorDark: '#0f172a',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.M,
  });
}

// PeerJS Host Instance
let peer = null;
let activeConnection = null;

function initHostPeer() {
  if (!window.Peer) {
    console.warn('PeerJS library not loaded');
    return;
  }
  peer = new Peer(fullPeerId, {
    debug: 1,
  });

  peer.on('open', (id) => {
    console.log('PeerJS Host opened:', id);
  });

  peer.on('connection', (conn) => {
    activeConnection = conn;

    conn.on('open', () => {
      console.log('Mobile controller connected!');
      soundEngine.init(currentVehicleDef);
      soundEngine.playCheer();

      if (pairingOverlay) pairingOverlay.classList.add('hidden');
      if (connDot) {
        connDot.className = 'status-pill';
        connDot.textContent = '●';
      }
      if (connStatusText) connStatusText.textContent = 'PHONE CONNECTED 📱';
      if (inputModeValue) inputModeValue.textContent = 'Phone Gyro';
    });

    conn.on('data', (data) => {
      if (!data) return;
      if (data.type === 'steer') {
        if (typeof data.angle === 'number') {
          // If PC invert is enabled, flip sign
          let angle = data.angle;
          if (invertSteeringPC) angle = -angle;
          carState.targetAngle = angle;
          const deg = Math.round((angle * 180) / Math.PI);
          if (headingValue) headingValue.textContent = deg + '°';
        }
      } else if (data.type === 'horn') {
        soundEngine.playHorn();
        if (hornBubble) {
          hornBubble.classList.add('active');
          setTimeout(() => {
            hornBubble.classList.remove('active');
          }, 800);
        }
      }
    });

    conn.on('close', () => {
      if (connDot) connDot.className = 'status-pill disconnected';
      if (connStatusText) connStatusText.textContent = 'PHONE DISCONNECTED (Waiting...)';
      activeConnection = null;
    });
  });

  peer.on('error', (err) => {
    console.warn('Peer error:', err);
  });
}

initHostPeer();

// Invert Steering Toggle on PC
function updatePCInvertUI() {
  if (!invertTogglePCBtn) return;
  if (invertSteeringPC) {
    invertTogglePCBtn.classList.add('active');
    invertTogglePCBtn.textContent = '🔄 Invert Steering: ON';
  } else {
    invertTogglePCBtn.classList.remove('active');
    invertTogglePCBtn.textContent = '🔄 Invert Steering: OFF';
  }
}
updatePCInvertUI();

if (invertTogglePCBtn) {
  invertTogglePCBtn.addEventListener('click', () => {
    invertSteeringPC = !invertSteeringPC;
    localStorage.setItem('toycar_pc_invert', invertSteeringPC ? '1' : '0');
    updatePCInvertUI();
  });
}

// Keyboard Controls (Desktop Mode / Testing Fallback)
const keysDown = {};
window.addEventListener('keydown', (e) => {
  soundEngine.init(currentVehicleDef);
  keysDown[e.key.toLowerCase()] = true;

  if (e.key === ' ' || e.key.toLowerCase() === 'h') {
    soundEngine.playHorn();
    if (hornBubble) {
      hornBubble.classList.add('active');
      setTimeout(() => hornBubble.classList.remove('active'), 800);
    }
  }
});

window.addEventListener('keyup', (e) => {
  keysDown[e.key.toLowerCase()] = false;
});

function handleKeyboardInput(dt) {
  let turned = false;
  if (keysDown['arrowleft'] || keysDown['a']) {
    carState.targetAngle -= 2.4 * dt;
    turned = true;
  }
  if (keysDown['arrowright'] || keysDown['d']) {
    carState.targetAngle += 2.4 * dt;
    turned = true;
  }
  if (turned) {
    const deg = Math.round((carState.targetAngle * 180) / Math.PI);
    if (headingValue) headingValue.textContent = deg + '°';
    if (!activeConnection && inputModeValue) {
      inputModeValue.textContent = 'Keyboard Mode';
    }
  }
}

// ==========================================
// 10. UI & VEHICLE SELECTOR MENU
// ==========================================
// Setup Vehicle Selector Menu buttons
const vehicleMenuContainer = document.getElementById('vehicleMenu');
if (vehicleMenuContainer) {
  vehicleMenuContainer.innerHTML = '';
  VEHICLES.forEach((v) => {
    const btn = document.createElement('button');
    btn.className = `vehicle-select-btn ${v.id === currentVehicleDef.id ? 'active' : ''}`;
    btn.innerHTML = `<span class="v-icon">${v.icon}</span><span class="v-label">${v.name}</span>`;
    btn.addEventListener('click', () => {
      soundEngine.init(v);
      mountVehicle(v);
      document.querySelectorAll('.vehicle-select-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    vehicleMenuContainer.appendChild(btn);
  });
}

if (desktopModeBtn) {
  desktopModeBtn.addEventListener('click', () => {
    soundEngine.init(currentVehicleDef);
    if (pairingOverlay) pairingOverlay.classList.add('hidden');
    if (connStatusText) connStatusText.textContent = 'KEYBOARD ACTIVE ⌨️';
    if (inputModeValue) inputModeValue.textContent = 'Keyboard Steer';
  });
}

const reopenPairingBtn = document.getElementById('reopenPairingBtn');
if (reopenPairingBtn) {
  reopenPairingBtn.addEventListener('click', () => {
    if (pairingOverlay) pairingOverlay.classList.remove('hidden');
  });
}

const audioToggleBtn = document.getElementById('audioToggleBtn');
if (audioToggleBtn) {
  audioToggleBtn.addEventListener('click', () => {
    soundEngine.init(currentVehicleDef);
    const isMuted = soundEngine.toggleMute();
    audioToggleBtn.textContent = isMuted ? '🔇' : '🔊';
  });
}

const resetCodeBtn = document.getElementById('resetCodeBtn');
if (resetCodeBtn) {
  resetCodeBtn.addEventListener('click', () => {
    localStorage.removeItem('toycar_pc_room_code');
    window.location.reload();
  });
}

const bottomDock = document.getElementById('bottomDock');
const toggleDockBtn = document.getElementById('toggleDockBtn');
if (toggleDockBtn && bottomDock) {
  toggleDockBtn.addEventListener('click', () => {
    bottomDock.classList.toggle('collapsed');
    toggleDockBtn.textContent = bottomDock.classList.contains('collapsed')
      ? '▴ Show Controls'
      : '▾ Hide Controls';
  });
}

// ==========================================
// 11. MAIN ANIMATION LOOP
// ==========================================
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(0.1, clock.getDelta());

  handleKeyboardInput(dt);
  checkCollisionsAndDrive(dt);
  updateCrumblingAndInfiniteWrapping(dt);
  updateParticles(dt);

  if (speedValue) {
    speedValue.textContent = carState.currentSpeed.toFixed(1) + ' m/s';
  }

  renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
