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
const COUNT_TREES = 1100;
const COUNT_HOUSES = 240;
const COUNT_BARNS = 90;
const COUNT_HAYBALES = 300;
const COUNT_TOYBLOCKS = 350;
const COUNT_STREETLAMPS = 180;
const COUNT_RAMPS = 80;
const COUNT_STARS = 120;
const COUNT_ARCHES = 35;

const TOTAL_OBSTACLES = COUNT_TREES + COUNT_HOUSES + COUNT_BARNS + COUNT_HAYBALES + COUNT_TOYBLOCKS + COUNT_STREETLAMPS + COUNT_RAMPS + COUNT_STARS + COUNT_ARCHES;

const obstacleSoA = {
  positions: new Float32Array(TOTAL_OBSTACLES * 2),
  radii: new Float32Array(TOTAL_OBSTACLES),
  states: new Uint8Array(TOTAL_OBSTACLES),          // 0: Active, 1: Crumbling, 2: Smashed
  types: new Uint8Array(TOTAL_OBSTACLES),           // 0: Tree, 1: House, 2: Barn, 3: Hay, 4: Block, 5: Lamp, 6: Ramp, 7: Star, 8: Arch
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
  const apple2 = new THREE.SphereGeometry(0.25, 6, 6);
  apple2.translate(-0.9, 4.6, 0.3);

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

function createRampGeometry() {
  const ramp = new THREE.BoxGeometry(4.4, 0.4, 6.0);
  ramp.rotateX(0.24);
  ramp.translate(0, 0.8, 0);

  const stripe1 = new THREE.BoxGeometry(4.4, 0.45, 1.0);
  stripe1.rotateX(0.24);
  stripe1.translate(0, 0.8, -1.8);

  const stripe2 = new THREE.BoxGeometry(4.4, 0.45, 1.0);
  stripe2.rotateX(0.24);
  stripe2.translate(0, 0.8, 1.2);

  setGeoColor(ramp, 0xfacc15);
  setGeoColor(stripe1, 0x0f172a);
  setGeoColor(stripe2, 0x0f172a);

  return mergeGeometries([ramp, stripe1, stripe2]);
}

function createStarGeometry() {
  const topCone = new THREE.ConeGeometry(1.2, 1.8, 5);
  topCone.translate(0, 0.9, 0);
  const bottomCone = new THREE.ConeGeometry(1.2, 1.8, 5);
  bottomCone.rotateX(Math.PI);
  bottomCone.translate(0, -0.9, 0);

  setGeoColor(topCone, 0xfacc15);
  setGeoColor(bottomCone, 0xf59e0b);

  const star = mergeGeometries([topCone, bottomCone]);
  star.translate(0, 2.2, 0);
  return star;
}

function createArchGeometry() {
  const pillarL = new THREE.CylinderGeometry(0.5, 0.6, 7.0, 10);
  pillarL.translate(-7.0, 3.5, 0);

  const pillarR = new THREE.CylinderGeometry(0.5, 0.6, 7.0, 10);
  pillarR.translate(7.0, 3.5, 0);

  const beam = new THREE.BoxGeometry(15.2, 1.4, 1.4);
  beam.translate(0, 6.6, 0);

  const banner = new THREE.BoxGeometry(12.0, 1.2, 0.3);
  banner.translate(0, 5.4, 0);

  const starTop = new THREE.SphereGeometry(0.9, 8, 8);
  starTop.translate(0, 7.8, 0);

  setGeoColor(pillarL, 0x0284c7);
  setGeoColor(pillarR, 0x0284c7);
  setGeoColor(beam, 0xf59e0b);
  setGeoColor(banner, 0xf8fafc);
  setGeoColor(starTop, 0xfacc15);

  return mergeGeometries([pillarL, pillarR, beam, banner, starTop]);
}

const instancedMeshes = {
  trees: new THREE.InstancedMesh(createTreeGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 }), COUNT_TREES),
  houses: new THREE.InstancedMesh(createHouseGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), COUNT_HOUSES),
  barns: new THREE.InstancedMesh(createBarnGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), COUNT_BARNS),
  haybales: new THREE.InstancedMesh(createHayBaleGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), COUNT_HAYBALES),
  toyblocks: new THREE.InstancedMesh(createToyBlockGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }), COUNT_TOYBLOCKS),
  streetlamps: new THREE.InstancedMesh(createStreetlampGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), COUNT_STREETLAMPS),
  ramps: new THREE.InstancedMesh(createRampGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), COUNT_RAMPS),
  stars: new THREE.InstancedMesh(createStarGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, emissive: 0x553300 }), COUNT_STARS),
  arches: new THREE.InstancedMesh(createArchGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 }), COUNT_ARCHES),
};

Object.values(instancedMeshes).forEach((mesh) => {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  scene.add(mesh);
});

// Function to check if a location is on asphalt road, sidewalk, or an open forest passage
function isRoadOrPassage(x, z, margin = 4.0) {
  const relX = ((x % ROAD_INTERVAL) + ROAD_INTERVAL) % ROAD_INTERVAL;
  const relZ = ((z % ROAD_INTERVAL) + ROAD_INTERVAL) % ROAD_INTERVAL;
  const roadCenter = ROAD_INTERVAL / 2; // 50 (roads are centered at 50 in world space)
  const roadHalfWidth = 10.0 + margin;  // 14 units road + sidewalk + buffer

  // 1. Paved Crossroads (Roads centered at 50, exactly matching ground texture)
  if (Math.abs(relX - roadCenter) < roadHalfWidth || Math.abs(relZ - roadCenter) < roadHalfWidth) {
    return true;
  }

  // 2. Clear scenic passages & forest trails so toddler doesn't constantly crash into houses:
  // Scenic north-south forest lane at relX = 22
  if (Math.abs(relX - 22) < 5.0) return true;
  // Scenic east-west forest lane at relZ = 78
  if (Math.abs(relZ - 78) < 5.0) return true;
  // Open park clearing / meadow in bottom-left quadrant
  if (relX > 8 && relX < 36 && relZ > 8 && relZ < 36) {
    return true;
  }

  return false;
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
    } while (attempts < 35 && !canBeOnRoad && isRoadOrPassage(x, z, 3.5));

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
populateObstacleGroup(instancedMeshes.ramps, COUNT_RAMPS, 6, 2.2, true);
populateObstacleGroup(instancedMeshes.stars, COUNT_STARS, 7, 1.8, true);
populateObstacleGroup(instancedMeshes.arches, COUNT_ARCHES, 8, 3.8, true);

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

  if (activeConnection && activeConnection.open) {
    activeConnection.send({
      type: 'parent_command',
      action: 'update_vehicle',
      vehicle: {
        id: vehicleDef.id,
        name: vehicleDef.name,
        icon: vehicleDef.icon,
        baseSpeed: vehicleDef.baseSpeed,
      }
    });
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

// Deadzone filter for bed / carpet unevenness
function applyTiltDeadzone(angleRad) {
  const sign = Math.sign(angleRad);
  const abs = Math.abs(angleRad);
  const deadzone = 0.12; // ~7 degrees margin of error
  if (abs <= deadzone) return 0;
  const normalized = (abs - deadzone) / (Math.PI - deadzone);
  return sign * normalized * Math.PI;
}

// ==========================================
// 8. 3D PHYSICS WITH REAL FLIP & ON-LAND DRIVE
// ==========================================
function checkCollisionsAndDrive(dt) {
  // 1. Steering Yaw interpolation
  carState.angle = lerpAngle(carState.angle, carState.targetAngle, Math.min(1.0, dt * 5.5));

  // 2. 3D Pitch & Roll from Phone with Bed Deadzone
  const filteredTargetPitch = applyTiltDeadzone(carState.targetPitch);
  const filteredTargetRoll = applyTiltDeadzone(carState.targetRoll);

  carState.pitch += (filteredTargetPitch - carState.pitch) * Math.min(1.0, dt * 7.0);
  carState.roll += (filteredTargetRoll - carState.roll) * Math.min(1.0, dt * 7.0);

  // Determine if wheels are on land:
  // "atm 45 degrees right rotation almost car is flipped and still travels with it should not"
  const isUpright = Math.cos(carState.pitch) * Math.cos(carState.roll);
  const isExcessiveTiltOrFlipped = Math.abs(carState.pitch) > 0.62 || Math.abs(carState.roll) > 0.62 || isUpright < 0.40;
  const wheelsOnLand = (carState.y <= 0.08) && !isExcessiveTiltOrFlipped;

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

  // 4. Movement: "when jump the speed should not be reduced"
  // When wheels on land OR flying airborne through a jump, full speed is maintained!
  // Only stop moving forward when flipped upside down / tilted > 35 degrees on land!
  let forwardDriveSpeed = 0;
  if (isExcessiveTiltOrFlipped && carState.y <= 0.08) {
    forwardDriveSpeed = carState.bonusSpeed * 0.4;
  } else {
    forwardDriveSpeed = carState.currentSpeed + carState.bonusSpeed;
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
                const typeId = obstacleSoA.types[obsIdx];
                if (typeId === 6) {
                  // Type 6: Stunt Ramp launch!
                  carState.vy = 22.0;
                  carState.bonusSpeed += 12.0;
                  carState.isAirborne = true;
                  soundEngine.playRampLaunch();
                  spawnParticles(carState.x, 1.5, carState.z, 28);
                  showGameNotification('🚀 MEGA STUNT RAMP!', 1400);
                } else if (typeId === 7) {
                  // Type 7: Star Collectible!
                  obstacleSoA.states[obsIdx] = 2; // collected
                  soundEngine.playChime();
                  carState.collisionCount += 5;
                  spawnParticles(ox, 2.4, oz, 24);
                  showGameNotification('⭐ STAR COLLECTED! +5', 1200);
                  const scoreText = document.getElementById('scoreText');
                  if (scoreText) scoreText.textContent = `${carState.collisionCount} Smashed & Stars!`;
                } else if (typeId === 8) {
                  // Type 8: Checkpoint Arch!
                  soundEngine.playCheer();
                  carState.bonusSpeed += 8.0;
                  spawnParticles(ox, 5.0, oz, 32);
                  showGameNotification('🏁 SPEED CHECKPOINT PASSED!', 1500);
                } else {
                  isCollidingThisFrame = true;
                  obstacleSoA.states[obsIdx] = 1;
                  obstacleSoA.crumbleProgress[obsIdx] = 0;
                  obstacleSoA.tipDirs[obsIdx * 2] = forwardX;
                  obstacleSoA.tipDirs[obsIdx * 2 + 1] = forwardZ;

                  const soundType = typeId === 1 ? 'house' : (typeId === 2 ? 'barn' : (typeId === 3 ? 'hay' : (typeId === 4 ? 'block' : 'tree')));
                  soundEngine.playTopple(soundType);
                  spawnParticles(ox, 2.0, oz, 16);

                  carState.collisionCount++;
                  const scoreText = document.getElementById('scoreText');
                  if (scoreText) scoreText.textContent = `${carState.collisionCount} Smashed & Stars!`;

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
  }

  // Smooth speed dynamics on ground
  const targetSpeed = isCollidingThisFrame ? currentVehicleDef.minSlowdownSpeed : currentVehicleDef.baseSpeed;
  const accelRate = isCollidingThisFrame ? 18.0 : 6.0;
  carState.currentSpeed += (targetSpeed - carState.currentSpeed) * Math.min(1.0, dt * accelRate);

  soundEngine.updateEnginePitch(wheelsOnLand ? (forwardDriveSpeed / currentVehicleDef.baseSpeed) : 0.2);

  // 6. Update Vehicle 3D Transform
  if (currentVehicleMesh) {
    // "also make it so it doesn't rotate through the ground as atm looks that vehicle is rotating through the ground instead of being on top of it"
    const groundContactLift = Math.abs(Math.sin(carState.pitch)) * 1.85 + Math.abs(Math.sin(carState.roll)) * 1.15;
    currentVehicleMesh.position.set(carState.x, carState.y + groundContactLift, carState.z);
    currentVehicleMesh.rotation.set(carState.pitch, carState.angle, carState.roll, 'YXZ');

    const rollSpeed = (forwardDriveSpeed / 0.6) * dt;
    for (let w = 0; w < currentWheels.length; w++) {
      currentWheels[w].children[0].rotation.x += rollSpeed;
    }
  }

  // 7. Dynamic Camera Tracking with 5 Modes & Presets
  updateCameraPerspective(dt);
}

// ==========================================
// 8B. CAMERA PERSPECTIVE PRESETS & 5 MODES
// ==========================================
export const DEFAULT_CAMERA_PRESETS = {
  1: {
    name: 'Free Mouse Orbit ⭐',
    mode: 'free',
    dist: 18.0,
    height: 8.5,
    targetHeight: 1.2,
    followRotation: false,
    smoothSpeed: 6.0,
  },
  2: {
    name: 'Chase Follow',
    mode: 'chase',
    dist: 17.0,
    height: 8.5,
    targetHeight: 1.5,
    followRotation: true,
    smoothSpeed: 5.0,
  },
  3: {
    name: 'Fixed North (Unmoved)',
    mode: 'fixed_north',
    dist: 18.0,
    height: 12.0,
    targetHeight: 1.2,
    followRotation: false,
    smoothSpeed: 6.0,
  },
  4: {
    name: 'Top-Down Bird Eye',
    mode: 'top_down',
    dist: 0.1,
    height: 32.0,
    targetHeight: 0.5,
    followRotation: false,
    smoothSpeed: 7.0,
  },
  5: {
    name: 'High Isometric',
    mode: 'isometric',
    dist: 24.0,
    height: 18.0,
    targetHeight: 1.0,
    followRotation: false,
    smoothSpeed: 5.5,
  },
};

let cameraPresets = { ...DEFAULT_CAMERA_PRESETS };
const savedCustomPresets = localStorage.getItem('toycar_camera_presets');
if (savedCustomPresets) {
  try {
    cameraPresets = { ...DEFAULT_CAMERA_PRESETS, ...JSON.parse(savedCustomPresets) };
  } catch (e) {}
}

let activePresetSlot = parseInt(localStorage.getItem('toycar_active_cam_slot') || '1', 10);
let cameraConfig = { ...(cameraPresets[activePresetSlot] || cameraPresets[1]) };

// Free Orbit Camera state with ideal default angle (elevated behind car looking North)
let freeCamAzimuth = 0;
let freeCamElevation = 0.44;
let isFreeCamDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;

// Mouse Drag for Free Orbit Cam
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (cameraConfig.mode === 'free') {
    isFreeCamDragging = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }
});

window.addEventListener('pointermove', (e) => {
  if (isFreeCamDragging && cameraConfig.mode === 'free') {
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;

    freeCamAzimuth -= dx * 0.007;
    freeCamElevation = Math.max(0.1, Math.min(Math.PI / 2 - 0.05, freeCamElevation + dy * 0.007));
  }
});

window.addEventListener('pointerup', () => {
  isFreeCamDragging = false;
});

renderer.domElement.addEventListener('wheel', (e) => {
  if (cameraConfig.mode === 'free') {
    e.preventDefault();
    cameraConfig.dist = Math.max(6, Math.min(65, cameraConfig.dist + e.deltaY * 0.025));
    const distSlider = document.getElementById('camDistSlider');
    const distVal = document.getElementById('camDistVal');
    if (distSlider) distSlider.value = cameraConfig.dist;
    if (distVal) distVal.textContent = cameraConfig.dist.toFixed(1) + 'm';
  }
}, { passive: false });

function updateCameraPerspective(dt) {
  let desiredCamX, desiredCamZ, desiredCamY;

  if (cameraConfig.followRotation) {
    // Mode 1: Rotates behind car heading
    desiredCamX = carState.x - Math.sin(carState.angle) * cameraConfig.dist;
    desiredCamZ = carState.z - Math.cos(carState.angle) * cameraConfig.dist;
    desiredCamY = cameraConfig.height + carState.y * 0.45;
  } else if (cameraConfig.mode === 'isometric') {
    // Mode 3: High Isometric (Fixed angle SW)
    const isoDist = cameraConfig.dist * 0.7071;
    desiredCamX = carState.x - isoDist;
    desiredCamZ = carState.z - isoDist;
    desiredCamY = cameraConfig.height + carState.y * 0.45;
  } else if (cameraConfig.mode === 'top_down') {
    // Mode 4: Top-Down Bird's Eye
    desiredCamX = carState.x;
    desiredCamZ = carState.z - 0.01;
    desiredCamY = cameraConfig.height + carState.y;
  } else if (cameraConfig.mode === 'free') {
    // Mode 5: Free Mouse Orbit
    const cosEl = Math.cos(freeCamElevation);
    const sinEl = Math.sin(freeCamElevation);
    desiredCamX = carState.x + Math.sin(freeCamAzimuth) * cosEl * cameraConfig.dist;
    desiredCamZ = carState.z - Math.cos(freeCamAzimuth) * cosEl * cameraConfig.dist;
    desiredCamY = carState.y + Math.max(2.0, sinEl * cameraConfig.dist);
  } else {
    // Mode 2: "Fixed North (Unmoved)" - Camera stays directly behind car along world -Z axis!
    // As the toddler turns their real toy car right, virtual car turns right on screen!
    desiredCamX = carState.x;
    desiredCamZ = carState.z - cameraConfig.dist;
    desiredCamY = cameraConfig.height + carState.y * 0.45;
  }

  const smooth = Math.min(1.0, dt * (cameraConfig.smoothSpeed || 5.5));
  camera.position.x += (desiredCamX - camera.position.x) * smooth;
  camera.position.y += (desiredCamY - camera.position.y) * smooth;
  camera.position.z += (desiredCamZ - camera.position.z) * smooth;

  camera.lookAt(carState.x, 1.4 + carState.y * 0.8 + (cameraConfig.targetHeight || 1.2), carState.z);

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
      showGameNotification('⚠️ Invalid vehicle file: missing createMesh()', 2500);
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

    rebuildVehicleGarageList();
    rebuildVehicleDockMenu();
    mountVehicle(customDef);

    showGameNotification(`🚀 Loaded ${customDef.name}!`, 1500);
  } catch (err) {
    console.error('Failed to load custom vehicle:', err);
    showGameNotification('⚠️ Error loading vehicle: ' + err.message, 3000);
  }
}

function showGameNotification(text, duration = 1500) {
  const hornBubble = document.getElementById('hornBubble');
  if (hornBubble) {
    hornBubble.textContent = text;
    hornBubble.classList.add('active');
    setTimeout(() => hornBubble.classList.remove('active'), duration);
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
export const MASTER_AI_PROMPT = `Generate a single, completely self-contained JavaScript ES module file (.js) for a high-quality 3D browser game vehicle.

VEHICLE DESCRIPTION / REFERENCE:
[USER INSTRUCTION: Describe your vehicle in detail, e.g. "Yellow Caterpillar Excavator with digging bucket", "Red Monster Truck with giant spiky wheels", "Police Cruiser with sirens", OR attach an image and say "Create this exact vehicle from the image"]

ACCURATE COLOR AND DESIGN MATCHING FROM REFERENCE IMAGES:
When a reference image of a vehicle is provided, meticulously analyze the exact color-blocking, patterns, decals, and section layouts (e.g., specific placement of red bumpers, yellow hoods, blue cabins, or accents). Map each distinct region of the car to its exact corresponding geometry coordinate and color hex code rather than applying a generic or simplified color scheme. Pay extraordinary attention to exact proportions, distinct multi-part color separation, window trims, headlights, taillights, roof racks, and wheel rim details so the 3D model looks as close to the reference photo as possible.

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

CRITICAL TECHNICAL RULES (PREVENT TECHNICAL / METHOD ERRORS):
1. When generating Three.js geometries for procedural vehicles, never use .clone() on geometries before modifying or setting vertex colors, because cloned geometries may not initialize position attributes properly in this runtime environment. Always create separate primitive geometries directly (e.g., new THREE.BoxGeometry(...)) or ensure vertex color helper functions check for valid position attributes.
2. Do NOT write \`import * as THREE from 'three'\`. The game engine passes THREE and mergeGeometries into createMesh(THREE, mergeGeometries).
3. Assemble composite 3D procedural geometries using Three.js primitives (BoxGeometry, CylinderGeometry, ConeGeometry, SphereGeometry).
4. Set vertex colors on each component using \`setGeoColor(geometry, hexColor)\` helper.
5. Merge all static body parts into ONE single draw-call mesh via \`mergeGeometries([...])\`.
6. The vehicle points forward along the +Z axis.
7. Return { group, wheels } where wheels is an array of wheel groups so they spin automatically.

OUTPUT FORMAT:
Output ONLY the raw JavaScript code inside a single \`\`\`javascript code block:
\`\`\`javascript
export default {
  id: 'custom_vehicle_id',
  name: 'Vehicle Name',
  icon: '🚜',
  baseSpeed: 10.0,
  minSlowdownSpeed: 3.5,
  soundPitch: 50, // 40 = heavy diesel rumble, 65 = sports car hum, 75 = high rev
  hornFrequencies: [349.23, 440.0],
  engineType: 'sawtooth', // 'sawtooth', 'triangle', or 'sine'
  createMesh(THREE, mergeGeometries) {
    const group = new THREE.Group();

    // High-Fidelity Multi-Part Body with Exact Color-Blocking
    const chassis = new THREE.BoxGeometry(2.2, 0.8, 4.0);
    chassis.translate(0, 0.7, 0);

    const cabin = new THREE.BoxGeometry(1.8, 1.0, 2.0);
    cabin.translate(0, 1.6, -0.2);

    const setGeoColor = (geo, colorHex) => {
      const col = new THREE.Color(colorHex);
      const count = geo.attributes && geo.attributes.position ? geo.attributes.position.count : 0;
      if (count === 0) return;
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
      showGameNotification('⚠️ Please paste vehicle code first', 2000);
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

      // Start live 3D gameplay video stream to phone!
      if (renderer.domElement.captureStream && peer) {
        try {
          const stream = renderer.domElement.captureStream(25);
          peer.call(conn.peer, stream);
          console.log('Initiated live 3D gameplay canvas stream to phone:', conn.peer);
        } catch (err) {
          console.warn('captureStream error:', err);
        }
      }

      // Send active vehicle to phone so phone displays top-down mirror
      conn.send({
        type: 'parent_command',
        action: 'update_vehicle',
        vehicle: {
          id: currentVehicleDef.id,
          name: currentVehicleDef.name,
          icon: currentVehicleDef.icon,
          baseSpeed: currentVehicleDef.baseSpeed,
        }
      });
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
      } else if (data.type === 'parent_command') {
        if (data.action === 'set_camera_preset') {
          applyCameraPreset(data.preset);
        } else if (data.action === 'recenter') {
          carState.angle = 0;
          carState.targetAngle = 0;
          showGameNotification('🎯 Re-Centered Direction!', 1200);
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
// 12. VEHICLE GARAGE & MANAGER (List, Rename, Delete, Export)
// ==========================================
let vehicleRenames = {};
try {
  vehicleRenames = JSON.parse(localStorage.getItem('toycar_vehicle_renames') || '{}');
} catch (e) {}

let deletedVehicleIds = new Set();
try {
  deletedVehicleIds = new Set(JSON.parse(localStorage.getItem('toycar_deleted_vehicles') || '[]'));
} catch (e) {}

// Apply persisted renames
VEHICLES.forEach((v) => {
  if (vehicleRenames[v.id]) {
    v.name = vehicleRenames[v.id];
  }
});

const vehicleGarageModal = document.getElementById('vehicleGarageModal');
const openGarageBtn = document.getElementById('openGarageBtn');
const closeGarageModalBtn = document.getElementById('closeGarageModalBtn');
const garageVehicleList = document.getElementById('garageVehicleList');
const garageCountBadge = document.getElementById('garageCountBadge');
const garageCountDock = document.getElementById('garageCountDock');
const activeCarIconDock = document.getElementById('activeCarIconDock');
const activeCarNameDock = document.getElementById('activeCarNameDock');
const vehicleQuickPills = document.getElementById('vehicleQuickPills');
const garageOpenAiBtn = document.getElementById('garageOpenAiBtn');

function getActiveVehicles() {
  return VEHICLES.filter(v => !deletedVehicleIds.has(v.id));
}

export function rebuildVehicleGarageList() {
  if (!garageVehicleList) return;
  garageVehicleList.innerHTML = '';

  const activeList = getActiveVehicles();

  if (activeList.length === 0) {
    garageVehicleList.innerHTML = `<div style="text-align: center; padding: 24px; color: #94a3b8;">No vehicles in garage. <button id="restoreDefaultsBtn" style="color: #38bdf8; background: none; border: none; text-decoration: underline; cursor: pointer;">↺ Restore default cars</button></div>`;
    const restoreBtn = document.getElementById('restoreDefaultsBtn');
    if (restoreBtn) {
      restoreBtn.addEventListener('click', () => {
        deletedVehicleIds.clear();
        localStorage.removeItem('toycar_deleted_vehicles');
        rebuildVehicleGarageList();
        rebuildVehicleDockMenu();
        showGameNotification('✓ Default vehicles restored!', 1200);
      });
    }
    return;
  }

  activeList.forEach((v) => {
    const isCurrent = v.id === currentVehicleDef.id;
    const item = document.createElement('div');
    item.className = `garage-item ${isCurrent ? 'active' : ''}`;

    const isCustom = v.id.startsWith('custom_') || v.id === 'excavator';
    const typeLabel = isCustom ? 'Custom / AI' : 'Standard';

    item.innerHTML = `
      <div class="car-info-col">
        <div class="car-avatar">${v.icon || '🏎️'}</div>
        <div class="car-meta">
          <div class="car-name-row">
            <span class="car-title-text" id="nameDisplay_${v.id}">${v.name}</span>
            <span class="car-type-badge">${typeLabel}</span>
            ${isCurrent ? '<span style="font-size: 11px; color: #34d399; font-weight: 800;">● Active</span>' : ''}
          </div>
          <div class="car-stats-sub">
            <span>⚡ ${v.baseSpeed.toFixed(1)} m/s</span>
            <span>🔊 Pitch: ${v.soundPitch || 60}Hz</span>
          </div>
        </div>
      </div>
      <div class="car-actions-row">
        ${!isCurrent ? `<button class="btn-garage-action btn-drive-now" data-action="drive" data-id="${v.id}">🏎️ Drive</button>` : `<button class="btn-garage-action" style="border-color: #34d399; color: #34d399;" disabled>✓ Driving</button>`}
        <button class="btn-garage-action" data-action="rename" data-id="${v.id}">✏️ Rename</button>
        <button class="btn-garage-action" data-action="export" data-id="${v.id}" title="Download .js file">💾 Export</button>
        ${activeList.length > 1 ? `<button class="btn-garage-action btn-delete-car" data-action="delete" data-id="${v.id}">🗑️</button>` : ''}
      </div>
    `;

    // Bind item buttons
    item.querySelectorAll('button[data-action]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const vid = btn.dataset.id;
        const targetV = VEHICLES.find(car => car.id === vid);
        if (!targetV) return;

        if (action === 'drive') {
          soundEngine.init(targetV);
          mountVehicle(targetV);
          rebuildVehicleGarageList();
          rebuildVehicleDockMenu();
          showGameNotification(`🏎️ Driving ${targetV.name}!`, 1200);
        } else if (action === 'rename') {
          const currentName = targetV.name;
          const newName = window.prompt(`Rename "${currentName}" to:`, currentName);
          if (newName && newName.trim().length > 0) {
            targetV.name = newName.trim();
            vehicleRenames[targetV.id] = targetV.name;
            localStorage.setItem('toycar_vehicle_renames', JSON.stringify(vehicleRenames));
            rebuildVehicleGarageList();
            rebuildVehicleDockMenu();
            showGameNotification(`✓ Renamed to ${targetV.name}!`, 1200);
          }
        } else if (action === 'export') {
          exportVehicleScript(targetV);
        } else if (action === 'delete') {
          if (confirm(`Remove "${targetV.name}" from your garage?`)) {
            deletedVehicleIds.add(targetV.id);
            localStorage.setItem('toycar_deleted_vehicles', JSON.stringify([...deletedVehicleIds]));
            if (currentVehicleDef.id === targetV.id) {
              const remaining = getActiveVehicles();
              if (remaining.length > 0) {
                mountVehicle(remaining[0]);
              }
            }
            rebuildVehicleGarageList();
            rebuildVehicleDockMenu();
            showGameNotification(`🗑️ Removed ${targetV.name}`, 1200);
          }
        }
      });
    });

    garageVehicleList.appendChild(item);
  });
}

export function exportVehicleScript(v) {
  let code = v._sourceCode;
  if (!code) {
    code = `/* Self-contained ${v.name} Vehicle ES Module */
export default {
  id: '${v.id}',
  name: '${v.name}',
  icon: '${v.icon || '🏎️'}',
  baseSpeed: ${v.baseSpeed || 11.0},
  minSlowdownSpeed: ${v.minSlowdownSpeed || 4.0},
  soundPitch: ${v.soundPitch || 60},
  hornFrequencies: ${JSON.stringify(v.hornFrequencies || [349.23, 440.0])},
  engineType: '${v.engineType || 'sawtooth'}',
  createMesh: ${v.createMesh.toString()}
};
`;
  }
  const blob = new Blob([code], { type: 'application/javascript' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${v.id}.js`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  showGameNotification(`💾 Downloaded ${v.name}.js`, 1500);
}

export function rebuildVehicleDockMenu() {
  const activeList = getActiveVehicles();
  if (garageCountDock) garageCountDock.textContent = activeList.length;
  if (garageCountBadge) garageCountBadge.textContent = activeList.length;

  if (activeCarIconDock) activeCarIconDock.textContent = currentVehicleDef.icon || '🏎️';
  if (activeCarNameDock) activeCarNameDock.textContent = currentVehicleDef.name;

  if (!vehicleQuickPills) return;
  vehicleQuickPills.innerHTML = '';

  // Show up to 3 quick-switch pills for clean uncluttered layout
  activeList.slice(0, 4).forEach((v) => {
    if (v.id === currentVehicleDef.id) return;
    const btn = document.createElement('button');
    btn.className = 'vehicle-select-btn';
    btn.innerHTML = `<span class="v-icon">${v.icon}</span><span class="v-label">${v.name}</span>`;
    btn.addEventListener('click', () => {
      soundEngine.init(v);
      mountVehicle(v);
      rebuildVehicleDockMenu();
    });
    vehicleQuickPills.appendChild(btn);
  });
}

rebuildVehicleGarageList();
rebuildVehicleDockMenu();

if (openGarageBtn && vehicleGarageModal) {
  openGarageBtn.addEventListener('click', () => {
    rebuildVehicleGarageList();
    vehicleGarageModal.style.display = 'flex';
  });
}
if (closeGarageModalBtn && vehicleGarageModal) {
  closeGarageModalBtn.addEventListener('click', () => {
    vehicleGarageModal.style.display = 'none';
  });
}
if (garageOpenAiBtn && aiPromptModal) {
  garageOpenAiBtn.addEventListener('click', () => {
    if (vehicleGarageModal) vehicleGarageModal.style.display = 'none';
    aiPromptModal.style.display = 'flex';
  });
}

// ==========================================
// 12B. ALIGNMENT & PRE-CONFIGURATION MODAL
// ==========================================
const alignmentModal = document.getElementById('alignmentModal');
const alignHudBtn = document.getElementById('alignHudBtn');
const dockAlignBtn = document.getElementById('dockAlignBtn');
const closeAlignmentModalBtn = document.getElementById('closeAlignmentModalBtn');
const lockAlignmentBtn = document.getElementById('lockAlignmentBtn');
const flip180PCBtn = document.getElementById('flip180PCBtn');
const resetAlignmentBtn = document.getElementById('resetAlignmentBtn');

let phoneFlip180State = localStorage.getItem('toycar_phone_flip180') === '1';

if (alignHudBtn && alignmentModal) {
  alignHudBtn.addEventListener('click', () => {
    alignmentModal.style.display = 'flex';
  });
}
if (dockAlignBtn && alignmentModal) {
  dockAlignBtn.addEventListener('click', () => {
    alignmentModal.style.display = 'flex';
  });
}
if (closeAlignmentModalBtn && alignmentModal) {
  closeAlignmentModalBtn.addEventListener('click', () => {
    alignmentModal.style.display = 'none';
  });
}

if (lockAlignmentBtn) {
  lockAlignmentBtn.addEventListener('click', () => {
    carState.angle = 0;
    carState.targetAngle = 0;
    if (activeConnection && activeConnection.open) {
      activeConnection.send({ type: 'parent_command', action: 'recenter' });
    }
    showGameNotification('🎯 1-to-1 Direction Aligned & Locked!', 1500);
    if (alignmentModal) alignmentModal.style.display = 'none';
  });
}

if (flip180PCBtn) {
  flip180PCBtn.addEventListener('click', () => {
    phoneFlip180State = !phoneFlip180State;
    localStorage.setItem('toycar_phone_flip180', phoneFlip180State ? '1' : '0');
    if (activeConnection && activeConnection.open) {
      activeConnection.send({ type: 'parent_command', action: 'toggle_flip180', flip: phoneFlip180State });
    }
    flip180PCBtn.textContent = phoneFlip180State ? '✓ Flipped 180°: ACTIVE' : '🔄 Flip 180° (Phone Backwards)';
    showGameNotification(phoneFlip180State ? '🔄 Flipped 180° Front/Back' : '↺ Restored Normal Heading', 1500);
  });
}

if (resetAlignmentBtn) {
  resetAlignmentBtn.addEventListener('click', () => {
    carState.angle = 0;
    carState.targetAngle = 0;
    if (activeConnection && activeConnection.open) {
      activeConnection.send({ type: 'parent_command', action: 'recenter' });
    }
    showGameNotification('↺ Heading Reset to 0° North', 1200);
  });
}

// Preset button handlers: 1: Free Orbit, 2: Chase, 3: Fixed North, 4: Top-Down, 5: Isometric
['1', '2', '3', '4', '5'].forEach(id => {
  const btn = document.getElementById(`camPreset${id}Btn`);
  if (btn) {
    btn.addEventListener('click', () => {
      applyCameraPreset(id);
    });
  }
});

// Live Sliders
if (camDistSlider) {
  camDistSlider.addEventListener('input', (e) => {
    cameraConfig.dist = parseFloat(e.target.value);
    if (camDistVal) camDistVal.textContent = cameraConfig.dist.toFixed(1) + 'm';
  });
}
if (camHeightSlider) {
  camHeightSlider.addEventListener('input', (e) => {
    cameraConfig.height = parseFloat(e.target.value);
    if (camHeightVal) camHeightVal.textContent = cameraConfig.height.toFixed(1) + 'm';
  });
}
if (camTargetHeightSlider) {
  camTargetHeightSlider.addEventListener('input', (e) => {
    cameraConfig.targetHeight = parseFloat(e.target.value);
    if (camTargetHeightVal) camTargetHeightVal.textContent = cameraConfig.targetHeight.toFixed(1) + 'm';
  });
}
if (toggleCamFollowRotBtn) {
  toggleCamFollowRotBtn.addEventListener('click', () => {
    cameraConfig.followRotation = !cameraConfig.followRotation;
    syncCameraSlidersToConfig();
  });
}

// Save to slots 1, 2, 3, 4
[1, 2, 3, 4].forEach(slot => {
  const btn = document.getElementById(`saveSlot${slot}Btn`);
  if (btn) {
    btn.addEventListener('click', () => {
      cameraPresets[slot] = { ...cameraConfig, name: `Custom Slot ${slot}` };
      localStorage.setItem('toycar_camera_presets', JSON.stringify(cameraPresets));
      btn.textContent = `✓ Saved Slot ${slot}!`;
      setTimeout(() => btn.textContent = `💾 Save Slot ${slot}`, 1500);
    });
  }
});

// Copy Camera Config JSON to Clipboard
if (copyCamConfigBtn) {
  copyCamConfigBtn.addEventListener('click', () => {
    const exportData = {
      activePreset: activePresetSlot,
      config: cameraConfig,
    };
    navigator.clipboard.writeText(JSON.stringify(exportData, null, 2)).then(() => {
      copyCamConfigBtn.textContent = '✓ Copied Config! Paste in chat';
      copyCamConfigBtn.style.background = '#10b981';
      setTimeout(() => {
        copyCamConfigBtn.textContent = '📋 Copy Camera Config JSON';
        copyCamConfigBtn.style.background = '#0284c7';
      }, 2500);
    });
  });
}

if (resetCamDefaultsBtn) {
  resetCamDefaultsBtn.addEventListener('click', () => {
    cameraPresets = { ...DEFAULT_CAMERA_PRESETS };
    localStorage.removeItem('toycar_camera_presets');
    applyCameraPreset(1);
  });
}

// ==========================================
// 12C. PARENT PHONE REMOTE CONTROL MODAL
// ==========================================
const phoneRemoteModal = document.getElementById('phoneRemoteModal');
const phoneRemoteBtn = document.getElementById('phoneRemoteBtn');
const closePhoneRemoteModalBtn = document.getElementById('closePhoneRemoteModalBtn');

const remoteViewTopDownBtn = document.getElementById('remoteViewTopDownBtn');
const remoteViewSensorsBtn = document.getElementById('remoteViewSensorsBtn');
const remoteLockToggleBtn = document.getElementById('remoteLockToggleBtn');
const remoteRecenterBtn = document.getElementById('remoteRecenterBtn');
const remoteInvertBtn = document.getElementById('remoteInvertBtn');
const remoteHonkBtn = document.getElementById('remoteHonkBtn');

let parentPhoneLocked = true;

if (phoneRemoteBtn && phoneRemoteModal) {
  phoneRemoteBtn.addEventListener('click', () => {
    phoneRemoteModal.style.display = 'flex';
  });
}
if (closePhoneRemoteModalBtn && phoneRemoteModal) {
  closePhoneRemoteModalBtn.addEventListener('click', () => {
    phoneRemoteModal.style.display = 'none';
  });
}

function sendParentCommand(action, payload = {}) {
  if (activeConnection && activeConnection.open) {
    activeConnection.send({
      type: 'parent_command',
      action,
      ...payload
    });
  }
}

if (remoteViewTopDownBtn) {
  remoteViewTopDownBtn.addEventListener('click', () => {
    remoteViewTopDownBtn.classList.add('active');
    if (remoteViewSensorsBtn) remoteViewSensorsBtn.classList.remove('active');
    sendParentCommand('toggle_view', { mode: 'top_down' });
  });
}

if (remoteViewSensorsBtn) {
  remoteViewSensorsBtn.addEventListener('click', () => {
    remoteViewSensorsBtn.classList.add('active');
    if (remoteViewTopDownBtn) remoteViewTopDownBtn.classList.remove('active');
    sendParentCommand('toggle_view', { mode: 'sensors' });
  });
}

if (remoteLockToggleBtn) {
  remoteLockToggleBtn.addEventListener('click', () => {
    parentPhoneLocked = !parentPhoneLocked;
    remoteLockToggleBtn.classList.toggle('active', parentPhoneLocked);
    remoteLockToggleBtn.textContent = parentPhoneLocked ? '🔒 Phone Screen: LOCKED' : '🔓 Phone Screen: UNLOCKED';
    sendParentCommand('toggle_lock', { locked: parentPhoneLocked });
  });
}

if (remoteRecenterBtn) {
  remoteRecenterBtn.addEventListener('click', () => {
    sendParentCommand('recenter');
    remoteRecenterBtn.textContent = '✓ Re-Centered!';
    setTimeout(() => remoteRecenterBtn.textContent = '🎯 Re-Center Compass', 1200);
  });
}

if (remoteInvertBtn) {
  remoteInvertBtn.addEventListener('click', () => {
    sendParentCommand('toggle_invert');
    remoteInvertBtn.textContent = '✓ Inverted!';
    setTimeout(() => remoteInvertBtn.textContent = '🔄 Invert Steering', 1200);
  });
}

if (remoteHonkBtn) {
  remoteHonkBtn.addEventListener('click', () => {
    soundEngine.playHorn();
    sendParentCommand('honk');
    if (hornBubble) {
      hornBubble.textContent = '🎺 BEEP BEEP!';
      hornBubble.classList.add('active');
      setTimeout(() => hornBubble.classList.remove('active'), 800);
    }
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
