/* Toddler Toy Car 3D - High-Performance 3D Browser Game */

// ==========================================
// 1. GLOBAL CONSTANTS & PROCEDURAL SOUND SYNTH
// ==========================================
const TOTAL_TREES = 2400;
const TOTAL_HOUSES = 550;
const TOTAL_OBSTACLES = TOTAL_TREES + TOTAL_HOUSES;
const ARENA_RADIUS = 195;
const ARENA_SIZE = 400; // -200 to +200
const GRID_CELL_SIZE = 10;
const GRID_DIM = Math.ceil(ARENA_SIZE / GRID_CELL_SIZE); // 40x40 cells

// Web Audio Synthesizer (Zero External MP3s)
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineGain = null;
    this.engineOsc = null;
  }
  init() {
    if (this.ctx) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();

      // Continuous gentle toy car engine hum
      this.engineOsc = this.ctx.createOscillator();
      this.engineOsc.type = 'sawtooth';
      this.engineOsc.frequency.setValueAtTime(65, this.ctx.currentTime);

      // Filter for smooth toy purr
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(260, this.ctx.currentTime);

      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.setValueAtTime(this.muted ? 0 : 0.05, this.ctx.currentTime);

      this.engineOsc.connect(filter);
      filter.connect(this.engineGain);
      this.engineGain.connect(this.ctx.destination);
      this.engineOsc.start();
    } catch (e) {
      console.warn('WebAudio init error:', e);
    }
  }
  updateEnginePitch(speedRatio) {
    if (!this.ctx || !this.engineOsc) return;
    const targetFreq = 50 + speedRatio * 70;
    this.engineOsc.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.05);
  }
  playTopple(isHouse = false) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = isHouse ? 'triangle' : 'sine';
    // Pitch slide down for topple / boing
    osc.frequency.setValueAtTime(isHouse ? 160 : 320, t);
    osc.frequency.exponentialRampToValueAtTime(isHouse ? 50 : 90, t + 0.28);

    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.28);

    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + 0.3);
  }
  playHorn() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    [349.23, 440.0].forEach((freq) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  }
  playCheer() {
    if (!this.ctx || this.muted) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      const t = this.ctx.currentTime + idx * 0.08;
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(t);
      osc.stop(t + 0.22);
    });
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.engineGain && this.ctx) {
      this.engineGain.gain.setValueAtTime(this.muted ? 0 : 0.05, this.ctx.currentTime);
    }
    return this.muted;
  }
}
const soundEngine = new SoundEngine();

// ==========================================
// 2. DATA-ORIENTED DESIGN (SoA) & SPATIAL GRID
// ==========================================
const obstacleSoA = {
  positions: new Float32Array(TOTAL_OBSTACLES * 2), // [x, z, x, z, ...]
  radii: new Float32Array(TOTAL_OBSTACLES),
  states: new Uint8Array(TOTAL_OBSTACLES), // 0 = Active, 1 = Crumbling, 2 = Destroyed
  types: new Uint8Array(TOTAL_OBSTACLES),  // 0 = Tree, 1 = House
  instanceIndices: new Uint32Array(TOTAL_OBSTACLES),
  crumbleProgress: new Float32Array(TOTAL_OBSTACLES), // 0.0 -> 1.0
  tipDirs: new Float32Array(TOTAL_OBSTACLES * 2), // [tipX, tipZ]
  initialMatrices: new Float32Array(TOTAL_OBSTACLES * 16),
};

// Spatial Partitioning Grid (Flat Array of dynamic index arrays)
const spatialGrid = new Array(GRID_DIM * GRID_DIM);
for (let i = 0; i < spatialGrid.length; i++) {
  spatialGrid[i] = [];
}

function getGridIndex(x, z) {
  const cx = Math.floor((x + ARENA_SIZE / 2) / GRID_CELL_SIZE);
  const cz = Math.floor((z + ARENA_SIZE / 2) / GRID_CELL_SIZE);
  if (cx < 0 || cx >= GRID_DIM || cz < 0 || cz >= GRID_DIM) return -1;
  return cz * GRID_DIM + cx;
}

function insertIntoGrid(obstacleIdx, x, z) {
  const gIdx = getGridIndex(x, z);
  if (gIdx >= 0) {
    spatialGrid[gIdx].push(obstacleIdx);
  }
}

// ==========================================
// 3. THREE.JS SCENE, SHADOWS, PBR & RENDERER
// ==========================================
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xa5d8ff); // Cheerful cartoon sky
scene.fog = new THREE.Fog(0xa5d8ff, 60, 280);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 600);
camera.position.set(0, 15, -25);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
container.appendChild(renderer.domElement);

// Lighting: Warm key light with shadows + cool ambient sky
const hemiLight = new THREE.HemisphereLight(0xfffbeb, 0x38bdf8, 0.65);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xfffaed, 1.15);
sunLight.position.set(60, 120, 80);
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

// Stylized Ground Plane with Canvas Grid / Cheerful Meadow Texture
function createGroundTexture() {
  const cvs = document.createElement('canvas');
  cvs.width = 512;
  cvs.height = 512;
  const ctx = cvs.getContext('2d');

  // Grass base
  ctx.fillStyle = '#86efac';
  ctx.fillRect(0, 0, 512, 512);

  // Soft checkered playmat grid
  ctx.fillStyle = '#6ee7b7';
  for (let x = 0; x < 512; x += 64) {
    for (let y = 0; y < 512; y += 64) {
      if ((x / 64 + y / 64) % 2 === 0) {
        ctx.fillRect(x, y, 64, 64);
      }
    }
  }
  // Subtle cute flowers / dots
  ctx.fillStyle = '#fef08a';
  for (let i = 0; i < 30; i++) {
    const fx = Math.random() * 512;
    const fy = Math.random() * 512;
    ctx.beginPath();
    ctx.arc(fx, fy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(cvs);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(50, 50);
  texture.encoding = THREE.sRGBEncoding;
  return texture;
}

const groundGeo = new THREE.PlaneGeometry(ARENA_SIZE * 1.5, ARENA_SIZE * 1.5);
const groundMat = new THREE.MeshStandardMaterial({
  map: createGroundTexture(),
  roughness: 0.9,
  metalness: 0.05,
});
const groundMesh = new THREE.Mesh(groundGeo, groundMat);
groundMesh.rotation.x = -Math.PI / 2;
groundMesh.receiveShadow = true;
scene.add(groundMesh);

// Boundary Natural Barrier (Colorful Wooden Peg Fence Ring)
const fencePostGeo = new THREE.CylinderGeometry(0.5, 0.6, 3.5, 8);
const fencePostMat = new THREE.MeshLambertMaterial({ color: 0xfbbf24 });
const fenceMesh = new THREE.InstancedMesh(fencePostGeo, fencePostMat, 160);
fenceMesh.castShadow = true;
fenceMesh.frustumCulled = false;
const _dummy = new THREE.Object3D();
for (let i = 0; i < 160; i++) {
  const theta = (i / 160) * Math.PI * 2;
  const fx = Math.cos(theta) * ARENA_RADIUS;
  const fz = Math.sin(theta) * ARENA_RADIUS;
  _dummy.position.set(fx, 1.75, fz);
  _dummy.rotation.set(0, theta, 0);
  _dummy.scale.set(1, 1, 1);
  _dummy.updateMatrix();
  fenceMesh.setMatrixAt(i, _dummy.matrix);
}
fenceMesh.instanceMatrix.needsUpdate = true;
scene.add(fenceMesh);

// ==========================================
// 4. PROCEDURAL SINGLE-DRAW-CALL MESHES
// (Using BufferGeometryUtils.mergeBufferGeometries)
// ==========================================
function mergeGeometries(geos) {
  if (window.THREE && THREE.BufferGeometryUtils && THREE.BufferGeometryUtils.mergeBufferGeometries) {
    return THREE.BufferGeometryUtils.mergeBufferGeometries(geos, false);
  }
  return geos[0];
}

// Procedural Tree: Trunk + Stacked Canopy (Cone/Spheres)
function createTreeGeometry() {
  const trunk = new THREE.CylinderGeometry(0.35, 0.55, 3.2, 7);
  trunk.translate(0, 1.6, 0);

  const foliage1 = new THREE.ConeGeometry(2.2, 3.0, 7);
  foliage1.translate(0, 3.5, 0);

  const foliage2 = new THREE.ConeGeometry(1.6, 2.4, 7);
  foliage2.translate(0, 4.8, 0);

  const foliage3 = new THREE.ConeGeometry(1.0, 1.8, 7);
  foliage3.translate(0, 5.8, 0);

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

  setGeoColor(trunk, 0x854d0e);     // Wood trunk
  setGeoColor(foliage1, 0x22c55e);  // Forest green
  setGeoColor(foliage2, 0x16a34a);  // Mid green
  setGeoColor(foliage3, 0x15803d);  // Deep green

  return mergeGeometries([trunk, foliage1, foliage2, foliage3]);
}

// Procedural House: Cuboid Base + Pitched Roof + Chimney + Door Recess
function createHouseGeometry() {
  const base = new THREE.BoxGeometry(4.0, 3.0, 4.0);
  base.translate(0, 1.5, 0);

  const roof = new THREE.ConeGeometry(3.6, 2.2, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 4.1, 0);

  const chimney = new THREE.BoxGeometry(0.7, 1.5, 0.7);
  chimney.translate(1.0, 4.2, 0.8);

  const door = new THREE.BoxGeometry(1.2, 1.8, 0.2);
  door.translate(0, 0.9, 2.01);

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

  setGeoColor(base, 0xf8fafc);     // White/Pastel House Body
  setGeoColor(roof, 0xe11d48);     // Crimson roof
  setGeoColor(chimney, 0x64748b);  // Brick/stone chimney
  setGeoColor(door, 0x0284c7);     // Blue front door

  return mergeGeometries([base, roof, chimney, door]);
}

// Procedural Player's Toy Car (Chassis, Cabin, 4 Wheels, Headlights, Tail)
function createCarMesh() {
  const carGroup = new THREE.Group();

  const chassis = new THREE.BoxGeometry(2.2, 0.9, 4.2);
  chassis.translate(0, 0.75, 0);

  const cabin = new THREE.BoxGeometry(1.8, 0.9, 2.3);
  cabin.translate(0, 1.6, -0.2);

  const hoodSlope = new THREE.BoxGeometry(1.7, 0.5, 1.1);
  hoodSlope.translate(0, 1.15, 1.4);

  const bumperFront = new THREE.BoxGeometry(2.3, 0.4, 0.4);
  bumperFront.translate(0, 0.5, 2.2);

  const bumperBack = new THREE.BoxGeometry(2.3, 0.4, 0.4);
  bumperBack.translate(0, 0.5, -2.2);

  const headlightL = new THREE.CylinderGeometry(0.2, 0.2, 0.2, 10);
  headlightL.rotateX(Math.PI / 2);
  headlightL.translate(-0.7, 0.85, 2.12);

  const headlightR = headlightL.clone();
  headlightR.translate(1.4, 0, 0);

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

  setGeoColor(chassis, 0xef4444);      // Vibrant Racing Red
  setGeoColor(cabin, 0x38bdf8);        // Glass Blue Windshield
  setGeoColor(hoodSlope, 0xdc2626);    // Deep Red Hood
  setGeoColor(bumperFront, 0x1e293b);  // Slate Dark Bumper
  setGeoColor(bumperBack, 0x1e293b);   // Slate Dark
  setGeoColor(headlightL, 0xfef08a);   // Yellow Glowing Lamps
  setGeoColor(headlightR, 0xfef08a);

  const mergedCarBody = mergeGeometries([
    chassis, cabin, hoodSlope, bumperFront, bumperBack, headlightL, headlightR
  ]);

  const bodyMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.35,
    metalness: 0.25,
  });
  const bodyMesh = new THREE.Mesh(mergedCarBody, bodyMat);
  bodyMesh.castShadow = true;
  carGroup.add(bodyMesh);

  // 4 Chunky Toy Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.3 });

  const wheels = [];
  const wheelPositions = [
    [-1.15, 0.55, 1.3],  // Front Left
    [1.15, 0.55, 1.3],   // Front Right
    [-1.15, 0.55, -1.3], // Rear Left
    [1.15, 0.55, -1.3],  // Rear Right
  ];

  wheelPositions.forEach((pos) => {
    const wGroup = new THREE.Group();
    const wMesh = new THREE.Mesh(wheelGeo, wheelMat);
    wMesh.castShadow = true;
    const hubMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.42, 10), hubMat);
    hubMesh.rotateZ(Math.PI / 2);
    wGroup.add(wMesh);
    wGroup.add(hubMesh);
    wGroup.position.set(...pos);
    carGroup.add(wGroup);
    wheels.push(wGroup);
  });

  // Contact shadow disk directly under car
  const shadowGeo = new THREE.CircleGeometry(2.4, 16);
  const shadowMat = new THREE.MeshBasicMaterial({
    color: 0x052e16,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.y = 0.03;
  carGroup.add(shadowMesh);

  return { carGroup, wheels };
}

const { carGroup: playerCar, wheels: carWheels } = createCarMesh();
scene.add(playerCar);

// ==========================================
// 5. INSTANCED MESHES & ENVIRONMENT POPULATION
// ==========================================
const treeGeo = createTreeGeometry();
const treeMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.8,
  metalness: 0.1,
});
const treeInstancedMesh = new THREE.InstancedMesh(treeGeo, treeMat, TOTAL_TREES);
treeInstancedMesh.castShadow = true;
treeInstancedMesh.receiveShadow = true;
treeInstancedMesh.frustumCulled = false;
scene.add(treeInstancedMesh);

const houseGeo = createHouseGeometry();
const houseMat = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.6,
  metalness: 0.15,
});
const houseInstancedMesh = new THREE.InstancedMesh(houseGeo, houseMat, TOTAL_HOUSES);
houseInstancedMesh.castShadow = true;
houseInstancedMesh.receiveShadow = true;
houseInstancedMesh.frustumCulled = false;
scene.add(houseInstancedMesh);

// Populate Trees and Houses across arena (avoiding origin spawn zone)
let obstacleGlobalIdx = 0;
const dummyObj = new THREE.Object3D();

// Seed Trees (2,400)
for (let i = 0; i < TOTAL_TREES; i++) {
  let x, z, dist;
  do {
    const r = Math.sqrt(Math.random()) * (ARENA_RADIUS - 6);
    const theta = Math.random() * Math.PI * 2;
    x = Math.cos(theta) * r;
    z = Math.sin(theta) * r;
    dist = Math.sqrt(x * x + z * z);
  } while (dist < 15); // Clear circular spawn runway in center

  const scale = 0.8 + Math.random() * 0.45;
  const rotY = Math.random() * Math.PI * 2;

  dummyObj.position.set(x, 0, z);
  dummyObj.rotation.set(0, rotY, 0);
  dummyObj.scale.set(scale, scale, scale);
  dummyObj.updateMatrix();

  treeInstancedMesh.setMatrixAt(i, dummyObj.matrix);

  // Store into SoA
  const idx = obstacleGlobalIdx++;
  obstacleSoA.positions[idx * 2] = x;
  obstacleSoA.positions[idx * 2 + 1] = z;
  obstacleSoA.radii[idx] = 1.2 * scale; // Tree radius
  obstacleSoA.states[idx] = 0; // Active
  obstacleSoA.types[idx] = 0;  // Tree
  obstacleSoA.instanceIndices[idx] = i;
  obstacleSoA.crumbleProgress[idx] = 0;

  // Store initial matrix for animation scaling
  const mElements = dummyObj.matrix.elements;
  for (let m = 0; m < 16; m++) {
    obstacleSoA.initialMatrices[idx * 16 + m] = mElements[m];
  }

  // Insert into spatial grid
  insertIntoGrid(idx, x, z);
}
treeInstancedMesh.instanceMatrix.needsUpdate = true;

// Seed Houses (550)
for (let i = 0; i < TOTAL_HOUSES; i++) {
  let x, z, dist;
  do {
    const r = Math.sqrt(Math.random()) * (ARENA_RADIUS - 10);
    const theta = Math.random() * Math.PI * 2;
    x = Math.cos(theta) * r;
    z = Math.sin(theta) * r;
    dist = Math.sqrt(x * x + z * z);
  } while (dist < 20); // Clear spawn area

  const scale = 0.85 + Math.random() * 0.35;
  const rotY = Math.random() * Math.PI * 2;

  dummyObj.position.set(x, 0, z);
  dummyObj.rotation.set(0, rotY, 0);
  dummyObj.scale.set(scale, scale, scale);
  dummyObj.updateMatrix();

  houseInstancedMesh.setMatrixAt(i, dummyObj.matrix);

  // Store into SoA
  const idx = obstacleGlobalIdx++;
  obstacleSoA.positions[idx * 2] = x;
  obstacleSoA.positions[idx * 2 + 1] = z;
  obstacleSoA.radii[idx] = 2.4 * scale; // House radius
  obstacleSoA.states[idx] = 0; // Active
  obstacleSoA.types[idx] = 1;  // House
  obstacleSoA.instanceIndices[idx] = i;
  obstacleSoA.crumbleProgress[idx] = 0;

  const mElements = dummyObj.matrix.elements;
  for (let m = 0; m < 16; m++) {
    obstacleSoA.initialMatrices[idx * 16 + m] = mElements[m];
  }

  insertIntoGrid(idx, x, z);
}
houseInstancedMesh.instanceMatrix.needsUpdate = true;

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

function spawnParticles(x, y, z, colorHex, count = 12) {
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
        particlePool.vy[i] -= 16.0 * dt; // Gravity
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
// 7. CAR KINEMATICS & COLLISION SIMULATION
// ==========================================
const car = {
  x: 0,
  z: 0,
  angle: 0,              // Current yaw angle (radians)
  targetAngle: 0,        // Commanded heading from phone/keys
  currentSpeed: 10.0,    // Current actual speed
  baseCruiseSpeed: 10.0, // Gentle cruise speed
  minSlowdownSpeed: 3.2, // ~30% speed when plowing through obstacles
  collisionCount: 0,
};

let cameraMode = 0; // 0 = Chase, 1 = High, 2 = Cockpit/Top
const cameraOffsets = [
  new THREE.Vector3(0, 8.5, -16.0), // Chase
  new THREE.Vector3(0, 18.0, -26.0),// High overview
  new THREE.Vector3(0, 28.0, -0.1), // Top-down
];

function lerpAngle(from, to, t) {
  let diff = (to - from) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return from + diff * t;
}

const scratchMatrix = new THREE.Matrix4();
const scratchPosition = new THREE.Vector3();
const scratchQuaternion = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const tipAxis = new THREE.Vector3();
const tipQuat = new THREE.Quaternion();

function updateCrumblingObstacles(dt) {
  let treeNeedsUpdate = false;
  let houseNeedsUpdate = false;

  for (let i = 0; i < TOTAL_OBSTACLES; i++) {
    if (obstacleSoA.states[i] === 1) { // Crumbling
      obstacleSoA.crumbleProgress[i] += dt * 2.2; // ~0.45s to collapse

      const progress = Math.min(1.0, obstacleSoA.crumbleProgress[i]);
      const instIdx = obstacleSoA.instanceIndices[i];
      const isHouse = obstacleSoA.types[i] === 1;

      for (let m = 0; m < 16; m++) {
        scratchMatrix.elements[m] = obstacleSoA.initialMatrices[i * 16 + m];
      }
      scratchMatrix.decompose(scratchPosition, scratchQuaternion, scratchScale);

      const tipX = obstacleSoA.tipDirs[i * 2];
      const tipZ = obstacleSoA.tipDirs[i * 2 + 1];
      tipAxis.set(-tipZ, 0, tipX).normalize();
      tipQuat.setFromAxisAngle(tipAxis, progress * (Math.PI * 0.45));
      scratchQuaternion.multiply(tipQuat);

      const currentScaleFactor = Math.max(0.001, (1.0 - progress));
      scratchScale.multiplyScalar(currentScaleFactor);

      scratchPosition.y -= progress * (isHouse ? 1.5 : 2.0);

      scratchMatrix.compose(scratchPosition, scratchQuaternion, scratchScale);

      if (isHouse) {
        houseInstancedMesh.setMatrixAt(instIdx, scratchMatrix);
        houseNeedsUpdate = true;
      } else {
        treeInstancedMesh.setMatrixAt(instIdx, scratchMatrix);
        treeNeedsUpdate = true;
      }

      if (progress >= 1.0) {
        obstacleSoA.states[i] = 2; // Destroyed
      }
    }
  }

  if (treeNeedsUpdate) treeInstancedMesh.instanceMatrix.needsUpdate = true;
  if (houseNeedsUpdate) houseInstancedMesh.instanceMatrix.needsUpdate = true;
}

function checkCollisionsAndDrive(dt) {
  // 1. Smoothly steer towards target angle
  car.angle = lerpAngle(car.angle, car.targetAngle, Math.min(1.0, dt * 5.5));

  // 2. Boundary turning: if near fence, smoothly turn back towards center
  const distFromCenter = Math.sqrt(car.x * car.x + car.z * car.z);
  if (distFromCenter > ARENA_RADIUS - 12) {
    const toCenterAngle = Math.atan2(-car.x, -car.z);
    car.targetAngle = lerpAngle(car.targetAngle, toCenterAngle, 0.15);
  }

  // 3. Move car forward based on currentSpeed
  const forwardX = Math.sin(car.angle);
  const forwardZ = Math.cos(car.angle);

  car.x += forwardX * car.currentSpeed * dt;
  car.z += forwardZ * car.currentSpeed * dt;

  if (distFromCenter > ARENA_RADIUS - 4) {
    const ratio = (ARENA_RADIUS - 4) / distFromCenter;
    car.x *= ratio;
    car.z *= ratio;
  }

  // 4. Query Spatial Grid: Check current cell + immediate 8 neighbors
  const carCellX = Math.floor((car.x + ARENA_SIZE / 2) / GRID_CELL_SIZE);
  const carCellZ = Math.floor((car.z + ARENA_SIZE / 2) / GRID_CELL_SIZE);

  let isCollidingThisFrame = false;
  const carRadius = 1.6;

  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const cx = carCellX + dx;
      const cz = carCellZ + dz;
      if (cx >= 0 && cx < GRID_DIM && cz >= 0 && cz < GRID_DIM) {
        const cellIdx = cz * GRID_DIM + cx;
        const obstaclesInCell = spatialGrid[cellIdx];
        for (let k = 0; k < obstaclesInCell.length; k++) {
          const obsIdx = obstaclesInCell[k];
          if (obstacleSoA.states[obsIdx] === 0) { // Only active obstacles
            const ox = obstacleSoA.positions[obsIdx * 2];
            const oz = obstacleSoA.positions[obsIdx * 2 + 1];
            const dX = car.x - ox;
            const dZ = car.z - oz;
            const distSq = dX * dX + dZ * dZ;
            const minDist = carRadius + obstacleSoA.radii[obsIdx];

            if (distSq < minDist * minDist) {
              isCollidingThisFrame = true;
              obstacleSoA.states[obsIdx] = 1; // Crumbling
              obstacleSoA.crumbleProgress[obsIdx] = 0;
              obstacleSoA.tipDirs[obsIdx * 2] = forwardX;
              obstacleSoA.tipDirs[obsIdx * 2 + 1] = forwardZ;

              const isHouse = obstacleSoA.types[obsIdx] === 1;
              soundEngine.playTopple(isHouse);
              spawnParticles(ox, isHouse ? 2.0 : 3.0, oz, isHouse ? 0xe11d48 : 0x22c55e, 14);

              car.collisionCount++;
              document.getElementById('scoreText').textContent = `${car.collisionCount} Smashed!`;

              if (car.collisionCount % 10 === 0) {
                soundEngine.playCheer();
              }
            }
          }
        }
      }
    }
  }

  // 5. Toddler smooth speed dynamics: slow down slightly when colliding, NEVER stop
  const targetSpeed = isCollidingThisFrame ? car.minSlowdownSpeed : car.baseCruiseSpeed;
  const accelRate = isCollidingThisFrame ? 18.0 : 7.0;
  car.currentSpeed += (targetSpeed - car.currentSpeed) * Math.min(1.0, dt * accelRate);

  soundEngine.updateEnginePitch(car.currentSpeed / car.baseCruiseSpeed);

  // 6. Update Car 3D Transform
  playerCar.position.set(car.x, 0, car.z);
  playerCar.rotation.y = car.angle;

  const wheelRollSpeed = (car.currentSpeed / 0.55) * dt;
  for (let w = 0; w < carWheels.length; w++) {
    carWheels[w].children[0].rotation.x += wheelRollSpeed;
  }

  // 7. Update Chase Camera smoothly
  const activeOffset = cameraOffsets[cameraMode];
  const desiredCamX = car.x - Math.sin(car.angle) * (-activeOffset.z) + Math.cos(car.angle) * activeOffset.x;
  const desiredCamZ = car.z - Math.cos(car.angle) * (-activeOffset.z) - Math.sin(car.angle) * activeOffset.x;
  const desiredCamY = activeOffset.y;

  camera.position.x += (desiredCamX - camera.position.x) * Math.min(1.0, dt * 5.0);
  camera.position.y += (desiredCamY - camera.position.y) * Math.min(1.0, dt * 5.0);
  camera.position.z += (desiredCamZ - camera.position.z) * Math.min(1.0, dt * 5.0);

  const lookTarget = new THREE.Vector3(car.x, 1.5, car.z);
  camera.lookAt(lookTarget);

  sunLight.position.set(car.x + 60, 120, car.z + 80);
  sunLight.target.position.set(car.x, 0, car.z);
}

// ==========================================
// 8. PEERJS WEBRTC PAIRING & INPUT HANDLING
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

// Generate 4-character Room ID
const random4 = Math.random().toString(36).substring(2, 6).toUpperCase();
const fullPeerId = 'toycar-' + random4;
if (roomCodeVal) roomCodeVal.textContent = random4;

const phoneUrl = `${window.location.origin}/phone.html?peer=${fullPeerId}`;
if (phoneControllerLink) phoneControllerLink.href = phoneUrl;

// Render QR Code via QRCode.js
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
      soundEngine.init();
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
          car.targetAngle = data.angle;
          const deg = Math.round((data.angle * 180) / Math.PI);
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
      if (connStatusText) connStatusText.textContent = 'PHONE DISCONNECTED';
      activeConnection = null;
    });
  });

  peer.on('error', (err) => {
    console.warn('Peer error:', err);
  });
}

initHostPeer();

// Keyboard Controls (Desktop Mode / Testing Fallback)
const keysDown = {};
window.addEventListener('keydown', (e) => {
  soundEngine.init();
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
    car.targetAngle -= 2.4 * dt;
    turned = true;
  }
  if (keysDown['arrowright'] || keysDown['d']) {
    car.targetAngle += 2.4 * dt;
    turned = true;
  }
  if (turned) {
    const deg = Math.round((car.targetAngle * 180) / Math.PI);
    if (headingValue) headingValue.textContent = deg + '°';
    if (!activeConnection && inputModeValue) {
      inputModeValue.textContent = 'Keyboard Mode';
    }
  }
}

// UI Event Listeners
if (desktopModeBtn) {
  desktopModeBtn.addEventListener('click', () => {
    soundEngine.init();
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
    soundEngine.init();
    const isMuted = soundEngine.toggleMute();
    audioToggleBtn.textContent = isMuted ? '🔇' : '🔊';
  });
}

const cameraToggleBtn = document.getElementById('cameraToggleBtn');
if (cameraToggleBtn) {
  cameraToggleBtn.addEventListener('click', () => {
    cameraMode = (cameraMode + 1) % cameraOffsets.length;
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
// 9. ANIMATION LOOP & RESIZE HANDLING
// ==========================================
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(0.1, clock.getDelta());

  handleKeyboardInput(dt);
  checkCollisionsAndDrive(dt);
  updateCrumblingObstacles(dt);
  updateParticles(dt);

  if (speedValue) {
    speedValue.textContent = car.currentSpeed.toFixed(1) + ' m/s';
  }

  renderer.render(scene, camera);
}

animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
