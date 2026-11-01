/* Mobile Steering Controller Logic with Invert, God Mode Motion & Persistent Pairing */

// --- State & Variables ---
let zeroOffset = 0;              // Calibration heading in degrees
let currentRawHeading = 0;       // Most recently read physical compass heading
let relativeAngleDeg = 0;        // Relative angle (degrees) [-180, 180]
let manualOffsetDeg = 0;         // Slider or manual tweak
let invertSteering = localStorage.getItem('toycar_invert_steering') === '1';

// God Mode / Physical Lift & Toss Settings
let godModeEnabled = localStorage.getItem('toycar_god_mode') !== '0'; // default ON
let liftForceEnabled = localStorage.getItem('toycar_lift_force') !== '0'; // default ON
let tossForceEnabled = localStorage.getItem('toycar_toss_force') !== '0'; // default ON

let hasSensors = false;
let peer = null;
let conn = null;
let wakeLock = null;
let sendInterval = null;
let reconnectTimer = null;

// Accelerometer state for throw / lift detection
let lastMotionTime = 0;
let lastAccel = { x: 0, y: 0, z: 0 };

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
    computeRelativeAngle();
  });
}

// God Mode / Toss Controls UI
function updateGodModeUI() {
  if (godModeBtn) {
    if (godModeEnabled) {
      godModeBtn.classList.add('active');
      godModeBtn.innerHTML = '<span>🚀</span><span>GOD MODE: ON</span>';
    } else {
      godModeBtn.classList.remove('active');
      godModeBtn.innerHTML = '<span>🚀</span><span>GOD MODE: OFF</span>';
    }
  }
  if (toggleLiftBtn) {
    toggleLiftBtn.classList.toggle('active', liftForceEnabled);
    toggleLiftBtn.textContent = `Lift (Up/Down): ${liftForceEnabled ? 'ON' : 'OFF'}`;
  }
  if (toggleTossBtn) {
    toggleTossBtn.classList.toggle('active', tossForceEnabled);
    toggleTossBtn.textContent = `Toss (Push/Slam): ${tossForceEnabled ? 'ON' : 'OFF'}`;
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

// --- Heading & DeviceOrientation Handling ---
function handleOrientation(e) {
  hasSensors = true;
  let rawHeading = null;

  if (typeof e.webkitCompassHeading !== 'undefined' && e.webkitCompassHeading !== null) {
    rawHeading = e.webkitCompassHeading;
  } else if (typeof e.alpha !== 'undefined' && e.alpha !== null) {
    rawHeading = (360 - e.alpha) % 360;
  }

  if (rawHeading !== null && !isNaN(rawHeading)) {
    currentRawHeading = rawHeading;
    computeRelativeAngle();
  }
}

// --- Physical Lift & Throw Motion Handling (God Mode) ---
function handleMotion(e) {
  if (!godModeEnabled) return;

  const now = Date.now();
  // Throttle motion impulse triggers to max once per 200ms
  if (now - lastMotionTime < 200) return;

  // Use linear acceleration if available, or accelerationIncludingGravity
  const acc = e.acceleration || e.accelerationIncludingGravity;
  if (!acc) return;

  const ax = acc.x || 0;
  const ay = acc.y || 0;
  const az = acc.z || 0;

  let triggered = false;
  let liftForce = 0;
  let tossForce = 0;

  // 1. Vertical Lift Force (Z or Y spike upward)
  if (liftForceEnabled) {
    const verticalMag = Math.max(Math.abs(az), Math.abs(ay));
    if (verticalMag > 6.0) {
      liftForce = Math.min(25.0, verticalMag);
      triggered = true;
    }
  }

  // 2. Lateral Throw Force (Forward push or side toss)
  if (tossForceEnabled) {
    const horizMag = Math.sqrt(ax * ax + ay * ay);
    if (horizMag > 7.0) {
      tossForce = Math.min(25.0, horizMag);
      triggered = true;
    }
  }

  if (triggered && conn && conn.open) {
    lastMotionTime = now;
    if (navigator.vibrate) navigator.vibrate([40, 20, 60]);

    conn.send({
      type: 'god_motion',
      lift: liftForce,
      toss: tossForce,
      ax, ay, az,
      timestamp: now,
    });
  }
}

function computeRelativeAngle() {
  let diff = currentRawHeading - zeroOffset;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;

  if (invertSteering) {
    diff = -diff;
  }

  let totalAngle = diff + manualOffsetDeg;
  while (totalAngle > 180) totalAngle -= 360;
  while (totalAngle < -180) totalAngle += 360;

  relativeAngleDeg = totalAngle;
  renderDial();
}

function renderDial() {
  if (compassArrowWrap) {
    compassArrowWrap.style.transform = `rotate(${relativeAngleDeg}deg)`;
  }

  const rounded = Math.round(relativeAngleDeg);
  if (steerDeg) {
    steerDeg.textContent = (rounded > 0 ? '+' : '') + rounded + '°';
  }

  if (steerLabel) {
    if (Math.abs(rounded) < 7) {
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

// --- Transmission at 45Hz ---
function startTransmissionLoop() {
  clearInterval(sendInterval);
  sendInterval = setInterval(() => {
    if (!conn || !conn.open) return;
    const angleRad = (relativeAngleDeg * Math.PI) / 180;
    conn.send({
      type: 'steer',
      angle: angleRad,
      degrees: relativeAngleDeg,
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

// --- Start & Calibrate Button ---
if (startCalibrateBtn) {
  startCalibrateBtn.addEventListener('click', async () => {
    if (navigator.vibrate) navigator.vibrate(50);

    // Orientation permission (iOS)
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        await DeviceOrientationEvent.requestPermission();
      } catch (err) {
        console.warn('Orientation permission error:', err);
      }
    }

    // Motion permission (iOS)
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

    zeroOffset = currentRawHeading;
    computeRelativeAngle();
    requestWakeLock();

    if (calibrationOverlay) calibrationOverlay.style.display = 'none';
  });
}

// Re-Center Button
if (recenterBtn) {
  recenterBtn.addEventListener('click', () => {
    if (navigator.vibrate) navigator.vibrate([25, 50, 25]);
    zeroOffset = currentRawHeading;
    manualOffsetDeg = 0;
    if (touchSlider) touchSlider.value = 0;
    if (sliderValue) sliderValue.textContent = '0°';
    computeRelativeAngle();
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

// Throw / Lift Test Button (tap to fling car)
if (tossTestBtn) {
  tossTestBtn.addEventListener('click', () => {
    if (navigator.vibrate) navigator.vibrate([60, 30, 80]);
    if (conn && conn.open) {
      conn.send({
        type: 'god_motion',
        lift: 16.0,
        toss: 14.0,
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
    computeRelativeAngle();
  });
}
