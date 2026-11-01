/* Mobile Steering Controller Logic with 3D Orientation, Push Boost & Persistent Pairing */

// --- State & Variables ---
let zeroAlpha = 0;               // Calibration yaw (degrees)
let zeroBeta = 0;                // Calibration pitch (degrees)
let zeroGamma = 0;               // Calibration roll (degrees)

let currentRawAlpha = 0;
let currentRawBeta = 0;
let currentRawGamma = 0;

let relativeYawDeg = 0;          // Relative yaw [-180, 180]
let relativePitchRad = 0;        // Relative pitch (front-back tilt)
let relativeRollRad = 0;         // Relative roll (left-right tilt)
let manualOffsetDeg = 0;         // Touch slider tweak

let invertSteering = localStorage.getItem('toycar_invert_steering') === '1';

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

// Invert Button UI
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
    toggleLiftBtn.textContent = `Lift/Jump: ${liftForceEnabled ? 'ON' : 'OFF'}`;
  }
  if (toggleTossBtn) {
    toggleTossBtn.classList.toggle('active', tossForceEnabled);
    toggleTossBtn.textContent = `Push Boost: ${tossForceEnabled ? 'ON' : 'OFF'}`;
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

// --- PeerJS WebRTC Connection ---
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
    if (err.type === 'peer-unavailable') {
      updateStatus('CAR OFFLINE', 'disconnected');
      scheduleReconnect();
    } else {
      updateStatus('RECONNECTING...', 'disconnected');
      scheduleReconnect();
    }
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
    updateStatus('CONNECTED & STEERING! 🟢', 'connected');
    conn.send({ type: 'hello', client: 'mobile-controller' });
    startTransmissionLoop();
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
  if (statusBadge) statusBadge.className = 'status-badge ' + state;
}

// --- Full 3D Orientation (Yaw, Pitch, Roll) ---
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
  // When kid tilts or flips phone upside down, the 3D car reflects that!
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

  // Check if car is upside down or tilted in an accident
  const isUpsideDown = Math.abs(relativeRollRad) > 1.4 || Math.abs(relativePitchRad) > 1.4;

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

// --- Motion: Forward Push Boost & Vertical Lift Detection ---
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

  // 1. Forward Push Force: when kid shoves the phone forward, give a forward speed boost!
  if (tossForceEnabled) {
    // When invert is active (phone turned 180°), forward push is opposite along phone Y
    const forwardAy = invertSteering ? -ay : ay;
    const planarJerk = Math.hypot(ax, ay);

    if (forwardAy > 2.4 || planarJerk > 5.2) {
      pushForce = Math.min(24.0, Math.max(forwardAy * 1.8, planarJerk * 1.2));
      triggered = true;
    }
  }

  // 2. Vertical Lift: when kid lifts phone off the table/car
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

// --- Continuous Transmission at 45Hz ---
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

// --- Wake Lock ---
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

// --- Calibrate / Re-Center Function ---
function calibrateSensors() {
  zeroAlpha = currentRawAlpha;
  zeroBeta = currentRawBeta;
  zeroGamma = currentRawGamma;
  manualOffsetDeg = 0;
  if (touchSlider) touchSlider.value = 0;
  if (sliderValue) sliderValue.textContent = '0°';
  compute3DOrientation();
}

// Start & Calibrate Button
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

    // Initial calibration
    calibrateSensors();
    requestWakeLock();

    if (calibrationOverlay) calibrationOverlay.style.display = 'none';
  });
}

// Re-Center / Calibrate Button
if (recenterBtn) {
  recenterBtn.addEventListener('click', () => {
    if (navigator.vibrate) navigator.vibrate([25, 50, 25]);
    calibrateSensors();
  });
}

// Honk Horn Button
if (honkBtn) {
  honkBtn.addEventListener('click', () => {
    if (navigator.vibrate) navigator.vibrate([80, 40, 100]);
    if (conn && conn.open) {
      conn.send({ type: 'horn', timestamp: Date.now() });
    }
  });
}

// Test Push / Jump Button
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

// Touch Slider Fallback
if (touchSlider) {
  touchSlider.addEventListener('input', (e) => {
    manualOffsetDeg = parseFloat(e.target.value);
    if (sliderValue) sliderValue.textContent = manualOffsetDeg + '°';
    compute3DOrientation();
  });
}
