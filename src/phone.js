/* Mobile Steering Controller Logic */

// --- State & Variables ---
let zeroOffset = 0;       // Calibration heading in degrees
let currentRawHeading = 0;// Most recently read physical compass heading
let relativeAngleDeg = 0; // Relative angle (degrees) [-180, 180]
let manualOffsetDeg = 0;  // Slider or manual tweak
let hasSensors = false;
let peer = null;
let conn = null;
let wakeLock = null;
let sendInterval = null;

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
const touchSlider = document.getElementById('touchSlider');
const sliderValue = document.getElementById('sliderValue');
const manualCodeModal = document.getElementById('manualCodeModal');
const manualCodeInput = document.getElementById('manualCodeInput');
const manualCodeSubmit = document.getElementById('manualCodeSubmit');

// Parse URL params
const urlParams = new URLSearchParams(window.location.search);
let targetPeerId = urlParams.get('peer');

if (!targetPeerId) {
  if (manualCodeModal) manualCodeModal.style.display = 'flex';
  if (manualCodeSubmit) {
    manualCodeSubmit.addEventListener('click', () => {
      const code = manualCodeInput.value.trim().toUpperCase();
      if (code) {
        targetPeerId = code.startsWith('toycar-') ? code : ('toycar-' + code);
        manualCodeModal.style.display = 'none';
        initPeerConnection();
      }
    });
  }
} else {
  if (!targetPeerId.startsWith('toycar-') && targetPeerId.length <= 6) {
    targetPeerId = 'toycar-' + targetPeerId;
  }
  initPeerConnection();
}

// --- PeerJS WebRTC Connection ---
function initPeerConnection() {
  if (peerBadge) peerBadge.textContent = 'CAR: ' + targetPeerId.replace('toycar-', '');
  updateStatus('CONNECTING...', 'connecting');

  const myId = 'ctrl-' + Math.random().toString(36).substring(2, 8);
  if (!window.Peer) {
    console.warn('PeerJS not loaded');
    return;
  }
  peer = new Peer(myId, {
    debug: 1,
  });

  peer.on('open', (id) => {
    connectToHost();
  });

  peer.on('error', (err) => {
    console.warn('Peer error:', err);
    if (err.type === 'peer-unavailable') {
      updateStatus('CAR NOT FOUND', 'disconnected');
      setTimeout(connectToHost, 3000);
    } else {
      updateStatus('NET ERROR', 'disconnected');
    }
  });
}

function connectToHost() {
  if (!peer || peer.destroyed) return;
  updateStatus('CONNECTING...', 'connecting');

  conn = peer.connect(targetPeerId, {
    reliable: true,
  });

  conn.on('open', () => {
    updateStatus('CONNECTED & STEERING!', 'connected');
    conn.send({ type: 'hello', client: 'mobile-controller' });
    startTransmissionLoop();
  });

  conn.on('close', () => {
    updateStatus('DISCONNECTED', 'disconnected');
    clearInterval(sendInterval);
    setTimeout(connectToHost, 2000);
  });

  conn.on('error', (err) => {
    console.warn('Connection error:', err);
    updateStatus('RECONNECTING...', 'disconnected');
  });
}

function updateStatus(text, state) {
  if (statusText) statusText.textContent = text;
  if (statusBadge) statusBadge.className = 'status-badge ' + state;
}

// --- Heading and DeviceOrientation Handling ---
function handleOrientation(e) {
  hasSensors = true;
  let rawHeading = null;

  // iOS Compass Heading (0° = North, clockwise)
  if (typeof e.webkitCompassHeading !== 'undefined' && e.webkitCompassHeading !== null) {
    rawHeading = e.webkitCompassHeading;
  } 
  // Standard Alpha (0° to 360°)
  else if (typeof e.alpha !== 'undefined' && e.alpha !== null) {
    rawHeading = (360 - e.alpha) % 360;
  }

  if (rawHeading !== null && !isNaN(rawHeading)) {
    currentRawHeading = rawHeading;
    computeRelativeAngle();
  }
}

function computeRelativeAngle() {
  let diff = currentRawHeading - zeroOffset;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;

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

    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== 'granted') {
          alert('Sensor permission is required to steer with physical rotation.');
        }
      } catch (err) {
        console.warn('Orientation permission error:', err);
      }
    }

    window.addEventListener('deviceorientationabsolute', handleOrientation, true);
    window.addEventListener('deviceorientation', handleOrientation, true);

    zeroOffset = currentRawHeading;
    computeRelativeAngle();
    requestWakeLock();

    if (calibrationOverlay) calibrationOverlay.style.display = 'none';
  });
}

// --- Re-Center Button ---
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

// --- Honk Horn Button ---
if (honkBtn) {
  honkBtn.addEventListener('click', () => {
    if (navigator.vibrate) navigator.vibrate([80, 40, 100]);
    if (conn && conn.open) {
      conn.send({ type: 'horn', timestamp: Date.now() });
    }
  });
}

// --- Touch Slider Fallback ---
if (touchSlider) {
  touchSlider.addEventListener('input', (e) => {
    manualOffsetDeg = parseFloat(e.target.value);
    if (sliderValue) sliderValue.textContent = manualOffsetDeg + '°';
    computeRelativeAngle();
  });
}
