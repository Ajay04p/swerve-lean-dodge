// SWERVE — 3D Perspective Lean & Dodge engine, renderer, controls, and UI

import { SoundEngine } from './audio.js?v=4';
import { PoseTracker, UPPER_BODY_CONNECTIONS, ALIGN_BOUNDS } from './tracker.js?v=4';

const STORAGE_KEYS = {
  highScore: 'swerve_high_score',
  sensitivity: 'swerve_sensitivity',
  showOverlay: 'swerve_overlay',
  brightness: 'swerve_brightness',
};

const SENSITIVITY_HINTS = {
  gentle: 'Small lean · great for desk play',
  normal: 'Balanced sway',
  wide: 'Full athletic lean',
};

const COLORS = {
  bg: '#0c0e10',
  stage: '#121518',
  volt: '#c8f53b',
  vermilion: '#ff4d2e',
  vermilionSide: '#9e2613',
  vermilionDeep: '#6e190c',
  amber: '#ffb82e',
  white: '#f2f5f7',
};

// 3D Corridor Perspective Constants
const FOCAL_LENGTH = 0.29;
const SPAWN_Z = 1.05;
const DESPAWN_Z = -0.22;
const PLAYER_UPRIGHT_WY = 0.68;
const PLAYER_DUCK_WY = 0.85;
const LOW_BEAM_TOP_WY = 0.16;
const LOW_BEAM_BOTTOM_WY = 0.6;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function readStorage(key, fallback) {
  try {
    const val = localStorage.getItem(key);
    return val !== null ? val : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Ignore storage errors
  }
}

class SwerveGame {
  constructor() {
    this.audio = new SoundEngine();
    this.tracker = new PoseTracker();

    // DOM Elements
    this.videoEl = document.getElementById('camera-video');
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');

    this.hudEl = document.getElementById('hud');
    this.shieldPips = Array.from(document.querySelectorAll('.shield-pip'));
    this.comboPillEl = document.getElementById('combo-pill');
    this.scoreValueEl = document.getElementById('score-value');
    this.bestInlineEl = document.getElementById('best-inline');
    this.btnRecenter = document.getElementById('btn-recenter');
    this.btnMute = document.getElementById('btn-mute');
    this.iconSoundOn = document.getElementById('icon-sound-on');
    this.iconSoundOff = document.getElementById('icon-sound-off');
    this.btnPause = document.getElementById('btn-pause');

    this.practiceHintEl = document.getElementById('practice-hint');
    this.poseWarningEl = document.getElementById('pose-warning');
    this.toastEl = document.getElementById('toast');

    // Screens
    this.screenStart = document.getElementById('screen-start');
    this.startBestChip = document.getElementById('start-best-chip');
    this.screenLoading = document.getElementById('screen-loading');
    this.loadingSpinner = document.getElementById('loading-spinner');
    this.loadingTitle = document.getElementById('loading-title');
    this.loadingStatus = document.getElementById('loading-status');
    this.cameraErrorBox = document.getElementById('camera-error');
    this.cameraErrorMsg = document.getElementById('camera-error-msg');

    this.screenCalibrate = document.getElementById('screen-calibrate');
    this.calibrateBadge = document.getElementById('calibrate-badge');
    this.calibrateLabel = document.getElementById('calibrate-label');
    this.calibrateTimer = document.getElementById('calibrate-timer');
    this.calibrateFill = document.getElementById('calibrate-fill');
    this.calibrateDelegate = document.getElementById('calibrate-delegate');

    this.screenPause = document.getElementById('screen-pause');
    this.pauseTitle = document.getElementById('pause-title');
    this.pauseGameActions = document.getElementById('pause-game-actions');
    this.btnRecalibrate = document.getElementById('btn-recalibrate');
    this.btnSwitchMode = document.getElementById('btn-switch-mode');
    this.engineStatusEl = document.getElementById('engine-status');

    this.sensitivityBtns = Array.from(document.querySelectorAll('#sensitivity-control .seg-btn'));
    this.sensitivityHintEl = document.getElementById('sensitivity-hint');
    this.sliderBrightness = document.getElementById('slider-brightness');
    this.brightnessValueEl = document.getElementById('brightness-value');
    this.toggleOverlay = document.getElementById('toggle-overlay');
    this.toggleSound = document.getElementById('toggle-sound');

    this.screenGameover = document.getElementById('screen-gameover');
    this.gameoverNewBest = document.getElementById('gameover-new-best');
    this.gameoverScore = document.getElementById('gameover-score');
    this.gameoverBest = document.getElementById('gameover-best');
    this.statDodges = document.getElementById('stat-dodges');
    this.statClose = document.getElementById('stat-close');
    this.statRings = document.getElementById('stat-rings');
    this.statCombo = document.getElementById('stat-combo');
    this.btnGameoverRecalibrate = document.getElementById('btn-gameover-recalibrate');

    // Persisted settings
    this.highScore = Math.max(0, parseInt(readStorage(STORAGE_KEYS.highScore, '0'), 10) || 0);
    const storedBrightness = parseInt(readStorage(STORAGE_KEYS.brightness, '45'), 10);
    this.settings = {
      sensitivity: readStorage(STORAGE_KEYS.sensitivity, 'normal'),
      showOverlay: readStorage(STORAGE_KEYS.showOverlay, '1') !== '0',
      brightness: clamp(Number.isNaN(storedBrightness) ? 45 : storedBrightness, 0, 100),
    };
    if (!SENSITIVITY_HINTS[this.settings.sensitivity]) {
      this.settings.sensitivity = 'normal';
    }
    this.tracker.setSensitivity(this.settings.sensitivity);

    // Viewport geometry
    this.viewW = window.innerWidth;
    this.viewH = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.playLeft = 0;
    this.playW = this.viewW;
    this.playRight = this.viewW;

    // Runtime state
    this.state = 'start'; // 'start' | 'loading' | 'calibrating' | 'ready' | 'playing' | 'paused' | 'gameover'
    this.pauseReturnState = 'playing';
    this.controlMode = 'camera'; // 'camera' | 'practice'
    this.loadingCancelled = false;

    // Gameplay state
    this.score = 0;
    this.shields = 3;
    this.combo = 1;
    this.peakCombo = 1;
    this.elapsedRunSec = 0;
    this.tunnelScroll = 0;
    this.runCycle = 0;
    this.readyTimer = 0;
    this.invulnTimer = 0;
    this.shakeTime = 0;
    this.shakeMag = 0;
    this.damageFlash = 0;
    this.stats = { dodges: 0, closeCalls: 0, rings: 0 };

    // Player core state (wx in [-0.84, 0.84], wy moves from upright to ducked)
    this.player = {
      x: 0.5, // normalized 0..1 across playable width
      targetX: 0.5,
      vx: 0,
      isDucked: false,
      wasDucked: false,
      duckStartTime: 0,
      duckAnim: 0, // 0..1 smooth vertical crouch
      trail: [],
    };

    // Practice mode input state
    this.keys = { left: false, right: false, duck: false };
    this.pointer = { active: false, id: null, x: 0, y: 0, ducking: false };

    // 3D Entities
    this.obstacles = [];
    this.rings = [];
    this.particles = [];
    this.callouts = [];
    this.spawnTimer = 0.6;
    this.lastPattern = null;
    this.samePatternStreak = 0;
    this.toastTimer = null;

    // Latest pose snapshot for rendering
    this.poseState = this.tracker.getState();

    this._bindEvents();
    this._applySettingsToUI();
    this._syncHighScoreUI();
    this._resize();

    this.lastFrameMs = performance.now();
    requestAnimationFrame((t) => this._loop(t));
  }

  _bindEvents() {
    window.addEventListener('resize', () => this._resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this._resize(), 120));

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') {
        this.openPause('playing');
      }
    });

    // Start Screen buttons
    document.getElementById('btn-play-camera').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      this.startCameraFlow();
    });

    document.getElementById('btn-play-practice').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      this.startPracticeMode();
    });

    document.getElementById('btn-start-settings').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      this.openPause('start');
    });

    // Loading / Error screen buttons
    document.getElementById('btn-retry-camera').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      this.startCameraFlow();
    });

    document.getElementById('btn-fallback-practice').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      this.startPracticeMode();
    });

    document.getElementById('btn-cancel-loading').addEventListener('click', () => {
      this.audio.click();
      this.loadingCancelled = true;
      this.tracker.stopCamera();
      this._setCameraVideoVisible(false);
      this._showScreen('start');
    });

    // Calibration screen buttons
    document.getElementById('btn-calibrate-practice').addEventListener('click', () => {
      this.audio.click();
      this.tracker.stopCamera();
      this._setCameraVideoVisible(false);
      this.startPracticeMode();
    });

    // HUD buttons
    this.btnRecenter.addEventListener('click', () => {
      this.audio.unlock();
      if (this.controlMode === 'camera' && this.tracker.recenter()) {
        this.audio.recenter();
        this._showToast('Neutral posture recentered');
      } else {
        this._showToast('Stand in frame to recenter');
      }
    });

    this.btnMute.addEventListener('click', () => {
      this.audio.toggleMute();
      this._syncMuteUI();
    });

    this.btnPause.addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      if (this.state === 'playing' || this.state === 'ready') {
        this.openPause('playing');
      }
    });

    // Pause / Settings modal buttons
    document.getElementById('btn-close-pause').addEventListener('click', () => {
      this.audio.click();
      this.closePause();
    });

    document.getElementById('btn-resume').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      this.closePause();
    });

    document.getElementById('btn-restart').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      this.beginRun();
    });

    this.btnRecalibrate.addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      this.startCalibrationPhase();
    });

    this.btnSwitchMode.addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      if (this.controlMode === 'camera') {
        this.tracker.stopCamera();
        this._setCameraVideoVisible(false);
        this.startPracticeMode();
        this._showToast('Switched to Practice Mode');
      } else {
        this.startCameraFlow();
      }
    });

    // Settings controls
    this.sensitivityBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        this.audio.unlock();
        this.audio.click();
        const mode = btn.dataset.sensitivity;
        this.settings.sensitivity = mode;
        this.tracker.setSensitivity(mode);
        writeStorage(STORAGE_KEYS.sensitivity, mode);
        this._applySettingsToUI();
      });
    });

    this.sliderBrightness.addEventListener('input', (e) => {
      const val = clamp(parseInt(e.target.value, 10) || 0, 0, 100);
      this.settings.brightness = val;
      writeStorage(STORAGE_KEYS.brightness, val);
      this._applySettingsToUI();
    });

    this.toggleOverlay.addEventListener('change', (e) => {
      this.audio.unlock();
      this.audio.click();
      this.settings.showOverlay = Boolean(e.target.checked);
      writeStorage(STORAGE_KEYS.showOverlay, this.settings.showOverlay ? '1' : '0');
    });

    this.toggleSound.addEventListener('change', (e) => {
      const muted = !e.target.checked;
      this.audio.setMuted(muted);
      if (!muted) {
        this.audio.unlock();
        this.audio.click();
      }
      this._syncMuteUI();
    });

    // Game Over screen buttons
    document.getElementById('btn-play-again').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      this.beginRun();
    });

    this.btnGameoverRecalibrate.addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      this.startCalibrationPhase();
    });

    document.getElementById('btn-gameover-home').addEventListener('click', () => {
      this.audio.click();
      this.tracker.stopCamera();
      this._setCameraVideoVisible(false);
      this._showScreen('start');
    });

    // Pointer Controls (Practice Mode: touch/mouse drag)
    const onPointerDown = (e) => {
      if (this.controlMode !== 'practice' || (this.state !== 'playing' && this.state !== 'ready')) return;
      if (e.target !== this.canvas) return;
      this.audio.unlock();
      this.pointer.active = true;
      this.pointer.id = e.pointerId;
      this.canvas.setPointerCapture?.(e.pointerId);
      this._updatePointerPractice(e.clientX, e.clientY);
    };

    const onPointerMove = (e) => {
      if (!this.pointer.active || e.pointerId !== this.pointer.id) return;
      this._updatePointerPractice(e.clientX, e.clientY);
    };

    const onPointerUp = (e) => {
      if (e.pointerId !== this.pointer.id) return;
      this.pointer.active = false;
      this.pointer.id = null;
      this.pointer.ducking = false;
    };

    this.canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    // Keyboard Controls
    window.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'Space'].includes(e.code)) {
        if (this.state === 'playing' || this.state === 'ready') {
          e.preventDefault();
        }
      }

      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.keys.left = true;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') this.keys.right = true;
      if (e.code === 'ArrowDown' || e.code === 'KeyS' || e.code === 'Space') {
        this.keys.duck = true;
      }

      if (e.repeat) return;

      if (e.code === 'KeyP' || e.code === 'Escape') {
        if (this.state === 'playing' || this.state === 'ready') {
          this.audio.click();
          this.openPause('playing');
        } else if (this.state === 'paused') {
          this.audio.click();
          this.closePause();
        }
      } else if (e.code === 'KeyR' && this.state === 'playing' && this.controlMode === 'camera') {
        if (this.tracker.recenter()) {
          this.audio.recenter();
          this._showToast('Neutral posture recentered');
        }
      } else if (e.code === 'KeyM') {
        this.audio.toggleMute();
        this._syncMuteUI();
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') this.keys.left = false;
      if (e.code === 'ArrowRight' || e.code === 'KeyD') this.keys.right = false;
      if (e.code === 'ArrowDown' || e.code === 'KeyS' || e.code === 'Space') {
        this.keys.duck = false;
      }
    });
  }

  _updatePointerPractice(clientX, clientY) {
    this.pointer.x = clientX;
    this.pointer.y = clientY;
    const normX = clamp((clientX - this.playLeft) / this.playW, 0.08, 0.92);
    this.player.targetX = normX;
    this.pointer.ducking = clientY >= this.viewH * 0.72;
  }

  _resize() {
    this.viewW = window.innerWidth;
    this.viewH = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.width = Math.floor(this.viewW * this.dpr);
    this.canvas.height = Math.floor(this.viewH * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.playW = Math.min(this.viewW, 560);
    this.playLeft = (this.viewW - this.playW) * 0.5;
    this.playRight = this.playLeft + this.playW;
  }

  _applySettingsToUI() {
    this.sensitivityBtns.forEach((btn) => {
      const isActive = btn.dataset.sensitivity === this.settings.sensitivity;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
    });
    this.sensitivityHintEl.textContent = SENSITIVITY_HINTS[this.settings.sensitivity];

    this.sliderBrightness.value = String(this.settings.brightness);
    this.brightnessValueEl.textContent = `${this.settings.brightness}%`;
    this.videoEl.style.setProperty('--camera-opacity', (this.settings.brightness / 100).toFixed(2));

    this.toggleOverlay.checked = this.settings.showOverlay;
    this._syncMuteUI();
  }

  _syncMuteUI() {
    const muted = this.audio.isMuted();
    this.iconSoundOn.classList.toggle('hidden', muted);
    this.iconSoundOff.classList.toggle('hidden', !muted);
    this.toggleSound.checked = !muted;
  }

  _syncHighScoreUI() {
    this.bestInlineEl.textContent = `BEST ${this.highScore.toLocaleString()}`;
    if (this.highScore > 0) {
      this.startBestChip.textContent = `BEST ${this.highScore.toLocaleString()}`;
      this.startBestChip.classList.remove('hidden');
    } else {
      this.startBestChip.classList.add('hidden');
    }
  }

  _setCameraVideoVisible(active) {
    this.videoEl.classList.toggle('active', Boolean(active));
  }

  _showScreen(name) {
    this.state = name;
    this.screenStart.classList.toggle('hidden', name !== 'start');
    this.screenLoading.classList.toggle('hidden', name !== 'loading');
    this.screenCalibrate.classList.toggle('hidden', name !== 'calibrating');
    this.screenPause.classList.toggle('hidden', name !== 'paused');
    this.screenGameover.classList.toggle('hidden', name !== 'gameover');

    const showHud =
      name === 'playing' || name === 'ready' || (name === 'paused' && this.pauseReturnState === 'playing');
    this.hudEl.classList.toggle('hidden', !showHud);
    this.btnRecenter.classList.toggle('hidden', this.controlMode !== 'camera');

    if (name !== 'playing' && name !== 'ready') {
      this.poseWarningEl.classList.add('hidden');
      this.practiceHintEl.classList.add('hidden');
    }
  }

  _showToast(message) {
    this.toastEl.textContent = message;
    this.toastEl.classList.remove('hidden');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toastEl.classList.add('hidden');
    }, 2100);
  }

  async startCameraFlow() {
    this.controlMode = 'camera';
    this.loadingCancelled = false;
    this._showScreen('loading');
    this.loadingSpinner.classList.remove('hidden');
    this.loadingTitle.textContent = 'STARTING CAMERA';
    this.loadingStatus.textContent = 'Requesting front camera…';
    this.cameraErrorBox.classList.add('hidden');

    try {
      await this.tracker.startCamera(this.videoEl, (msg) => {
        if (!this.loadingCancelled) this.loadingStatus.textContent = msg;
      });
      if (this.loadingCancelled) return;

      this._setCameraVideoVisible(true);
      this.loadingTitle.textContent = 'LOADING POSE MODEL';

      const delegate = await this.tracker.initModel((msg) => {
        if (!this.loadingCancelled) this.loadingStatus.textContent = msg;
      });
      if (this.loadingCancelled) return;

      this.calibrateDelegate.textContent = `POSE LITE · ${delegate}`;
      this.engineStatusEl.textContent = `CAMERA · ${delegate}`;
      this.startCalibrationPhase();
    } catch (err) {
      if (this.loadingCancelled) return;
      this.loadingSpinner.classList.add('hidden');
      this.loadingTitle.textContent = 'CAMERA UNAVAILABLE';
      this.loadingStatus.textContent = 'You can retry or jump straight into Practice Mode.';
      this.cameraErrorMsg.textContent = err?.message || 'Unable to initialize camera pose tracking.';
      this.cameraErrorBox.classList.remove('hidden');
    }
  }

  startCalibrationPhase() {
    this.controlMode = 'camera';
    this._setCameraVideoVisible(true);
    this.tracker.startCalibration();
    this._showScreen('calibrating');
  }

  startPracticeMode() {
    this.controlMode = 'practice';
    this._setCameraVideoVisible(false);
    this.engineStatusEl.textContent = 'PRACTICE · TOUCH / KEYS';
    this.beginRun();
  }

  openPause(returnState = 'playing') {
    this.pauseReturnState = returnState;
    const isInGame = returnState === 'playing';
    this.pauseTitle.textContent = isInGame ? 'PAUSED' : 'SETTINGS';
    this.pauseGameActions.classList.toggle('hidden', !isInGame);
    this.btnRecalibrate.classList.toggle('hidden', this.controlMode !== 'camera');

    this.btnSwitchMode.textContent =
      this.controlMode === 'camera' ? 'Switch to Practice Mode' : 'Switch to Camera Mode';

    if (this.controlMode === 'camera') {
      this.engineStatusEl.textContent = `CAMERA · ${this.tracker.delegate || 'LITE'}`;
    } else {
      this.engineStatusEl.textContent = 'PRACTICE · TOUCH / KEYS';
    }

    this._showScreen('paused');
  }

  closePause() {
    if (this.pauseReturnState === 'playing') {
      this._showScreen('playing');
    } else {
      this._showScreen('start');
    }
  }

  beginRun() {
    this.score = 0;
    this.shields = 3;
    this.combo = 1;
    this.peakCombo = 1;
    this.elapsedRunSec = 0;
    this.tunnelScroll = 0;
    this.readyTimer = 0.6;
    this.invulnTimer = 0;
    this.shakeTime = 0;
    this.shakeMag = 0;
    this.damageFlash = 0;
    this.stats = { dodges: 0, closeCalls: 0, rings: 0 };

    this.obstacles = [];
    this.rings = [];
    this.particles = [];
    this.callouts = [];
    this.spawnTimer = 0.55;
    this.lastPattern = null;
    this.samePatternStreak = 0;

    this.player.x = 0.5;
    this.player.targetX = 0.5;
    this.player.vx = 0;
    this.player.isDucked = false;
    this.player.wasDucked = false;
    this.player.duckAnim = 0;
    this.player.trail = [];

    this._syncScoreHUD();
    this._syncShieldsHUD();
    this._syncComboHUD();
    this._showScreen('ready');

    if (this.controlMode === 'practice') {
      this.practiceHintEl.classList.remove('hidden');
      this.practiceHintEl.style.opacity = '1';
    }

    this.audio.ready();
  }

  endGame() {
    this.audio.gameOver();
    const isNewBest = this.score > this.highScore;
    if (isNewBest) {
      this.highScore = this.score;
      writeStorage(STORAGE_KEYS.highScore, this.highScore);
      this._syncHighScoreUI();
    }

    this.gameoverNewBest.classList.toggle('hidden', !isNewBest);
    this.gameoverScore.textContent = this.score.toLocaleString();
    this.gameoverBest.textContent = `BEST ${this.highScore.toLocaleString()}`;
    this.statDodges.textContent = String(this.stats.dodges);
    this.statClose.textContent = String(this.stats.closeCalls);
    this.statRings.textContent = String(this.stats.rings);
    this.statCombo.textContent = `×${this.peakCombo}`;
    this.btnGameoverRecalibrate.classList.toggle('hidden', this.controlMode !== 'camera');

    this._showScreen('gameover');
  }

  _syncScoreHUD() {
    this.scoreValueEl.textContent = this.score.toLocaleString();
    if (this.score > this.highScore) {
      this.bestInlineEl.textContent = `BEST ${this.score.toLocaleString()}`;
    }
  }

  _syncShieldsHUD() {
    this.shieldPips.forEach((pip, i) => {
      pip.classList.toggle('active', i < this.shields);
      pip.classList.toggle('damaged', i >= this.shields);
    });
  }

  _syncComboHUD() {
    if (this.combo > 1) {
      this.comboPillEl.textContent = `×${this.combo}`;
      this.comboPillEl.classList.remove('hidden');
    } else {
      this.comboPillEl.classList.add('hidden');
    }
  }

  // ==================== 3D PERSPECTIVE PROJECTION ====================

  _getCorridorCamera() {
    const nearW = this.playW * 0.94;
    const nearH = this.viewH * 0.68;
    const cx = this.viewW * 0.5;
    const cy = this.viewH * 0.49;

    // Slight elevated third-person 3D chase-cam with head-coupled lean & duck parallax
    const leanNorm = (this.player.x - 0.5) * 2; // -1..1
    const vpX = cx - leanNorm * (this.playW * 0.085);
    const vpY = this.viewH * 0.38 + this.player.duckAnim * (this.viewH * 0.05);

    return { nearW, nearH, cx, cy, vpX, vpY };
  }

  _project(wx, wy, z, cam = this._getCorridorCamera()) {
    const s = FOCAL_LENGTH / Math.max(0.065, z + FOCAL_LENGTH);
    const sx = cam.vpX + (cam.cx - cam.vpX + wx * (cam.nearW * 0.5)) * s;
    const sy = cam.vpY + (cam.cy - cam.vpY + wy * (cam.nearH * 0.5)) * s;
    return { x: sx, y: sy, s };
  }

  _getPlayerMetrics() {
    const cam = this._getCorridorCamera();
    const wx = clamp((this.player.x - 0.5) * 1.7, -0.83, 0.83);
    const wy = lerp(PLAYER_UPRIGHT_WY, PLAYER_DUCK_WY, this.player.duckAnim);
    const pt = this._project(wx, wy, 0, cam);
    const floorPt = this._project(wx, 1.0, 0, cam);

    // Sleek, unmistakably readable athletic runner scaled cleanly to corridor height
    const bodyH = clamp(cam.nearH * 0.27, 114, 162);
    const r = clamp(bodyH * 0.115, 12, 17);
    const hitHalfWx = clamp((bodyH * 0.145) / (cam.nearW * 0.5), 0.068, 0.105);

    return { x: pt.x, y: pt.y, floorX: floorPt.x, floorY: floorPt.y, wx, wy, r, bodyH, hitHalfWx, cam };
  }

  _getDifficulty() {
    // Smooth progression over ~95 seconds of survival
    const t = clamp(this.elapsedRunSec / 95, 0, 1);
    const zSpeed = 0.54 + t * 0.56; // depth units/sec (1.0 -> 0.0 takes ~1.85s ramping to ~0.91s)
    const telegraphSec = 0.62 - t * 0.2;
    const spawnIntervalSec = 1.5 - t * 0.64;
    return { t, zSpeed, telegraphSec, spawnIntervalSec };
  }

  _spawnNextWave() {
    const diff = this._getDifficulty();
    const patterns = ['left', 'right', 'center', 'lowBeam'];

    let weights = [1.0, 1.0, 0.95, 0.88];
    if (this.elapsedRunSec < 4.5) {
      weights = [1.2, 1.2, 0.7, 0.4];
    }

    if (this.lastPattern !== null) {
      const lastIdx = patterns.indexOf(this.lastPattern);
      if (this.samePatternStreak >= 2 && lastIdx >= 0) {
        weights[lastIdx] = 0;
      } else if (this.lastPattern === 'lowBeam') {
        weights[3] *= 0.3;
      }
    }

    const total = weights.reduce((a, b) => a + b, 0);
    let pick = Math.random() * total;
    let type = patterns[0];
    for (let i = 0; i < patterns.length; i++) {
      pick -= weights[i];
      if (pick <= 0) {
        type = patterns[i];
        break;
      }
    }

    if (type === this.lastPattern) {
      this.samePatternStreak += 1;
    } else {
      this.lastPattern = type;
      this.samePatternStreak = 1;
    }

    let extraDelay = 0;
    const prevObs = this.obstacles[this.obstacles.length - 1];
    if (
      prevObs &&
      ((prevObs.type === 'left' && type === 'right') || (prevObs.type === 'right' && type === 'left'))
    ) {
      extraDelay = 0.16;
    }

    let wx1 = -1;
    let wx2 = 1;
    let wy1 = -1;
    let wy2 = 1;
    let depth = 0.1;

    if (type === 'left') {
      wx1 = -1.0;
      wx2 = 0.14;
    } else if (type === 'right') {
      wx1 = -0.14;
      wx2 = 1.0;
    } else if (type === 'center') {
      wx1 = -0.36;
      wx2 = 0.36;
      depth = 0.12;
    } else if (type === 'lowBeam') {
      wx1 = -1.0;
      wx2 = 1.0;
      wy1 = LOW_BEAM_TOP_WY;
      wy2 = LOW_BEAM_BOTTOM_WY;
      depth = 0.12;
    }

    const obs = {
      type,
      wx1,
      wx2,
      wy1,
      wy2,
      depth,
      z: SPAWN_Z,
      zSpeed: diff.zSpeed,
      state: 'telegraph',
      telegraphTimer: 0,
      telegraphDuration: diff.telegraphSec,
      cleared: false,
      hit: false,
      minClearanceWx: Infinity,
      closeDuck: false,
      enteredHitBand: false,
    };

    this.obstacles.push(obs);

    // Collectible 3D Gold Ring in the safe clearance lane (~58% of waves)
    if (Math.random() < 0.58) {
      let ringWx = 0;
      let ringWy = PLAYER_UPRIGHT_WY;
      if (type === 'left') {
        ringWx = 0.58;
      } else if (type === 'right') {
        ringWx = -0.58;
      } else if (type === 'center') {
        ringWx = Math.random() < 0.5 ? -0.68 : 0.68;
      } else if (type === 'lowBeam') {
        ringWx = (Math.random() - 0.5) * 0.7;
        ringWy = PLAYER_DUCK_WY;
      }

      this.rings.push({
        wx: ringWx,
        wy: ringWy,
        z: SPAWN_Z,
        zSpeed: diff.zSpeed,
        delay: diff.telegraphSec + 0.04,
        active: false,
        collected: false,
        spin: Math.random() * Math.PI * 2,
      });
    }

    this.spawnTimer = diff.spawnIntervalSec + extraDelay + (Math.random() * 0.15 - 0.075);
  }

  _spawnParticles(x, y, color, count = 14, speedScale = 1) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.45;
      const speed = (75 + Math.random() * 195) * speedScale;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2.5 + Math.random() * 4,
        color,
        life: 0.32 + Math.random() * 0.25,
        maxLife: 0.57,
      });
    }
  }

  _addCallout(x, y, text, color = COLORS.volt, size = 16) {
    this.callouts.push({
      x: clamp(x, this.playLeft + 54, this.playRight - 54),
      y,
      text,
      color,
      size,
      life: 0.85,
      maxLife: 0.85,
    });
  }

  _loop(nowMs) {
    const dtSec = Math.min((nowMs - this.lastFrameMs) / 1000, 0.05);
    this.lastFrameMs = nowMs;

    this._update(nowMs, dtSec);
    this._render(nowMs);

    requestAnimationFrame((t) => this._loop(t));
  }

  _update(nowMs, dtSec) {
    if (this.controlMode === 'camera' && this.tracker.cameraActive) {
      this.poseState = this.tracker.update(nowMs, dtSec, this.viewW, this.viewH);
    }

    // Gentle tunnel drift on start / ready screens
    if (this.state === 'start' || this.state === 'ready') {
      this.tunnelScroll = (this.tunnelScroll + dtSec * 0.35) % 1;
      this.runCycle += dtSec * 7.5;
    }

    if (this.state === 'calibrating') {
      this._updateCalibrationUI();
      return;
    }

    if (this.state === 'ready') {
      this._updatePlayerControl(nowMs, dtSec);
      this.readyTimer -= dtSec;
      if (this.readyTimer <= 0) {
        this._showScreen('playing');
      }
      return;
    }

    if (this.state !== 'playing') {
      return;
    }

    this.elapsedRunSec += dtSec;
    const diff = this._getDifficulty();
    this.tunnelScroll = (this.tunnelScroll + dtSec * diff.zSpeed * 0.72) % 1;
    this.runCycle += dtSec * (9.5 + diff.t * 4.5);

    if (this.controlMode === 'practice' && this.elapsedRunSec > 6.5) {
      this.practiceHintEl.style.opacity = '0';
    }

    this._updatePlayerControl(nowMs, dtSec);
    this._updateGameplayEntities(nowMs, dtSec);
  }

  _updateCalibrationUI() {
    const p = this.poseState;
    const align = p.alignment || { aligned: false, hint: 'Step into frame · show head & shoulders' };
    const progress = p.calibrationProgress;
    const pct = Math.round(progress * 100);
    const remaining = Math.max(0, 1.4 * (1 - progress));

    this.calibrateFill.style.width = `${pct}%`;
    this.calibrateTimer.textContent = align.aligned ? `${remaining.toFixed(1)}s` : 'WAIT';
    this.calibrateLabel.textContent = align.hint;

    if (align.aligned) {
      this.calibrateBadge.textContent = 'ALIGNED · HOLD STILL';
      this.calibrateBadge.classList.remove('warn');
    } else {
      this.calibrateBadge.textContent = 'ALIGN IN TARGET BOX';
      this.calibrateBadge.classList.add('warn');
    }

    if (p.calibrated && !p.calibrating) {
      this._showToast('Posture calibrated');
      this.beginRun();
    }
  }

  _updatePlayerControl(nowMs, dtSec) {
    if (this.controlMode === 'camera') {
      const p = this.poseState;
      this.poseWarningEl.classList.toggle('hidden', p.hasPose);

      if (p.hasPose) {
        this.player.targetX = clamp(0.5 + p.lean * 0.5, 0, 1);
        this.player.isDucked = p.isDucked;
      } else {
        this.player.isDucked = false;
      }

      const alpha = 1 - Math.exp(-dtSec / 0.035);
      const prevX = this.player.x;
      this.player.x += (this.player.targetX - this.player.x) * alpha;
      this.player.vx = (this.player.x - prevX) / Math.max(0.001, dtSec);
    } else {
      const keyDir = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
      if (keyDir !== 0) {
        this.player.targetX = clamp(this.player.targetX + keyDir * dtSec * 1.45, 0, 1);
      }

      const alpha = 1 - Math.exp(-dtSec / 0.04);
      const prevX = this.player.x;
      this.player.x += (this.player.targetX - this.player.x) * alpha;
      this.player.vx = (this.player.x - prevX) / Math.max(0.001, dtSec);

      this.player.isDucked = Boolean(this.keys.duck || this.pointer.ducking);
    }

    if (this.player.isDucked && !this.player.wasDucked) {
      this.player.duckStartTime = nowMs;
      this.audio.duck();
    }
    this.player.wasDucked = this.player.isDucked;

    const duckTarget = this.player.isDucked ? 1 : 0;
    this.player.duckAnim += (duckTarget - this.player.duckAnim) * (1 - Math.exp(-dtSec / 0.055));

    const pm = this._getPlayerMetrics();
    this.player.trail.unshift({
      x: pm.x,
      y: pm.y,
      floorX: pm.floorX,
      floorY: pm.floorY,
      duck: this.player.duckAnim,
    });
    if (this.player.trail.length > 5) {
      this.player.trail.pop();
    }
  }

  _updateGameplayEntities(nowMs, dtSec) {
    if (this.invulnTimer > 0) {
      this.invulnTimer = Math.max(0, this.invulnTimer - dtSec);
    }
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - dtSec);
    }
    if (this.damageFlash > 0) {
      this.damageFlash = Math.max(0, this.damageFlash - dtSec * 1.8);
    }

    this.spawnTimer -= dtSec;
    if (this.spawnTimer <= 0) {
      this._spawnNextWave();
    }

    const pm = this._getPlayerMetrics();
    const nearMissThresholdWx = 0.2;

    // Update 3D obstacles
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];

      if (obs.state === 'telegraph') {
        obs.telegraphTimer += dtSec;
        if (obs.telegraphTimer >= obs.telegraphDuration) {
          obs.state = 'active';
          obs.z = SPAWN_Z;
        }
        continue;
      }

      obs.z -= obs.zSpeed * dtSec;
      const zFront = obs.z;
      const zBack = obs.z + obs.depth;

      // Player sits at z = 0 plane
      const overlapsZ = zFront <= 0.025 && zBack >= -0.025;

      if (overlapsZ && !obs.hit) {
        if (obs.type === 'lowBeam') {
          if (!obs.enteredHitBand) {
            obs.enteredHitBand = true;
            if (this.player.isDucked && nowMs - this.player.duckStartTime <= 300) {
              obs.closeDuck = true;
            }
          }
          if (!this.player.isDucked) {
            this._handlePlayerHit(obs, pm);
          }
        } else {
          const overlapsX = pm.wx + pm.hitHalfWx > obs.wx1 && pm.wx - pm.hitHalfWx < obs.wx2;
          if (overlapsX) {
            this._handlePlayerHit(obs, pm);
          } else {
            const distLeft = obs.wx1 - (pm.wx + pm.hitHalfWx);
            const distRight = pm.wx - pm.hitHalfWx - obs.wx2;
            const clearance = Math.max(distLeft, distRight);
            if (clearance < obs.minClearanceWx) {
              obs.minClearanceWx = clearance;
            }
          }
        }
      }

      // Passed cleanly behind player plane
      if (!obs.cleared && !obs.hit && zBack < -0.025) {
        obs.cleared = true;
        this.stats.dodges += 1;
        this.combo = Math.min(this.combo + 1, 12);
        if (this.combo > this.peakCombo) this.peakCombo = this.combo;

        const isNearMiss =
          (obs.type !== 'lowBeam' && obs.minClearanceWx <= nearMissThresholdWx) ||
          (obs.type === 'lowBeam' && obs.closeDuck);

        if (isNearMiss) {
          const pts = 55 * this.combo;
          this.score += pts;
          this.stats.closeCalls += 1;
          this.audio.closeCall(this.combo);
          this._spawnParticles(pm.x, pm.y - 8, COLORS.amber, 12, 0.9);
          this._addCallout(pm.x, pm.y - 34, `CLOSE! +${pts}`, COLORS.amber, 17);
        } else {
          const pts = 20 * this.combo;
          this.score += pts;
          this.audio.dodge(this.combo);
          this._addCallout(pm.x, pm.y - 28, `+${pts}`, COLORS.volt, 14);
        }

        this._syncScoreHUD();
        this._syncComboHUD();
      }

      if (zBack < DESPAWN_Z) {
        this.obstacles.splice(i, 1);
      }
    }

    // Update 3D collectible Gold Rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i];
      if (!ring.active) {
        ring.delay -= dtSec;
        if (ring.delay <= 0) {
          ring.active = true;
          ring.z = SPAWN_Z;
        }
        continue;
      }

      ring.z -= ring.zSpeed * dtSec;
      ring.spin += dtSec * 4.2;

      if (!ring.collected && Math.abs(ring.z) <= 0.085) {
        const dx = Math.abs(ring.wx - pm.wx);
        const dy = Math.abs(ring.wy - pm.wy);
        if (dx <= 0.3 && dy <= 0.38) {
          ring.collected = true;
          const pts = 50 * this.combo;
          this.score += pts;
          this.stats.rings += 1;
          const rp = this._project(ring.wx, ring.wy, Math.max(0, ring.z), pm.cam);
          this.audio.goldRing(this.combo);
          this._spawnParticles(rp.x, rp.y, COLORS.amber, 16, 1.05);
          this._addCallout(rp.x, rp.y - 24, `RING +${pts}`, COLORS.amber, 16);
          this._syncScoreHUD();
          this.rings.splice(i, 1);
          continue;
        }
      }

      if (ring.z < DESPAWN_Z) {
        this.rings.splice(i, 1);
      }
    }

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dtSec;
      pt.x += pt.vx * dtSec;
      pt.y += pt.vy * dtSec;
      pt.vx *= 0.94;
      pt.vy *= 0.94;
      if (pt.life <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // Update floating callouts
    for (let i = this.callouts.length - 1; i >= 0; i--) {
      const c = this.callouts[i];
      c.life -= dtSec;
      c.y -= 48 * dtSec;
      if (c.life <= 0) {
        this.callouts.splice(i, 1);
      }
    }
  }

  _handlePlayerHit(obs, pm) {
    obs.hit = true;
    if (this.invulnTimer > 0) return;

    this.shields -= 1;
    this.combo = 1;
    this.invulnTimer = 1.4;
    this.shakeTime = 0.28;
    this.shakeMag = 14;
    this.damageFlash = 0.44;

    this._syncShieldsHUD();
    this._syncComboHUD();
    this._spawnParticles(pm.x, pm.y, COLORS.vermilion, 22, 1.3);
    this._addCallout(pm.x, pm.y - 32, 'SHIELD HIT', COLORS.vermilion, 16);
    this.audio.hit();

    if (this.shields <= 0) {
      this.endGame();
    }
  }

  // ==================== 3D RENDERING ====================

  _render(nowMs) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.viewW, this.viewH);

    ctx.save();

    if (this.shakeTime > 0) {
      const decay = this.shakeTime / 0.28;
      const sx = (Math.random() * 2 - 1) * this.shakeMag * decay;
      const sy = (Math.random() * 2 - 1) * this.shakeMag * decay;
      ctx.translate(sx, sy);
    }

    const cam = this._getCorridorCamera();

    // 1. 3D Perspective Studio Corridor
    this._draw3DTunnel(ctx, cam);

    // 2. Subtle Pose Skeleton & Duck Clearance Line (camera mode)
    if (
      this.controlMode === 'camera' &&
      this.tracker.cameraActive &&
      (this.settings.showOverlay || this.state === 'calibrating')
    ) {
      this._drawPoseOverlay(ctx, nowMs);
    }

    // 3. Practice mode duck zone hint while dragging
    if (this.controlMode === 'practice' && (this.state === 'playing' || this.state === 'ready')) {
      this._drawPracticeDuckZone(ctx);
    }

    // 4. 3D Telegraphs & Painter-Sorted Obstacles, Gold Rings, and Runner Body
    if (
      this.state === 'playing' ||
      this.state === 'ready' ||
      this.state === 'paused' ||
      this.state === 'gameover'
    ) {
      this._drawTelegraphs(ctx, cam, nowMs);
      this._draw3DEntitiesSorted(ctx, cam, nowMs);
      this._drawParticles(ctx);
      this._drawCallouts(ctx);
    }

    if (this.state === 'ready') {
      this._drawReadyBanner(ctx);
    }

    if (this.damageFlash > 0) {
      ctx.fillStyle = `rgba(255, 77, 46, ${(this.damageFlash * 0.42).toFixed(3)})`;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }

    ctx.restore();
  }

  _draw3DTunnel(ctx, cam) {
    ctx.save();

    const farZ = SPAWN_Z;
    const nearZ = 0;

    // 4 perspective corner rails from distant portal to near plane
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ];

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1.25;
    for (const [wx, wy] of corners) {
      const pFar = this._project(wx, wy, farZ, cam);
      const pNear = this._project(wx, wy, nearZ, cam);
      ctx.beginPath();
      ctx.moveTo(pFar.x, pFar.y);
      ctx.lineTo(pNear.x, pNear.y);
      ctx.stroke();
    }

    // Subtle floor lane guide lines (left/center/right cues receding into depth)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1;
    for (const laneWx of [-0.36, 0.36]) {
      const pFar = this._project(laneWx, 1, farZ, cam);
      const pNear = this._project(laneWx, 1, nearZ, cam);
      ctx.beginPath();
      ctx.moveTo(pFar.x, pFar.y);
      ctx.lineTo(pNear.x, pNear.y);
      ctx.stroke();
    }

    // Speeding depth portal rings rushing toward camera
    const frameCount = 5;
    for (let i = 0; i < frameCount; i++) {
      let z = ((i / frameCount) - this.tunnelScroll + 1) % 1;
      z = z * (SPAWN_Z + 0.08) - 0.08;
      if (z < -0.05 || z > SPAWN_Z) continue;

      const tl = this._project(-1, -1, z, cam);
      const br = this._project(1, 1, z, cam);
      const depthAlpha = clamp(1 - z / SPAWN_Z, 0.08, 1) * (z < 0 ? clamp(1 + z * 8, 0, 1) : 1);

      ctx.strokeStyle = `rgba(255, 255, 255, ${(0.05 + depthAlpha * 0.12).toFixed(3)})`;
      ctx.lineWidth = 1 + depthAlpha * 0.7;
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    }

    // Crisp far vanishing portal rectangle
    const fTL = this._project(-1, -1, farZ, cam);
    const fBR = this._project(1, 1, farZ, cam);
    ctx.fillStyle = 'rgba(12, 14, 16, 0.32)';
    ctx.fillRect(fTL.x, fTL.y, fBR.x - fTL.x, fBR.y - fTL.y);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = 1.4;
    ctx.strokeRect(fTL.x, fTL.y, fBR.x - fTL.x, fBR.y - fTL.y);

    // Subtle near player-plane horizon frame
    const nTL = this._project(-1, -1, 0, cam);
    const nBR = this._project(1, 1, 0, cam);
    ctx.strokeStyle = 'rgba(200, 245, 59, 0.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(nTL.x, nTL.y, nBR.x - nTL.x, nBR.y - nTL.y);

    ctx.restore();
  }

  _drawTelegraphs(ctx, cam, nowMs) {
    const hudRect = this.hudEl.getBoundingClientRect();
    const topBarY = Math.max(12, Math.round(hudRect.bottom) + 4);

    for (const obs of this.obstacles) {
      if (obs.state !== 'telegraph') continue;

      const progress = clamp(obs.telegraphTimer / obs.telegraphDuration, 0, 1);
      const pulse = 0.55 + Math.sin(nowMs * 0.026) * 0.35;
      const isBeam = obs.type === 'lowBeam';
      const isSafeBeam = isBeam && this.player.isDucked;
      const accent = isSafeBeam ? COLORS.volt : COLORS.vermilion;

      ctx.save();

      // 1. 3D Distant Portal Preview showing exact upcoming 3D obstacle silhouette
      const pTL = this._project(obs.wx1, obs.wy1, SPAWN_Z, cam);
      const pBR = this._project(obs.wx2, obs.wy2, SPAWN_Z, cam);
      const pw = pBR.x - pTL.x;
      const ph = pBR.y - pTL.y;

      ctx.fillStyle = isSafeBeam
        ? `rgba(200, 245, 59, ${(0.18 + progress * 0.28).toFixed(3)})`
        : `rgba(255, 77, 46, ${(0.22 + progress * 0.36).toFixed(3)})`;
      ctx.fillRect(pTL.x, pTL.y, pw, ph);

      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.65 + progress * 0.35;
      ctx.strokeRect(pTL.x, pTL.y, pw, ph);

      // 2. Compact notch-safe top-edge telegraph bar matching obstacle X span
      const leftNorm = (obs.wx1 + 1) * 0.5;
      const widthNorm = (obs.wx2 - obs.wx1) * 0.5;
      const bx = this.playLeft + leftNorm * this.playW + 4;
      const bw = widthNorm * this.playW - 8;

      ctx.globalAlpha = 1;
      ctx.fillStyle = isSafeBeam ? 'rgba(200, 245, 59, 0.2)' : 'rgba(255, 77, 46, 0.22)';
      this._roundRect(ctx, bx, topBarY, bw, 7, 4);
      ctx.fill();

      const fillW = Math.max(8, bw * progress);
      ctx.fillStyle = accent;
      this._roundRect(ctx, bx + (bw - fillW) * 0.5, topBarY, fillW, 7, 4);
      ctx.fill();

      if (isBeam) {
        ctx.globalAlpha = pulse;
        ctx.font = '700 10.5px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = accent;
        ctx.fillText(isSafeBeam ? 'LOW BEAM · CLEAR' : '▼ LOW BEAM · DUCK ▼', bx + bw * 0.5, topBarY + 20);
        ctx.textAlign = 'left';
      }

      ctx.restore();
    }
  }

  _draw3DEntitiesSorted(ctx, cam, nowMs) {
    // Painter's algorithm: sort obstacles, gold rings, and the player avatar body (z=0) back-to-front
    const items = [{ kind: 'player', z: 0.0, ref: null }];
    for (const obs of this.obstacles) {
      if (obs.state === 'active') {
        items.push({ kind: 'obs', z: obs.z, ref: obs });
      }
    }
    for (const ring of this.rings) {
      if (ring.active && !ring.collected) {
        items.push({ kind: 'ring', z: ring.z, ref: ring });
      }
    }

    items.sort((a, b) => b.z - a.z);

    for (const item of items) {
      if (item.kind === 'obs') {
        this._draw3DObstacle(ctx, item.ref, cam);
      } else if (item.kind === 'ring') {
        this._draw3DRing(ctx, item.ref, cam);
      } else {
        this._drawPlayerBody(ctx, nowMs);
      }
    }
  }

  _draw3DObstacle(ctx, obs, cam) {
    const zFront = obs.z;
    const zBack = obs.z + obs.depth;

    // Fade in smoothly from distant fog and fade out right as it flies past camera
    const farFade = clamp((SPAWN_Z - zFront) * 4.5 + 0.28, 0.22, 1);
    const nearFade = zFront < -0.02 ? clamp(1 - (-0.02 - zFront) / 0.16, 0, 1) : 1;
    const alpha = farFade * nearFade;
    if (alpha <= 0.01) return;

    const isBeam = obs.type === 'lowBeam';
    const isBeamCleared = isBeam && this.player.isDucked;

    // Project all 8 corners of the 3D slab
    const fTL = this._project(obs.wx1, obs.wy1, zFront, cam);
    const fTR = this._project(obs.wx2, obs.wy1, zFront, cam);
    const fBR = this._project(obs.wx2, obs.wy2, zFront, cam);
    const fBL = this._project(obs.wx1, obs.wy2, zFront, cam);

    const bTL = this._project(obs.wx1, obs.wy1, zBack, cam);
    const bTR = this._project(obs.wx2, obs.wy1, zBack, cam);
    const bBR = this._project(obs.wx2, obs.wy2, zBack, cam);
    const bBL = this._project(obs.wx1, obs.wy2, zBack, cam);

    ctx.save();
    ctx.globalAlpha = alpha;

    // 1. Draw visible 3D extruded side / top / underside faces first
    const sideFill = isBeamCleared ? 'rgba(130, 180, 32, 0.34)' : COLORS.vermilionSide;
    const topFill = isBeamCleared ? 'rgba(165, 215, 48, 0.36)' : '#c7311a';
    const underFill = isBeamCleared ? 'rgba(200, 245, 59, 0.26)' : COLORS.vermilionDeep;

    // Right inner face (visible when obstacle's right edge is left of vanishing point)
    if (fTR.x < cam.vpX && obs.wx2 < 0.99) {
      ctx.fillStyle = sideFill;
      ctx.beginPath();
      ctx.moveTo(fTR.x, fTR.y);
      ctx.lineTo(bTR.x, bTR.y);
      ctx.lineTo(bBR.x, bBR.y);
      ctx.lineTo(fBR.x, fBR.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = isBeamCleared ? 'rgba(200, 245, 59, 0.55)' : 'rgba(255, 165, 145, 0.35)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Left inner face (visible when obstacle's left edge is right of vanishing point)
    if (fTL.x > cam.vpX && obs.wx1 > -0.99) {
      ctx.fillStyle = sideFill;
      ctx.beginPath();
      ctx.moveTo(fTL.x, fTL.y);
      ctx.lineTo(bTL.x, bTL.y);
      ctx.lineTo(bBL.x, bBL.y);
      ctx.lineTo(fBL.x, fBL.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = isBeamCleared ? 'rgba(200, 245, 59, 0.55)' : 'rgba(255, 165, 145, 0.35)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Top 3D bevel face for overhead Low Beam crossbar (visible when crossbar top is below horizon vpY)
    if (isBeam && fTL.y > cam.vpY) {
      ctx.fillStyle = topFill;
      ctx.beginPath();
      ctx.moveTo(fTL.x, fTL.y);
      ctx.lineTo(fTR.x, fTR.y);
      ctx.lineTo(bTR.x, bTR.y);
      ctx.lineTo(bTL.x, bTL.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = isBeamCleared ? 'rgba(200, 245, 59, 0.65)' : 'rgba(255, 185, 168, 0.45)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Underside face for overhead Low Beam (visible if beam bottom rises above vpY)
    if (isBeam && fBL.y < cam.vpY) {
      ctx.fillStyle = underFill;
      ctx.beginPath();
      ctx.moveTo(fBL.x, fBL.y);
      ctx.lineTo(fBR.x, fBR.y);
      ctx.lineTo(bBR.x, bBR.y);
      ctx.lineTo(bBL.x, bBL.y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = isBeamCleared ? COLORS.volt : 'rgba(255, 165, 145, 0.45)';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    // 2. Draw Front Face
    const fw = fTR.x - fTL.x;
    const fh = fBL.y - fTL.y;

    if (isBeamCleared) {
      // Safe ducked clearance look: crisp translucent volt frame
      ctx.fillStyle = 'rgba(200, 245, 59, 0.2)';
      ctx.fillRect(fTL.x, fTL.y, fw, fh);
      ctx.strokeStyle = COLORS.volt;
      ctx.lineWidth = Math.max(1.5, 2.8 * fTL.s);
      ctx.strokeRect(fTL.x, fTL.y, fw, fh);
    } else {
      // High-contrast studio vermilion barrier with subtle gradient depth & hazard chevrons
      const grad = ctx.createLinearGradient(fTL.x, fTL.y, fTL.x, fBL.y);
      grad.addColorStop(0, '#ff5c3d');
      grad.addColorStop(1, '#db3218');
      ctx.fillStyle = grad;
      ctx.fillRect(fTL.x, fTL.y, fw, fh);

      // Diagonal hazard stripes clipped to front face
      ctx.save();
      ctx.beginPath();
      ctx.rect(fTL.x, fTL.y, fw, fh);
      ctx.clip();
      ctx.fillStyle = 'rgba(12, 14, 16, 0.18)';
      const stripeW = Math.max(8, 22 * fTL.s);
      for (let sx = fTL.x - fh; sx < fTR.x + fh; sx += stripeW * 2.2) {
        ctx.beginPath();
        ctx.moveTo(sx, fBL.y);
        ctx.lineTo(sx + stripeW, fBL.y);
        ctx.lineTo(sx + stripeW + fh * 0.45, fTL.y);
        ctx.lineTo(sx + fh * 0.45, fTL.y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      // Bright edge bevel for razor-sharp 3D read
      ctx.strokeStyle = 'rgba(255, 200, 185, 0.72)';
      ctx.lineWidth = Math.max(1, 2.2 * fTL.s);
      ctx.strokeRect(fTL.x, fTL.y, fw, fh);
    }

    // 3. Low Beam bottom clearance lip & badge
    if (isBeam && fw > 90) {
      ctx.fillStyle = isBeamCleared ? COLORS.volt : '#fff1ec';
      const lipH = Math.max(2, 4 * fTL.s);
      ctx.fillRect(fBL.x, fBL.y - lipH, fw, lipH);

      const fontSize = clamp(Math.round(13 * fTL.s), 9, 15);
      const badgeText = isBeamCleared ? 'CLEAR ✓' : 'DUCK UNDER';
      ctx.font = `700 ${fontSize}px "JetBrains Mono", monospace`;
      const tw = ctx.measureText(badgeText).width;
      const bw = tw + 16;
      const bh = fontSize + 10;
      const bx = fBL.x + (fw - bw) * 0.5;
      const by = fBL.y - bh - Math.max(8, 12 * fTL.s);

      ctx.fillStyle = isBeamCleared ? COLORS.volt : 'rgba(12, 14, 16, 0.88)';
      this._roundRect(ctx, bx, by, bw, bh, 5);
      ctx.fill();
      ctx.fillStyle = isBeamCleared ? '#0b0e05' : '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(badgeText, fBL.x + fw * 0.5, by + bh - 6);
      ctx.textAlign = 'left';
    }

    ctx.restore();
  }

  _draw3DRing(ctx, ring, cam) {
    const pt = this._project(ring.wx, ring.wy, ring.z, cam);
    const floorPt = this._project(ring.wx, 1.0, ring.z, cam);

    const farFade = clamp((SPAWN_Z - ring.z) * 4.5 + 0.25, 0.2, 1);
    const nearFade = ring.z < -0.02 ? clamp(1 - (-0.02 - ring.z) / 0.14, 0, 1) : 1;
    const alpha = farFade * nearFade;
    if (alpha <= 0.01) return;

    const r = clamp(this.playW * 0.048, 16, 22) * pt.s;
    const spinScaleX = 0.48 + Math.abs(Math.cos(ring.spin)) * 0.52;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Subtle amber floor reflection shadow for instant 3D depth grounding
    ctx.fillStyle = 'rgba(255, 184, 46, 0.24)';
    ctx.beginPath();
    ctx.ellipse(floorPt.x, floorPt.y - 2, r * 0.85, Math.max(2, r * 0.22), 0, 0, Math.PI * 2);
    ctx.fill();

    // Soft halo
    ctx.translate(pt.x, pt.y);
    ctx.fillStyle = 'rgba(255, 184, 46, 0.18)';
    ctx.beginPath();
    ctx.arc(0, 0, r * 1.35, 0, Math.PI * 2);
    ctx.fill();

    // Spinning 3D gold ring
    ctx.scale(spinScaleX, 1);
    ctx.strokeStyle = COLORS.amber;
    ctx.lineWidth = Math.max(2, 4.4 * pt.s);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#fff2cc';
    ctx.lineWidth = Math.max(1, 1.6 * pt.s);
    ctx.beginPath();
    ctx.arc(0, 0, Math.max(1, r - 3.5 * pt.s), -Math.PI * 0.65, Math.PI * 0.15);
    ctx.stroke();

    ctx.restore();
  }

  _drawPoseOverlay(ctx, nowMs) {
    const p = this.poseState;

    // 1. Duck clearance threshold line (once calibrated)
    if (p.calibrated) {
      const duckY = p.duckLineY * this.viewH;
      const isDucked = p.isDucked;

      ctx.save();
      ctx.strokeStyle = isDucked ? COLORS.volt : 'rgba(255, 255, 255, 0.26)';
      ctx.lineWidth = isDucked ? 1.8 : 1.2;
      ctx.setLineDash(isDucked ? [] : [6, 7]);
      ctx.beginPath();
      ctx.moveTo(this.playLeft + 14, duckY);
      ctx.lineTo(this.playRight - 14, duckY);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '700 9.5px "JetBrains Mono", monospace';
      const label = isDucked ? 'DUCK CLEAR' : 'DUCK LINE';
      const textW = ctx.measureText(label).width;
      const bx = this.playRight - textW - 22;
      const by = duckY - 17;
      ctx.fillStyle = isDucked ? COLORS.volt : 'rgba(12, 14, 16, 0.72)';
      this._roundRect(ctx, bx, by, textW + 10, 15, 4);
      ctx.fill();
      ctx.fillStyle = isDucked ? '#0b0e05' : 'rgba(242, 245, 247, 0.66)';
      ctx.fillText(label, bx + 5, by + 10.5);

      // Compact neutral crosshair
      const nx = p.neutralX * this.viewW;
      const ny = p.neutralY * this.viewH;
      ctx.strokeStyle = 'rgba(200, 245, 59, 0.28)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(nx - 6, ny);
      ctx.lineTo(nx + 6, ny);
      ctx.moveTo(nx, ny - 6);
      ctx.lineTo(nx, ny + 6);
      ctx.stroke();
      ctx.restore();
    }

    // 2. Alignment Target Box during Calibration (waits until user aligns inside!)
    if (this.state === 'calibrating') {
      const align = p.alignment || { aligned: false };
      const boxLeft = (ALIGN_BOUNDS.centerX - ALIGN_BOUNDS.halfW) * this.viewW;
      const boxRight = (ALIGN_BOUNDS.centerX + ALIGN_BOUNDS.halfW) * this.viewW;
      const boxTop = ALIGN_BOUNDS.minY * this.viewH;
      const boxBottom = ALIGN_BOUNDS.maxY * this.viewH;
      const boxCx = ALIGN_BOUNDS.centerX * this.viewW;
      const boxCy = ALIGN_BOUNDS.centerY * this.viewH;
      const cornerLen = 18;

      ctx.save();
      const boxColor = align.aligned ? COLORS.volt : COLORS.amber;
      ctx.strokeStyle = boxColor;
      ctx.lineWidth = align.aligned ? 2.4 : 1.8;

      // Sleek viewfinder corner brackets
      const drawBracket = (x, y, dx, dy) => {
        ctx.beginPath();
        ctx.moveTo(x + dx * cornerLen, y);
        ctx.lineTo(x, y);
        ctx.lineTo(x, y + dy * cornerLen);
        ctx.stroke();
      };
      drawBracket(boxLeft, boxTop, 1, 1);
      drawBracket(boxRight, boxTop, -1, 1);
      drawBracket(boxLeft, boxBottom, 1, -1);
      drawBracket(boxRight, boxBottom, -1, -1);

      // Subtle center target dot
      ctx.strokeStyle = align.aligned ? 'rgba(200, 245, 59, 0.45)' : 'rgba(255, 184, 46, 0.35)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(boxCx, boxCy, 14, 0, Math.PI * 2);
      ctx.stroke();

      // If user is detected but off-center, draw subtle guide line to center target
      if (p.hasPose && p.trackedPointPx && !align.aligned) {
        ctx.strokeStyle = 'rgba(255, 184, 46, 0.55)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(p.trackedPointPx.x, p.trackedPointPx.y);
        ctx.lineTo(boxCx, boxCy);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Compact calibration progress ring around tracked point once aligned
      if (p.hasPose && p.trackedPointPx && p.calibrationProgress > 0) {
        ctx.strokeStyle = COLORS.volt;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(
          p.trackedPointPx.x,
          p.trackedPointPx.y,
          18,
          -Math.PI / 2,
          -Math.PI / 2 + Math.PI * 2 * p.calibrationProgress
        );
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3. Sleek, smaller upper-body skeleton overlay aligned to mirrored cover-fit video
    const lms = p.mappedLandmarks;
    if (!p.hasPose || !lms) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(200, 245, 59, 0.36)';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';

    for (const [aIdx, bIdx] of UPPER_BODY_CONNECTIONS) {
      const a = lms[aIdx];
      const b = lms[bIdx];
      if (a && b && a.visibility >= 0.35 && b.visibility >= 0.35) {
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    }

    if (p.nosePx && p.midShoulderPx) {
      ctx.strokeStyle = 'rgba(200, 245, 59, 0.28)';
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(p.nosePx.x, p.nosePx.y);
      ctx.lineTo(p.midShoulderPx.x, p.midShoulderPx.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const idx of [11, 12, 13, 14, 15, 16]) {
      const lm = lms[idx];
      if (!lm || lm.visibility < 0.35) continue;
      const isShoulder = idx === 11 || idx === 12;
      ctx.fillStyle = isShoulder ? 'rgba(200, 245, 59, 0.85)' : 'rgba(242, 245, 247, 0.55)';
      ctx.beginPath();
      ctx.arc(lm.x, lm.y, isShoulder ? 3.2 : 2.1, 0, Math.PI * 2);
      ctx.fill();
    }

    // Compact tracked Nose + Mid-Shoulders center pip
    if (p.trackedPointPx) {
      const pulse = 1 + Math.sin(nowMs * 0.008) * 0.1;
      ctx.fillStyle = COLORS.volt;
      ctx.beginPath();
      ctx.arc(p.trackedPointPx.x, p.trackedPointPx.y, 4 * pulse, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = '#0c0e10';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }

    ctx.restore();
  }

  _drawPracticeDuckZone(ctx) {
    const duckZoneY = this.viewH * 0.72;
    const active = this.player.isDucked;
    ctx.save();
    ctx.strokeStyle = active ? 'rgba(200, 245, 59, 0.5)' : 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.25;
    ctx.setLineDash([5, 7]);
    ctx.beginPath();
    ctx.moveTo(this.playLeft + 14, duckZoneY);
    ctx.lineTo(this.playRight - 14, duckZoneY);
    ctx.stroke();
    ctx.setLineDash([]);

    if (this.pointer.active || active) {
      ctx.font = '700 9.5px "JetBrains Mono", monospace';
      ctx.fillStyle = active ? COLORS.volt : 'rgba(255, 255, 255, 0.42)';
      ctx.textAlign = 'right';
      ctx.fillText(active ? 'DUCKED' : 'DUCK ZONE', this.playRight - 16, duckZoneY + 13);
      ctx.textAlign = 'left';
    }
    ctx.restore();
  }

  _drawLimb(ctx, x1, y1, x2, y2, width, fillColor, rimColor = null) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (rimColor) {
      ctx.strokeStyle = rimColor;
      ctx.lineWidth = width + 2.2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.strokeStyle = fillColor;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  _drawPlayerBody(ctx, nowMs) {
    if (this.invulnTimer > 0 && Math.floor(nowMs / 75) % 2 === 0) {
      return;
    }

    const pm = this._getPlayerMetrics();
    const H = pm.bodyH;
    const duck = this.player.duckAnim;
    const phase = this.runCycle;

    // Combine lateral lean velocity with live camera shoulder tilt for tactile torso banking
    const liveTilt =
      this.controlMode === 'camera' && this.poseState.hasPose ? (this.poseState.shoulderTilt || 0) * 0.72 : 0;
    const torsoLean = clamp(this.player.vx * 0.16 + liveTilt, -0.44, 0.44);

    // 1. Subtle ghosted motion echoes during fast leans
    if (Math.abs(this.player.vx) > 0.25 && this.player.trail.length > 2) {
      ctx.save();
      for (let i = 1; i < this.player.trail.length; i += 2) {
        const tp = this.player.trail[i];
        const frac = 1 - i / this.player.trail.length;
        const ghostH = lerp(H * 0.88, H * 0.54, tp.duck);
        ctx.fillStyle = `rgba(200, 245, 59, ${(frac * 0.14).toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(tp.floorX, tp.floorY - ghostH * 0.54, H * 0.15, ghostH * 0.44, torsoLean * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.translate(pm.floorX, pm.floorY);

    // 2. Grounded 3D elliptical floor shadow + active duck clearance ring
    const shadowRx = H * (0.22 + duck * 0.12);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.48)';
    ctx.beginPath();
    ctx.ellipse(0, -1, shadowRx, Math.max(4, H * 0.045), 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = this.player.isDucked ? COLORS.volt : 'rgba(200, 245, 59, 0.34)';
    ctx.lineWidth = this.player.isDucked ? 2 : 1.25;
    ctx.beginPath();
    ctx.ellipse(0, -1, shadowRx * 1.18, Math.max(5, H * 0.055), 0, 0, Math.PI * 2);
    ctx.stroke();

    // 3. Skeleton joint coordinates in runner-local space (y=0 is floor, negative y is UP)
    const bounce = Math.abs(Math.sin(phase)) * H * 0.028 * (1 - duck);
    const hipX = torsoLean * H * 0.07;
    const hipY = -lerp(H * 0.45, H * 0.25, duck) - bounce;
    const hipHalfW = H * 0.088;

    const torsoH = lerp(H * 0.34, H * 0.23, duck);
    const shCenterX = hipX + Math.sin(torsoLean) * torsoH;
    const shCenterY = hipY - Math.cos(torsoLean) * torsoH;
    const shHalfW = H * 0.165;

    const cosT = Math.cos(torsoLean);
    const sinT = Math.sin(torsoLean);

    const shL = { x: shCenterX - cosT * shHalfW, y: shCenterY - sinT * shHalfW };
    const shR = { x: shCenterX + cosT * shHalfW, y: shCenterY + sinT * shHalfW };
    const hipL = { x: hipX - hipHalfW, y: hipY };
    const hipR = { x: hipX + hipHalfW, y: hipY };

    // Compute animated sprint legs -> blending smoothly into wide planted athletic crouch when ducking
    const buildLeg = (side, stridePhase) => {
      const s = Math.sin(stridePhase); // +1 = foot lifted back, -1 = planted forward
      const c = Math.cos(stridePhase);
      const hip = side < 0 ? hipL : hipR;

      // Running stride foot & knee
      const runFootX = side * H * 0.105 + c * H * 0.02;
      const runFootY = -Math.max(0, s) * H * 0.135;
      const runKneeX = side * H * 0.115 + side * Math.max(0, s) * H * 0.02;
      const runKneeY = hip.y * 0.52 - Math.max(0, s) * H * 0.065;

      // Athletic low crouch stance
      const duckFootX = side * H * 0.2;
      const duckFootY = 0;
      const duckKneeX = side * H * 0.235;
      const duckKneeY = -H * 0.185;

      return {
        side,
        depth: s,
        hip,
        knee: { x: lerp(runKneeX, duckKneeX, duck), y: lerp(runKneeY, duckKneeY, duck) },
        foot: { x: lerp(runFootX, duckFootX, duck), y: lerp(runFootY, duckFootY, duck) },
      };
    };

    const legL = buildLeg(-1, phase);
    const legR = buildLeg(1, phase + Math.PI);

    // Draw farther back-swinging leg first for 3D depth
    const orderedLegs = legL.depth > legR.depth ? [legL, legR] : [legR, legL];
    const thighW = Math.max(5.5, H * 0.078);
    const shinW = Math.max(4.5, H * 0.064);

    for (const leg of orderedLegs) {
      const isBack = leg.depth > 0.15 && duck < 0.5;
      const fill = isBack ? '#98a6b3' : '#e8eef2';
      const rim = '#0c0e10';

      this._drawLimb(ctx, leg.hip.x, leg.hip.y, leg.knee.x, leg.knee.y, thighW, fill, rim);
      this._drawLimb(ctx, leg.knee.x, leg.knee.y, leg.foot.x, leg.foot.y, shinW, fill, rim);

      // Crisp volt sneaker accent
      ctx.fillStyle = isBack ? '#9ec62c' : COLORS.volt;
      ctx.strokeStyle = '#0c0e10';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.ellipse(leg.foot.x + leg.side * 2, leg.foot.y - 2, H * 0.058, H * 0.03, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 4. Sculpted Athletic V-Tapered Torso (high-contrast volt jersey with dark ink outline)
    ctx.save();
    ctx.fillStyle = '#181e25';
    ctx.strokeStyle = COLORS.volt;
    ctx.lineWidth = 2.4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(shL.x, shL.y);
    ctx.lineTo(shR.x, shR.y);
    ctx.lineTo(hipR.x + 1, hipR.y + 2);
    ctx.lineTo(hipL.x - 1, hipL.y + 2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Bold tennis-volt chest/back V-chevron
    const midChestX = lerp(shCenterX, hipX, 0.48);
    const midChestY = lerp(shCenterY, hipY, 0.48);
    ctx.strokeStyle = COLORS.volt;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(lerp(shL.x, shCenterX, 0.25), lerp(shL.y, shCenterY, 0.25) + H * 0.05);
    ctx.lineTo(midChestX, midChestY + H * 0.05);
    ctx.lineTo(lerp(shR.x, shCenterX, 0.25), lerp(shR.y, shCenterY, 0.25) + H * 0.05);
    ctx.stroke();
    ctx.restore();

    // 5. Articulated Arms (mirrored live from camera pose when visible, else dynamic sprint pump)
    const armW = Math.max(4.8, H * 0.062);
    const foreW = Math.max(4, H * 0.052);
    const liveArms = this.controlMode === 'camera' && this.poseState.hasPose ? this.poseState.avatarArms : null;
    const armScale = shHalfW * 1.85;

    const drawArm = (side, shoulder, stridePhase, liveVec) => {
      let elbow;
      let hand;

      if (liveVec) {
        elbow = {
          x: shoulder.x + liveVec.ex * armScale,
          y: shoulder.y + liveVec.ey * armScale,
        };
        hand = {
          x: shoulder.x + liveVec.wx * armScale,
          y: shoulder.y + liveVec.wy * armScale,
        };
      } else {
        const swing = Math.sin(stridePhase);
        const runEx = shoulder.x + side * H * 0.088;
        const runEy = shoulder.y + H * (0.14 + swing * 0.035);
        const runHx = runEx + side * H * 0.032;
        const runHy = runEy + H * (0.12 - swing * 0.05);

        const duckEx = shoulder.x + side * H * 0.15;
        const duckEy = shoulder.y + H * 0.085;
        const duckHx = duckEx + side * H * 0.085;
        const duckHy = duckEy + H * 0.065;

        elbow = { x: lerp(runEx, duckEx, duck), y: lerp(runEy, duckEy, duck) };
        hand = { x: lerp(runHx, duckHx, duck), y: lerp(runHy, duckHy, duck) };
      }

      this._drawLimb(ctx, shoulder.x, shoulder.y, elbow.x, elbow.y, armW, '#e8eef2', '#0c0e10');
      this._drawLimb(ctx, elbow.x, elbow.y, hand.x, hand.y, foreW, '#d6e0e8', '#0c0e10');

      // Crisp volt glove accent
      ctx.fillStyle = COLORS.volt;
      ctx.strokeStyle = '#0c0e10';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(hand.x, hand.y, Math.max(3, H * 0.032), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    };

    drawArm(-1, shL, phase + Math.PI, liveArms?.left || null);
    drawArm(1, shR, phase, liveArms?.right || null);

    // 6. Sculpted Tennis-Volt Athletic Head / Helmet
    const neckLen = lerp(H * 0.115, H * 0.09, duck);
    const headX = shCenterX + sinT * neckLen;
    const headY = shCenterY - cosT * neckLen;
    const headR = clamp(H * 0.102, 11, 15.5);

    ctx.save();
    ctx.translate(headX, headY);
    ctx.rotate(torsoLean * 0.65);

    // Subtle dark neck collar
    ctx.fillStyle = '#0c0e10';
    ctx.fillRect(-headR * 0.35, headR * 0.65, headR * 0.7, headR * 0.45);

    // Main volt athletic helmet dome
    ctx.fillStyle = COLORS.volt;
    ctx.strokeStyle = '#0c0e10';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, headR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Sleek charcoal wraparound helmet band / crown stripe
    ctx.fillStyle = '#12161b';
    ctx.beginPath();
    ctx.roundRect?.(-headR * 0.78, -headR * 0.18, headR * 1.56, headR * 0.38, 3);
    if (!ctx.roundRect) {
      ctx.rect(-headR * 0.78, -headR * 0.18, headR * 1.56, headR * 0.38);
    }
    ctx.fill();

    // Crisp crown specular dot
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.beginPath();
    ctx.arc(-headR * 0.25, -headR * 0.45, headR * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 7. Compact DUCKED badge beneath floor shadow when ducking
    if (this.player.isDucked) {
      ctx.font = '700 9.5px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = COLORS.volt;
      ctx.fillText('DUCKED', 0, 14);
      ctx.textAlign = 'left';
    }

    ctx.restore();
  }

  _drawParticles(ctx) {
    ctx.save();
    for (const pt of this.particles) {
      const alpha = clamp(pt.life / pt.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = pt.color;
      ctx.fillRect(pt.x - pt.size * 0.5, pt.y - pt.size * 0.5, pt.size, pt.size);
    }
    ctx.restore();
  }

  _drawCallouts(ctx) {
    ctx.save();
    ctx.textAlign = 'center';
    for (const c of this.callouts) {
      const alpha = clamp(c.life / (c.maxLife * 0.65), 0, 1);
      ctx.globalAlpha = alpha;
      ctx.font = `700 ${c.size}px "JetBrains Mono", monospace`;
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(12, 14, 16, 0.85)';
      ctx.strokeText(c.text, c.x, c.y);
      ctx.fillStyle = c.color;
      ctx.fillText(c.text, c.x, c.y);
    }
    ctx.textAlign = 'left';
    ctx.restore();
  }

  _drawReadyBanner(ctx) {
    ctx.save();
    const alpha = clamp(this.readyTimer / 0.6, 0, 1);
    ctx.globalAlpha = Math.min(1, alpha * 1.8);
    ctx.font = '700 42px "Space Grotesk", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.volt;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 16;
    ctx.fillText('SWERVE!', this.viewW * 0.5, this.viewH * 0.44);
    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w * 0.5, h * 0.5);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new SwerveGame();
});
