/* Mobile Steering Controller Logic with 3D Orientation, Top-Down Game View & Remote Control */

// --- State & Variables ---
let zeroAlpha = 0;               // Calibration yaw (degrees)
let zeroBeta = 0;                // Calibration pitch (degrees)
let zeroGamma = 0;               // Calibration roll (degrees)

let currentRawAlpha = 0;
let currentRawBeta = 0;
let currentRawGamma = 0;

let relativeYawDeg = 0;          // Relative yaw [-180, 180]
let relativePitchRad = 0;        // Relative pitch
let relativeRollRad = 0;         // Relative roll
let manualOffsetDeg = 0;         // Touch slider tweak

let invertSteering = localStorage.getItem('toycar_invert_steering') === '1';

// View Mode: 'top_down' (default for kid) or 'sensors' (for parent/tuning)
let currentViewMode = localStorage.getItem('toycar_phone_view') || 'top_down';

// Toddler Screen Lock
let isScreenLocked = localStorage.getItem('toycar_phone_locked') !== '0';

// Active vehicle info received from PC
let currentVehicleInfo = {
  id: 'car',
  name: 'Toy Sports Car',
  icon: '🏎️',
  baseSpeed: 11.0,
};

// God Mode / Physical Lift & Toss Settings
let godModeEnabled = localStorage.getItem('toycar_god_mode') !== '0';
let liftForceEnabled = localStorage.getItem('toycar_lift_force') !== '0';
let tossForceEnabled = localStorage.getItem('toycar_toss_force') !== '0';

let hasSensors = false;
let peer = null;
let conn = null;
let wakeLock = null;
let sendInterval = null;
let reconnectTimer = null;

// Accelerometer state for forward push boost & lift
let lastMotionTime = 0;

// Elements
const topDownView = document.getElementById('topDownView');
const topDownCanvas = document.getElementById('topDownCanvas');
const topDownStatusText = document.getElementById('topDownStatusText');
const toddlerLockBtn = document.getElementById('toddlerLockBtn');
const lockStatusText = document.getElementById('lockStatusText');
const btnSwitchToSensors = document.getElementById('btnSwitchToSensors');
const topDownVehicleIcon = document.getElementById('topDownVehicleIcon');
const topDownSpeedText = document.getElementById('topDownSpeedText');
const topDownHonkBtn = document.getElementById('topDownHonkBtn');

const sensorsView = document.getElementById('sensorsView');
const btnBackToTopDown = document.getElementById('btnBackToTopDown');
const calibrationOverlay = document.getElementById('calibrationOverlay');
const startCalibrateBtn = document.getElementById('startCalibrateBtn');
const statusBadge = document.getElementById('statusBadge');
const statusText = document.getElementById('statusText');
const peerBadge = document.getElementById('peerBadge');
const compassArrowWrap = document.getElementById('compassArrowWrap');
const steerDeg = document.getElementById('steerDeg');
const steerLabel = document.getElementById('steerLabel');
const recenterBtn = document.getElementById('recenterBtn');
const honkBtn = document.getElementById('honkBtn');
const invertBtn = document.getElementById('invertBtn');
const godModeBtn = document.getElementById('godModeBtn');
const toggleLiftBtn = document.getElementById('toggleLiftBtn');
const toggleTossBtn = document.getElementById('toggleTossBtn');
const tossTestBtn = document.getElementById('tossTestBtn');
const touchSlider = document.getElementById('touchSlider');
const sliderValue = document.getElementById('sliderValue');
const manualCodeModal = document.getElementById('manualCodeModal');
const manualCodeInput = document.getElementById('manualCodeInput');
const manualCodeSubmit = document.getElementById('manualCodeSubmit');
const changeRoomBtn = document.getElementById('changeRoomBtn');

// 1. Persistent Pairing: Parse URL params or read remembered code
const urlParams = new URLSearchParams(window.location.search);
let targetPeerId = urlParams.get('peer');

if (targetPeerId) {
  if (!targetPeerId.startsWith('toycar-') && targetPeerId.length <= 6) {
    targetPeerId = 'toycar-' + targetPeerId;
  }
  localStorage.setItem('toycar_last_peer', targetPeerId);
} else {
  const savedPeer = localStorage.getItem('toycar_last_peer');
  if (savedPeer) {
    targetPeerId = savedPeer;
  }
}

// 2. View Mode Switcher
function updateViewModeUI() {
  if (currentViewMode === 'top_down') {
    if (topDownView) topDownView.style.display = 'flex';
    if (sensorsView) sensorsView.style.display = 'none';
  } else {
    if (topDownView) topDownView.style.display = 'none';
    if (sensorsView) sensorsView.style.display = 'flex';
  }
  localStorage.setItem('toycar_phone_view', currentViewMode);
}

if (btnSwitchToSensors) {
  btnSwitchToSensors.addEventListener('click', () => {
    if (isScreenLocked) {
      flashLockHint();
      return;
    }
    currentViewMode = 'sensors';
    updateViewModeUI();
  });
}

if (btnBackToTopDown) {
  btnBackToTopDown.addEventListener('click', () => {
    currentViewMode = 'top_down';
    updateViewModeUI();
  });
}

// 3. Toddler Lock Logic
function updateLockUI() {
  if (!toddlerLockBtn) return;
  if (isScreenLocked) {
    toddlerLockBtn.classList.remove('unlocked');
    if (lockStatusText) lockStatusText.textContent = 'LOCKED';
    toddlerLockBtn.querySelector('span:first-child').textContent = '🔒';
  } else {
    toddlerLockBtn.classList.add('unlocked');
    if (lockStatusText) lockStatusText.textContent = 'UNLOCKED';
    toddlerLockBtn.querySelector('span:first-child').textContent = '🔓';
  }
}

function flashLockHint() {
  if (navigator.vibrate) navigator.vibrate(40);
  if (lockStatusText) {
    const original = lockStatusText.textContent;
    lockStatusText.textContent = 'HOLD 2s TO UNLOCK';
    setTimeout(() => {
      lockStatusText.textContent = original;
    }, 1500);
  }
}

let lockPressTimer = null;
if (toddlerLockBtn) {
  toddlerLockBtn.addEventListener('touchstart', (e) => {
    e.preventDefault();
    lockPressTimer = setTimeout(() => {
      isScreenLocked = !isScreenLocked;
      localStorage.setItem('toycar_phone_locked', isScreenLocked ? '1' : '0');
      updateLockUI();
      if (navigator.vibrate) navigator.vibrate([60, 40, 80]);
    }, 1400);
  });

  toddlerLockBtn.addEventListener('touchend', () => {
    clearTimeout(lockPressTimer);
  });

  toddlerLockBtn.addEventListener('click', () => {
    if (isScreenLocked) {
      flashLockHint();
    } else {
      isScreenLocked = true;
      localStorage.setItem('toycar_phone_locked', '1');
      updateLockUI();
    }
  });
}

updateLockUI();
updateViewModeUI();

// 4. Invert Button UI
function updateInvertBtnUI() {
  if (!invertBtn) return;
  if (invertSteering) {
    invertBtn.classList.add('active');
    invertBtn.innerHTML = '<span>🔄</span><span>INVERT: ON</span>';
  } else {
    invertBtn.classList.remove('active');
    invertBtn.innerHTML = '<span>🔄</span><span>INVERT: OFF</span>';
  }
}
updateInvertBtnUI();

if (invertBtn) {
  invertBtn.addEventListener('click', () => {
    if (navigator.vibrate) navigator.vibrate(30);
    invertSteering = !invertSteering;
    localStorage.setItem('toycar_invert_steering', invertSteering ? '1' : '0');
    updateInvertBtnUI();
    compute3DOrientation();
  });
}

// God Mode / Toss Controls UI
function updateGodModeUI() {
  if (godModeBtn) {
    if (godModeEnabled) {
      godModeBtn.classList.add('active');
      godModeBtn.innerHTML = '<span>🚀</span><span>TOSS/BOOST: ON</span>';
    } else {
      godModeBtn.classList.remove('active');
      godModeBtn.innerHTML = '<span>🚀</span><span>TOSS/BOOST: OFF</span>';
    }
  }
  if (toggleLiftBtn) {
    toggleLiftBtn.classList.toggle('active', liftForceEnabled);
    toggleLiftBtn.textContent = `Lift: ${liftForceEnabled ? 'ON' : 'OFF'}`;
  }
  if (toggleTossBtn) {
    toggleTossBtn.classList.toggle('active', tossForceEnabled);
    toggleTossBtn.textContent = `Push: ${tossForceEnabled ? 'ON' : 'OFF'}`;
  }
}
updateGodModeUI();

if (godModeBtn) {
  godModeBtn.addEventListener('click', () => {
    if (navigator.vibrate) navigator.vibrate(30);
    godModeEnabled = !godModeEnabled;
    localStorage.setItem('toycar_god_mode', godModeEnabled ? '1' : '0');
    updateGodModeUI();
  });
}

if (toggleLiftBtn) {
  toggleLiftBtn.addEventListener('click', () => {
    liftForceEnabled = !liftForceEnabled;
    localStorage.setItem('toycar_lift_force', liftForceEnabled ? '1' : '0');
    updateGodModeUI();
  });
}

if (toggleTossBtn) {
  toggleTossBtn.addEventListener('click', () => {
    tossForceEnabled = !tossForceEnabled;
    localStorage.setItem('toycar_toss_force', tossForceEnabled ? '1' : '0');
    updateGodModeUI();
  });
}

// Manual Code Modal
if (!targetPeerId) {
  if (manualCodeModal) manualCodeModal.style.display = 'flex';
  if (manualCodeSubmit) {
    manualCodeSubmit.addEventListener('click', () => {
      const code = manualCodeInput.value.trim().toUpperCase();
      if (code) {
        targetPeerId = code.startsWith('toycar-') ? code : ('toycar-' + code);
        localStorage.setItem('toycar_last_peer', targetPeerId);
        manualCodeModal.style.display = 'none';
        initPeerConnection();
      }
    });
  }
} else {
  initPeerConnection();
}

if (changeRoomBtn) {
  changeRoomBtn.addEventListener('click', () => {
    localStorage.removeItem('toycar_last_peer');
    if (conn) conn.close();
    if (manualCodeModal) manualCodeModal.style.display = 'flex';
  });
}

// 5. PeerJS WebRTC Connection
function initPeerConnection() {
  const shortCode = targetPeerId.replace('toycar-', '');
  if (peerBadge) peerBadge.textContent = 'ROOM: ' + shortCode;
  updateStatus('CONNECTING...', 'connecting');

  const myId = 'ctrl-' + Math.random().toString(36).substring(2, 8);
  if (!window.Peer) {
    console.warn('PeerJS not loaded');
    return;
  }

  peer = new Peer(myId, {
    debug: 1,
  });

  peer.on('open', () => {
    connectToHost();
  });

  peer.on('error', (err) => {
    console.warn('Peer error:', err);
    updateStatus('RECONNECTING...', 'disconnected');
    scheduleReconnect();
  });
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connectToHost, 3000);
}

function connectToHost() {
  if (!peer || peer.destroyed) return;
  updateStatus('CONNECTING...', 'connecting');

  conn = peer.connect(targetPeerId, {
    reliable: true,
  });

  conn.on('open', () => {
    updateStatus('CONNECTED! 🟢', 'connected');
    conn.send({ type: 'hello', client: 'mobile-controller' });
    startTransmissionLoop();
  });

  // Listen for parent remote commands & vehicle info from PC!
  conn.on('data', (data) => {
    if (!data) return;
    if (data.type === 'parent_command') {
      if (data.action === 'toggle_view') {
        currentViewMode = data.mode || (currentViewMode === 'top_down' ? 'sensors' : 'top_down');
        updateViewModeUI();
      } else if (data.action === 'toggle_invert') {
        invertSteering = typeof data.invert === 'boolean' ? data.invert : !invertSteering;
        localStorage.setItem('toycar_invert_steering', invertSteering ? '1' : '0');
        updateInvertBtnUI();
        compute3DOrientation();
      } else if (data.action === 'recenter') {
        calibrateSensors();
        if (navigator.vibrate) navigator.vibrate([30, 30, 30]);
      } else if (data.action === 'toggle_lock') {
        isScreenLocked = typeof data.locked === 'boolean' ? data.locked : !isScreenLocked;
        localStorage.setItem('toycar_phone_locked', isScreenLocked ? '1' : '0');
        updateLockUI();
      } else if (data.action === 'honk') {
        triggerHonk();
      } else if (data.action === 'update_vehicle') {
        if (data.vehicle) {
          currentVehicleInfo = data.vehicle;
          if (topDownVehicleIcon) topDownVehicleIcon.textContent = data.vehicle.icon || '🏎️';
          if (topDownSpeedText) topDownSpeedText.textContent = (data.vehicle.baseSpeed || 11.0).toFixed(1) + ' m/s';
        }
      }
    }
  });

  conn.on('close', () => {
    updateStatus('DISCONNECTED (Retrying...)', 'disconnected');
    clearInterval(sendInterval);
    scheduleReconnect();
  });

  conn.on('error', (err) => {
    console.warn('Connection error:', err);
    updateStatus('RECONNECTING...', 'disconnected');
    scheduleReconnect();
  });
}

function updateStatus(text, state) {
  if (statusText) statusText.textContent = text;
  if (topDownStatusText) topDownStatusText.textContent = text;
  if (statusBadge) statusBadge.className = 'status-badge ' + state;
}

// 6. Full 3D Orientation (Yaw, Pitch, Roll) with Deadzone Calibration
function handleOrientation(e) {
  hasSensors = true;

  // Yaw: iOS Compass Heading or Alpha
  if (typeof e.webkitCompassHeading !== 'undefined' && e.webkitCompassHeading !== null) {
    currentRawAlpha = e.webkitCompassHeading;
  } else if (typeof e.alpha !== 'undefined' && e.alpha !== null) {
    currentRawAlpha = (360 - e.alpha) % 360;
  }

  // Pitch (Front-to-back tilt) & Roll (Left-to-right tilt)
  if (typeof e.beta !== 'undefined' && e.beta !== null) {
    currentRawBeta = e.beta;
  }
  if (typeof e.gamma !== 'undefined' && e.gamma !== null) {
    currentRawGamma = e.gamma;
  }

  compute3DOrientation();
}

function compute3DOrientation() {
  // 1. Yaw (Compass heading)
  let diffAlpha = currentRawAlpha - zeroAlpha;
  while (diffAlpha > 180) diffAlpha -= 360;
  while (diffAlpha < -180) diffAlpha += 360;

  if (invertSteering) {
    diffAlpha = -diffAlpha;
  }

  let totalYaw = diffAlpha + manualOffsetDeg;
  while (totalYaw > 180) totalYaw -= 360;
  while (totalYaw < -180) totalYaw += 360;

  relativeYawDeg = totalYaw;

  // 2. Pitch & Roll (relative to calibrated flat position)
  let diffBetaDeg = currentRawBeta - zeroBeta;
  let diffGammaDeg = currentRawGamma - zeroGamma;

  if (invertSteering) {
    diffBetaDeg = -diffBetaDeg;
    diffGammaDeg = -diffGammaDeg;
  }

  relativePitchRad = (diffBetaDeg * Math.PI) / 180;
  relativeRollRad = (diffGammaDeg * Math.PI) / 180;

  renderDial();
}

function renderDial() {
  if (compassArrowWrap) {
    compassArrowWrap.style.transform = `rotate(${relativeYawDeg}deg)`;
  }

  const rounded = Math.round(relativeYawDeg);
  if (steerDeg) {
    steerDeg.textContent = (rounded > 0 ? '+' : '') + rounded + '°';
  }

  const isUpsideDown = Math.abs(relativeRollRad) > 1.3 || Math.abs(relativePitchRad) > 1.3;

  if (steerLabel) {
    if (isUpsideDown) {
      steerLabel.textContent = '⚠️ FLIPPED UPSIDE DOWN!';
      steerLabel.style.color = '#f87171';
    } else if (Math.abs(rounded) < 7) {
      steerLabel.textContent = 'STRAIGHT AHEAD';
      steerLabel.style.color = '#34d399';
    } else if (rounded > 0) {
      steerLabel.textContent = 'TURNING RIGHT ▶';
      steerLabel.style.color = '#38bdf8';
    } else {
      steerLabel.textContent = '◀ TURNING LEFT';
      steerLabel.style.color = '#38bdf8';
    }
  }
}

// 7. Motion: Forward Push Boost & Vertical Lift
function handleMotion(e) {
  if (!godModeEnabled) return;

  const now = Date.now();
  if (now - lastMotionTime < 140) return;

  let ax = 0, ay = 0, az = 0;
  if (e.acceleration && (e.acceleration.x !== null || e.acceleration.y !== null || e.acceleration.z !== null)) {
    ax = e.acceleration.x || 0;
    ay = e.acceleration.y || 0;
    az = e.acceleration.z || 0;
  } else if (e.accelerationIncludingGravity) {
    ax = e.accelerationIncludingGravity.x || 0;
    ay = e.accelerationIncludingGravity.y || 0;
    az = (e.accelerationIncludingGravity.z || 0) - 9.8;
  } else {
    return;
  }

  let triggered = false;
  let liftForce = 0;
  let pushForce = 0;

  if (tossForceEnabled) {
    const forwardAy = invertSteering ? -ay : ay;
    const planarJerk = Math.hypot(ax, ay);

    if (forwardAy > 2.4 || planarJerk > 5.2) {
      pushForce = Math.min(24.0, Math.max(forwardAy * 1.8, planarJerk * 1.2));
      triggered = true;
    }
  }

  if (liftForceEnabled) {
    const verticalMag = Math.abs(az);
    if (verticalMag > 4.8) {
      liftForce = Math.min(26.0, verticalMag * 1.2);
      triggered = true;
    }
  }

  if (triggered && conn && conn.open) {
    lastMotionTime = now;
    if (navigator.vibrate) navigator.vibrate([40, 20, 50]);

    conn.send({
      type: 'god_motion',
      lift: liftForce,
      push: pushForce,
      timestamp: now,
    });
  }
}

// 8. Continuous Transmission Loop at 40Hz
function startTransmissionLoop() {
  clearInterval(sendInterval);
  sendInterval = setInterval(() => {
    if (!conn || !conn.open) return;
    const yawRad = (relativeYawDeg * Math.PI) / 180;
    conn.send({
      type: 'steer',
      angle: yawRad,
      pitch: relativePitchRad,
      roll: relativeRollRad,
      degrees: relativeYawDeg,
      timestamp: Date.now()
    });
  }, 25);
}

// 9. Wake Lock
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        console.log('WakeLock released');
      });
    }
  } catch (err) {
    console.warn('WakeLock not granted:', err);
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && calibrationOverlay && calibrationOverlay.style.display === 'none') {
    requestWakeLock();
  }
});

// 10. Calibration
function calibrateSensors() {
  zeroAlpha = currentRawAlpha;
  zeroBeta = currentRawBeta;
  zeroGamma = currentRawGamma;
  manualOffsetDeg = 0;
  if (touchSlider) touchSlider.value = 0;
  if (sliderValue) sliderValue.textContent = '0°';
  compute3DOrientation();
}

if (startCalibrateBtn) {
  startCalibrateBtn.addEventListener('click', async () => {
    if (navigator.vibrate) navigator.vibrate(50);

    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        await DeviceOrientationEvent.requestPermission();
      } catch (err) {
        console.warn('Orientation permission error:', err);
      }
    }

    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        await DeviceMotionEvent.requestPermission();
      } catch (err) {
        console.warn('Motion permission error:', err);
      }
    }

    window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    window.addEventListener('deviceorientation', handleOrientation, true);
    window.addEventListener('devicemotion', handleMotion, true);

    calibrateSensors();
    requestWakeLock();

    if (calibrationOverlay) calibrationOverlay.style.display = 'none';
  });
}

if (recenterBtn) {
  recenterBtn.addEventListener('click', () => {
    if (navigator.vibrate) navigator.vibrate([25, 50, 25]);
    calibrateSensors();
  });
}

function triggerHonk() {
  if (navigator.vibrate) navigator.vibrate([80, 40, 100]);
  if (conn && conn.open) {
    conn.send({ type: 'horn', timestamp: Date.now() });
  }
}

if (honkBtn) honkBtn.addEventListener('click', triggerHonk);
if (topDownHonkBtn) topDownHonkBtn.addEventListener('click', triggerHonk);

if (tossTestBtn) {
  tossTestBtn.addEventListener('click', () => {
    if (navigator.vibrate) navigator.vibrate([50, 20, 60]);
    if (conn && conn.open) {
      conn.send({
        type: 'god_motion',
        lift: 16.0,
        push: 18.0,
        timestamp: Date.now(),
      });
    }
  });
}

if (touchSlider) {
  touchSlider.addEventListener('input', (e) => {
    manualOffsetDeg = parseFloat(e.target.value);
    if (sliderValue) sliderValue.textContent = manualOffsetDeg + '°';
    compute3DOrientation();
  });
}

// ==========================================
// 11. TOP-DOWN 2D CAR DRIVING SIMULATION
// ==========================================
let roadScrollOffset = 0;
let lastFrameTime = performance.now();

function setupTopDownCanvas() {
  if (!topDownCanvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  topDownCanvas.width = window.innerWidth * dpr;
  topDownCanvas.height = window.innerHeight * dpr;
}

window.addEventListener('resize', setupTopDownCanvas);
setupTopDownCanvas();

// Tap anywhere on canvas to honk
if (topDownCanvas) {
  topDownCanvas.addEventListener('pointerdown', (e) => {
    // Avoid clicking buttons
    if (e.target !== topDownCanvas) return;
    triggerHonk();
  });
}

function drawTopDownCar(ctx, cx, cy, vehicleId) {
  ctx.save();
  ctx.translate(cx, cy);

  // Top-down rotation matching compass heading!
  const rotationRad = (relativeYawDeg * Math.PI) / 180;
  ctx.rotate(rotationRad);

  // Drop shadow
  ctx.fillStyle = 'rgba(15, 23, 42, 0.25)';
  ctx.beginPath();
  ctx.roundRect(-28, -50, 56, 100, 14);
  ctx.fill();

  if (vehicleId === 'bus') {
    // Yellow School Bus
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-29, -36, 7, 20); // Wheels
    ctx.fillRect(22, -36, 7, 20);
    ctx.fillRect(-29, 22, 7, 20);
    ctx.fillRect(22, 22, 7, 20);

    // Body
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.roundRect(-25, -55, 50, 110, 12);
    ctx.fill();

    // Windshield & Windows
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(-20, -50, 40, 14); // Front windshield
    for (let wy = -28; wy <= 34; wy += 14) {
      ctx.fillRect(-22, wy, 8, 8);
      ctx.fillRect(14, wy, 8, 8);
    }
    // Headlights
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(-20, -56, 8, 4);
    ctx.fillRect(12, -56, 8, 4);
  } else if (vehicleId === 'truck') {
    // Heavy Dump Truck
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(-28, -38, 8, 20);
    ctx.fillRect(20, -38, 8, 20);
    ctx.fillRect(-28, 12, 8, 18);
    ctx.fillRect(20, 12, 8, 18);
    ctx.fillRect(-28, 32, 8, 18);
    ctx.fillRect(20, 32, 8, 18);

    // Cabin
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.roundRect(-24, -52, 48, 36, 8);
    ctx.fill();

    // Windshield
    ctx.fillStyle = '#bae6fd';
    ctx.fillRect(-18, -48, 36, 12);

    // Cargo Bed
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.roundRect(-23, -12, 46, 64, 4);
    ctx.fill();
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(-18, -8, 36, 56);
  } else if (vehicleId === 'tractor') {
    // Farm Tractor
    // Big rear wheels
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-34, 10, 12, 34);
    ctx.fillRect(22, 10, 12, 34);
    // Small front wheels
    ctx.fillRect(-24, -40, 8, 18);
    ctx.fillRect(16, -40, 8, 18);

    // Engine Hood
    ctx.fillStyle = '#22c55e';
    ctx.beginPath();
    ctx.roundRect(-16, -46, 32, 54, 8);
    ctx.fill();

    // Driver Seat / Cabin
    ctx.fillStyle = '#15803d';
    ctx.fillRect(-18, 10, 36, 30);

    // Exhaust Pipe
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.arc(10, -28, 5, 0, Math.PI * 2);
    ctx.fill();
  } else if (vehicleId === 'excavator') {
    // Yellow Excavator with Tracks
    ctx.fillStyle = '#0f172a'; // Tracks
    ctx.fillRect(-30, -48, 12, 96);
    ctx.fillRect(18, -48, 12, 96);

    // Center Cabin
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.roundRect(-16, -26, 32, 52, 6);
    ctx.fill();

    // Glass
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(-14, -22, 14, 18);

    // Boom arm
    ctx.fillStyle = '#eab308';
    ctx.fillRect(2, -44, 8, 36);

    // Bucket
    ctx.fillStyle = '#475569';
    ctx.fillRect(-4, -58, 20, 14);
  } else {
    // Default Toy Sports Car
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-28, -32, 7, 18);
    ctx.fillRect(21, -32, 7, 18);
    ctx.fillRect(-28, 18, 7, 18);
    ctx.fillRect(21, 18, 7, 18);

    // Body
    ctx.fillStyle = '#f43f5e';
    ctx.beginPath();
    ctx.roundRect(-23, -48, 46, 96, 14);
    ctx.fill();

    // Windshield
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.roundRect(-17, -26, 34, 22, 6);
    ctx.fill();

    // Rear Spoiler
    ctx.fillStyle = '#be123c';
    ctx.fillRect(-21, 38, 42, 8);

    // Headlights
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(-18, -49, 8, 4);
    ctx.fillRect(10, -49, 8, 4);
  }

  // Front Heading Arrow indicator
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.moveTo(0, -70);
  ctx.lineTo(-10, -56);
  ctx.lineTo(10, -56);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function renderTopDownLoop(timestamp) {
  requestAnimationFrame(renderTopDownLoop);
  if (!topDownCanvas || currentViewMode !== 'top_down') return;

  const dt = Math.min((timestamp - lastFrameTime) / 1000, 0.1);
  lastFrameTime = timestamp;

  const ctx = topDownCanvas.getContext('2d');
  const w = topDownCanvas.width;
  const h = topDownCanvas.height;

  // Cruise forward scroll
  const speed = (currentVehicleInfo.baseSpeed || 11.0) * 16.0;
  roadScrollOffset = (roadScrollOffset + speed * dt) % 120;

  // 1. Meadow green ground
  ctx.fillStyle = '#86efac';
  ctx.fillRect(0, 0, w, h);

  // 2. Checker grass tile accents
  ctx.fillStyle = '#6ee7b7';
  const tileSize = 60;
  for (let x = 0; x < w; x += tileSize) {
    for (let y = (roadScrollOffset % tileSize) - tileSize; y < h; y += tileSize) {
      if (((x / tileSize) + Math.floor(y / tileSize)) % 2 === 0) {
        ctx.fillRect(x, y, tileSize, tileSize);
      }
    }
  }

  // 3. Wide Asphalt Road centered vertically
  const roadWidth = Math.min(w * 0.65, 340);
  const roadX = (w - roadWidth) / 2;

  // Curbs
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(roadX - 8, 0, roadWidth + 16, h);

  // Asphalt
  ctx.fillStyle = '#334155';
  ctx.fillRect(roadX, 0, roadWidth, h);

  // White edge lines
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(roadX + 8, 0, 4, h);
  ctx.fillRect(roadX + roadWidth - 12, 0, 4, h);

  // Yellow dashed centerline
  ctx.fillStyle = '#facc15';
  const dashLength = 40;
  const gap = 30;
  const totalDash = dashLength + gap;
  const startY = (roadScrollOffset % totalDash) - totalDash;
  for (let y = startY; y < h; y += totalDash) {
    ctx.fillRect(w / 2 - 3, y, 6, dashLength);
  }

  // 4. Little roadside trees
  ctx.fillStyle = '#15803d';
  for (let y = ((roadScrollOffset * 0.8) % 180) - 180; y < h; y += 180) {
    ctx.beginPath();
    ctx.arc(roadX - 35, y + 50, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(roadX + roadWidth + 35, y + 110, 16, 0, Math.PI * 2);
    ctx.fill();
  }

  // 5. Draw Selected Top-Down Car in the middle of phone screen
  drawTopDownCar(ctx, w / 2, h / 2, currentVehicleInfo.id);
}

requestAnimationFrame(renderTopDownLoop);
