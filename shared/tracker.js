// MOTION ARCADE — Shared on-device MediaPipe Pose Landmarker tracker
// Supports Front/Back cameras, multi-lens selection, GPU->CPU delegate fallback,
// cover-fit projection, weighted Nose + Mid-Shoulders EMA tracking, alignment-gated
// 1.4s calibration, duck hysteresis, shoulder tilt, and live left/right hand tracking.

const MEDIAPIPE_ESM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs';
const MEDIAPIPE_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm';
const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

export const UPPER_BODY_CONNECTIONS = [
  [11, 12], // shoulders
  [11, 13], // left upper arm
  [13, 15], // left forearm
  [12, 14], // right upper arm
  [14, 16], // right forearm
  [11, 23], // left torso
  [12, 24], // right torso
  [23, 24], // hips
];

export const UPPER_BODY_LANDMARKS = [0, 11, 12, 13, 14, 15, 16, 19, 20, 23, 24];

const SENSITIVITY_MULTIPLIERS = {
  gentle: 1.4,
  normal: 1.0,
  wide: 0.72,
};

const CALIBRATION_DURATION_MS = 1400;
const MIN_VISIBILITY = 0.35;
const ALIGN_VISIBILITY = 0.42;

export const ALIGN_BOUNDS = {
  centerX: 0.5,
  centerY: 0.42,
  halfW: 0.16,
  minY: 0.2,
  maxY: 0.62,
  minSpanW: 0.12,
  maxSpanW: 0.74,
  maxSpeed: 0.42,
};

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function emaAlpha(dtSec, tauSec) {
  return 1 - Math.exp(-Math.max(0.001, dtSec) / tauSec);
}

export class PoseTracker {
  constructor() {
    this.poseLandmarker = null;
    this.delegate = null; // 'GPU' | 'CPU' | null
    this.stream = null;
    this.videoEl = null;

    this.ready = false;
    this.cameraActive = false;
    this.facingMode = 'user'; // 'user' | 'environment'
    this.deviceId = null;
    this.mirrored = true;
    this.sensitivity = 'normal';

    this.lastVideoTime = -1;
    this.lastDetectTimestamp = 0;

    // Smoothed viewport-normalized tracking state
    this.hasPose = false;
    this.hasFullUpperBody = false;
    this.poseLostTimer = 0;
    this.smoothX = 0.5;
    this.smoothY = 0.42;
    this.smoothSpanW = 0.24;
    this.smoothSpanH = 0.16;
    this.motionSpeed = 0;
    this.rawX = 0.5;
    this.rawY = 0.42;
    this.hasInitialSample = false;

    // Alignment telemetry
    this.alignment = {
      aligned: false,
      reason: 'no_pose',
      hint: 'Step into frame · show head & shoulders',
    };

    // Calibration state
    this.calibrated = false;
    this.calibrating = false;
    this.calibrationElapsedMs = 0;
    this.calibrationSamples = [];
    this.neutralX = 0.5;
    this.neutralY = 0.42;
    this.neutralSpanW = 0.24;
    this.neutralSpanH = 0.16;

    // Hysteresis duck state
    this.isDucked = false;
    this.duckProgress = 0;

    // Mapped landmarks, avatar pose, and live fist/hand tracking
    this.mappedLandmarks = null;
    this.trackedPointPx = null;
    this.midShoulderPx = null;
    this.nosePx = null;
    this.shoulderTilt = 0;
    this.avatarArms = { left: null, right: null };
    this.hands = {
      left: { visible: false, x: 0, y: 0, nx: 0.25, ny: 0.55, vx: 0, vy: 0, speed: 0 },
      right: { visible: false, x: 0, y: 0, nx: 0.75, ny: 0.55, vx: 0, vy: 0, speed: 0 },
    };
  }

  setSensitivity(mode) {
    if (SENSITIVITY_MULTIPLIERS[mode]) {
      this.sensitivity = mode;
    }
  }

  setMirror(mirrored) {
    this.mirrored = Boolean(mirrored);
  }

  async initModel(onStatus = () => {}) {
    if (this.poseLandmarker) {
      this.ready = true;
      return this.delegate;
    }

    onStatus('Loading vision runtime…');
    const visionModule = await import(MEDIAPIPE_ESM_URL);
    const { FilesetResolver, PoseLandmarker } = visionModule;

    onStatus('Initializing WASM…');
    const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);

    const commonOptions = {
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.45,
      minPosePresenceConfidence: 0.45,
      minTrackingConfidence: 0.45,
    };

    try {
      onStatus('Loading Pose model (GPU)…');
      this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        ...commonOptions,
        baseOptions: {
          modelAssetPath: POSE_MODEL_URL,
          delegate: 'GPU',
        },
      });
      this.delegate = 'GPU';
    } catch (gpuErr) {
      console.warn('[ARCADE] GPU delegate unavailable, falling back to CPU:', gpuErr);
      onStatus('Switching Pose model to CPU…');
      this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        ...commonOptions,
        baseOptions: {
          modelAssetPath: POSE_MODEL_URL,
          delegate: 'CPU',
        },
      });
      this.delegate = 'CPU';
    }

    this.ready = true;
    return this.delegate;
  }

  async listCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return [];
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices
        .filter((d) => d.kind === 'videoinput')
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${idx + 1}`,
        }));
    } catch {
      return [];
    }
  }

  async startCamera(videoEl, onStatus = () => {}, options = {}) {
    this.videoEl = videoEl;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera access requires HTTPS and a browser supporting getUserMedia.');
    }

    const facingMode = options.facingMode === 'environment' ? 'environment' : 'user';
    const deviceId = options.deviceId || null;
    this.facingMode = facingMode;
    this.deviceId = deviceId;

    const camName = facingMode === 'environment' ? 'back camera' : 'front camera';
    onStatus(`Requesting ${camName}…`);
    this.stopCamera();

    const baseVideo = {
      width: { ideal: 640 },
      height: { ideal: 480 },
    };

    const attempts = [];
    if (deviceId) {
      attempts.push({ audio: false, video: { ...baseVideo, deviceId: { exact: deviceId } } });
    }
    if (facingMode === 'environment') {
      attempts.push({ audio: false, video: { ...baseVideo, facingMode: { exact: 'environment' } } });
      attempts.push({ audio: false, video: { ...baseVideo, facingMode: { ideal: 'environment' } } });
    } else {
      attempts.push({ audio: false, video: { ...baseVideo, facingMode: { ideal: 'user' } } });
    }

    let stream = null;
    let lastErr = null;
    for (const constraints of attempts) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        break;
      } catch (err) {
        lastErr = err;
        if (err && (err.name === 'NotAllowedError' || err.name === 'NotReadableError')) {
          break;
        }
      }
    }

    if (!stream) {
      const err = lastErr;
      if (err && err.name === 'NotAllowedError') {
        throw new Error('Camera permission was denied. Allow camera access or use Practice Mode.');
      }
      if (err && err.name === 'NotFoundError') {
        throw new Error(`No ${camName} was detected on this device. Try the other camera or Practice Mode.`);
      }
      if (err && err.name === 'NotReadableError') {
        throw new Error('Camera is currently busy in another app. Close it or use Practice Mode.');
      }
      throw new Error(err?.message || `Unable to access ${camName}.`);
    }

    const videoTrack = stream.getVideoTracks()[0];
    const trackSettings = videoTrack?.getSettings?.() || {};
    if (trackSettings.deviceId) {
      this.deviceId = trackSettings.deviceId;
    }
    if (trackSettings.facingMode === 'environment' || trackSettings.facingMode === 'user') {
      this.facingMode = trackSettings.facingMode;
    }

    this.stream = stream;
    videoEl.srcObject = stream;
    videoEl.muted = true;
    videoEl.playsInline = true;
    videoEl.setAttribute('playsinline', '');
    videoEl.setAttribute('autoplay', '');
    videoEl.setAttribute('muted', '');

    await new Promise((resolve, reject) => {
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('Failed to start camera video stream.'));
      };
      const cleanup = () => {
        videoEl.removeEventListener('loadedmetadata', onLoaded);
        videoEl.removeEventListener('error', onError);
      };

      if (videoEl.readyState >= 1 && videoEl.videoWidth > 0) {
        resolve();
        return;
      }
      videoEl.addEventListener('loadedmetadata', onLoaded, { once: true });
      videoEl.addEventListener('error', onError, { once: true });
    });

    await videoEl.play();
    this.cameraActive = true;
    this.lastVideoTime = -1;
    return stream;
  }

  stopCamera() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    if (this.videoEl) {
      this.videoEl.srcObject = null;
    }
    this.cameraActive = false;
    this.hasPose = false;
    this.hasFullUpperBody = false;
    this.hasInitialSample = false;
    this.poseLostTimer = 0;
    this.motionSpeed = 0;
    this.shoulderTilt = 0;
    this.avatarArms = { left: null, right: null };
    this.hands.left.visible = false;
    this.hands.right.visible = false;
    this.mappedLandmarks = null;
  }

  startCalibration() {
    this.calibrating = true;
    this.calibrated = false;
    this.calibrationElapsedMs = 0;
    this.calibrationSamples = [];
    this.isDucked = false;
    this.duckProgress = 0;
    this.alignment = {
      aligned: false,
      reason: 'no_pose',
      hint: 'Step into frame · show head & shoulders',
    };
  }

  recenter() {
    if (!this.hasPose) return false;
    this.neutralX = this.smoothX;
    this.neutralY = this.smoothY;
    if (this.smoothSpanW > 0.05 && this.smoothSpanH > 0.04) {
      this.neutralSpanW = this.smoothSpanW;
      this.neutralSpanH = this.smoothSpanH;
    }
    this.calibrated = true;
    this.isDucked = false;
    this.duckProgress = 0;
    return true;
  }

  getCalibrationProgress() {
    return clamp(this.calibrationElapsedMs / CALIBRATION_DURATION_MS, 0, 1);
  }

  getDuckThresholdsNormH() {
    const enterDrop = clamp(this.neutralSpanH * 0.4, 0.056, 0.155);
    const exitDrop = enterDrop * 0.68;
    return {
      enterDrop,
      exitDrop,
      enterLineY: clamp(this.neutralY + enterDrop, 0.15, 0.92),
      exitLineY: clamp(this.neutralY + exitDrop, 0.12, 0.9),
    };
  }

  _mapLandmark(lm, vidW, vidH, viewW, viewH) {
    const vidAspect = vidW / vidH;
    const viewAspect = viewW / viewH;
    const projX = this.mirrored ? 1 - lm.x : lm.x;

    let x;
    let y;
    if (vidAspect > viewAspect) {
      const scale = viewH / vidH;
      const renderedW = vidW * scale;
      const offsetX = (renderedW - viewW) * 0.5;
      x = projX * renderedW - offsetX;
      y = lm.y * viewH;
    } else {
      const scale = viewW / vidW;
      const renderedH = vidH * scale;
      const offsetY = (renderedH - viewH) * 0.5;
      x = projX * viewW;
      y = lm.y * renderedH - offsetY;
    }

    return {
      x,
      y,
      nx: x / viewW,
      ny: y / viewH,
      visibility: lm.visibility ?? 1,
    };
  }

  _evaluateAlignment() {
    if (!this.hasPose) {
      return { aligned: false, reason: 'no_pose', hint: 'Step into frame · show head & shoulders' };
    }
    if (!this.hasFullUpperBody) {
      return { aligned: false, reason: 'missing_shoulders', hint: 'Keep head & both shoulders inside frame' };
    }
    if (this.smoothSpanW < ALIGN_BOUNDS.minSpanW) {
      return { aligned: false, reason: 'too_far', hint: 'Move slightly closer to camera' };
    }
    if (this.smoothSpanW > ALIGN_BOUNDS.maxSpanW) {
      return { aligned: false, reason: 'too_close', hint: 'Step back slightly from camera' };
    }
    if (this.smoothX < ALIGN_BOUNDS.centerX - ALIGN_BOUNDS.halfW) {
      return { aligned: false, reason: 'move_right', hint: 'Move slightly right to center →' };
    }
    if (this.smoothX > ALIGN_BOUNDS.centerX + ALIGN_BOUNDS.halfW) {
      return { aligned: false, reason: 'move_left', hint: '← Move slightly left to center' };
    }
    if (this.smoothY < ALIGN_BOUNDS.minY) {
      return { aligned: false, reason: 'too_high', hint: 'Lower head or tilt phone up' };
    }
    if (this.smoothY > ALIGN_BOUNDS.maxY) {
      return { aligned: false, reason: 'too_low', hint: 'Raise posture or tilt phone down' };
    }
    if (this.motionSpeed > ALIGN_BOUNDS.maxSpeed) {
      return { aligned: false, reason: 'moving', hint: 'Hold steady to lock posture…' };
    }
    return { aligned: true, reason: 'aligned', hint: 'Aligned — locking neutral posture…' };
  }

  update(nowMs, dtSec, viewW, viewH) {
    const video = this.videoEl;
    if (
      !this.ready ||
      !this.poseLandmarker ||
      !this.cameraActive ||
      !video ||
      video.readyState < 2 ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      return this.getState();
    }

    const vidTime = video.currentTime;
    if (vidTime !== this.lastVideoTime) {
      this.lastVideoTime = vidTime;
      const ts = nowMs > this.lastDetectTimestamp ? nowMs : this.lastDetectTimestamp + 1;
      this.lastDetectTimestamp = ts;

      let result = null;
      try {
        result = this.poseLandmarker.detectForVideo(video, ts);
      } catch (err) {
        console.warn('[ARCADE] Pose detect frame skipped:', err);
      }

      const rawLandmarks = result?.landmarks?.[0];
      if (rawLandmarks && rawLandmarks.length >= 17) {
        this._processLandmarks(rawLandmarks, video.videoWidth, video.videoHeight, viewW, viewH, dtSec);
      } else {
        this.poseLostTimer += dtSec;
        if (this.poseLostTimer > 0.35) {
          this.hasPose = false;
          this.hasFullUpperBody = false;
          this.hands.left.visible = false;
          this.hands.right.visible = false;
          this.mappedLandmarks = null;
        }
      }
    }

    if (this.calibrating) {
      this.alignment = this._evaluateAlignment();
      if (this.alignment.aligned) {
        this.calibrationElapsedMs += dtSec * 1000;
        this.calibrationSamples.push({
          x: this.smoothX,
          y: this.smoothY,
          spanW: this.smoothSpanW,
          spanH: this.smoothSpanH,
        });

        if (this.calibrationElapsedMs >= CALIBRATION_DURATION_MS && this.calibrationSamples.length >= 8) {
          this._finalizeCalibration();
        }
      } else {
        this.calibrationElapsedMs = Math.max(0, this.calibrationElapsedMs - dtSec * 1000);
        if (this.calibrationElapsedMs === 0) {
          this.calibrationSamples = [];
        }
      }
    }

    return this.getState();
  }

  _updateHandState(handState, elbow, wrist, indexTip, dtSec, viewW, viewH) {
    const hasW = wrist && wrist.visibility >= 0.32;
    if (!hasW) {
      handState.visible = false;
      handState.speed *= 0.8;
      return;
    }

    // Project fist/palm center slightly ahead of wrist toward index fingertip (or forearm vector)
    let targetX = wrist.x;
    let targetY = wrist.y;
    if (indexTip && indexTip.visibility >= 0.3) {
      targetX = wrist.x * 0.58 + indexTip.x * 0.42;
      targetY = wrist.y * 0.58 + indexTip.y * 0.42;
    } else if (elbow && elbow.visibility >= 0.32) {
      targetX = wrist.x + (wrist.x - elbow.x) * 0.22;
      targetY = wrist.y + (wrist.y - elbow.y) * 0.22;
    }

    const clampedX = clamp(targetX, 0, viewW);
    const clampedY = clamp(targetY, 0, viewH);

    if (!handState.visible) {
      handState.x = clampedX;
      handState.y = clampedY;
      handState.vx = 0;
      handState.vy = 0;
      handState.speed = 0;
    } else {
      const a = emaAlpha(dtSec, 0.03); // Ultra-snappy tracking for fast punches
      const prevX = handState.x;
      const prevY = handState.y;
      handState.x += (clampedX - handState.x) * a;
      handState.y += (clampedY - handState.y) * a;
      const dtSafe = Math.max(0.016, dtSec);
      handState.vx = (handState.x - prevX) / dtSafe;
      handState.vy = (handState.y - prevY) / dtSafe;
      handState.speed = Math.hypot(handState.vx, handState.vy);
    }

    handState.nx = handState.x / viewW;
    handState.ny = handState.y / viewH;
    handState.visible = true;
  }

  _processLandmarks(rawLandmarks, vidW, vidH, viewW, viewH, dtSec) {
    const mapped = new Array(rawLandmarks.length);
    for (let i = 0; i < UPPER_BODY_LANDMARKS.length; i++) {
      const idx = UPPER_BODY_LANDMARKS[i];
      if (rawLandmarks[idx]) {
        mapped[idx] = this._mapLandmark(rawLandmarks[idx], vidW, vidH, viewW, viewH);
      }
    }

    const nose = mapped[0];
    const ls = mapped[11];
    const rs = mapped[12];

    const hasNose = nose && nose.visibility >= MIN_VISIBILITY;
    const hasLS = ls && ls.visibility >= MIN_VISIBILITY;
    const hasRS = rs && rs.visibility >= MIN_VISIBILITY;

    if (!hasNose && !hasLS && !hasRS) {
      this.poseLostTimer += dtSec;
      if (this.poseLostTimer > 0.35) {
        this.hasPose = false;
        this.hasFullUpperBody = false;
        this.hands.left.visible = false;
        this.hands.right.visible = false;
        this.mappedLandmarks = null;
      }
      return;
    }

    this.poseLostTimer = 0;
    this.hasPose = true;
    this.hasFullUpperBody = Boolean(
      nose &&
        nose.visibility >= ALIGN_VISIBILITY &&
        ls &&
        ls.visibility >= ALIGN_VISIBILITY &&
        rs &&
        rs.visibility >= ALIGN_VISIBILITY &&
        ls.nx > 0.02 &&
        ls.nx < 0.98 &&
        rs.nx > 0.02 &&
        rs.nx < 0.98
    );

    this.mappedLandmarks = mapped;
    this.nosePx = hasNose ? { x: nose.x, y: nose.y } : null;

    let midShoulderX;
    let midShoulderY;
    let hasMidShoulder = false;
    let measuredSpanPx = null;

    if (hasLS && hasRS) {
      midShoulderX = (ls.nx + rs.nx) * 0.5;
      midShoulderY = (ls.ny + rs.ny) * 0.5;
      hasMidShoulder = true;
      measuredSpanPx = Math.hypot(ls.x - rs.x, ls.y - rs.y);
      this.midShoulderPx = { x: (ls.x + rs.x) * 0.5, y: (ls.y + rs.y) * 0.5 };
    } else if (hasLS) {
      midShoulderX = ls.nx;
      midShoulderY = ls.ny;
      hasMidShoulder = true;
      this.midShoulderPx = { x: ls.x, y: ls.y };
    } else if (hasRS) {
      midShoulderX = rs.nx;
      midShoulderY = rs.ny;
      hasMidShoulder = true;
      this.midShoulderPx = { x: rs.x, y: rs.y };
    } else {
      this.midShoulderPx = null;
    }

    // Weighted Nose (0) + Mid-Shoulders (11, 12)
    let targetX;
    let targetY;
    if (hasNose && hasMidShoulder) {
      targetX = nose.nx * 0.45 + midShoulderX * 0.55;
      targetY = nose.ny * 0.65 + midShoulderY * 0.35;
    } else if (hasNose) {
      targetX = nose.nx;
      targetY = nose.ny;
    } else {
      targetX = midShoulderX;
      targetY = midShoulderY;
    }

    this.rawX = targetX;
    this.rawY = targetY;

    if (!this.hasInitialSample) {
      this.smoothX = targetX;
      this.smoothY = targetY;
      this.motionSpeed = 0;
      if (measuredSpanPx && measuredSpanPx > 12) {
        this.smoothSpanW = measuredSpanPx / viewW;
        this.smoothSpanH = measuredSpanPx / viewH;
      }
      this.hasInitialSample = true;
    } else {
      const prevX = this.smoothX;
      const prevY = this.smoothY;
      const aX = emaAlpha(dtSec, 0.052);
      const aY = emaAlpha(dtSec, 0.058);
      this.smoothX += (targetX - this.smoothX) * aX;
      this.smoothY += (targetY - this.smoothY) * aY;

      const instSpeed = Math.hypot(this.smoothX - prevX, this.smoothY - prevY) / Math.max(0.016, dtSec);
      const aMotion = emaAlpha(dtSec, 0.14);
      this.motionSpeed += (instSpeed - this.motionSpeed) * aMotion;

      if (measuredSpanPx && measuredSpanPx > 12) {
        const aSpan = emaAlpha(dtSec, 0.16);
        this.smoothSpanW += (measuredSpanPx / viewW - this.smoothSpanW) * aSpan;
        this.smoothSpanH += (measuredSpanPx / viewH - this.smoothSpanH) * aSpan;
      }
    }

    this.trackedPointPx = {
      x: this.smoothX * viewW,
      y: this.smoothY * viewH,
    };

    // Orientation-proof shoulder tilt, arm offsets, and live screen-left / screen-right hands
    const lsIsLeft = hasLS && hasRS ? ls.x < rs.x : this.mirrored;
    const screenLeftSh = lsIsLeft ? ls : rs;
    const screenRightSh = lsIsLeft ? rs : ls;
    const leftElbow = lsIsLeft ? mapped[13] : mapped[14];
    const leftWrist = lsIsLeft ? mapped[15] : mapped[16];
    const leftIndex = lsIsLeft ? mapped[19] : mapped[20];
    const rightElbow = lsIsLeft ? mapped[14] : mapped[13];
    const rightWrist = lsIsLeft ? mapped[16] : mapped[15];
    const rightIndex = lsIsLeft ? mapped[20] : mapped[19];

    this._updateHandState(this.hands.left, leftElbow, leftWrist, leftIndex, dtSec, viewW, viewH);
    this._updateHandState(this.hands.right, rightElbow, rightWrist, rightIndex, dtSec, viewW, viewH);

    if (hasLS && hasRS && measuredSpanPx && measuredSpanPx > 16) {
      const rawTilt = clamp(
        Math.atan2(screenRightSh.y - screenLeftSh.y, screenRightSh.x - screenLeftSh.x),
        -0.45,
        0.45
      );
      const aTilt = emaAlpha(dtSec, 0.075);
      this.shoulderTilt += (rawTilt - this.shoulderTilt) * aTilt;

      const buildArm = (shoulder, elbow, wrist, prev) => {
        const hasE = elbow && elbow.visibility >= 0.45;
        const hasW = wrist && wrist.visibility >= 0.45;
        if (!hasE) return null;
        const ex = clamp((elbow.x - shoulder.x) / measuredSpanPx, -1.2, 1.2);
        const ey = clamp((elbow.y - shoulder.y) / measuredSpanPx, -1.2, 1.4);
        const wx = hasW ? clamp((wrist.x - shoulder.x) / measuredSpanPx, -1.8, 1.8) : ex * 1.45;
        const wy = hasW ? clamp((wrist.y - shoulder.y) / measuredSpanPx, -1.8, 1.8) : ey + 0.55;
        if (!prev) return { ex, ey, wx, wy };
        const aArm = emaAlpha(dtSec, 0.065);
        return {
          ex: prev.ex + (ex - prev.ex) * aArm,
          ey: prev.ey + (ey - prev.ey) * aArm,
          wx: prev.wx + (wx - prev.wx) * aArm,
          wy: prev.wy + (wy - prev.wy) * aArm,
        };
      };

      this.avatarArms = {
        left: buildArm(screenLeftSh, leftElbow, leftWrist, this.avatarArms.left),
        right: buildArm(screenRightSh, rightElbow, rightWrist, this.avatarArms.right),
      };
    } else {
      const aDecay = emaAlpha(dtSec, 0.14);
      this.shoulderTilt *= 1 - aDecay;
      this.avatarArms = { left: null, right: null };
    }

    if (this.calibrated) {
      const { enterDrop, exitDrop } = this.getDuckThresholdsNormH();
      const dropY = this.smoothY - this.neutralY;
      this.duckProgress = clamp(dropY / enterDrop, 0, 1.25);

      if (!this.isDucked && dropY >= enterDrop) {
        this.isDucked = true;
      } else if (this.isDucked && dropY <= exitDrop) {
        this.isDucked = false;
      }
    }
  }

  _finalizeCalibration() {
    const samples = this.calibrationSamples;
    const avgTrimmed = (key) => {
      const vals = samples.map((s) => s[key]).sort((a, b) => a - b);
      const cut = Math.floor(vals.length * 0.15);
      const sliced = vals.slice(cut, vals.length - cut || vals.length);
      return sliced.reduce((acc, v) => acc + v, 0) / sliced.length;
    };

    this.neutralX = avgTrimmed('x');
    this.neutralY = avgTrimmed('y');
    this.neutralSpanW = clamp(avgTrimmed('spanW'), 0.09, 0.65);
    this.neutralSpanH = clamp(avgTrimmed('spanH'), 0.06, 0.48);

    this.calibrating = false;
    this.calibrated = true;
    this.isDucked = false;
    this.duckProgress = 0;
  }

  getLeanNormalized() {
    if (!this.hasPose) return 0;
    const dx = this.smoothX - this.neutralX;
    const baseSwayW = clamp(this.neutralSpanW * 0.72, 0.11, 0.28);
    const mult = SENSITIVITY_MULTIPLIERS[this.sensitivity] ?? 1.0;
    return clamp((dx / baseSwayW) * mult, -1, 1);
  }

  getState() {
    const thresholds = this.getDuckThresholdsNormH();
    return {
      ready: this.ready,
      cameraActive: this.cameraActive,
      facingMode: this.facingMode,
      mirrored: this.mirrored,
      delegate: this.delegate,
      hasPose: this.hasPose,
      hasFullUpperBody: this.hasFullUpperBody,
      alignment: this.alignment,
      calibrating: this.calibrating,
      calibrated: this.calibrated,
      calibrationProgress: this.getCalibrationProgress(),
      lean: this.getLeanNormalized(),
      isDucked: this.isDucked,
      duckProgress: this.duckProgress,
      neutralX: this.neutralX,
      neutralY: this.neutralY,
      neutralSpanW: this.neutralSpanW,
      neutralSpanH: this.neutralSpanH,
      duckLineY: thresholds.enterLineY,
      duckExitLineY: thresholds.exitLineY,
      mappedLandmarks: this.mappedLandmarks,
      trackedPointPx: this.trackedPointPx,
      midShoulderPx: this.midShoulderPx,
      nosePx: this.nosePx,
      shoulderTilt: this.shoulderTilt,
      avatarArms: this.avatarArms,
      hands: this.hands,
    };
  }
}
