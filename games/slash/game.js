// SLASH — Real Human Neon Hologram Laser-Blade Slicer
// On-device MediaPipe Pose + Segmentation Hologram + 3D Wireframe Polyhedra Vector Slicing

import { PoseTracker, UPPER_BODY_CONNECTIONS } from '../../shared/tracker.js?v=8';
import { SoundEngine } from '../../shared/audio.js?v=8';

const STORAGE = {
  highScore: 'slash_high_score',
  bodyMode: 'slash_body_mode',
  brightness: 'swerve_brightness',
  overlay: 'swerve_overlay',
  cameraFacing: 'swerve_camera_facing',
  cameraMirror: 'swerve_camera_mirror',
};

const MAX_SHIELDS = 3;
const MAX_PARTICLES = 150;
const MAX_TRAIL_AGE_MS = 165;
const MULTI_WINDOW_MS = 270;
const FRENZY_DURATION_SEC = 4.6;

const ZONES = [
  {
    id: 1,
    name: 'CYBER DOJO',
    minScore: 0,
    gridRgb: '50, 230, 255',
    accentHex: '#32e6ff',
    holoTopRgb: [50, 230, 255],
    holoBotRgb: [255, 56, 174],
    gravity: 790,
    spawnMin: 1.05,
    spawnMax: 1.5,
    mineChance: 0.14,
  },
  {
    id: 2,
    name: 'PLASMA OVERDRIVE',
    minScore: 550,
    gridRgb: '255, 56, 174',
    accentHex: '#ff38ae',
    holoTopRgb: [255, 72, 188],
    holoBotRgb: [50, 230, 255],
    gravity: 840,
    spawnMin: 0.9,
    spawnMax: 1.32,
    mineChance: 0.18,
  },
  {
    id: 3,
    name: 'HYPER PRISM',
    minScore: 1350,
    gridRgb: '200, 245, 59',
    accentHex: '#c8f53b',
    holoTopRgb: [200, 245, 59],
    holoBotRgb: [50, 230, 255],
    gravity: 890,
    spawnMin: 0.78,
    spawnMax: 1.16,
    mineChance: 0.22,
  },
  {
    id: 4,
    name: 'SUPERNOVA',
    minScore: 2450,
    gridRgb: '255, 184, 46',
    accentHex: '#ffb82e',
    holoTopRgb: [255, 184, 46],
    holoBotRgb: [255, 56, 174],
    gravity: 940,
    spawnMin: 0.68,
    spawnMax: 1.02,
    mineChance: 0.25,
  },
];

const POLY_PALETTES = [
  { stroke: '#32e6ff', rgb: '50, 230, 255', core: '#d8fbff' },
  { stroke: '#ff38ae', rgb: '255, 56, 174', core: '#ffd4ee' },
  { stroke: '#c8f53b', rgb: '200, 245, 59', core: '#f3ffd0' },
  { stroke: '#a864ff', rgb: '168, 100, 255', core: '#eadbff' },
];

// Normalized 3D wireframe polyhedra geometry definitions
const MESHES = (() => {
  const octaVerts = [
    [0, -1, 0],
    [1, 0, 0],
    [0, 0, 1],
    [-1, 0, 0],
    [0, 0, -1],
    [0, 1, 0],
  ];
  const octaEdges = [
    [0, 1], [0, 2], [0, 3], [0, 4],
    [5, 1], [5, 2], [5, 3], [5, 4],
    [1, 2], [2, 3], [3, 4], [4, 1],
  ];

  const c = 0.68;
  const cubeVerts = [
    [-c, -c, -c], [c, -c, -c], [c, c, -c], [-c, c, -c],
    [-c, -c, c], [c, -c, c], [c, c, c], [-c, c, c],
  ];
  const cubeEdges = [
    [0, 1], [1, 2], [2, 3], [3, 0],
    [4, 5], [5, 6], [6, 7], [7, 4],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];

  // Hexagonal bipyramid prism
  const prismVerts = [[0, -1.06, 0], [0, 1.06, 0]];
  const prismEdges = [];
  const sides = 6;
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    prismVerts.push([Math.cos(a) * 0.88, 0, Math.sin(a) * 0.88]);
    const idx = i + 2;
    const nextIdx = ((i + 1) % sides) + 2;
    prismEdges.push([0, idx], [1, idx], [idx, nextIdx]);
  }

  // Spiked mine (octahedron core + 8 radial spike tips)
  const mineVerts = [
    [0, -0.78, 0], [0.78, 0, 0], [0, 0, 0.78], [-0.78, 0, 0], [0, 0, -0.78], [0, 0.78, 0],
  ];
  const mineEdges = [
    [0, 1], [0, 2], [0, 3], [0, 4],
    [5, 1], [5, 2], [5, 3], [5, 4],
    [1, 2], [2, 3], [3, 4], [4, 1],
  ];
  const s = 0.86;
  const spikeDirs = [
    [s, s, s], [-s, s, s], [s, -s, s], [-s, -s, s],
    [s, s, -s], [-s, s, -s], [s, -s, -s], [-s, -s, -s],
  ];
  // Add center vertex at index 6 and spike tips from 7..14
  mineVerts.push([0, 0, 0]);
  for (let i = 0; i < spikeDirs.length; i++) {
    const idx = mineVerts.length;
    mineVerts.push(spikeDirs[i]);
    mineEdges.push([6, idx]);
  }

  return {
    octa: { verts: octaVerts, edges: octaEdges },
    cube: { verts: cubeVerts, edges: cubeEdges },
    prism: { verts: prismVerts, edges: prismEdges },
    star: { verts: octaVerts, edges: octaEdges },
    mine: { verts: mineVerts, edges: mineEdges },
  };
})();

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function distSegmentToPoint(x1, y1, x2, y2, px, py) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 0.0001) return Math.hypot(px - x1, py - y1);
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / lenSq, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function projectVerts3D(mesh, rx, ry, rz, radius) {
  const sx = Math.sin(rx), cx = Math.cos(rx);
  const sy = Math.sin(ry), cy = Math.cos(ry);
  const sz = Math.sin(rz), cz = Math.cos(rz);
  const out = new Array(mesh.verts.length);

  for (let i = 0; i < mesh.verts.length; i++) {
    const [vx, vy, vz] = mesh.verts[i];
    // Rotate X
    const y1 = vy * cx - vz * sx;
    const z1 = vy * sx + vz * cx;
    // Rotate Y
    const x2 = vx * cy + z1 * sy;
    const z2 = -vx * sy + z1 * cy;
    // Rotate Z
    const x3 = x2 * cz - y1 * sz;
    const y3 = x2 * sz + y1 * cz;

    const persp = 3.1 / (3.1 - z2 * 0.65);
    out[i] = {
      x: x3 * radius * persp,
      y: y3 * radius * persp,
      z: z2,
    };
  }
  return out;
}

class SlashGame {
  constructor() {
    this.tracker = new PoseTracker();
    this.audio = new SoundEngine();

    this.state = 'start'; // start | loading | calibrating | playing | paused | gameover
    this.mode = 'camera'; // camera | practice
    this.pauseOrigin = 'playing';

    this.highScore = this._loadInt(STORAGE.highScore, 0);
    this.bodyMode = this._loadBodyMode(); // 'hologram' | 'cutout' | 'camera'
    this.brightness = this._loadInt(STORAGE.brightness, 45);
    this.showOverlay = this._loadStr(STORAGE.overlay, '1') !== '0';
    this.cameraFacing = this._loadStr(STORAGE.cameraFacing, 'user') === 'environment' ? 'environment' : 'user';
    const storedMirror = this._loadStr(STORAGE.cameraMirror, null);
    this.mirrorCamera = storedMirror === null ? this.cameraFacing === 'user' : storedMirror !== '0';
    this.selectedDeviceId = null;
    this.availableCameras = [];

    // Viewport
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Run state
    this.score = 0;
    this.shields = MAX_SHIELDS;
    this.combo = 1;
    this.peakCombo = 1;
    this.slicesCount = 0;
    this.multiBlitzCount = 0;
    this.starsCount = 0;
    this.zoneIndex = 0;
    this.frenzyTimer = 0;
    this.isNewBest = false;

    // Multi-slice accumulator
    this.multiWindowTimer = 0;
    this.multiWindowHits = 0;
    this.multiLastX = 0;
    this.multiLastY = 0;

    // Timing & juice
    this.spawnTimer = 0.7;
    this.elapsedSec = 0;
    this.gridScroll = 0;
    this.beatTimer = 0;
    this.beatPulse = 0;
    this.beatCount = 0;
    this.hitStopTimer = 0;
    this.shakeTimer = 0;
    this.shakeIntensity = 0;
    this.hitFlashAlpha = 0;
    this.bannerTimer = 0;
    this.bannerText = '';
    this.bannerColor = '#ff38ae';
    this.swingSfxCooldown = 0;
    this.toastTimer = null;

    // Entities
    this.targets = [];
    this.slicedHalves = [];
    this.slashFlashes = [];
    this.particles = [];
    this.shockwaves = [];
    this.floaters = [];
    this.ambientStars = [];

    // Live plasma blade trails
    this.blades = {
      left: { points: [], color: '#32e6ff', rgb: '50, 230, 255', prevX: null, prevY: null, active: false },
      right: { points: [], color: '#ff38ae', rgb: '255, 56, 174', prevX: null, prevY: null, active: false },
      pointer: { points: [], color: '#c8f53b', rgb: '200, 245, 59', prevX: null, prevY: null, active: false },
    };

    // Attract mode ghost blade on start screen
    this.attractTargets = [];
    this.attractSpawnTimer = 0.25;
    this.attractPhase = 0;

    // Pointer swipe state
    this.pointerDown = false;
    this.pointerId = null;

    // Cached tracker snapshot
    this.poseState = this.tracker.getState();

    this._bindDom();
    this._applySettings();
    this._bindEvents();
    this._initAmbient();
    this._resize();
    this._renderHighScores();

    this.lastFrameMs = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  _loadStr(key, fallback) {
    try {
      const val = localStorage.getItem(key);
      return val === null ? fallback : val;
    } catch {
      return fallback;
    }
  }

  _loadInt(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      const parsed = parseInt(raw, 10);
      return Number.isNaN(parsed) ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  _loadBodyMode() {
    const val = this._loadStr(STORAGE.bodyMode, 'hologram');
    return val === 'cutout' || val === 'camera' ? val : 'hologram';
  }

  _save(key, value) {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // Ignore storage errors
    }
  }

  _bindDom() {
    this.videoEl = document.getElementById('camera-video');
    this.scrimEl = document.getElementById('camera-scrim');
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');

    this.hudEl = document.getElementById('hud');
    this.shieldPips = Array.from(document.querySelectorAll('#shield-bar .shield-pip'));
    this.zonePillEl = document.getElementById('zone-pill');
    this.comboPillEl = document.getElementById('combo-pill');
    this.scoreEl = document.getElementById('score-value');
    this.bestInlineEl = document.getElementById('best-inline');
    this.practiceHintEl = document.getElementById('practice-hint');
    this.poseWarningEl = document.getElementById('pose-warning');

    this.screenStart = document.getElementById('screen-start');
    this.screenLoading = document.getElementById('screen-loading');
    this.screenCalibrate = document.getElementById('screen-calibrate');
    this.screenPause = document.getElementById('screen-pause');
    this.screenGameover = document.getElementById('screen-gameover');

    this.startBestChipEl = document.getElementById('start-best-chip');
    this.loadingSpinnerEl = document.getElementById('loading-spinner');
    this.loadingTitleEl = document.getElementById('loading-title');
    this.loadingStatusEl = document.getElementById('loading-status');
    this.cameraErrorEl = document.getElementById('camera-error');
    this.cameraErrorMsgEl = document.getElementById('camera-error-msg');

    this.calibrateBadgeEl = document.getElementById('calibrate-badge');
    this.calibrateLabelEl = document.getElementById('calibrate-label');
    this.calibrateTimerEl = document.getElementById('calibrate-timer');
    this.calibrateFillEl = document.getElementById('calibrate-fill');
    this.calibrateDelegateEl = document.getElementById('calibrate-delegate');

    this.pauseTitleEl = document.getElementById('pause-title');
    this.pauseGameActionsEl = document.getElementById('pause-game-actions');
    this.btnSwitchMode = document.getElementById('btn-switch-mode');

    this.bodyModeHintEl = document.getElementById('body-mode-hint');
    this.bodyModeBtns = Array.from(document.querySelectorAll('#settings-body-mode .seg-btn'));
    this.cameraFacingHintEl = document.getElementById('camera-facing-hint');
    this.cameraFacingBtns = Array.from(
      document.querySelectorAll('#start-camera-facing .seg-btn, #settings-camera-facing .seg-btn')
    );
    this.cameraLensGroupEl = document.getElementById('camera-lens-group');
    this.selectCameraLensEl = document.getElementById('select-camera-lens');
    this.sliderBrightness = document.getElementById('slider-brightness');
    this.brightnessValueEl = document.getElementById('brightness-value');
    this.toggleMirror = document.getElementById('toggle-mirror');
    this.toggleOverlay = document.getElementById('toggle-overlay');
    this.toggleSound = document.getElementById('toggle-sound');

    this.iconSoundOn = document.getElementById('icon-sound-on');
    this.iconSoundOff = document.getElementById('icon-sound-off');

    this.gameoverNewBestEl = document.getElementById('gameover-new-best');
    this.gameoverRankEl = document.getElementById('gameover-rank');
    this.gameoverScoreEl = document.getElementById('gameover-score');
    this.gameoverBestEl = document.getElementById('gameover-best');
    this.statSlicesEl = document.getElementById('stat-slices');
    this.statBlitzEl = document.getElementById('stat-blitz');
    this.statFrenzyEl = document.getElementById('stat-frenzy');
    this.statComboEl = document.getElementById('stat-combo');

    this.toastEl = document.getElementById('toast');
  }

  _bindEvents() {
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this._resize(), 120));

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') {
        this._openPause('playing');
      }
    });

    document.getElementById('btn-play-camera').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      this._startCameraFlow();
    });

    document.getElementById('btn-play-practice').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      this._startPracticeMode();
    });

    document.getElementById('btn-start-settings').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      this._openPause('start');
    });

    document.getElementById('btn-retry-camera').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      this._startCameraFlow();
    });

    document.getElementById('btn-fallback-practice').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      this._startPracticeMode();
    });

    document.getElementById('btn-cancel-loading').addEventListener('click', () => {
      this.audio.click();
      this.tracker.stopCamera();
      this._syncCameraVisibility();
      this._setState('start');
    });

    document.getElementById('btn-calibrate-practice').addEventListener('click', () => {
      this.audio.click();
      this._startPracticeMode();
    });

    document.getElementById('btn-calibrate-flip').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      const next = this.cameraFacing === 'user' ? 'environment' : 'user';
      this._selectCameraFacing(next);
    });

    document.getElementById('btn-body-mode').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      const order = ['hologram', 'cutout', 'camera'];
      const next = order[(order.indexOf(this.bodyMode) + 1) % order.length];
      this._setBodyMode(next, true);
    });

    document.getElementById('btn-mute').addEventListener('click', () => {
      this.audio.toggleMute();
      this._syncAudioUI();
    });

    document.getElementById('btn-pause').addEventListener('click', () => {
      this.audio.click();
      this._openPause('playing');
    });

    document.getElementById('btn-close-pause').addEventListener('click', () => {
      this.audio.click();
      this._closePause();
    });

    document.getElementById('btn-resume').addEventListener('click', () => {
      this.audio.click();
      this._closePause();
    });

    document.getElementById('btn-restart').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      this._startRun();
    });

    document.getElementById('btn-recalibrate').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      if (this.mode === 'camera' && this.tracker.cameraActive) {
        this._beginCalibration();
      } else {
        this._startCameraFlow();
      }
    });

    this.btnSwitchMode.addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      if (this.mode === 'camera') {
        this._startPracticeMode();
      } else {
        this._startCameraFlow();
      }
    });

    document.getElementById('btn-play-again').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      this._startRun();
    });

    document.getElementById('btn-gameover-recalibrate').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      if (this.mode === 'camera' && this.tracker.cameraActive) {
        this._beginCalibration();
      } else {
        this._startCameraFlow();
      }
    });

    this.bodyModeBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.audio.click();
        this._setBodyMode(btn.dataset.bodyMode, true);
      });
    });

    this.cameraFacingBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.audio.click();
        this._selectCameraFacing(btn.dataset.facing);
      });
    });

    this.selectCameraLensEl.addEventListener('change', () => {
      const id = this.selectCameraLensEl.value || null;
      this.selectedDeviceId = id;
      if (this.mode === 'camera' && this.tracker.cameraActive) {
        this._switchActiveCamera();
      }
    });

    this.sliderBrightness.addEventListener('input', () => {
      this.brightness = parseInt(this.sliderBrightness.value, 10);
      this._save(STORAGE.brightness, this.brightness);
      this._applyBrightness();
    });

    this.toggleMirror.addEventListener('change', () => {
      this.mirrorCamera = this.toggleMirror.checked;
      this._save(STORAGE.cameraMirror, this.mirrorCamera ? '1' : '0');
      this._applyMirror();
      this._syncCameraUI();
    });

    this.toggleOverlay.addEventListener('change', () => {
      this.showOverlay = this.toggleOverlay.checked;
      this._save(STORAGE.overlay, this.showOverlay ? '1' : '0');
    });

    this.toggleSound.addEventListener('change', () => {
      this.audio.setMuted(!this.toggleSound.checked);
      if (!this.audio.isMuted()) {
        this.audio.unlock();
        this.audio.click();
      }
      this._syncAudioUI();
    });

    // Pointer / Touch swipe slicing (active in Practice Mode, or anytime player drags on canvas)
    this.canvas.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    window.addEventListener('pointermove', (e) => this._onPointerMove(e));
    window.addEventListener('pointerup', (e) => this._onPointerUp(e));
    window.addEventListener('pointercancel', (e) => this._onPointerUp(e));

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
      if (this.state === 'playing') {
        if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') {
          this._openPause('playing');
          return;
        }
        if (e.key === 'm' || e.key === 'M') {
          this.audio.toggleMute();
          this._syncAudioUI();
          return;
        }
        if (e.key === 'h' || e.key === 'H') {
          const order = ['hologram', 'cutout', 'camera'];
          const next = order[(order.indexOf(this.bodyMode) + 1) % order.length];
          this._setBodyMode(next, true);
          return;
        }
        if (this.mode === 'practice') {
          if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
            this._triggerSyntheticSlash(0.18, 0.72, 0.44, 0.25);
          } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
            this._triggerSyntheticSlash(0.82, 0.72, 0.56, 0.25);
          } else if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
            this._triggerSyntheticSlash(0.16, 0.48, 0.84, 0.36);
          }
        }
      } else if (this.state === 'paused' && (e.key === 'Escape' || e.key === 'p' || e.key === 'P')) {
        this._closePause();
      }
    });
  }

  _onPointerDown(e) {
    if (this.state !== 'playing') return;
    if (this.mode !== 'practice') return;
    this.audio.unlock();
    this.pointerDown = true;
    this.pointerId = e.pointerId;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const blade = this.blades.pointer;
    blade.active = true;
    blade.prevX = x;
    blade.prevY = y;
    blade.points.push({ x, y, t: performance.now() });
  }

  _onPointerMove(e) {
    if (!this.pointerDown || e.pointerId !== this.pointerId) return;
    if (this.state !== 'playing' || this.mode !== 'practice') return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const blade = this.blades.pointer;
    const nowMs = performance.now();

    if (blade.prevX !== null && blade.prevY !== null) {
      const dist = Math.hypot(x - blade.prevX, y - blade.prevY);
      if (dist >= 4) {
        this._testBladeSegment(blade.prevX, blade.prevY, x, y, dist * 45, blade, nowMs);
        blade.points.push({ x, y, t: nowMs });
        if (blade.points.length > 22) blade.points.shift();
        if (dist > 34 && this.swingSfxCooldown <= 0) {
          this.audio.bladeSwing(clamp(dist / 60, 0.45, 1.1));
          this.swingSfxCooldown = 0.22;
        }
        blade.prevX = x;
        blade.prevY = y;
      }
    } else {
      blade.prevX = x;
      blade.prevY = y;
    }
  }

  _onPointerUp(e) {
    if (this.pointerId !== null && e.pointerId !== this.pointerId) return;
    this.pointerDown = false;
    this.pointerId = null;
    this.blades.pointer.active = false;
    this.blades.pointer.prevX = null;
    this.blades.pointer.prevY = null;
  }

  _triggerSyntheticSlash(nx1, ny1, nx2, ny2) {
    const x1 = nx1 * this.width;
    const y1 = ny1 * this.height;
    const x2 = nx2 * this.width;
    const y2 = ny2 * this.height;
    const nowMs = performance.now();
    const blade = this.blades.pointer;
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      blade.points.push({ x: x1 + (x2 - x1) * f, y: y1 + (y2 - y1) * f, t: nowMs - (steps - i) * 10 });
    }
    this.audio.bladeSwing(0.85);
    this._testBladeSegment(x1, y1, x2, y2, 1200, blade, nowMs);
  }

  _setBodyMode(mode, notify = false) {
    this.bodyMode = mode === 'cutout' || mode === 'camera' ? mode : 'hologram';
    this._save(STORAGE.bodyMode, this.bodyMode);
    this._syncBodyModeUI();
    this._syncCameraVisibility();
    if (notify) {
      const labels = {
        hologram: 'Visual: Real Human Neon Hologram',
        cutout: 'Visual: Real Body Cutout + Neon Outline',
        camera: 'Visual: Full Live Camera Background',
      };
      this._showToast(labels[this.bodyMode]);
    }
  }

  _syncBodyModeUI() {
    this.bodyModeBtns.forEach((btn) => {
      const active = btn.dataset.bodyMode === this.bodyMode;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    if (this.bodyModeHintEl) {
      const hints = {
        hologram: 'Neon silhouette · room hidden',
        cutout: 'Real body cutout · neon rim',
        camera: 'Full live camera background',
      };
      this.bodyModeHintEl.textContent = hints[this.bodyMode];
    }
  }

  _syncCameraVisibility() {
    const showRawVideo = this.mode === 'camera' && this.tracker.cameraActive && this.bodyMode === 'camera';
    this.videoEl.classList.toggle('active', showRawVideo);
    if (this.scrimEl) {
      this.scrimEl.style.opacity = showRawVideo ? '1' : '0';
    }
  }

  _applySettings() {
    this.sliderBrightness.value = String(this.brightness);
    this._applyBrightness();
    this._applyMirror();
    this.toggleOverlay.checked = this.showOverlay;
    this._syncBodyModeUI();
    this._syncCameraUI();
    this._syncAudioUI();
  }

  _applyBrightness() {
    const opacity = clamp(this.brightness / 100, 0, 1);
    this.videoEl.style.setProperty('--camera-opacity', opacity.toFixed(2));
    this.brightnessValueEl.textContent = `${this.brightness}%`;
  }

  _applyMirror() {
    this.tracker.setMirror(this.mirrorCamera);
    this.videoEl.classList.toggle('mirrored', this.mirrorCamera);
    this.toggleMirror.checked = this.mirrorCamera;
  }

  _syncCameraUI() {
    this.cameraFacingBtns.forEach((btn) => {
      const active = btn.dataset.facing === this.cameraFacing;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    if (this.cameraFacingHintEl) {
      const camLabel = this.cameraFacing === 'environment' ? 'Back' : 'Front';
      const mirrorLabel = this.mirrorCamera ? 'mirrored' : 'unmirrored';
      this.cameraFacingHintEl.textContent = `${camLabel} · ${mirrorLabel}`;
    }
  }

  _syncAudioUI() {
    const muted = this.audio.isMuted();
    this.iconSoundOn.classList.toggle('hidden', muted);
    this.iconSoundOff.classList.toggle('hidden', !muted);
    this.toggleSound.checked = !muted;
  }

  _selectCameraFacing(facing) {
    const nextFacing = facing === 'environment' ? 'environment' : 'user';
    if (nextFacing === this.cameraFacing && !this.selectedDeviceId) {
      this._syncCameraUI();
      return;
    }
    this.cameraFacing = nextFacing;
    this.selectedDeviceId = null;
    this.mirrorCamera = nextFacing === 'user';
    this._save(STORAGE.cameraFacing, this.cameraFacing);
    this._save(STORAGE.cameraMirror, this.mirrorCamera ? '1' : '0');
    this._applyMirror();
    this._syncCameraUI();

    if (this.mode === 'camera' && this.tracker.cameraActive) {
      this._switchActiveCamera();
    }
  }

  async _refreshCameraLenses() {
    const cams = await this.tracker.listCameras();
    this.availableCameras = cams;
    if (!this.cameraLensGroupEl || !this.selectCameraLensEl) return;

    if (cams.length <= 1) {
      this.cameraLensGroupEl.classList.add('hidden');
      return;
    }

    this.selectCameraLensEl.innerHTML = '';
    cams.forEach((cam, idx) => {
      const opt = document.createElement('option');
      opt.value = cam.deviceId;
      opt.textContent = cam.label || `Camera Lens ${idx + 1}`;
      if (cam.deviceId === this.tracker.deviceId) {
        opt.selected = true;
      }
      this.selectCameraLensEl.appendChild(opt);
    });
    this.cameraLensGroupEl.classList.remove('hidden');
  }

  async _switchActiveCamera() {
    const label = this.cameraFacing === 'environment' ? 'Back Camera' : 'Front Camera';
    this._showToast(`Switching to ${label}…`);
    try {
      await this.tracker.startCamera(this.videoEl, () => {}, {
        facingMode: this.cameraFacing,
        deviceId: this.selectedDeviceId,
      });
      this._applyMirror();
      this._syncCameraUI();
      this._syncCameraVisibility();
      await this._refreshCameraLenses();
      this._showToast(`${label} active`);
      if (this.state === 'calibrating') {
        this.tracker.startCalibration();
      }
    } catch (err) {
      this._showToast(err?.message || `Unable to switch to ${label}`);
    }
  }

  _resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(this.width * this.dpr);
    this.canvas.height = Math.floor(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  _initAmbient() {
    this.ambientStars = Array.from({ length: 34 }, () => ({
      x: Math.random(),
      y: Math.random() * 0.72,
      z: Math.random(),
      size: 1 + Math.random() * 1.8,
      speed: 0.08 + Math.random() * 0.16,
    }));
  }

  _setState(next) {
    this.state = next;
    this.screenStart.classList.toggle('hidden', next !== 'start');
    this.screenLoading.classList.toggle('hidden', next !== 'loading');
    this.screenCalibrate.classList.toggle('hidden', next !== 'calibrating');
    this.screenPause.classList.toggle('hidden', next !== 'paused');
    this.screenGameover.classList.toggle('hidden', next !== 'gameover');

    const showHud = next === 'playing' || next === 'paused';
    this.hudEl.classList.toggle('hidden', !showHud);
    this.practiceHintEl.classList.toggle('hidden', !(next === 'playing' && this.mode === 'practice'));
    if (next !== 'playing') {
      this.poseWarningEl.classList.add('hidden');
    }

    this._syncCameraVisibility();
  }

  _showToast(message, durationMs = 2000) {
    this.toastEl.textContent = message;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastEl.classList.add('hidden');
    }, durationMs);
  }

  _renderHighScores() {
    this.bestInlineEl.textContent = `BEST ${this.highScore}`;
    if (this.highScore > 0) {
      this.startBestChipEl.textContent = `BEST ${this.highScore}`;
      this.startBestChipEl.classList.remove('hidden');
    } else {
      this.startBestChipEl.classList.add('hidden');
    }
  }

  async _startCameraFlow() {
    this.mode = 'camera';
    this.cameraErrorEl.classList.add('hidden');
    this.loadingSpinnerEl.classList.remove('hidden');
    this.loadingTitleEl.textContent =
      this.cameraFacing === 'environment' ? 'BACK CAMERA HOLOGRAM' : 'BOOTING HOLOGRAM';
    this.loadingStatusEl.textContent = 'Requesting camera…';
    this._setState('loading');

    try {
      await this.tracker.startCamera(
        this.videoEl,
        (msg) => {
          this.loadingStatusEl.textContent = msg;
        },
        {
          facingMode: this.cameraFacing,
          deviceId: this.selectedDeviceId,
        }
      );

      this._applyMirror();
      this._syncCameraUI();
      this._syncCameraVisibility();
      await this._refreshCameraLenses();

      this.loadingTitleEl.textContent = 'LOADING HOLOGRAM AI';
      const delegate = await this.tracker.initModel(
        (msg) => {
          this.loadingStatusEl.textContent = msg;
        },
        { segmentation: true }
      );

      const segTag = this.tracker.segmentationEnabled ? 'HOLOGRAM' : 'POSE';
      this.calibrateDelegateEl.textContent = `${segTag} · ${delegate || 'ON-DEVICE'}`;
      this._beginCalibration();
    } catch (err) {
      console.error('[SLASH] Camera startup error:', err);
      this.loadingSpinnerEl.classList.add('hidden');
      this.loadingTitleEl.textContent = 'CAMERA UNAVAILABLE';
      this.loadingStatusEl.textContent = 'You can still slice right away in Practice Mode.';
      this.cameraErrorMsgEl.textContent = err?.message || 'Unable to access camera.';
      this.cameraErrorEl.classList.remove('hidden');
    }
  }

  _beginCalibration() {
    this.tracker.startCalibration();
    this.calibrateFillEl.style.width = '0%';
    this.calibrateTimerEl.textContent = 'WAIT';
    this.calibrateBadgeEl.textContent = 'SYNCING HOLOGRAM';
    this.calibrateBadgeEl.className = 'status-badge warn';
    this.calibrateLabelEl.textContent = 'Step into frame · show shoulders & hands';
    this._setState('calibrating');
  }

  _startPracticeMode() {
    this.mode = 'practice';
    this.tracker.stopCamera();
    this._syncCameraVisibility();
    this._startRun();
    this._showToast('Practice Mode · Swipe to slice 3D neon shapes!');
  }

  _startRun() {
    this.score = 0;
    this.shields = MAX_SHIELDS;
    this.combo = 1;
    this.peakCombo = 1;
    this.slicesCount = 0;
    this.multiBlitzCount = 0;
    this.starsCount = 0;
    this.zoneIndex = 0;
    this.frenzyTimer = 0;
    this.isNewBest = false;

    this.multiWindowTimer = 0;
    this.multiWindowHits = 0;

    this.spawnTimer = 0.65;
    this.elapsedSec = 0;
    this.hitStopTimer = 0;
    this.shakeTimer = 0;
    this.hitFlashAlpha = 0;
    this.bannerTimer = 1.25;
    this.bannerText = 'IGNITE BLADES';
    this.bannerColor = '#32e6ff';

    this.targets = [];
    this.slicedHalves = [];
    this.slashFlashes = [];
    this.particles = [];
    this.shockwaves = [];
    this.floaters = [];

    for (const key of Object.keys(this.blades)) {
      this.blades[key].points = [];
      this.blades[key].prevX = null;
      this.blades[key].prevY = null;
      this.blades[key].active = false;
    }

    this._syncHud();
    this._setState('playing');
    this.audio.ready();
  }

  _openPause(origin) {
    this.pauseOrigin = origin;
    const isInGame = origin === 'playing';
    this.pauseTitleEl.textContent = isInGame ? 'PAUSED' : 'VISUAL & CAMERA SETTINGS';
    this.pauseGameActionsEl.classList.toggle('hidden', !isInGame);
    this.btnSwitchMode.textContent =
      this.mode === 'camera' ? 'Switch to Practice Mode' : 'Switch to Camera Hologram';
    this._syncBodyModeUI();
    this._syncCameraUI();
    this._setState('paused');
  }

  _closePause() {
    this._setState(this.pauseOrigin === 'playing' ? 'playing' : 'start');
  }

  _triggerGameOver() {
    this.audio.gameOver();
    const finalScore = Math.floor(this.score);
    if (finalScore > this.highScore) {
      this.highScore = finalScore;
      this.isNewBest = true;
      this._save(STORAGE.highScore, this.highScore);
    }

    this._renderHighScores();
    this.gameoverScoreEl.textContent = String(finalScore);
    this.gameoverBestEl.textContent = `BEST ${this.highScore}`;
    this.gameoverNewBestEl.classList.toggle('hidden', !this.isNewBest);

    let rank = 'C';
    let rankClass = 'rank-c';
    if (finalScore >= 2200) {
      rank = 'S';
      rankClass = 'rank-s';
    } else if (finalScore >= 1100) {
      rank = 'A';
      rankClass = 'rank-a';
    } else if (finalScore >= 450) {
      rank = 'B';
      rankClass = 'rank-b';
    }
    this.gameoverRankEl.textContent = rank;
    this.gameoverRankEl.className = `rank-badge ${rankClass}`;

    this.statSlicesEl.textContent = String(this.slicesCount);
    this.statBlitzEl.textContent = String(this.multiBlitzCount);
    this.statFrenzyEl.textContent = String(this.starsCount);
    this.statComboEl.textContent = `×${this.peakCombo}`;

    this._setState('gameover');
  }

  _syncHud() {
    const scoreInt = Math.floor(this.score);
    this.scoreEl.textContent = String(scoreInt);
    this.bestInlineEl.textContent = `BEST ${Math.max(this.highScore, scoreInt)}`;

    const zone = ZONES[this.zoneIndex];
    this.zonePillEl.textContent = this.frenzyTimer > 0 ? 'FRENZY 2×' : `Z${zone.id}`;
    this.zonePillEl.style.color = this.frenzyTimer > 0 ? '#ffb82e' : zone.accentHex;
    this.zonePillEl.style.borderColor =
      this.frenzyTimer > 0 ? 'rgba(255, 184, 46, 0.7)' : `rgba(${zone.gridRgb}, 0.48)`;

    this.shieldPips.forEach((pip, idx) => {
      pip.classList.toggle('active', idx < this.shields);
      pip.classList.toggle('lost', idx >= this.shields);
    });

    if (this.combo > 1) {
      this.comboPillEl.textContent = `×${this.combo}`;
      this.comboPillEl.classList.remove('hidden');
      this.comboPillEl.classList.toggle('fever', this.combo >= 8 || this.frenzyTimer > 0);
    } else {
      this.comboPillEl.classList.add('hidden');
    }
  }

  _spawnWave() {
    const zone = ZONES[this.zoneIndex];
    const inFrenzy = this.frenzyTimer > 0;

    // Decide how many shapes to arc up in this wave
    let count = 1;
    if (inFrenzy) {
      count = Math.random() < 0.55 ? 3 : 2;
    } else {
      const r = Math.random();
      if (this.zoneIndex >= 2 && r < 0.28) count = 3;
      else if (r < 0.62) count = 2;
      else count = 1;
    }

    const gravity = zone.gravity;
    const minRadius = Math.max(30, Math.min(this.width, this.height) * 0.068);
    const maxRadius = Math.max(40, Math.min(this.width, this.height) * 0.088);

    // Ensure at least one sliceable shape in every wave
    let minesSpawned = 0;

    for (let i = 0; i < count; i++) {
      let kind = 'poly';
      if (!inFrenzy) {
        if (i > 0 && minesSpawned === 0 && Math.random() < zone.mineChance) {
          kind = 'mine';
          minesSpawned++;
        } else if (i === 0 && Math.random() < 0.095) {
          kind = 'star';
        }
      }

      const spread = count === 1 ? 0.5 : 0.22 + (i / (count - 1)) * 0.56 + randRange(-0.07, 0.07);
      const startX = clamp(spread, 0.14, 0.86) * this.width;
      const startY = this.height + maxRadius + 16 + i * 24;

      // Choose an apex nicely in the upper-middle play band so arms reach comfortably
      const apexY = randRange(this.height * 0.18, this.height * 0.4);
      const riseH = Math.max(140, startY - apexY);
      const vy = -Math.sqrt(2 * gravity * riseH);

      // Gentle horizontal drift toward center so shapes never fly off-screen
      const targetMidX = randRange(this.width * 0.22, this.width * 0.78);
      const timeToApex = Math.abs(vy) / gravity;
      const vx = clamp((targetMidX - startX) / Math.max(0.55, timeToApex * 1.15), -240, 240);

      let meshKey = 'octa';
      let palette = POLY_PALETTES[Math.floor(Math.random() * POLY_PALETTES.length)];
      let radius = randRange(minRadius, maxRadius);

      if (kind === 'mine') {
        meshKey = 'mine';
        palette = { stroke: '#ff4d2e', rgb: '255, 77, 46', core: '#ffd4ca' };
        radius = minRadius * 0.96;
      } else if (kind === 'star') {
        meshKey = 'star';
        palette = { stroke: '#ffb82e', rgb: '255, 184, 46', core: '#fff5c8' };
        radius = minRadius * 0.94;
      } else {
        const types = ['octa', 'cube', 'prism'];
        meshKey = types[Math.floor(Math.random() * types.length)];
      }

      this.targets.push({
        kind,
        meshKey,
        x: startX,
        y: startY,
        vx,
        vy,
        gravity,
        radius,
        rx: randRange(0, Math.PI * 2),
        ry: randRange(0, Math.PI * 2),
        rz: randRange(0, Math.PI * 2),
        vrx: randRange(-2.4, 2.4),
        vry: randRange(-2.8, 2.8),
        vrz: randRange(-1.8, 1.8),
        palette,
        sliced: false,
        enteredView: false,
      });
    }
  }

  _spawnSparks(x, y, rgb, count, baseAngle = null) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const angle =
        baseAngle !== null
          ? baseAngle + randRange(-0.95, 0.95) + (i % 2 === 0 ? 0 : Math.PI)
          : Math.random() * Math.PI * 2;
      const speed = randRange(120, 440);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - randRange(20, 90),
        size: randRange(2, 4.8),
        rgb,
        life: 0,
        maxLife: randRange(0.28, 0.56),
      });
    }
  }

  _spawnShockwave(x, y, rgb, maxRadius) {
    this.shockwaves.push({ x, y, rgb, maxRadius, life: 0, maxLife: 0.34 });
  }

  _spawnFloater(text, x, y, color, big = false) {
    this.floaters.push({
      text,
      x: clamp(x, 64, this.width - 64),
      y: clamp(y, 84, this.height - 64),
      color,
      big,
      life: 0,
      maxLife: big ? 0.92 : 0.72,
    });
  }

  _testBladeSegment(x1, y1, x2, y2, speedPx, blade, nowMs) {
    if (this.state !== 'playing') return;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const segLen = Math.hypot(dx, dy);
    if (segLen < 3) return;
    const cutAngle = Math.atan2(dy, dx);

    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      if (t.sliced) continue;

      const hitScale = t.kind === 'mine' ? 0.86 : 1.24;
      // Mines require a real moving slash so resting hands don't trigger accidental explosions
      if (t.kind === 'mine' && speedPx < 220) continue;
      if (t.kind !== 'mine' && speedPx < 95 && this.mode === 'camera') continue;

      const d = distSegmentToPoint(x1, y1, x2, y2, t.x, t.y);
      if (d <= t.radius * hitScale) {
        t.sliced = true;
        this.targets.splice(i, 1);
        this._handleTargetSliced(t, cutAngle, blade, nowMs);
      }
    }
  }

  _handleTargetSliced(target, cutAngle, blade) {
    if (target.kind === 'mine') {
      this.audio.mineBlast();
      this.shields = Math.max(0, this.shields - 1);
      this.combo = 1;
      this.multiWindowHits = 0;
      this.multiWindowTimer = 0;
      this.hitFlashAlpha = 0.62;
      this.shakeTimer = 0.38;
      this.shakeIntensity = 15;
      this.hitStopTimer = 0.055;
      this._spawnSparks(target.x, target.y, '255, 77, 46', 34);
      this._spawnShockwave(target.x, target.y, '255, 77, 46', target.radius * 3.1);
      this._spawnFloater('MINE HIT!', target.x, target.y - 16, '#ff4d2e', true);
      this._syncHud();
      if (this.shields <= 0) {
        this._triggerGameOver();
      }
      return;
    }

    // Cleave polyhedron cleanly into 2 glowing wireframe halves along cutAngle!
    const nx = -Math.sin(cutAngle);
    const ny = Math.cos(cutAngle);
    for (const side of [-1, 1]) {
      const kick = randRange(155, 220);
      this.slicedHalves.push({
        meshKey: target.meshKey,
        x: target.x + nx * side * 6,
        y: target.y + ny * side * 6,
        vx: target.vx * 0.45 + nx * side * kick,
        vy: Math.min(target.vy * 0.35, -70) + ny * side * kick - 55,
        gravity: target.gravity * 1.05,
        radius: target.radius,
        rx: target.rx,
        ry: target.ry,
        rz: target.rz,
        vrx: target.vrx * 1.4,
        vry: target.vry * 1.4,
        vrz: side * randRange(2.4, 4.6),
        cutAngle,
        side,
        palette: target.palette,
        life: 0,
        maxLife: 0.9,
      });
    }

    // Blazing cut flash line through the crystal
    this.slashFlashes.push({
      x: target.x,
      y: target.y,
      angle: cutAngle,
      len: target.radius * 2.45,
      rgb: blade.rgb || target.palette.rgb,
      life: 0,
      maxLife: 0.24,
    });

    this.slicesCount++;
    this.combo = Math.min(24, this.combo + 1);
    if (this.combo > this.peakCombo) this.peakCombo = this.combo;

    // Multi-slice Blitz detection
    if (this.multiWindowTimer > 0) {
      this.multiWindowHits++;
    } else {
      this.multiWindowHits = 1;
    }
    this.multiWindowTimer = MULTI_WINDOW_MS / 1000;
    this.multiLastX = target.x;
    this.multiLastY = target.y;

    const frenzyMult = this.frenzyTimer > 0 ? 2 : 1;
    const basePts = target.kind === 'star' ? 120 : 40;
    const pts = Math.round(basePts * (1 + Math.min(this.combo - 1, 12) * 0.12) * frenzyMult);
    this.score += pts;

    if (target.kind === 'star') {
      this.starsCount++;
      this.frenzyTimer = FRENZY_DURATION_SEC;
      this.audio.frenzyStart();
      this.bannerText = 'FRENZY 2× · SLICE EVERYTHING!';
      this.bannerColor = '#ffb82e';
      this.bannerTimer = 1.6;
      this.hitStopTimer = 0.04;
      this.shakeTimer = 0.22;
      this.shakeIntensity = 7;
      this._spawnSparks(target.x, target.y, '255, 184, 46', 32, cutAngle);
      this._spawnShockwave(target.x, target.y, '255, 184, 46', target.radius * 3.4);
      this._spawnFloater(`FRENZY! +${pts}`, target.x, target.y - 14, '#ffb82e', true);
    } else {
      this.audio.crystalSlice(this.combo, this.multiWindowHits);
      this._spawnSparks(target.x, target.y, target.palette.rgb, 18, cutAngle);
      this._spawnShockwave(target.x, target.y, target.palette.rgb, target.radius * 2.2);
      this._spawnFloater(`+${pts}`, target.x, target.y - 8, target.palette.stroke, false);

      if (this.multiWindowHits >= 2) {
        this.multiBlitzCount++;
        const bonus = this.multiWindowHits * 60 * frenzyMult;
        this.score += bonus;
        const label =
          this.multiWindowHits >= 4
            ? `${this.multiWindowHits}× ULTRA! +${bonus}`
            : this.multiWindowHits === 3
              ? `3× BLITZ! +${bonus}`
              : `2× SLICE! +${bonus}`;
        this.hitStopTimer = 0.032;
        this.shakeTimer = 0.16;
        this.shakeIntensity = 6;
        this._spawnFloater(label, this.multiLastX, this.multiLastY - 38, '#c8f53b', true);
      }
    }

    this._checkZoneUpgrade();
    this._syncHud();
  }

  _checkZoneUpgrade() {
    let nextIdx = this.zoneIndex;
    for (let i = ZONES.length - 1; i >= 0; i--) {
      if (this.score >= ZONES[i].minScore) {
        nextIdx = i;
        break;
      }
    }
    if (nextIdx > this.zoneIndex) {
      this.zoneIndex = nextIdx;
      const z = ZONES[this.zoneIndex];
      this.bannerText = `ZONE ${z.id} · ${z.name}`;
      this.bannerColor = z.accentHex;
      this.bannerTimer = 1.65;
      this.audio.zoneUp();
    }
  }

  _updateCameraBlades(nowMs, dtSec) {
    if (this.mode !== 'camera') return;
    const hands = this.poseState.hands;
    const pairs = [
      ['left', hands?.left],
      ['right', hands?.right],
    ];

    for (const [side, hand] of pairs) {
      const blade = this.blades[side];
      if (!hand || !hand.visible) {
        blade.active = false;
        blade.prevX = null;
        blade.prevY = null;
        continue;
      }

      blade.active = true;
      if (blade.prevX !== null && blade.prevY !== null) {
        const dist = Math.hypot(hand.x - blade.prevX, hand.y - blade.prevY);
        if (dist >= 3) {
          const speed = Math.max(hand.speed || 0, dist / Math.max(0.016, dtSec));
          if (this.state === 'playing') {
            this._testBladeSegment(blade.prevX, blade.prevY, hand.x, hand.y, speed, blade, nowMs);
          }
          if (speed > 920 && this.swingSfxCooldown <= 0 && this.state === 'playing') {
            this.audio.bladeSwing(clamp(speed / 1600, 0.45, 1.1));
            this.swingSfxCooldown = 0.23;
          }
        }
      }

      blade.points.push({ x: hand.x, y: hand.y, t: nowMs });
      if (blade.points.length > 20) blade.points.shift();
      blade.prevX = hand.x;
      blade.prevY = hand.y;
    }
  }

  _pruneBladeTrails(nowMs) {
    for (const key of Object.keys(this.blades)) {
      const pts = this.blades[key].points;
      while (pts.length > 0 && nowMs - pts[0].t > MAX_TRAIL_AGE_MS) {
        pts.shift();
      }
    }
  }

  _updateAttract(dtSec) {
    this.attractPhase += dtSec;
    this.attractSpawnTimer -= dtSec;
    if (this.attractSpawnTimer <= 0 && this.attractTargets.length < 4) {
      this.attractSpawnTimer = randRange(0.75, 1.25);
      const types = ['octa', 'cube', 'prism'];
      this.attractTargets.push({
        meshKey: types[Math.floor(Math.random() * types.length)],
        x: randRange(this.width * 0.16, this.width * 0.84),
        y: this.height + 54,
        vx: randRange(-75, 75),
        vy: -Math.sqrt(2 * 640 * randRange(this.height * 0.45, this.height * 0.72)),
        gravity: 640,
        radius: randRange(32, 46),
        rx: randRange(0, 6),
        ry: randRange(0, 6),
        rz: randRange(0, 6),
        vrx: randRange(-1.8, 1.8),
        vry: randRange(-2.2, 2.2),
        vrz: randRange(-1.2, 1.2),
        palette: POLY_PALETTES[Math.floor(Math.random() * POLY_PALETTES.length)],
      });
    }

    for (let i = this.attractTargets.length - 1; i >= 0; i--) {
      const t = this.attractTargets[i];
      t.x += t.vx * dtSec;
      t.y += t.vy * dtSec;
      t.vy += t.gravity * dtSec;
      t.rx += t.vrx * dtSec;
      t.ry += t.vry * dtSec;
      t.rz += t.vrz * dtSec;
      if (t.y > this.height + 120 && t.vy > 0) {
        this.attractTargets.splice(i, 1);
      }
    }
  }

  _update(nowMs, rawDt) {
    const dt = Math.min(rawDt, 0.05);
    this.gridScroll = (this.gridScroll + dt * (this.frenzyTimer > 0 ? 0.56 : 0.28)) % 1;
    this.beatPulse = Math.max(0, this.beatPulse - dt * 2.8);
    this.swingSfxCooldown = Math.max(0, this.swingSfxCooldown - dt);

    // Update ambient stars
    for (const s of this.ambientStars) {
      s.z -= dt * s.speed * (this.frenzyTimer > 0 ? 2.1 : 1);
      if (s.z <= 0.02) {
        s.z = 1;
        s.x = Math.random();
        s.y = Math.random() * 0.68;
      }
    }

    // Update pose tracker whenever camera is active
    if (this.mode === 'camera' && this.tracker.cameraActive) {
      this.poseState = this.tracker.update(nowMs, dt, this.width, this.height);
      this._updateCameraBlades(nowMs, dt);
    }
    this._pruneBladeTrails(nowMs);

    if (this.state === 'start') {
      this._updateAttract(dt);
      return;
    }

    if (this.state === 'calibrating') {
      const p = this.poseState.calibrationProgress;
      const pct = Math.round(p * 100);
      this.calibrateFillEl.style.width = `${pct}%`;

      if (this.poseState.alignment.aligned) {
        this.calibrateBadgeEl.textContent = this.tracker.hasMask
          ? 'HOLOGRAM LOCKED — HOLD STEADY'
          : 'POSE LOCKED — HOLD STEADY';
        this.calibrateBadgeEl.className = 'status-badge ok';
        this.calibrateTimerEl.textContent = `${pct}%`;
        this.calibrateLabelEl.textContent = 'Blades ready — locking silhouette…';
      } else {
        this.calibrateBadgeEl.textContent = 'SYNCING HOLOGRAM';
        this.calibrateBadgeEl.className = 'status-badge warn';
        this.calibrateTimerEl.textContent = 'WAIT';
        this.calibrateLabelEl.textContent = this.poseState.alignment.hint;
      }

      if (this.poseState.calibrated) {
        this._startRun();
      }
      return;
    }

    if (this.state !== 'playing') return;

    this.poseWarningEl.classList.toggle('hidden', !(this.mode === 'camera' && !this.poseState.hasPose));

    // Brief tactile hit-stop on huge multi-slices / mine blasts
    if (this.hitStopTimer > 0) {
      this.hitStopTimer -= dt;
      this.shakeTimer = Math.max(0, this.shakeTimer - dt);
      return;
    }

    this.elapsedSec += dt;
    this.hitFlashAlpha = Math.max(0, this.hitFlashAlpha - dt * 1.9);
    this.shakeTimer = Math.max(0, this.shakeTimer - dt);
    this.bannerTimer = Math.max(0, this.bannerTimer - dt);

    if (this.frenzyTimer > 0) {
      this.frenzyTimer = Math.max(0, this.frenzyTimer - dt);
      if (this.frenzyTimer === 0) this._syncHud();
    }

    if (this.multiWindowTimer > 0) {
      this.multiWindowTimer -= dt;
      if (this.multiWindowTimer <= 0) {
        this.multiWindowHits = 0;
      }
    }

    // Subtle synth rhythm pulse
    const beatInterval = this.frenzyTimer > 0 ? 0.36 : 0.48 - this.zoneIndex * 0.03;
    this.beatTimer += dt;
    if (this.beatTimer >= beatInterval) {
      this.beatTimer -= beatInterval;
      this.beatCount++;
      this.beatPulse = 1;
      this.audio.beatPulse(this.zoneIndex, this.combo, this.beatCount % 4 === 1);
    }

    // Wave spawner
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this._spawnWave();
      const z = ZONES[this.zoneIndex];
      this.spawnTimer = this.frenzyTimer > 0 ? randRange(0.42, 0.62) : randRange(z.spawnMin, z.spawnMax);
    }

    // Update flying polyhedra targets
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      t.vy += t.gravity * dt;
      t.rx += t.vrx * dt;
      t.ry += t.vry * dt;
      t.rz += t.vrz * dt;

      // Soft bounce off side walls so shapes stay cleanly reachable
      if (t.x < t.radius + 12 && t.vx < 0) {
        t.x = t.radius + 12;
        t.vx = Math.abs(t.vx) * 0.75;
      } else if (t.x > this.width - t.radius - 12 && t.vx > 0) {
        t.x = this.width - t.radius - 12;
        t.vx = -Math.abs(t.vx) * 0.75;
      }

      if (t.y < this.height - t.radius * 0.5) {
        t.enteredView = true;
      }

      // Fell past bottom
      if (t.enteredView && t.y > this.height + t.radius + 36 && t.vy > 0) {
        this.targets.splice(i, 1);
        if (t.kind === 'poly' && this.frenzyTimer <= 0) {
          this.shields = Math.max(0, this.shields - 1);
          this.combo = 1;
          this.hitFlashAlpha = 0.42;
          this.shakeTimer = 0.24;
          this.shakeIntensity = 9;
          this.audio.hit();
          this._spawnFloater('MISSED', t.x, this.height - 54, '#ff4d2e', false);
          this._syncHud();
          if (this.shields <= 0) {
            this._triggerGameOver();
            return;
          }
        }
      }
    }

    // Update cleanly cleaved halves
    for (let i = this.slicedHalves.length - 1; i >= 0; i--) {
      const h = this.slicedHalves[i];
      h.life += dt;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      h.vy += h.gravity * dt;
      h.rx += h.vrx * dt;
      h.ry += h.vry * dt;
      h.rz += h.vrz * dt;
      if (h.life >= h.maxLife || h.y > this.height + 160) {
        this.slicedHalves.splice(i, 1);
      }
    }

    // Update slash flash lines
    for (let i = this.slashFlashes.length - 1; i >= 0; i--) {
      const f = this.slashFlashes[i];
      f.life += dt;
      if (f.life >= f.maxLife) this.slashFlashes.splice(i, 1);
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 420 * dt;
      if (p.life >= p.maxLife) this.particles.splice(i, 1);
    }

    // Update shockwaves
    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.life += dt;
      if (sw.life >= sw.maxLife) this.shockwaves.splice(i, 1);
    }

    // Update floaters
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const fl = this.floaters[i];
      fl.life += dt;
      fl.y -= 54 * dt;
      if (fl.life >= fl.maxLife) this.floaters.splice(i, 1);
    }
  }

  _drawCyberDojoBackground(ctx, nowMs) {
    const w = this.width;
    const h = this.height;
    const zone = ZONES[this.zoneIndex];
    const inFrenzy = this.frenzyTimer > 0;
    const gridRgb = inFrenzy ? '255, 184, 46' : zone.gridRgb;

    const showRawCamera = this.mode === 'camera' && this.tracker.cameraActive && this.bodyMode === 'camera';

    if (!showRawCamera) {
      // Pure dark cyber neon dojo backdrop (completely replaces room background!)
      const bgGrad = ctx.createRadialGradient(w * 0.5, h * 0.42, 20, w * 0.5, h * 0.48, Math.max(w, h) * 0.85);
      bgGrad.addColorStop(0, inFrenzy ? '#20140a' : '#101628');
      bgGrad.addColorStop(0.55, '#070a12');
      bgGrad.addColorStop(1, '#040509');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);
    } else {
      ctx.clearRect(0, 0, w, h);
    }

    const horizonY = h * 0.56;
    const vpX = w * 0.5;

    // Subtle atmospheric horizon glow
    const glowGrad = ctx.createRadialGradient(vpX, horizonY, 8, vpX, horizonY, Math.max(w, h) * 0.48);
    glowGrad.addColorStop(0, `rgba(${gridRgb}, ${(0.18 + this.beatPulse * 0.08).toFixed(3)})`);
    glowGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, w, h);

    // Drifting depth stars
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.ambientStars) {
      const sx = vpX + (s.x - 0.5) * w * (1.2 / Math.max(0.18, s.z));
      const sy = horizonY + (s.y - 0.5) * h * (0.9 / Math.max(0.18, s.z));
      if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue;
      const alpha = clamp((1 - s.z) * 0.55, 0.05, 0.55);
      ctx.fillStyle = `rgba(${gridRgb}, ${alpha.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(sx, sy, s.size * (1.1 - s.z * 0.5), 0, Math.PI * 2);
      ctx.fill();
    }

    // Perspective cyber floor grid
    const floorCols = 10;
    ctx.lineWidth = 1.15;
    for (let i = -floorCols; i <= floorCols; i++) {
      const nearX = vpX + i * (w * 0.14);
      const farX = vpX + i * (w * 0.025);
      ctx.strokeStyle = `rgba(${gridRgb}, ${Math.abs(i) <= 2 ? 0.28 : 0.14})`;
      ctx.beginPath();
      ctx.moveTo(farX, horizonY);
      ctx.lineTo(nearX, h + 10);
      ctx.stroke();
    }

    // Horizontal scrolling floor lines
    const rows = 9;
    for (let i = 0; i < rows; i++) {
      const f = ((i / rows) + this.gridScroll) % 1;
      const y = horizonY + Math.pow(f, 2.2) * (h - horizonY + 12);
      const alpha = clamp(f * 0.36 + this.beatPulse * 0.07, 0.04, 0.44);
      ctx.strokeStyle = `rgba(${gridRgb}, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 1 + f * 1.1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Pulsing neon architectural horizon ring
    const ringR = Math.min(w, h) * (0.28 + this.beatPulse * 0.015);
    ctx.strokeStyle = `rgba(${gridRgb}, ${(0.22 + this.beatPulse * 0.14).toFixed(3)})`;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(vpX, horizonY * 0.86, ringR, Math.PI * 1.04, Math.PI * 1.96);
    ctx.stroke();

    // Horizon laser line
    ctx.strokeStyle = `rgba(${gridRgb}, 0.5)`;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, horizonY);
    ctx.lineTo(w, horizonY);
    ctx.stroke();
    ctx.restore();
  }

  _drawHumanHologramLayer(ctx, nowMs) {
    if (this.mode !== 'camera' || !this.tracker.cameraActive) return;

    const zone = ZONES[this.zoneIndex];
    const inFrenzy = this.frenzyTimer > 0;
    const accentRgb = inFrenzy ? [255, 210, 64] : zone.holoTopRgb;
    const secondaryRgb = inFrenzy ? [255, 56, 174] : zone.holoBotRgb;

    let drewMask = false;
    if (this.bodyMode === 'hologram' || this.bodyMode === 'cutout') {
      drewMask = this.tracker.drawHumanLayer(ctx, this.width, this.height, {
        mode: this.bodyMode,
        accentRgb,
        secondaryRgb,
        nowMs,
        bodyOpacity: this.state === 'calibrating' ? 0.95 : 0.9,
      });
    }

    // Optional Cyber Skeleton Accent (or automatic fallback if segmentation mask isn't available yet)
    const lm = this.poseState.mappedLandmarks;
    if (!lm) return;

    const shouldDrawSkeleton = this.showOverlay || (!drewMask && this.bodyMode !== 'camera');
    if (!shouldDrawSkeleton) return;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const alpha = drewMask ? 0.34 : 0.82;
    ctx.strokeStyle = `rgba(${accentRgb[0]}, ${accentRgb[1]}, ${accentRgb[2]}, ${alpha})`;
    ctx.lineWidth = drewMask ? 2.2 : 4.2;

    for (let i = 0; i < UPPER_BODY_CONNECTIONS.length; i++) {
      const [aIdx, bIdx] = UPPER_BODY_CONNECTIONS[i];
      const a = lm[aIdx];
      const b = lm[bIdx];
      if (!a || !b || a.visibility < 0.35 || b.visibility < 0.35) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Glowing joints
    ctx.fillStyle = `rgba(255, 255, 255, ${drewMask ? 0.48 : 0.9})`;
    for (const idx of [0, 11, 12, 13, 14, 15, 16]) {
      const pt = lm[idx];
      if (!pt || pt.visibility < 0.35) continue;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, idx === 0 && !drewMask ? 14 : 3.6, 0, Math.PI * 2);
      if (idx === 0 && !drewMask) {
        ctx.stroke();
      } else {
        ctx.fill();
      }
    }

    ctx.restore();
  }

  _drawWireframePoly(ctx, meshKey, rx, ry, rz, radius, palette, alpha = 1, isMine = false, isStar = false, nowMs = 0) {
    const mesh = MESHES[meshKey] || MESHES.octa;
    const pts = projectVerts3D(mesh, rx, ry, rz, radius);

    // Subtle translucent tinted core glow
    const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, radius * 1.15);
    grad.addColorStop(0, `rgba(${palette.rgb}, ${(0.34 * alpha).toFixed(3)})`);
    grad.addColorStop(0.65, `rgba(${palette.rgb}, ${(0.1 * alpha).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.15, 0, Math.PI * 2);
    ctx.fill();

    // Outer neon bloom lines (no shadowBlur!)
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(${palette.rgb}, ${(0.45 * alpha).toFixed(3)})`;
    ctx.lineWidth = isMine ? 6.5 : 5.5;
    ctx.beginPath();
    for (let i = 0; i < mesh.edges.length; i++) {
      const a = pts[mesh.edges[i][0]];
      const b = pts[mesh.edges[i][1]];
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();

    // Razor-sharp inner glowing wireframe edges
    ctx.strokeStyle = palette.stroke;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = isMine ? 2.4 : 2.1;
    ctx.stroke();

    // White-hot vertex nodes
    ctx.fillStyle = palette.core;
    for (let i = 0; i < pts.length; i++) {
      if (isMine && i === 6) continue;
      ctx.beginPath();
      ctx.arc(pts[i].x, pts[i].y, isMine && i > 6 ? 3.2 : 2.1, 0, Math.PI * 2);
      ctx.fill();
    }

    if (isMine) {
      const pulse = 0.55 + 0.45 * Math.sin(nowMs * 0.015);
      ctx.strokeStyle = `rgba(255, 77, 46, ${(0.75 * pulse * alpha).toFixed(3)})`;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([7, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, radius * 1.24, nowMs * 0.004, nowMs * 0.004 + Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (isStar) {
      // Counter-rotating golden orbital halo
      ctx.strokeStyle = `rgba(255, 224, 102, ${(0.85 * alpha).toFixed(3)})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * 1.32, radius * 0.46, nowMs * 0.0045, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * 1.32, radius * 0.46, -nowMs * 0.0035 + 1.2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  _drawTargets(ctx, nowMs) {
    const list = this.state === 'start' ? this.attractTargets : this.targets;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      ctx.save();
      ctx.translate(t.x, t.y);
      this._drawWireframePoly(
        ctx,
        t.meshKey,
        t.rx,
        t.ry,
        t.rz,
        t.radius,
        t.palette,
        this.state === 'start' ? 0.72 : 1,
        t.kind === 'mine',
        t.kind === 'star',
        nowMs
      );
      ctx.restore();
    }

    // Draw cleanly cleaved halves split along the exact blade cut angle!
    for (let i = 0; i < this.slicedHalves.length; i++) {
      const h = this.slicedHalves[i];
      const alpha = clamp(1 - h.life / h.maxLife, 0, 1);
      ctx.save();
      ctx.translate(h.x, h.y);
      ctx.rotate(h.cutAngle);

      // Clip to top half (side = -1) or bottom half (side = +1)
      ctx.beginPath();
      const pad = h.radius * 2.1;
      if (h.side < 0) {
        ctx.rect(-pad, -pad, pad * 2, pad);
      } else {
        ctx.rect(-pad, 0, pad * 2, pad);
      }
      ctx.clip();

      ctx.rotate(-h.cutAngle);
      this._drawWireframePoly(ctx, h.meshKey, h.rx, h.ry, h.rz, h.radius, h.palette, alpha, false, false, nowMs);

      // Glowing laser-heated seam right along the freshly sliced plane
      ctx.rotate(h.cutAngle);
      ctx.strokeStyle = `rgba(255, 255, 255, ${(alpha * 0.95).toFixed(3)})`;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.moveTo(-h.radius * 0.92, 0);
      ctx.lineTo(h.radius * 0.92, 0);
      ctx.stroke();

      ctx.restore();
    }

    // Draw blinding laser cut flashes
    for (let i = 0; i < this.slashFlashes.length; i++) {
      const f = this.slashFlashes[i];
      const p = f.life / f.maxLife;
      const a = 1 - p;
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.angle);

      ctx.strokeStyle = `rgba(${f.rgb}, ${(a * 0.72).toFixed(3)})`;
      ctx.lineWidth = 10 * a;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-f.len * (0.75 + p * 0.45), 0);
      ctx.lineTo(f.len * (0.75 + p * 0.45), 0);
      ctx.stroke();

      ctx.strokeStyle = `rgba(255, 255, 255, ${(a * 0.95).toFixed(3)})`;
      ctx.lineWidth = 3 * a;
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  _drawPlasmaBlades(ctx, nowMs) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const key of ['left', 'right', 'pointer']) {
      const blade = this.blades[key];
      const pts = blade.points;

      if (pts.length >= 2) {
        // Draw tapered plasma katana ribbon from tail to glowing tip
        for (let i = 1; i < pts.length; i++) {
          const p0 = pts[i - 1];
          const p1 = pts[i];
          const ageFrac = clamp(1 - (nowMs - p1.t) / MAX_TRAIL_AGE_MS, 0, 1);
          const idxFrac = i / (pts.length - 1);
          const wFrac = ageFrac * idxFrac;
          if (wFrac <= 0.02) continue;

          // Outer plasma glow
          ctx.strokeStyle = `rgba(${blade.rgb}, ${(wFrac * 0.42).toFixed(3)})`;
          ctx.lineWidth = 22 * wFrac;
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();

          // Saturated neon edge
          ctx.strokeStyle = `rgba(${blade.rgb}, ${(wFrac * 0.92).toFixed(3)})`;
          ctx.lineWidth = 9 * wFrac;
          ctx.stroke();

          // White-hot core filament
          ctx.strokeStyle = `rgba(255, 255, 255, ${(wFrac * 0.96).toFixed(3)})`;
          ctx.lineWidth = 3.2 * wFrac;
          ctx.stroke();
        }
      }

      // Draw active energy blade emitter ring on live hands (so player always sees blade anchor!)
      if (blade.active && blade.prevX !== null && blade.prevY !== null) {
        const hx = blade.prevX;
        const hy = blade.prevY;
        const grad = ctx.createRadialGradient(hx, hy, 2, hx, hy, 28);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        grad.addColorStop(0.35, `rgba(${blade.rgb}, 0.72)`);
        grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(hx, hy, 28, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = blade.color;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.arc(hx, hy, 15, nowMs * 0.006, nowMs * 0.006 + Math.PI * 1.45);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  _drawEffects(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Shockwave rings
    for (let i = 0; i < this.shockwaves.length; i++) {
      const sw = this.shockwaves[i];
      const p = sw.life / sw.maxLife;
      const r = 10 + p * sw.maxRadius;
      ctx.strokeStyle = `rgba(${sw.rgb}, ${((1 - p) * 0.78).toFixed(3)})`;
      ctx.lineWidth = Math.max(1.2, 5 * (1 - p));
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Sparks
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      const a = 1 - p.life / p.maxLife;
      ctx.fillStyle = `rgba(${p.rgb}, ${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Floating callouts
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < this.floaters.length; i++) {
      const fl = this.floaters[i];
      const a = clamp(1 - fl.life / fl.maxLife, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = fl.big ? 'italic 700 26px "Chakra Petch", sans-serif' : '700 18px "JetBrains Mono", monospace';
      ctx.fillStyle = '#07090c';
      ctx.fillText(fl.text, fl.x + 2, fl.y + 2);
      ctx.fillStyle = fl.color;
      ctx.fillText(fl.text, fl.x, fl.y);
    }
    ctx.restore();

    // Center zone / frenzy banner
    if (this.bannerTimer > 0 && this.bannerText) {
      const a = clamp(this.bannerTimer * 1.4, 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = 'italic 700 28px "Chakra Petch", sans-serif';
      ctx.fillStyle = 'rgba(7, 9, 12, 0.75)';
      ctx.fillText(this.bannerText, this.width * 0.5 + 2, this.height * 0.24 + 2);
      ctx.fillStyle = this.bannerColor;
      ctx.fillText(this.bannerText, this.width * 0.5, this.height * 0.24);
      ctx.restore();
    }

    // Frenzy top progress bar
    if (this.frenzyTimer > 0 && this.state === 'playing') {
      const frac = clamp(this.frenzyTimer / FRENZY_DURATION_SEC, 0, 1);
      const barW = Math.min(260, this.width * 0.58);
      const barX = (this.width - barW) * 0.5;
      const barY = (this.hudEl?.getBoundingClientRect?.().bottom || 74) + 8;
      ctx.save();
      ctx.fillStyle = 'rgba(7, 9, 12, 0.65)';
      ctx.fillRect(barX, barY, barW, 6);
      ctx.fillStyle = '#ffb82e';
      ctx.fillRect(barX, barY, barW * frac, 6);
      ctx.restore();
    }

    // Calibration alignment guide frame
    if (this.state === 'calibrating') {
      const aligned = this.poseState.alignment.aligned;
      const boxW = Math.min(this.width * 0.62, 300);
      const boxH = Math.min(this.height * 0.44, 320);
      const bx = (this.width - boxW) * 0.5;
      const by = this.height * 0.22;
      ctx.save();
      ctx.strokeStyle = aligned ? 'rgba(50, 230, 255, 0.9)' : 'rgba(255, 56, 174, 0.68)';
      ctx.lineWidth = 2.4;
      ctx.setLineDash([12, 8]);
      ctx.strokeRect(bx, by, boxW, boxH);
      ctx.setLineDash([]);
      ctx.restore();
    }

    // Damage / miss red vignette flash
    if (this.hitFlashAlpha > 0.01) {
      ctx.save();
      const grad = ctx.createRadialGradient(
        this.width * 0.5,
        this.height * 0.5,
        Math.min(this.width, this.height) * 0.2,
        this.width * 0.5,
        this.height * 0.5,
        Math.max(this.width, this.height) * 0.72
      );
      grad.addColorStop(0, 'rgba(255, 77, 46, 0)');
      grad.addColorStop(1, `rgba(255, 77, 46, ${this.hitFlashAlpha.toFixed(3)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
    }
  }

  _render(nowMs) {
    const ctx = this.ctx;
    ctx.save();

    if (this.shakeTimer > 0) {
      const mag = this.shakeIntensity * (this.shakeTimer / 0.35);
      ctx.translate((Math.random() - 0.5) * mag * 2, (Math.random() - 0.5) * mag * 2);
    }

    this._drawCyberDojoBackground(ctx, nowMs);
    this._drawHumanHologramLayer(ctx, nowMs);
    this._drawTargets(ctx, nowMs);
    this._drawPlasmaBlades(ctx, nowMs);
    this._drawEffects(ctx);

    ctx.restore();
  }

  _loop(nowMs) {
    const rawDt = (nowMs - this.lastFrameMs) / 1000;
    this.lastFrameMs = nowMs;
    this._update(nowMs, rawDt);
    this._render(nowMs);
    requestAnimationFrame((t) => this._loop(t));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  window.__SLASH_GAME__ = new SlashGame();
});
