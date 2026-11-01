/* Toddler Toy Car 3D - High-Performance Procedural World with God Mode, 3D Physics & AI Car Importer */

import { SoundEngine } from './audio.js';
import { VEHICLES, getVehicleById } from './vehicles/index.js';

// ==========================================
// 1. CONFIGURATION & PERSISTENT ROOM PAIRING
// ==========================================
const ROAD_INTERVAL = 100;     // Roads every 100 units in world space
const WORLD_SPAN = 400;        // Active obstacle envelope (-200 to +200 relative to car)
const HALF_SPAN = WORLD_SPAN / 2;
const GRID_CELL_SIZE = 12;     // Spatial hash cell size
const GRID_DIM = Math.ceil(WORLD_SPAN / GRID_CELL_SIZE); // ~34x34 spatial cells

// Persistent Room Code
let persistentRoomCode = localStorage.getItem('toycar_pc_room_code');
if (!persistentRoomCode || persistentRoomCode.length < 4) {
  persistentRoomCode = Math.random().toString(36).substring(2, 6).toUpperCase();
  localStorage.setItem('toycar_pc_room_code', persistentRoomCode);
}
const fullPeerId = 'toycar-' + persistentRoomCode;

// Active Vehicle State
const savedVehicleId = localStorage.getItem('toycar_active_vehicle') || 'car';
let currentVehicleDef = getVehicleById(savedVehicleId);

// Steering Invert Toggle on PC
let invertSteeringPC = localStorage.getItem('toycar_pc_invert') === '1';

// God Mode / Physical Lift & Throw Settings
let godModeEnabled = localStorage.getItem('toycar_god_mode') !== '0';
let liftForceEnabled = localStorage.getItem('toycar_lift_force') !== '0';
let tossForceEnabled = localStorage.getItem('toycar_toss_force') !== '0';

// Sound Engine
const soundEngine = new SoundEngine();

// ==========================================
// 2. PROCEDURAL ENVIRONMENT POPULATION (SoA)
// ==========================================
const COUNT_TREES = 1400;
const COUNT_HOUSES = 300;
const COUNT_BARNS = 120;
const COUNT_HAYBALES = 400;
const COUNT_TOYBLOCKS = 400;
const COUNT_STREETLAMPS = 240;

const TOTAL_OBSTACLES = COUNT_TREES + COUNT_HOUSES + COUNT_BARNS + COUNT_HAYBALES + COUNT_TOYBLOCKS + COUNT_STREETLAMPS;

const obstacleSoA = {
  positions: new Float32Array(TOTAL_OBSTACLES * 2),
  radii: new Float32Array(TOTAL_OBSTACLES),
  states: new Uint8Array(TOTAL_OBSTACLES),          // 0: Active, 1: Crumbling, 2: Smashed
  types: new Uint8Array(TOTAL_OBSTACLES),           // 0: Tree, 1: House, 2: Barn, 3: Hay, 4: Block, 5: Lamp
  instanceIndices: new Uint32Array(TOTAL_OBSTACLES),
  crumbleProgress: new Float32Array(TOTAL_OBSTACLES),
  tipDirs: new Float32Array(TOTAL_OBSTACLES * 2),
  initialMatrices: new Float32Array(TOTAL_OBSTACLES * 16),
  baseScales: new Float32Array(TOTAL_OBSTACLES),
};

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
// 3. THREE.JS SCENE & REAL FIXED ROAD NETWORK
// ==========================================
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa5d8ff);
scene.fog = new THREE.Fog(0xa5d8ff, 80, 280);

const camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.5, 550);
camera.position.set(0, 15, -24);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
container.appendChild(renderer.domElement);

// Lighting
const hemiLight = new THREE.HemisphereLight(0xfffdf5, 0x38bdf8, 0.75);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfffaed, 1.25);
sunLight.position.set(60, 110, 70);
sunLight.castShadow = true;
sunLight.shadow.mapSize.width = 2048;
sunLight.shadow.mapSize.height = 2048;
sunLight.shadow.camera.near = 10;
sunLight.shadow.camera.far = 300;
sunLight.shadow.camera.left = -65;
sunLight.shadow.camera.right = 65;
sunLight.shadow.camera.top = 65;
sunLight.shadow.camera.bottom = -65;
sunLight.shadow.bias = -0.0005;
scene.add(sunLight);
scene.add(sunLight.target);

// High-Fidelity Fixed Ground & Road Texture
function createStationaryRoadTexture() {
  const size = 1024;
  const cvs = document.createElement('canvas');
  cvs.width = size;
  cvs.height = size;
  const ctx = cvs.getContext('2d');

  // Grass meadow background
  ctx.fillStyle = '#86efac';
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = '#6ee7b7';
  const tileSize = 64;
  for (let x = 0; x < size; x += tileSize) {
    for (let y = 0; y < size; y += tileSize) {
      if ((x / tileSize + y / tileSize) % 2 === 0) {
        ctx.fillRect(x, y, tileSize, tileSize);
      }
    }
  }

  // Cute flower patches in meadow
  const flowerColors = ['#fef08a', '#f472b6', '#ffffff', '#fed7aa'];
  for (let i = 0; i < 80; i++) {
    const fx = Math.random() * size;
    const fy = Math.random() * size;
    if (Math.abs(fx - size / 2) > 95 && Math.abs(fy - size / 2) > 95) {
      ctx.fillStyle = flowerColors[i % flowerColors.length];
      ctx.beginPath();
      ctx.arc(fx, fy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Asphalt Crossroads (Corresponds to 100 units world interval)
  const roadPx = 144;
  const center = size / 2;

  // Concrete Sidewalk Curbs
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(center - roadPx / 2 - 10, 0, roadPx + 20, size);
  ctx.fillRect(0, center - roadPx / 2 - 10, size, roadPx + 20);

  // Dark Smooth Asphalt
  ctx.fillStyle = '#334155';
  ctx.fillRect(center - roadPx / 2, 0, roadPx, size);
  ctx.fillRect(0, center - roadPx / 2, size, roadPx);

  // Solid White Edge Lines
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(center - roadPx / 2 + 6, 0, 4, size);
  ctx.fillRect(center + roadPx / 2 - 10, 0, 4, size);
  ctx.fillRect(0, center - roadPx / 2 + 6, size, 4);
  ctx.fillRect(0, center + roadPx / 2 - 10, size, 4);

  // Bright Yellow Dashed Centerlines
  ctx.fillStyle = '#facc15';
  for (let y = 0; y < size; y += 42) {
    if (Math.abs(y - center) > roadPx / 2 + 12) {
      ctx.fillRect(center - 3, y + 8, 6, 26);
    }
  }
  for (let x = 0; x < size; x += 42) {
    if (Math.abs(x - center) > roadPx / 2 + 12) {
      ctx.fillRect(x + 8, center - 3, 26, 6);
    }
  }

  // Zebra Pedestrian Crosswalks
  ctx.fillStyle = '#ffffff';
  for (let k = -50; k <= 50; k += 20) {
    ctx.fillRect(center + k - 5, center - roadPx / 2 - 26, 12, 22);
    ctx.fillRect(center + k - 5, center + roadPx / 2 + 4, 12, 22);
    ctx.fillRect(center - roadPx / 2 - 26, center + k - 5, 22, 12);
    ctx.fillRect(center + roadPx / 2 + 4, center + k - 5, 22, 12);
  }

  const texture = new THREE.CanvasTexture(cvs);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.encoding = THREE.sRGBEncoding;
  return texture;
}

const GROUND_SIZE = 3000;
const groundTexture = createStationaryRoadTexture();
groundTexture.repeat.set(GROUND_SIZE / ROAD_INTERVAL, GROUND_SIZE / ROAD_INTERVAL);

const groundGeo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
const groundMat = new THREE.MeshStandardMaterial({
  map: groundTexture,
  roughness: 0.85,
  metalness: 0.1,
});
const groundMesh = new THREE.Mesh(groundGeo, groundMat);
groundMesh.rotation.x = -Math.PI / 2;
groundMesh.receiveShadow = true;
scene.add(groundMesh);

// Function to keep ground aligned seamlessly in discrete 100-unit steps
function updateGroundPosition(carX, carZ) {
  const snapX = Math.round(carX / ROAD_INTERVAL) * ROAD_INTERVAL;
  const snapZ = Math.round(carZ / ROAD_INTERVAL) * ROAD_INTERVAL;
  if (Math.abs(groundMesh.position.x - snapX) >= ROAD_INTERVAL || Math.abs(groundMesh.position.z - snapZ) >= ROAD_INTERVAL) {
    groundMesh.position.set(snapX, 0, snapZ);
  }
}

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
// 4. ENVIRONMENT GEOMETRIES
// ==========================================
function createTreeGeometry() {
  const trunk = new THREE.CylinderGeometry(0.35, 0.55, 3.2, 7);
  trunk.translate(0, 1.6, 0);

  const foliage1 = new THREE.ConeGeometry(2.3, 3.2, 7);
  foliage1.translate(0, 3.6, 0);

  const foliage2 = new THREE.ConeGeometry(1.7, 2.6, 7);
  foliage2.translate(0, 5.0, 0);

  const foliage3 = new THREE.ConeGeometry(1.1, 2.0, 7);
  foliage3.translate(0, 6.1, 0);

  const apple1 = new THREE.SphereGeometry(0.25, 6, 6);
  apple1.translate(0.9, 4.0, 0.7);
  const apple2 = apple1.clone();
  apple2.translate(-1.8, 0.6, -0.4);

  setGeoColor(trunk, 0x854d0e);
  setGeoColor(foliage1, 0x22c55e);
  setGeoColor(foliage2, 0x16a34a);
  setGeoColor(foliage3, 0x15803d);
  setGeoColor(apple1, 0xef4444);
  setGeoColor(apple2, 0xef4444);

  return mergeGeometries([trunk, foliage1, foliage2, foliage3, apple1, apple2]);
}

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

  setGeoColor(base, 0xf8fafc);
  setGeoColor(roof, 0xe11d48);
  setGeoColor(chimney, 0x64748b);
  setGeoColor(door, 0x0284c7);

  return mergeGeometries([base, roof, chimney, door]);
}

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

  const silo = new THREE.CylinderGeometry(1.4, 1.4, 6.0, 12);
  silo.translate(3.8, 3.0, 0);

  const siloDome = new THREE.SphereGeometry(1.4, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  siloDome.translate(3.8, 6.0, 0);

  setGeoColor(barnBody, 0xb91c1c);
  setGeoColor(roofLower, 0x475569);
  setGeoColor(roofPeak, 0x475569);
  setGeoColor(barnDoor, 0xffffff);
  setGeoColor(silo, 0x94a3b8);
  setGeoColor(siloDome, 0x64748b);

  return mergeGeometries([barnBody, roofLower, roofPeak, barnDoor, silo, siloDome]);
}

function createHayBaleGeometry() {
  const bale = new THREE.CylinderGeometry(1.1, 1.1, 2.4, 12);
  bale.rotateZ(Math.PI / 2);
  bale.translate(0, 1.1, 0);
  setGeoColor(bale, 0xfacc15);
  return bale;
}

function createToyBlockGeometry() {
  const cube = new THREE.BoxGeometry(2.2, 2.2, 2.2);
  cube.translate(0, 1.1, 0);

  const accent = new THREE.BoxGeometry(1.4, 0.1, 1.4);
  accent.translate(0, 2.21, 0);

  setGeoColor(cube, 0x06b6d4);
  setGeoColor(accent, 0xfef08a);
  return mergeGeometries([cube, accent]);
}

function createStreetlampGeometry() {
  const pole = new THREE.CylinderGeometry(0.12, 0.16, 4.5, 8);
  pole.translate(0, 2.25, 0);

  const arm = new THREE.BoxGeometry(0.12, 0.12, 1.2);
  arm.translate(0, 4.4, 0.5);

  const lamp = new THREE.BoxGeometry(0.45, 0.55, 0.45);
  lamp.translate(0, 4.2, 1.0);

  setGeoColor(pole, 0x1e293b);
  setGeoColor(arm, 0x1e293b);
  setGeoColor(lamp, 0xfef08a);
  return mergeGeometries([pole, arm, lamp]);
}

const instancedMeshes = {
  trees: new THREE.InstancedMesh(createTreeGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), COUNT_TREES),
  houses: new THREE.InstancedMesh(createHouseGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), COUNT_HOUSES),
  barns: new THREE.InstancedMesh(createBarnGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), COUNT_BARNS),
  haybales: new THREE.InstancedMesh(createHayBaleGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), COUNT_HAYBALES),
  toyblocks: new THREE.InstancedMesh(createToyBlockGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }), COUNT_TOYBLOCKS),
  streetlamps: new THREE.InstancedMesh(createStreetlampGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), COUNT_STREETLAMPS),
};

Object.values(instancedMeshes).forEach((mesh) => {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
});

function isOnRoad(x, z, margin = 4.0) {
  const modX = Math.abs(((x % ROAD_INTERVAL) + ROAD_INTERVAL) % ROAD_INTERVAL);
  const modZ = Math.abs(((z % ROAD_INTERVAL) + ROAD_INTERVAL) % ROAD_INTERVAL);
  const roadHalfWidth = 7.0 + margin;
  return (modX < roadHalfWidth || modX > ROAD_INTERVAL - roadHalfWidth) ||
         (modZ < roadHalfWidth || modZ > ROAD_INTERVAL - roadHalfWidth);
}

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
    } while (attempts < 25 && !canBeOnRoad && isOnRoad(x, z, 3.5));

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
    obstacleSoA.states[idx] = 0;
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

populateObstacleGroup(instancedMeshes.trees, COUNT_TREES, 0, 1.3, false);
populateObstacleGroup(instancedMeshes.houses, COUNT_HOUSES, 1, 2.5, false);
populateObstacleGroup(instancedMeshes.barns, COUNT_BARNS, 2, 3.4, false);
populateObstacleGroup(instancedMeshes.haybales, COUNT_HAYBALES, 3, 1.4, false);
populateObstacleGroup(instancedMeshes.toyblocks, COUNT_TOYBLOCKS, 4, 1.5, true);
populateObstacleGroup(instancedMeshes.streetlamps, COUNT_STREETLAMPS, 5, 0.9, true);

// ==========================================
// 5. VEHICLE MOUNTING & STATE WITH 3D FLIGHT
// ==========================================
let currentVehicleMesh = null;
let currentWheels = [];

const carState = {
  x: 0,
  y: 0,                // 3D Altitude
  z: 0,
  vy: 0,               // Vertical velocity
  bonusSpeed: 0,       // Push boost
  pitch: 0,            // Dynamic 3D tilt
  roll: 0,
  targetPitch: 0,      // Physical pitch from phone
  targetRoll: 0,       // Physical roll from phone
  isAirborne: false,
  angle: 0,            // Steering yaw
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

  const vehicleNameBadge = document.getElementById('vehicleNameBadge');
  if (vehicleNameBadge) {
    vehicleNameBadge.textContent = `${vehicleDef.icon} ${vehicleDef.name}`;
  }
}

mountVehicle(currentVehicleDef);

// ==========================================
// 6. POPPING PUFF PARTICLES
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

    let dx = ox - carState.x;
    let dz = oz - carState.z;
    let shifted = false;

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
      obstacleSoA.states[i] = 0;
      obstacleSoA.crumbleProgress[i] = 0;

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

    if (obstacleSoA.states[i] === 0) {
      insertIntoGrid(i, dx, dz);
    }

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
        obstacleSoA.states[i] = 2;
      }
    }
  }

  meshUpdates.forEach(m => {
    m.instanceMatrix.needsUpdate = true;
  });
}

function lerpAngle(from, to, t) {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return from + diff * t;
}

// ==========================================
// 8. 3D PHYSICS WITH REAL FLIP & ON-LAND DRIVE
// ==========================================
function checkCollisionsAndDrive(dt) {
  // 1. Steering Yaw interpolation
  carState.angle = lerpAngle(carState.angle, carState.targetAngle, Math.min(1.0, dt * 5.5));

  // 2. 3D Pitch & Roll from Phone
  // When phone is tilted or flipped upside down, the 3D car reflects that in real-time!
  carState.pitch += (carState.targetPitch - carState.pitch) * Math.min(1.0, dt * 7.0);
  carState.roll += (carState.targetRoll - carState.roll) * Math.min(1.0, dt * 7.0);

  // Determine if wheels are on land:
  // Upright when cos(pitch) * cos(roll) > 0.4
  const isUpright = Math.cos(carState.pitch) * Math.cos(carState.roll);
  const wheelsOnLand = (carState.y <= 0.08) && (isUpright > 0.35);

  // 3. 3D Flight & Jump Dynamics
  if (carState.isAirborne || carState.y > 0) {
    carState.vy -= 28.0 * dt;
    carState.y += carState.vy * dt;

    // Land on ground
    if (carState.y <= 0) {
      carState.y = 0;
      carState.vy = 0;
      if (carState.isAirborne) {
        carState.isAirborne = false;
        soundEngine.playLandingThud();
        spawnParticles(carState.x, 0.2, carState.z, 24);
      }
    }
  }

  // Bonus speed decay (from push/toss)
  if (carState.bonusSpeed > 0) {
    carState.bonusSpeed = Math.max(0, carState.bonusSpeed - dt * 10.0);
  }

  // 4. Movement: "obviously goes forward when is with wheels on land"
  // When wheels are on land, cruise forward at currentSpeed + bonusSpeed.
  // When flipped upside down in accident, wheels don't push the ground!
  let forwardDriveSpeed = 0;
  if (wheelsOnLand) {
    forwardDriveSpeed = carState.currentSpeed + carState.bonusSpeed;
  } else {
    // In air or upside down, car only carries residual coasting momentum
    forwardDriveSpeed = carState.bonusSpeed * 0.7;
  }

  const forwardX = Math.sin(carState.angle);
  const forwardZ = Math.cos(carState.angle);

  carState.x += forwardX * forwardDriveSpeed * dt;
  carState.z += forwardZ * forwardDriveSpeed * dt;

  // Discrete ground snap
  updateGroundPosition(carState.x, carState.z);

  // 5. Collision Detection (Only collides when vehicle is near ground: y < 3.0 and moving)
  let isCollidingThisFrame = false;
  if (carState.y < 3.0 && forwardDriveSpeed > 1.0) {
    const centerCellX = Math.floor(HALF_SPAN / GRID_CELL_SIZE);
    const centerCellZ = Math.floor(HALF_SPAN / GRID_CELL_SIZE);
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
                obstacleSoA.states[obsIdx] = 1;
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
  }

  // Smooth speed dynamics on ground
  const targetSpeed = isCollidingThisFrame ? currentVehicleDef.minSlowdownSpeed : currentVehicleDef.baseSpeed;
  const accelRate = isCollidingThisFrame ? 18.0 : 6.0;
  carState.currentSpeed += (targetSpeed - carState.currentSpeed) * Math.min(1.0, dt * accelRate);

  soundEngine.updateEnginePitch(wheelsOnLand ? (forwardDriveSpeed / currentVehicleDef.baseSpeed) : 0.2);

  // 6. Update Vehicle 3D Transform
  if (currentVehicleMesh) {
    currentVehicleMesh.position.set(carState.x, carState.y, carState.z);
    currentVehicleMesh.rotation.set(carState.pitch, carState.angle, carState.roll, 'YXZ');

    const rollSpeed = (forwardDriveSpeed / 0.6) * dt;
    for (let w = 0; w < currentWheels.length; w++) {
      currentWheels[w].children[0].rotation.x += rollSpeed;
    }
  }

  // 7. Third-Person Chase Camera
  const camDist = currentVehicleDef.id === 'bus' ? 19.0 : 16.0;
  const camHeight = (currentVehicleDef.id === 'bus' ? 9.5 : 8.5) + carState.y * 0.45;

  const desiredCamX = carState.x - Math.sin(carState.angle) * camDist;
  const desiredCamZ = carState.z - Math.cos(carState.angle) * camDist;
  const desiredCamY = camHeight;

  camera.position.x += (desiredCamX - camera.position.x) * Math.min(1.0, dt * 5.0);
  camera.position.y += (desiredCamY - camera.position.y) * Math.min(1.0, dt * 5.0);
  camera.position.z += (desiredCamZ - camera.position.z) * Math.min(1.0, dt * 5.0);

  camera.lookAt(carState.x, 1.6 + carState.y * 0.8, carState.z);

  sunLight.position.set(carState.x + 60, 110 + carState.y, carState.z + 70);
  sunLight.target.position.set(carState.x, carState.y, carState.z);
}

// Jump / Lift trigger (ONLY when on land!)
export function triggerJump(liftForce = 16.0) {
  if (!godModeEnabled || !liftForceEnabled) return;

  // "the jump should be only once is on land"
  if (carState.y > 0.08 || carState.isAirborne) {
    return; // Already in air! No double jumping.
  }

  carState.vy = Math.min(32.0, 14.0 + liftForce * 0.8);
  carState.isAirborne = true;
  soundEngine.playFlightSwoosh();
  spawnParticles(carState.x, 0.4, carState.z, 20);
}

// Push Boost trigger (Forward force)
export function triggerPushBoost(pushForce = 15.0) {
  if (!godModeEnabled || !tossForceEnabled) return;
  carState.bonusSpeed = Math.min(24.0, carState.bonusSpeed + pushForce * 1.1);
  soundEngine.playFlightSwoosh();
}

// ==========================================
// 9. DYNAMIC VEHICLE IMPORTER & CODE LOADER
// ==========================================
export const SAMPLE_EXCAVATOR_CODE = `/* Procedural Construction Excavator Vehicle */
export default {
  id: 'excavator',
  name: 'Yellow Excavator',
  icon: '🏗️',
  baseSpeed: 8.5,            // Slower, powerful construction vehicle (reference: normal car = 11.0)
  minSlowdownSpeed: 4.0,     // Stronger push-through capability
  soundPitch: 40,            // Heavy diesel engine thrum
  hornFrequencies: [220.0, 293.66], // Deep industrial horn
  engineType: 'triangle',

  createMesh(THREE, mergeGeometries) {
    const group = new THREE.Group();

    // 1. Lower Track Chassis (Black Caterpillar treads)
    const trackL = new THREE.BoxGeometry(0.7, 0.7, 4.4);
    trackL.translate(-1.1, 0.45, 0);

    const trackR = new THREE.BoxGeometry(0.7, 0.7, 4.4);
    trackR.translate(1.1, 0.45, 0);

    const trackCenter = new THREE.BoxGeometry(1.6, 0.4, 3.2);
    trackCenter.translate(0, 0.5, 0);

    // 2. Rotating Body Cabin (High-Vis Construction Yellow)
    const cabin = new THREE.BoxGeometry(2.3, 1.8, 3.2);
    cabin.translate(0, 1.7, -0.2);

    // 3. Operator Glass Cockpit
    const glass = new THREE.BoxGeometry(1.0, 1.4, 1.4);
    glass.translate(-0.55, 1.9, 0.6);

    // 4. Counterweight on Back
    const counterweight = new THREE.BoxGeometry(2.3, 1.6, 0.8);
    counterweight.translate(0, 1.6, -1.9);

    // 5. Heavy Boom Arm
    const boomBase = new THREE.BoxGeometry(0.4, 0.5, 2.6);
    boomBase.rotateX(-0.5);
    boomBase.translate(0.5, 2.4, 1.6);

    const boomStick = new THREE.BoxGeometry(0.35, 0.4, 2.4);
    boomStick.rotateX(0.7);
    boomStick.translate(0.5, 2.7, 3.2);

    // 6. Excavator Digging Bucket (Metal Scoop)
    const bucket = new THREE.BoxGeometry(1.4, 0.8, 1.0);
    bucket.rotateX(0.2);
    bucket.translate(0.5, 1.2, 4.1);

    // 7. Roof Flashing Amber Beacon
    const beacon = new THREE.CylinderGeometry(0.18, 0.22, 0.35, 10);
    beacon.translate(-0.55, 2.8, 0.6);

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

    setGeoColor(trackL, 0x1e293b);          // Dark Rubber Treads
    setGeoColor(trackR, 0x1e293b);
    setGeoColor(trackCenter, 0x334155);
    setGeoColor(cabin, 0xfacc15);           // High-Vis Caterpillar Yellow
    setGeoColor(glass, 0x38bdf8);           // Tinted Cockpit Glass
    setGeoColor(counterweight, 0x0f172a);   // Dark Steel Counterweight
    setGeoColor(boomBase, 0xfacc15);        // Yellow Boom
    setGeoColor(boomStick, 0xfacc15);
    setGeoColor(bucket, 0x475569);          // Tough Steel Bucket
    setGeoColor(beacon, 0xf97316);          // Safety Amber Light

    const mergedBody = mergeGeometries([
      trackL, trackR, trackCenter, cabin, glass,
      counterweight, boomBase, boomStick, bucket, beacon
    ]);

    const bodyMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.4,
      metalness: 0.2,
    });
    const bodyMesh = new THREE.Mesh(mergedBody, bodyMat);
    bodyMesh.castShadow = true;
    group.add(bodyMesh);

    // 6 Track Rollers (3 per side)
    const wheels = [];
    const wheelPositions = [
      [-1.1, 0.4, 1.4],
      [-1.1, 0.4, 0.0],
      [-1.1, 0.4, -1.4],
      [1.1, 0.4, 1.4],
      [1.1, 0.4, 0.0],
      [1.1, 0.4, -1.4],
    ];

    const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.4, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 });

    wheelPositions.forEach((pos) => {
      const wGroup = new THREE.Group();
      const wMesh = new THREE.Mesh(wheelGeo, wheelMat);
      wMesh.castShadow = true;
      wGroup.add(wMesh);
      wGroup.position.set(...pos);
      group.add(wGroup);
      wheels.push(wGroup);
    });

    // Contact shadow
    const shadowGeo = new THREE.PlaneGeometry(3.4, 5.8);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x052e16,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    group.add(shadow);

    return { group, wheels };
  }
};`;

export function sanitizeAndExtractVehicleCode(raw) {
  let code = (raw || '').trim();

  // 1. If wrapped in markdown code fence, extract code block
  const markdownMatch = code.match(/```(?:javascript|js)?\s*([\s\S]*?)```/);
  if (markdownMatch && markdownMatch[1]) {
    code = markdownMatch[1].trim();
  }

  // 2. Strip any ES import statements so dynamic import doesn't fail on missing modules
  code = code.replace(/import\s+[^;]+;?/g, '// [stripped import]');

  // 3. Handle CommonJS module.exports = ...
  if (/module\.exports\s*=/.test(code)) {
    code = code.replace(/module\.exports\s*=/, 'export default ');
  }

  // 4. If code assigns to a variable but forgot export default
  if (!code.includes('export default') && !code.includes('export const Vehicle') && !code.includes('export const ExcavatorVehicle')) {
    const varMatch = code.match(/(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*\{/);
    if (varMatch && varMatch[1]) {
      code += `\nexport default ${varMatch[1]};`;
    } else if (code.trim().startsWith('{') && code.trim().endsWith('}')) {
      code = 'export default ' + code;
    }
  }

  return code;
}

export async function loadCustomVehicleScript(codeString, fileName = 'custom_car.js') {
  try {
    const cleanCode = sanitizeAndExtractVehicleCode(codeString);
    const blob = new Blob([cleanCode], { type: 'application/javascript' });
    const blobUrl = URL.createObjectURL(blob);
    const module = await import(/* @vite-ignore */ blobUrl);
    URL.revokeObjectURL(blobUrl);

    const customDef = module.default || module.Vehicle || module.ExcavatorVehicle || Object.values(module)[0];

    if (!customDef || typeof customDef.createMesh !== 'function') {
      alert('Custom vehicle file must export an object with createMesh(THREE, mergeGeometries).');
      return;
    }

    if (!customDef.id) customDef.id = 'custom_' + Date.now();
    if (!customDef.name) customDef.name = fileName.replace('.js', '');
    if (!customDef.icon) customDef.icon = '⭐';
    if (!customDef.baseSpeed) customDef.baseSpeed = 11.0;
    if (!customDef.minSlowdownSpeed) customDef.minSlowdownSpeed = 4.0;

    const existingIdx = VEHICLES.findIndex(v => v.id === customDef.id);
    if (existingIdx >= 0) {
      VEHICLES[existingIdx] = customDef;
    } else {
      VEHICLES.push(customDef);
    }

    localStorage.setItem('toycar_custom_js', cleanCode);
    localStorage.setItem('toycar_custom_name', customDef.name);

    rebuildVehicleMenu();
    mountVehicle(customDef);

    const hornBubble = document.getElementById('hornBubble');
    if (hornBubble) {
      hornBubble.textContent = `🚀 Loaded ${customDef.name}!`;
      hornBubble.classList.add('active');
      setTimeout(() => hornBubble.classList.remove('active'), 1200);
    }
  } catch (err) {
    console.error('Failed to load custom vehicle:', err);
    alert('Error loading vehicle script: ' + err.message);
  }
}

// Check saved custom vehicle on startup
const savedCustomCode = localStorage.getItem('toycar_custom_js');
if (savedCustomCode) {
  loadCustomVehicleScript(savedCustomCode, localStorage.getItem('toycar_custom_name') || 'custom_car.js');
}

// Drag & Drop
const dropOverlay = document.getElementById('dropOverlay');

window.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (dropOverlay) dropOverlay.classList.add('active');
});

window.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null && dropOverlay) {
    dropOverlay.classList.remove('active');
  }
});

window.addEventListener('drop', (e) => {
  e.preventDefault();
  if (dropOverlay) dropOverlay.classList.remove('active');

  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    const file = files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      loadCustomVehicleScript(event.target.result, file.name);
    };
    reader.readAsText(file);
  }
});

// File input picker trigger
const addVehicleFileInput = document.getElementById('addVehicleFileInput');
if (addVehicleFileInput) {
  addVehicleFileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        loadCustomVehicleScript(event.target.result, file.name);
      };
      reader.readAsText(file);
    }
  });
}

// Download Sample Excavator Script (Embedded, 100% offline & reliable)
const downloadSampleExcavatorBtn = document.getElementById('downloadSampleExcavatorBtn');
if (downloadSampleExcavatorBtn) {
  downloadSampleExcavatorBtn.addEventListener('click', () => {
    const blob = new Blob([SAMPLE_EXCAVATOR_CODE], { type: 'application/javascript' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sample_excavator.js';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
}

// Test-Drive Excavator Directly in Game
const testDriveExcavatorBtn = document.getElementById('testDriveExcavatorBtn');
if (testDriveExcavatorBtn) {
  testDriveExcavatorBtn.addEventListener('click', () => {
    loadCustomVehicleScript(SAMPLE_EXCAVATOR_CODE, 'sample_excavator.js');
    if (aiPromptModal) aiPromptModal.style.display = 'none';
  });
}

// ==========================================
// 10. AI VEHICLE GENERATOR PROMPT MODAL
// ==========================================
const aiPromptModal = document.getElementById('aiPromptModal');
const openAiPromptBtn = document.getElementById('openAiPromptBtn');
const closeAiPromptBtn = document.getElementById('closeAiPromptBtn');
const copyAiPromptBtn = document.getElementById('copyAiPromptBtn');
const aiPromptTextArea = document.getElementById('aiPromptTextArea');
const pasteCodeInput = document.getElementById('pasteCodeInput');
const mountPastedCodeBtn = document.getElementById('mountPastedCodeBtn');

// Master AI Vehicle Prompt text
export const MASTER_AI_PROMPT = `Generate a single, completely self-contained JavaScript ES module file (.js) for a 3D browser game vehicle.

VEHICLE DESCRIPTION / REFERENCE:
[USER INSTRUCTION: Describe your vehicle here, e.g. "Yellow Caterpillar Excavator with digging bucket", "Red Monster Truck with giant spiky wheels", "Police Cruiser with sirens", OR attach an image and say "Create this exact vehicle from the image"]

SPEED BENCHMARK & CALIBRATION:
The game's standard baseline is the Normal Toy Sports Car with baseSpeed = 11.0 m/s.
Calibrate your vehicle's speed realistically using this 11.0 m/s benchmark:
- Construction Excavator / Bulldozer / Steamroller: baseSpeed = 8.0 - 8.5 m/s
- Farm Tractor / Slow Work Truck: baseSpeed = 9.0 m/s
- Yellow School Bus: baseSpeed = 9.5 m/s
- Heavy Dump Truck / Semi: baseSpeed = 10.0 m/s
- Normal Toy Sports Car (REFERENCE BASELINE): baseSpeed = 11.0 m/s
- Police Cruiser / Muscle Car: baseSpeed = 12.5 m/s
- Formula 1 / Rocket Hypercar: baseSpeed = 15.0 - 16.0 m/s
Choose the \`baseSpeed\` and \`minSlowdownSpeed\` (3.0 - 4.5) relative to the 11.0 baseline.

TECHNICAL RULES:
1. Do NOT write \`import * as THREE from 'three'\`. The game engine passes THREE and mergeGeometries into createMesh(THREE, mergeGeometries).
2. Assemble composite 3D procedural geometries using Three.js primitives (BoxGeometry, CylinderGeometry, ConeGeometry, SphereGeometry).
3. Set vertex colors on each component using \`setGeoColor(geometry, hexColor)\` helper.
4. Merge all static body parts into ONE single draw-call mesh via \`mergeGeometries([...])\`.
5. The vehicle points forward along the +Z axis.
6. Return { group, wheels } where wheels is an array of wheel groups so they spin automatically.

OUTPUT FORMAT:
Output ONLY the raw JavaScript code inside a single \`\`\`javascript code block:
\`\`\`javascript
export default {
  id: 'custom_vehicle_id',
  name: 'Vehicle Name',
  icon: '🚜',
  baseSpeed: 10.0, // Choose relative to normal car reference (11.0 m/s)
  minSlowdownSpeed: 3.5,
  soundPitch: 50, // 40 = heavy diesel rumble, 65 = sports car hum, 75 = high rev
  hornFrequencies: [349.23, 440.0],
  engineType: 'sawtooth', // 'sawtooth', 'triangle', or 'sine'
  createMesh(THREE, mergeGeometries) {
    const group = new THREE.Group();

    // 1. Procedural Parts...
    const chassis = new THREE.BoxGeometry(2.2, 0.8, 4.0);
    chassis.translate(0, 0.7, 0);

    const cabin = new THREE.BoxGeometry(1.8, 1.0, 2.0);
    cabin.translate(0, 1.6, -0.2);

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

    setGeoColor(chassis, 0xfacc15);
    setGeoColor(cabin, 0x38bdf8);

    const merged = mergeGeometries([chassis, cabin]);
    const bodyMesh = new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }));
    bodyMesh.castShadow = true;
    group.add(bodyMesh);

    // Wheels...
    const wheels = [];
    const wheelPositions = [[-1.1, 0.5, 1.2], [1.1, 0.5, 1.2], [-1.1, 0.5, -1.2], [1.1, 0.5, -1.2]];
    const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.35, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });

    wheelPositions.forEach((pos) => {
      const wGroup = new THREE.Group();
      const wMesh = new THREE.Mesh(wheelGeo, wheelMat);
      wMesh.castShadow = true;
      wGroup.add(wMesh);
      wGroup.position.set(...pos);
      group.add(wGroup);
      wheels.push(wGroup);
    });

    // Shadow
    const shadowGeo = new THREE.CircleGeometry(2.2, 16);
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x052e16, transparent: true, opacity: 0.4, depthWrite: false });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    group.add(shadow);

    return { group, wheels };
  }
};
\`\`\``;

if (aiPromptTextArea) {
  aiPromptTextArea.value = MASTER_AI_PROMPT;
}

if (openAiPromptBtn && aiPromptModal) {
  openAiPromptBtn.addEventListener('click', () => {
    aiPromptModal.style.display = 'flex';
  });
}

if (closeAiPromptBtn && aiPromptModal) {
  closeAiPromptBtn.addEventListener('click', () => {
    aiPromptModal.style.display = 'none';
  });
}

if (copyAiPromptBtn) {
  copyAiPromptBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(MASTER_AI_PROMPT).then(() => {
      copyAiPromptBtn.textContent = '✓ Copied to Clipboard!';
      copyAiPromptBtn.style.background = '#10b981';
      setTimeout(() => {
        copyAiPromptBtn.textContent = '📋 Copy Master AI Prompt';
        copyAiPromptBtn.style.background = '#0284c7';
      }, 2000);
    });
  });
}

// Mount Pasted Code Button
if (mountPastedCodeBtn && pasteCodeInput) {
  mountPastedCodeBtn.addEventListener('click', () => {
    let code = pasteCodeInput.value.trim();
    if (!code) {
      alert('Please paste some vehicle JavaScript code first.');
      return;
    }
    loadCustomVehicleScript(code, 'ai_vehicle.js');
    if (aiPromptModal) aiPromptModal.style.display = 'none';
  });
}

// ==========================================
// 11. PEERJS WEBRTC PAIRING & INPUT HANDLING
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
      if (inputModeValue) inputModeValue.textContent = 'Phone Gyro 3D';
    });

    conn.on('data', (data) => {
      if (!data) return;
      if (data.type === 'steer') {
        if (typeof data.angle === 'number') {
          let yaw = data.angle;
          if (invertSteeringPC) yaw = -yaw;
          carState.targetAngle = yaw;

          const deg = Math.round((yaw * 180) / Math.PI);
          if (headingValue) headingValue.textContent = deg + '°';
        }
        if (typeof data.pitch === 'number') {
          carState.targetPitch = data.pitch;
        }
        if (typeof data.roll === 'number') {
          carState.targetRoll = data.roll;
        }
      } else if (data.type === 'horn') {
        soundEngine.playHorn();
        if (hornBubble) {
          hornBubble.textContent = '🎺 BEEP BEEP!';
          hornBubble.classList.add('active');
          setTimeout(() => hornBubble.classList.remove('active'), 800);
        }
      } else if (data.type === 'god_motion') {
        // Forward push force from toddler shove
        if (data.push && data.push > 0) {
          triggerPushBoost(data.push);
        }
        // Vertical lift (only once on land!)
        if (data.lift && data.lift > 0) {
          triggerJump(data.lift);
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
    invertTogglePCBtn.textContent = '🔄 Invert: ON';
  } else {
    invertTogglePCBtn.classList.remove('active');
    invertTogglePCBtn.textContent = '🔄 Invert: OFF';
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

// God Mode Controls in PC HUD
const godModePCBtn = document.getElementById('godModePCBtn');
const tossJumpPCBtn = document.getElementById('tossJumpPCBtn');
const pushBoostPCBtn = document.getElementById('pushBoostPCBtn');

function updateGodModePCUI() {
  if (godModePCBtn) {
    godModePCBtn.classList.toggle('active', godModeEnabled);
    godModePCBtn.textContent = `🚀 Toss/Boost: ${godModeEnabled ? 'ON' : 'OFF'}`;
  }
}
updateGodModePCUI();

if (godModePCBtn) {
  godModePCBtn.addEventListener('click', () => {
    godModeEnabled = !godModeEnabled;
    localStorage.setItem('toycar_god_mode', godModeEnabled ? '1' : '0');
    updateGodModePCUI();
  });
}

if (tossJumpPCBtn) {
  tossJumpPCBtn.addEventListener('click', () => {
    soundEngine.init(currentVehicleDef);
    triggerJump(18.0);
  });
}

if (pushBoostPCBtn) {
  pushBoostPCBtn.addEventListener('click', () => {
    soundEngine.init(currentVehicleDef);
    triggerPushBoost(18.0);
  });
}

// Keyboard Controls (Desktop Mode / Testing Fallback)
const keysDown = {};
window.addEventListener('keydown', (e) => {
  soundEngine.init(currentVehicleDef);
  keysDown[e.key.toLowerCase()] = true;

  // Spacebar = Jump (only once on land!)
  if (e.key === ' ') {
    triggerJump(18.0);
  }
  // Up arrow or W = Push Boost
  if (e.key === 'arrowup' || e.key.toLowerCase() === 'w') {
    triggerPushBoost(12.0);
  }
  if (e.key.toLowerCase() === 'h') {
    soundEngine.playHorn();
    if (hornBubble) {
      hornBubble.textContent = '🎺 BEEP BEEP!';
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
// 12. UI & VEHICLE SELECTOR MENU
// ==========================================
function rebuildVehicleMenu() {
  const vehicleMenuContainer = document.getElementById('vehicleMenu');
  if (!vehicleMenuContainer) return;
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

rebuildVehicleMenu();

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
// 13. MAIN ANIMATION LOOP
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
    const isUpright = Math.cos(carState.pitch) * Math.cos(carState.roll);
    const wheelsOnLand = (carState.y <= 0.08) && (isUpright > 0.35);
    const displaySpd = wheelsOnLand ? (carState.currentSpeed + carState.bonusSpeed) : carState.bonusSpeed * 0.7;
    speedValue.textContent = displaySpd.toFixed(1) + ' m/s';
  }

  renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
