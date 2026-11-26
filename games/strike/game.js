// STRIKE — 3D Camera Hand-Punch & Duck Arcade Game
// Powered by shared on-device MediaPipe Pose Tracker & Web Audio Synth.

import { SoundEngine } from '../../shared/audio.js?v=7';
import { PoseTracker, UPPER_BODY_CONNECTIONS, ALIGN_BOUNDS } from '../../shared/tracker.js?v=7';

const STORAGE_KEYS = {
  highScore: 'strike_high_score',
  showOverlay: 'swerve_overlay',
  brightness: 'swerve_brightness',
  cameraFacing: 'swerve_camera_facing',
  cameraMirror: 'swerve_camera_mirror',
};

const COLORS = {
  cyan: '#32e6ff',
  volt: '#c8f53b',
  vermilion: '#ff4d2e',
  amber: '#ffb82e',
  white: '#f4f7fa',
};

const ZONES = [
  { tag: 'Z1', name: 'CYBER RING', accent: '#32e6ff', rgb: '50, 230, 255', secondary: '200, 245, 59' },
  { tag: 'Z2', name: 'VOLT ARENA', accent: '#c8f53b', rgb: '200, 245, 59', secondary: '50, 230, 255' },
  { tag: 'Z3', name: 'SOLAR STRIKE', accent: '#ffb82e', rgb: '255, 184, 46', secondary: '255, 92, 50' },
  { tag: 'Z4', name: 'HYPER COMBO', accent: '#6ef0ff', rgb: '110, 240, 255', secondary: '255, 184, 46' },
];

const FOCAL_LENGTH = 0.31;
const SPAWN_Z = 1.05;
const DESPAWN_Z = -0.22;
const STRIKE_Z_MAX = 0.32;
const STRIKE_Z_MIN = -0.1;

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
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

class StrikeGame {
  constructor() {
    this.audio = new SoundEngine();
    this.tracker = new PoseTracker();

    // DOM refs
    this.videoEl = document.getElementById('camera-video');
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');

    this.hudEl = document.getElementById('hud');
    this.shieldPips = Array.from(document.querySelectorAll('.shield-pip'));
    this.zonePillEl = document.getElementById('zone-pill');
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

    this.screenStart = document.getElementById('screen-start');
    this.startBestChip = document.getElementById('start-best-chip');
    this.startFacingBtns = Array.from(document.querySelectorAll('#start-camera-facing .seg-btn'));
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

    this.settingsFacingBtns = Array.from(document.querySelectorAll('#settings-camera-facing .seg-btn'));
    this.cameraFacingHintEl = document.getElementById('camera-facing-hint');
    this.cameraLensGroup = document.getElementById('camera-lens-group');
    this.selectCameraLens = document.getElementById('select-camera-lens');
    this.toggleMirror = document.getElementById('toggle-mirror');
    this.sliderBrightness = document.getElementById('slider-brightness');
    this.brightnessValueEl = document.getElementById('brightness-value');
    this.toggleOverlay = document.getElementById('toggle-overlay');
    this.toggleSound = document.getElementById('toggle-sound');

    this.screenGameover = document.getElementById('screen-gameover');
    this.gameoverNewBest = document.getElementById('gameover-new-best');
    this.gameoverRank = document.getElementById('gameover-rank');
    this.gameoverScore = document.getElementById('gameover-score');
    this.gameoverBest = document.getElementById('gameover-best');
    this.statSmashes = document.getElementById('stat-smashes');
    this.statPerfect = document.getElementById('stat-perfect');
    this.statDucks = document.getElementById('stat-ducks');
    this.statCombo = document.getElementById('stat-combo');
    this.btnGameoverRecalibrate = document.getElementById('btn-gameover-recalibrate');

    // Settings
    this.highScore = Math.max(0, parseInt(readStorage(STORAGE_KEYS.highScore, '0'), 10) || 0);
    const storedBrightness = parseInt(readStorage(STORAGE_KEYS.brightness, '45'), 10);
    const storedFacing = readStorage(STORAGE_KEYS.cameraFacing, 'user');
    const facing = storedFacing === 'environment' ? 'environment' : 'user';
    const storedMirror = readStorage(STORAGE_KEYS.cameraMirror, facing === 'user' ? '1' : '0');

    this.settings = {
      showOverlay: readStorage(STORAGE_KEYS.showOverlay, '1') !== '0',
      brightness: clamp(Number.isNaN(storedBrightness) ? 45 : storedBrightness, 0, 100),
      cameraFacing: facing,
      mirrored: storedMirror === '1',
      deviceId: null,
    };
    this.tracker.setMirror(this.settings.mirrored);

    // Viewport
    this.viewW = window.innerWidth;
    this.viewH = window.innerHeight;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.playLeft = 0;
    this.playW = this.viewW;
    this.playRight = this.viewW;

    // Runtime state
    this.state = 'start';
    this.pauseReturnState = 'playing';
    this.controlMode = 'camera';
    this.loadingCancelled = false;

    // Gameplay state
    this.score = 0;
    this.shields = 3;
    this.combo = 1;
    this.peakCombo = 1;
    this.zoneIndex = 0;
    this.elapsedRunSec = 0;
    this.tunnelScroll = 0;
    this.readyTimer = 0;
    this.invulnTimer = 0;
    this.hitStopTimer = 0;
    this.shakeTime = 0;
    this.shakeMag = 0;
    this.damageFlash = 0;
    this.beatTimer = 0;
    this.beatStep = 0;
    this.scorePopTimer = null;
    this.stats = { smashes: 0, perfects: 0, ducks: 0 };

    // Duck & hand trails
    this.isDucked = false;
    this.wasDucked = false;
    this.duckAnim = 0;
    this.handTrails = { left: [], right: [] };
    this.virtualPunches = []; // Practice mode tap/key punch bursts

    // Practice inputs
    this.keys = { duck: false };
    this.pointer = { active: false, id: null, x: 0, y: 0, ducking: false };

    // 3D Entities & VFX
    this.targets = [];
    this.lasers = [];
    this.particles = [];
    this.shockwaves = [];
    this.callouts = [];
    this.zoneBanner = null;
    this.warpStreaks = this._createWarpStreaks();
    this.spawnTimer = 0.65;
    this.lastWaveType = null;
    this.toastTimer = null;

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

    document.getElementById('btn-calibrate-flip').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      const nextFacing = this.settings.cameraFacing === 'user' ? 'environment' : 'user';
      this._setCameraFacing(nextFacing, true);
    });

    document.getElementById('btn-calibrate-practice').addEventListener('click', () => {
      this.audio.click();
      this.tracker.stopCamera();
      this._setCameraVideoVisible(false);
      this.startPracticeMode();
    });

    const bindFacingButtons = (btns) => {
      btns.forEach((btn) => {
        btn.addEventListener('click', () => {
          this.audio.unlock();
          this.audio.click();
          const facing = btn.dataset.facing === 'environment' ? 'environment' : 'user';
          const switchLive = this.controlMode === 'camera' && this.tracker.cameraActive;
          this._setCameraFacing(facing, switchLive);
        });
      });
    };
    bindFacingButtons(this.startFacingBtns);
    bindFacingButtons(this.settingsFacingBtns);

    this.selectCameraLens.addEventListener('change', () => {
      this.audio.unlock();
      this.audio.click();
      this.settings.deviceId = this.selectCameraLens.value || null;
      if (this.controlMode === 'camera' && this.tracker.cameraActive) {
        this.startCameraFlow();
      }
    });

    this.toggleMirror.addEventListener('change', (e) => {
      this.audio.unlock();
      this.audio.click();
      this.settings.mirrored = Boolean(e.target.checked);
      writeStorage(STORAGE_KEYS.cameraMirror, this.settings.mirrored ? '1' : '0');
      this.tracker.setMirror(this.settings.mirrored);
      this._applySettingsToUI();
    });

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

    // Pointer controls for Practice Mode (tap/swipe crystals to smash, hold bottom to duck)
    const onPointerDown = (e) => {
      if (this.controlMode !== 'practice' || (this.state !== 'playing' && this.state !== 'ready')) return;
      if (e.target !== this.canvas) return;
      this.audio.unlock();
      this.pointer.active = true;
      this.pointer.id = e.pointerId;
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.pointer.ducking = e.clientY >= this.viewH * 0.78;
      if (!this.pointer.ducking) {
        this._triggerPracticeStrike(e.clientX, e.clientY);
      }
    };

    const onPointerMove = (e) => {
      if (!this.pointer.active || e.pointerId !== this.pointer.id) return;
      this.pointer.x = e.clientX;
      this.pointer.y = e.clientY;
      this.pointer.ducking = e.clientY >= this.viewH * 0.78;
      if (!this.pointer.ducking) {
        this._checkPointAgainstTargets(e.clientX, e.clientY, 'swipe', 58);
      }
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

    // Keyboard controls
    window.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) {
        if (this.state === 'playing' || this.state === 'ready') e.preventDefault();
      }

      if (e.code === 'ArrowDown' || e.code === 'KeyS' || e.code === 'Space') {
        this.keys.duck = true;
      }

      if (e.repeat) return;

      if (this.controlMode === 'practice' && this.state === 'playing') {
        if (e.code === 'ArrowLeft' || e.code === 'KeyA') {
          this._triggerLanePunch('left');
        } else if (e.code === 'ArrowRight' || e.code === 'KeyD') {
          this._triggerLanePunch('right');
        } else if (e.code === 'ArrowUp' || e.code === 'KeyW') {
          this._triggerLanePunch('center');
        }
      }

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
      if (e.code === 'ArrowDown' || e.code === 'KeyS' || e.code === 'Space') {
        this.keys.duck = false;
      }
    });
  }

  _triggerPracticeStrike(x, y) {
    const color = x < this.viewW * 0.5 ? COLORS.cyan : COLORS.volt;
    this.virtualPunches.push({ x, y, color, life: 0.2, maxLife: 0.2 });
    const hitAny = this._checkPointAgainstTargets(x, y, x < this.viewW * 0.5 ? 'left' : 'right', 66);
    if (!hitAny) {
      this._spawnShockwave(x, y, color, 46, 2);
    }
  }

  _triggerLanePunch(lane) {
    const cam = this._getCorridorCamera();
    const wx = lane === 'left' ? -0.46 : lane === 'right' ? 0.46 : 0;
    const pt = this._project(wx, -0.02, 0.05, cam);
    const color = lane === 'left' ? COLORS.cyan : lane === 'right' ? COLORS.volt : COLORS.amber;
    this.virtualPunches.push({ x: pt.x, y: pt.y, color, life: 0.22, maxLife: 0.22 });
    this._spawnShockwave(pt.x, pt.y, color, 58, 2.5);

    // Hit closest strikeable target matching that side (or gold center)
    let hitCount = 0;
    for (const t of this.targets) {
      if (t.smashed || t.z > STRIKE_Z_MAX + 0.06 || t.z < STRIKE_Z_MIN) continue;
      const matches =
        (lane === 'left' && t.side === 'left') ||
        (lane === 'right' && t.side === 'right') ||
        (lane === 'center' && (t.side === 'gold' || Math.abs(t.wx) < 0.35));
      if (matches) {
        this._smashTarget(t, lane, true);
        hitCount += 1;
        if (lane !== 'center') break;
      }
    }
    if (hitCount === 0) {
      this.audio.click();
    }
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

  _setCameraFacing(facing, restartCamera = false) {
    const normalized = facing === 'environment' ? 'environment' : 'user';
    this.settings.cameraFacing = normalized;
    this.settings.deviceId = null;
    this.settings.mirrored = normalized === 'user';

    writeStorage(STORAGE_KEYS.cameraFacing, normalized);
    writeStorage(STORAGE_KEYS.cameraMirror, this.settings.mirrored ? '1' : '0');

    this.tracker.setMirror(this.settings.mirrored);
    this._applySettingsToUI();

    if (restartCamera) {
      this.startCameraFlow();
    }
  }

  async _populateCameraLenses() {
    const cams = await this.tracker.listCameras();
    if (cams.length <= 2) {
      this.cameraLensGroup.classList.add('hidden');
      return;
    }

    this.selectCameraLens.innerHTML = '';
    const autoOpt = document.createElement('option');
    autoOpt.value = '';
    autoOpt.textContent = `Auto (${this.settings.cameraFacing === 'environment' ? 'Back' : 'Front'})`;
    this.selectCameraLens.appendChild(autoOpt);

    for (const cam of cams) {
      const opt = document.createElement('option');
      opt.value = cam.deviceId;
      opt.textContent = cam.label;
      if (this.tracker.deviceId && cam.deviceId === this.tracker.deviceId) {
        opt.selected = true;
      }
      this.selectCameraLens.appendChild(opt);
    }

    this.cameraLensGroup.classList.remove('hidden');
  }

  _applySettingsToUI() {
    const syncFacingBtns = (btns) => {
      btns.forEach((btn) => {
        const isActive = btn.dataset.facing === this.settings.cameraFacing;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
      });
    };
    syncFacingBtns(this.startFacingBtns);
    syncFacingBtns(this.settingsFacingBtns);

    const facingLabel = this.settings.cameraFacing === 'environment' ? 'Back' : 'Front';
    const mirrorLabel = this.settings.mirrored ? 'mirrored' : 'unmirrored';
    this.cameraFacingHintEl.textContent = `${facingLabel} · ${mirrorLabel}`;

    this.videoEl.classList.toggle('mirrored', this.settings.mirrored);
    this.toggleMirror.checked = this.settings.mirrored;

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
    const camName = this.settings.cameraFacing === 'environment' ? 'back camera' : 'front camera';
    this.loadingTitle.textContent = 'STARTING CAMERA';
    this.loadingStatus.textContent = `Requesting ${camName}…`;
    this.cameraErrorBox.classList.add('hidden');

    try {
      this.tracker.setMirror(this.settings.mirrored);
      await this.tracker.startCamera(
        this.videoEl,
        (msg) => {
          if (!this.loadingCancelled) this.loadingStatus.textContent = msg;
        },
        {
          facingMode: this.settings.cameraFacing,
          deviceId: this.settings.deviceId,
        }
      );
      if (this.loadingCancelled) return;

      this._applySettingsToUI();
      this._populateCameraLenses();
      this._setCameraVideoVisible(true);
      this.loadingTitle.textContent = 'LOADING POSE MODEL';

      const delegate = await this.tracker.initModel((msg) => {
        if (!this.loadingCancelled) this.loadingStatus.textContent = msg;
      });
      if (this.loadingCancelled) return;

      const camTag = this.tracker.facingMode === 'environment' ? 'BACK' : 'FRONT';
      this.calibrateDelegate.textContent = `${camTag} · ${delegate}`;
      this.startCalibrationPhase();
    } catch (err) {
      if (this.loadingCancelled) return;
      this.loadingSpinner.classList.add('hidden');
      this.loadingTitle.textContent = 'CAMERA UNAVAILABLE';
      this.loadingStatus.textContent = 'You can retry or play Practice Mode right away.';
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
    this._showScreen('paused');
  }

  closePause() {
    this._showScreen(this.pauseReturnState === 'playing' ? 'playing' : 'start');
  }

  _getCurrentZone() {
    return ZONES[this.zoneIndex % ZONES.length];
  }

  _createWarpStreaks() {
    const arr = [];
    for (let i = 0; i < 24; i++) arr.push(this._makeWarpStreak(Math.random() * SPAWN_Z));
    return arr;
  }

  _makeWarpStreak(z = SPAWN_Z) {
    const edge = Math.random();
    let wx;
    let wy;
    if (edge < 0.42) {
      wx = -0.96 - Math.random() * 0.08;
      wy = -0.9 + Math.random() * 1.8;
    } else if (edge < 0.84) {
      wx = 0.96 + Math.random() * 0.08;
      wy = -0.9 + Math.random() * 1.8;
    } else {
      wx = -0.9 + Math.random() * 1.8;
      wy = -0.98 - Math.random() * 0.06;
    }
    return { wx, wy, z, speedMult: 0.75 + Math.random() * 0.65, len: 0.08 + Math.random() * 0.11, bright: Math.random() > 0.45 };
  }

  beginRun() {
    this.score = 0;
    this.shields = 3;
    this.combo = 1;
    this.peakCombo = 1;
    this.zoneIndex = 0;
    this.elapsedRunSec = 0;
    this.tunnelScroll = 0;
    this.readyTimer = 0.6;
    this.invulnTimer = 0;
    this.hitStopTimer = 0;
    this.shakeTime = 0;
    this.shakeMag = 0;
    this.damageFlash = 0;
    this.beatTimer = 0;
    this.beatStep = 0;
    this.isDucked = false;
    this.wasDucked = false;
    this.duckAnim = 0;
    this.stats = { smashes: 0, perfects: 0, ducks: 0 };

    this.targets = [];
    this.lasers = [];
    this.particles = [];
    this.shockwaves = [];
    this.callouts = [];
    this.virtualPunches = [];
    this.handTrails = { left: [], right: [] };
    this.zoneBanner = null;
    this.spawnTimer = 0.55;
    this.lastWaveType = null;

    this._syncScoreHUD(false);
    this._syncShieldsHUD();
    this._syncComboHUD();
    this._syncZoneHUD();
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

    let rank = 'C';
    let rankClass = 'rank-c';
    if (this.score >= 3000 || this.stats.smashes >= 34) {
      rank = 'S';
      rankClass = 'rank-s';
    } else if (this.score >= 1400 || this.stats.smashes >= 18) {
      rank = 'A';
      rankClass = 'rank-a';
    } else if (this.score >= 500 || this.stats.smashes >= 8) {
      rank = 'B';
      rankClass = 'rank-b';
    }

    this.gameoverRank.textContent = rank;
    this.gameoverRank.className = `rank-badge ${rankClass}`;
    this.gameoverNewBest.classList.toggle('hidden', !isNewBest);
    this.gameoverScore.textContent = this.score.toLocaleString();
    this.gameoverBest.textContent = `BEST ${this.highScore.toLocaleString()}`;
    this.statSmashes.textContent = String(this.stats.smashes);
    this.statPerfect.textContent = String(this.stats.perfects);
    this.statDucks.textContent = String(this.stats.ducks);
    this.statCombo.textContent = `×${this.peakCombo}`;
    this.btnGameoverRecalibrate.classList.toggle('hidden', this.controlMode !== 'camera');

    this._showScreen('gameover');
  }

  _syncScoreHUD(animatePop = true) {
    this.scoreValueEl.textContent = this.score.toLocaleString();
    if (this.score > this.highScore) {
      this.bestInlineEl.textContent = `BEST ${this.score.toLocaleString()}`;
    }
    if (animatePop && this.score > 0) {
      this.scoreValueEl.classList.add('pop');
      if (this.scorePopTimer) clearTimeout(this.scorePopTimer);
      this.scorePopTimer = setTimeout(() => {
        this.scoreValueEl.classList.remove('pop');
      }, 130);
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
      this.comboPillEl.classList.toggle('fever', this.combo >= 4);
    } else {
      this.comboPillEl.classList.add('hidden');
      this.comboPillEl.classList.remove('fever');
    }
  }

  _syncZoneHUD() {
    const z = this._getCurrentZone();
    this.zonePillEl.textContent = z.tag;
    this.zonePillEl.style.color = z.accent;
    this.zonePillEl.style.borderColor = `rgba(${z.rgb}, 0.42)`;
  }

  // ==================== 3D PROJECTION & WAVES ====================

  _getCorridorCamera() {
    const nearW = this.playW * 0.94;
    const nearH = this.viewH * 0.68;
    const cx = this.viewW * 0.5;
    const cy = this.viewH * 0.49;
    const vpX = cx;
    const vpY = this.viewH * 0.4 + this.duckAnim * (this.viewH * 0.06);
    return { nearW, nearH, cx, cy, vpX, vpY };
  }

  _project(wx, wy, z, cam = this._getCorridorCamera()) {
    const s = FOCAL_LENGTH / Math.max(0.065, z + FOCAL_LENGTH);
    const sx = cam.vpX + (cam.cx - cam.vpX + wx * (cam.nearW * 0.5)) * s;
    const sy = cam.vpY + (cam.cy - cam.vpY + wy * (cam.nearH * 0.5)) * s;
    return { x: sx, y: sy, s };
  }

  _getDifficulty() {
    const t = clamp(this.elapsedRunSec / 95, 0, 1);
    const zSpeed = 0.5 + t * 0.52;
    const spawnIntervalSec = 1.38 - t * 0.58;
    return { t, zSpeed, spawnIntervalSec };
  }

  _spawnNextWave() {
    const diff = this._getDifficulty();
    const roll = Math.random();

    // Friendly early ramp: single left/right crystals first, then doubles, golds, and red laser sweeps
    let waveType = 'left';
    if (this.elapsedRunSec < 4) {
      waveType = this.lastWaveType === 'left' ? 'right' : 'left';
    } else if (roll < 0.34) {
      waveType = 'left';
    } else if (roll < 0.68) {
      waveType = 'right';
    } else if (roll < 0.81 && this.lastWaveType !== 'double') {
      waveType = 'double';
    } else if (roll < 0.91 && this.lastWaveType !== 'laser') {
      waveType = 'laser';
    } else {
      waveType = 'gold';
    }

    this.lastWaveType = waveType;

    const makeCrystal = (side, wx, wy) => ({
      side, // 'left' | 'right' | 'gold'
      wx,
      wy,
      z: SPAWN_Z,
      zSpeed: diff.zSpeed,
      spin: Math.random() * Math.PI * 2,
      smashed: false,
      missed: false,
      pairId: null,
    });

    if (waveType === 'left') {
      const wx = -(0.34 + Math.random() * 0.3);
      const wy = -0.22 + Math.random() * 0.38;
      this.targets.push(makeCrystal('left', wx, wy));
    } else if (waveType === 'right') {
      const wx = 0.34 + Math.random() * 0.3;
      const wy = -0.22 + Math.random() * 0.38;
      this.targets.push(makeCrystal('right', wx, wy));
    } else if (waveType === 'double') {
      const wy = -0.14 + Math.random() * 0.24;
      const pairId = Math.random();
      const leftC = makeCrystal('left', -0.48, wy);
      const rightC = makeCrystal('right', 0.48, wy);
      leftC.pairId = pairId;
      rightC.pairId = pairId;
      this.targets.push(leftC, rightC);
    } else if (waveType === 'gold') {
      const wx = (Math.random() - 0.5) * 0.42;
      const wy = -0.26 + Math.random() * 0.24;
      this.targets.push(makeCrystal('gold', wx, wy));
    } else if (waveType === 'laser') {
      this.lasers.push({
        z: SPAWN_Z,
        depth: 0.1,
        zSpeed: diff.zSpeed * 0.96,
        cleared: false,
        hit: false,
      });
    }

    this.spawnTimer = diff.spawnIntervalSec + (waveType === 'laser' || waveType === 'double' ? 0.22 : 0);
  }

  _spawnParticles(x, y, color, count = 16, speedScale = 1) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= 96) this.particles.shift();
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
      const speed = (95 + Math.random() * 260) * speedScale;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 2.4 + Math.random() * 3.6,
        color,
        life: 0.3 + Math.random() * 0.28,
        maxLife: 0.58,
      });
    }
  }

  _spawnShockwave(x, y, color, maxRadius = 96, lineWidth = 4) {
    if (this.shockwaves.length >= 10) this.shockwaves.shift();
    this.shockwaves.push({
      x,
      y,
      color,
      radius: 10,
      maxRadius,
      lineWidth,
      life: 0.34,
      maxLife: 0.34,
    });
  }

  _addCallout(x, y, text, color = COLORS.cyan, size = 17) {
    this.callouts.push({
      x: clamp(x, this.playLeft + 60, this.playRight - 60),
      y,
      text,
      color,
      size,
      life: 0.88,
      maxLife: 0.88,
    });
  }

  _checkPointAgainstTargets(px, py, handSide, extraRadius = 46) {
    const cam = this._getCorridorCamera();
    let smashedAny = false;
    for (const t of this.targets) {
      if (t.smashed || t.missed) continue;
      if (t.z > STRIKE_Z_MAX || t.z < STRIKE_Z_MIN) continue;
      const pt = this._project(t.wx, t.wy, t.z, cam);
      const targetR = clamp(this.playW * 0.082, 26, 40) * pt.s;
      const dist = Math.hypot(px - pt.x, py - pt.y);
      if (dist <= targetR + extraRadius) {
        this._smashTarget(t, handSide, false);
        smashedAny = true;
      }
    }
    return smashedAny;
  }

  _smashTarget(t, handSide, isFastPunch = false) {
    t.smashed = true;
    const cam = this._getCorridorCamera();
    const pt = this._project(t.wx, t.wy, Math.max(0, t.z), cam);

    this.stats.smashes += 1;
    this.combo = Math.min(this.combo + 1, 12);
    if (this.combo > this.peakCombo) this.peakCombo = this.combo;

    const inSweetSpot = t.z >= -0.03 && t.z <= 0.16;
    const matchedHand = t.side === 'gold' || handSide === t.side;
    const isPerfect = inSweetSpot || isFastPunch || matchedHand;
    const isGold = t.side === 'gold';

    let basePts = isGold ? 100 : isPerfect ? 65 : 40;
    const pts = basePts * this.combo;
    this.score += pts;

    if (isPerfect) this.stats.perfects += 1;

    const color = isGold ? COLORS.amber : t.side === 'left' ? COLORS.cyan : COLORS.volt;

    // Check if this completes a Double Strike pair
    let completedDouble = false;
    if (t.pairId) {
      const sibling = this.targets.find((o) => o !== t && o.pairId === t.pairId);
      if (sibling && sibling.smashed) {
        completedDouble = true;
      }
    }

    if (completedDouble) {
      const bonus = 80 * this.combo;
      this.score += bonus;
      this.audio.doubleSmash(this.combo);
      this.hitStopTimer = 0.038;
      this.shakeTime = 0.16;
      this.shakeMag = 8;
      this._spawnParticles(pt.x, pt.y, COLORS.amber, 24, 1.3);
      this._spawnShockwave(pt.x, pt.y, COLORS.amber, 130, 4.5);
      this._addCallout(pt.x, pt.y - 30, `DOUBLE SMASH! +${pts + bonus}`, COLORS.amber, 19);
    } else if (isGold) {
      this.audio.goldRing(this.combo);
      this.hitStopTimer = 0.032;
      this.shakeTime = 0.14;
      this.shakeMag = 7;
      this._spawnParticles(pt.x, pt.y, COLORS.amber, 24, 1.25);
      this._spawnShockwave(pt.x, pt.y, COLORS.amber, 120, 4.5);
      this._addCallout(pt.x, pt.y - 26, `GOLD CORE +${pts}`, COLORS.amber, 19);
    } else {
      this.audio.punchSmash(this.combo, isPerfect);
      if (isPerfect) {
        this.shakeTime = 0.1;
        this.shakeMag = 5;
      }
      this._spawnParticles(pt.x, pt.y, color, isPerfect ? 20 : 14, isPerfect ? 1.15 : 0.95);
      this._spawnShockwave(pt.x, pt.y, color, isPerfect ? 102 : 80, isPerfect ? 4 : 3);
      this._addCallout(pt.x, pt.y - 24, isPerfect ? `PERFECT! +${pts}` : `SMASH +${pts}`, color, isPerfect ? 18 : 15);
    }

    this._syncScoreHUD(true);
    this._syncComboHUD();
  }

  _handleShieldDamage(label) {
    if (this.invulnTimer > 0) return;

    this.shields -= 1;
    this.combo = 1;
    this.invulnTimer = 1.35;
    this.hitStopTimer = 0.045;
    this.shakeTime = 0.3;
    this.shakeMag = 15;
    this.damageFlash = 0.5;

    this._syncShieldsHUD();
    this._syncComboHUD();
    this._spawnShockwave(this.viewW * 0.5, this.viewH * 0.5, COLORS.vermilion, 140, 5);
    this._addCallout(this.viewW * 0.5, this.viewH * 0.48, label, COLORS.vermilion, 19);
    this.audio.hit();

    if (this.shields <= 0) {
      this.endGame();
    }
  }

  _loop(nowMs) {
    const dtSec = Math.min((nowMs - this.lastFrameMs) / 1000, 0.05);
    this.lastFrameMs = nowMs;

    this._update(nowMs, dtSec);
    this._render(nowMs);

    requestAnimationFrame((t) => this._loop(t));
  }

  _updateWarpStreaks(dtSec, speedFactor) {
    for (let i = 0; i < this.warpStreaks.length; i++) {
      const st = this.warpStreaks[i];
      st.z -= dtSec * speedFactor * st.speedMult;
      if (st.z < -0.15) {
        this.warpStreaks[i] = this._makeWarpStreak(SPAWN_Z + Math.random() * 0.15);
      }
    }
  }

  _update(nowMs, dtSec) {
    if (this.controlMode === 'camera' && this.tracker.cameraActive) {
      this.poseState = this.tracker.update(nowMs, dtSec, this.viewW, this.viewH);
    }

    if (this.state === 'start') {
      this.tunnelScroll = (this.tunnelScroll + dtSec * 0.4) % 1;
      this._updateWarpStreaks(dtSec, 0.6);
      return;
    }

    if (this.state === 'calibrating') {
      this.tunnelScroll = (this.tunnelScroll + dtSec * 0.22) % 1;
      this._updateWarpStreaks(dtSec, 0.35);
      this._updateCalibrationUI();
      return;
    }

    if (this.state === 'ready') {
      this.tunnelScroll = (this.tunnelScroll + dtSec * 0.45) % 1;
      this._updateWarpStreaks(dtSec, 0.7);
      this._updateControls(dtSec);
      this.readyTimer -= dtSec;
      if (this.readyTimer <= 0) {
        this._showScreen('playing');
      }
      return;
    }

    if (this.state !== 'playing') return;

    if (this.hitStopTimer > 0) {
      this.hitStopTimer = Math.max(0, this.hitStopTimer - dtSec);
      if (this.shakeTime > 0) this.shakeTime = Math.max(0, this.shakeTime - dtSec);
      return;
    }

    this.elapsedRunSec += dtSec;

    // Zone progression
    const nextZone = Math.min(ZONES.length - 1, Math.floor(this.elapsedRunSec / 24));
    if (nextZone > this.zoneIndex) {
      this.zoneIndex = nextZone;
      const z = this._getCurrentZone();
      this._syncZoneHUD();
      this.zoneBanner = {
        tag: `ZONE ${nextZone + 1}`,
        name: z.name,
        color: z.accent,
        life: 1.7,
        maxLife: 1.7,
      };
      this.audio.zoneUp();
      this._spawnShockwave(this.viewW * 0.5, this.viewH * 0.42, z.accent, Math.max(this.viewW, this.viewH) * 0.52, 5);
    }

    const diff = this._getDifficulty();
    const feverBoost = this.combo >= 4 ? 1.2 : 1.0;
    this.tunnelScroll = (this.tunnelScroll + dtSec * diff.zSpeed * 0.75 * feverBoost) % 1;
    this._updateWarpStreaks(dtSec, diff.zSpeed * 1.3 * feverBoost);

    // Rhythmic arcade synth bass pulse
    const beatInterval = clamp(0.46 - diff.t * 0.14, 0.3, 0.46);
    this.beatTimer += dtSec;
    if (this.beatTimer >= beatInterval) {
      this.beatTimer -= beatInterval;
      this.audio.beatPulse(this.zoneIndex, this.combo, this.beatStep % 2 === 0);
      this.beatStep += 1;
    }

    if (this.controlMode === 'practice' && this.elapsedRunSec > 6.5) {
      this.practiceHintEl.style.opacity = '0';
    }

    this._updateControls(dtSec);
    this._updateEntities(dtSec);
  }

  _updateCalibrationUI() {
    const p = this.poseState;
    const align = p.alignment || { aligned: false, hint: 'Step into frame · show shoulders & hands' };
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
      this._showToast('Posture calibrated · hands ready!');
      this.beginRun();
    }
  }

  _updateControls(dtSec) {
    if (this.controlMode === 'camera') {
      const p = this.poseState;
      this.poseWarningEl.classList.toggle('hidden', p.hasPose);
      this.isDucked = Boolean(p.hasPose && p.isDucked);

      // Record sleek hand glove motion trails
      for (const side of ['left', 'right']) {
        const hand = p.hands?.[side];
        const trail = this.handTrails[side];
        if (hand && hand.visible) {
          trail.unshift({ x: hand.x, y: hand.y });
          if (trail.length > 7) trail.pop();
        } else if (trail.length > 0) {
          trail.pop();
        }
      }
    } else {
      this.isDucked = Boolean(this.keys.duck || this.pointer.ducking);
    }

    if (this.isDucked && !this.wasDucked) {
      this.audio.duck();
    }
    this.wasDucked = this.isDucked;
    this.duckAnim += ((this.isDucked ? 1 : 0) - this.duckAnim) * (1 - Math.exp(-dtSec / 0.06));
  }

  _updateEntities(dtSec) {
    if (this.invulnTimer > 0) this.invulnTimer = Math.max(0, this.invulnTimer - dtSec);
    if (this.shakeTime > 0) this.shakeTime = Math.max(0, this.shakeTime - dtSec);
    if (this.damageFlash > 0) this.damageFlash = Math.max(0, this.damageFlash - dtSec * 1.9);
    if (this.zoneBanner) {
      this.zoneBanner.life -= dtSec;
      if (this.zoneBanner.life <= 0) this.zoneBanner = null;
    }

    this.spawnTimer -= dtSec;
    if (this.spawnTimer <= 0) {
      this._spawnNextWave();
    }

    const cam = this._getCorridorCamera();
    const hands = this.controlMode === 'camera' ? this.poseState.hands : null;
    const gloveR = clamp(this.playW * 0.062, 22, 32);

    // Update punch crystals
    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      t.z -= t.zSpeed * dtSec;
      t.spin += dtSec * 3.4;

      // Live Camera Hand Collision inside Strike Window
      if (!t.smashed && !t.missed && t.z <= STRIKE_Z_MAX && t.z >= STRIKE_Z_MIN && hands) {
        const pt = this._project(t.wx, t.wy, t.z, cam);
        const crystalR = clamp(this.playW * 0.082, 26, 40) * pt.s;
        for (const side of ['left', 'right']) {
          const h = hands[side];
          if (!h || !h.visible) continue;
          const dist = Math.hypot(h.x - pt.x, h.y - pt.y);
          if (dist <= crystalR + gloveR + 18) {
            this._smashTarget(t, side, h.speed > 420);
            break;
          }
        }
      }

      // Missed target passed behind player
      if (!t.smashed && !t.missed && t.z < STRIKE_Z_MIN) {
        t.missed = true;
        if (t.side !== 'gold') {
          this._handleShieldDamage('MISSED!');
        }
      }

      if (t.smashed || t.z < DESPAWN_Z) {
        this.targets.splice(i, 1);
      }
    }

    // Update Red Laser Sweeps (duck underneath!)
    for (let i = this.lasers.length - 1; i >= 0; i--) {
      const l = this.lasers[i];
      l.z -= l.zSpeed * dtSec;
      const zFront = l.z;
      const zBack = l.z + l.depth;

      if (!l.hit && zFront <= 0.03 && zBack >= -0.03) {
        if (!this.isDucked) {
          l.hit = true;
          this._handleShieldDamage('LASER HIT!');
        }
      }

      if (!l.cleared && !l.hit && zBack < -0.03) {
        l.cleared = true;
        this.stats.ducks += 1;
        this.combo = Math.min(this.combo + 1, 12);
        if (this.combo > this.peakCombo) this.peakCombo = this.combo;
        const pts = 45 * this.combo;
        this.score += pts;
        this.audio.dodge(this.combo);
        this._spawnShockwave(this.viewW * 0.5, this.viewH * 0.65, COLORS.volt, 90, 3);
        this._addCallout(this.viewW * 0.5, this.viewH * 0.52, `CLEAR! +${pts}`, COLORS.volt, 17);
        this._syncScoreHUD(true);
        this._syncComboHUD();
      }

      if (zBack < DESPAWN_Z) {
        this.lasers.splice(i, 1);
      }
    }

    // Update VFX pools
    for (let i = this.virtualPunches.length - 1; i >= 0; i--) {
      this.virtualPunches[i].life -= dtSec;
      if (this.virtualPunches[i].life <= 0) this.virtualPunches.splice(i, 1);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.life -= dtSec;
      pt.x += pt.vx * dtSec;
      pt.y += pt.vy * dtSec;
      pt.vx *= 0.93;
      pt.vy *= 0.93;
      if (pt.life <= 0) this.particles.splice(i, 1);
    }

    for (let i = this.shockwaves.length - 1; i >= 0; i--) {
      const sw = this.shockwaves[i];
      sw.life -= dtSec;
      const p = 1 - clamp(sw.life / sw.maxLife, 0, 1);
      sw.radius = 10 + (sw.maxRadius - 10) * (1 - Math.pow(1 - p, 3));
      if (sw.life <= 0) this.shockwaves.splice(i, 1);
    }

    for (let i = this.callouts.length - 1; i >= 0; i--) {
      const c = this.callouts[i];
      c.life -= dtSec;
      c.y -= 52 * dtSec;
      if (c.life <= 0) this.callouts.splice(i, 1);
    }
  }

  // ==================== 3D VFX RENDERING ====================

  _render(nowMs) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.viewW, this.viewH);

    ctx.save();

    if (this.shakeTime > 0) {
      const decay = this.shakeTime / 0.3;
      ctx.translate((Math.random() * 2 - 1) * this.shakeMag * decay, (Math.random() * 2 - 1) * this.shakeMag * decay);
    }

    const cam = this._getCorridorCamera();
    this._draw3DArena(ctx, cam, nowMs);

    // Live Start Screen showcase (floating twin demo crystals + orbiting gauntlets)
    if (this.state === 'start') {
      this._drawStartDemo(ctx, cam, nowMs);
      ctx.restore();
      return;
    }

    if (
      this.controlMode === 'camera' &&
      this.tracker.cameraActive &&
      (this.settings.showOverlay || this.state === 'calibrating')
    ) {
      this._drawPoseOverlay(ctx, nowMs);
    }

    if (this.controlMode === 'practice' && (this.state === 'playing' || this.state === 'ready')) {
      this._drawPracticeDuckZone(ctx);
    }

    if (
      this.state === 'playing' ||
      this.state === 'ready' ||
      this.state === 'paused' ||
      this.state === 'gameover'
    ) {
      this._draw3DEntitiesSorted(ctx, cam, nowMs);
      this._drawHandGloves(ctx, nowMs);
      this._drawShockwaves(ctx);
      this._drawParticles(ctx);
      this._drawSpeedLines(ctx, nowMs);
      this._drawCallouts(ctx);
      this._drawZoneBanner(ctx);
    }

    if (this.state === 'ready') {
      this._drawReadyBanner(ctx);
    }

    if (this.damageFlash > 0) {
      const grad = ctx.createRadialGradient(
        this.viewW * 0.5,
        this.viewH * 0.5,
        this.viewW * 0.18,
        this.viewW * 0.5,
        this.viewH * 0.5,
        Math.max(this.viewW, this.viewH) * 0.72
      );
      grad.addColorStop(0, `rgba(255, 77, 46, ${(this.damageFlash * 0.12).toFixed(3)})`);
      grad.addColorStop(1, `rgba(255, 42, 24, ${(this.damageFlash * 0.65).toFixed(3)})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, this.viewW, this.viewH);
    }

    ctx.restore();
  }

  _draw3DArena(ctx, cam, nowMs) {
    ctx.save();
    const zone = this._getCurrentZone();
    const isFever = this.combo >= 4 && this.state === 'playing';
    const railRgb = isFever ? '200, 245, 59' : zone.rgb;
    const farZ = SPAWN_Z;

    const fTL = this._project(-1, -1, farZ, cam);
    const fBR = this._project(1, 1, farZ, cam);
    const fCx = (fTL.x + fBR.x) * 0.5;
    const fCy = (fTL.y + fBR.y) * 0.5;
    const portalR = Math.max(fBR.x - fTL.x, fBR.y - fTL.y) * 1.95;

    // Radial horizon glow
    const portalGrad = ctx.createRadialGradient(fCx, fCy, 6, fCx, fCy, portalR);
    portalGrad.addColorStop(0, `rgba(${railRgb}, ${isFever ? 0.34 : 0.22})`);
    portalGrad.addColorStop(0.45, `rgba(${zone.secondary}, 0.08)`);
    portalGrad.addColorStop(1, 'rgba(7, 9, 12, 0)');
    ctx.fillStyle = portalGrad;
    ctx.beginPath();
    ctx.arc(fCx, fCy, portalR, 0, Math.PI * 2);
    ctx.fill();

    // Reflective floor plane
    const flFar = this._project(-1, 1, farZ, cam);
    const frFar = this._project(1, 1, farZ, cam);
    const frNear = this._project(1, 1, 0, cam);
    const flNear = this._project(-1, 1, 0, cam);

    const floorGrad = ctx.createLinearGradient(0, flFar.y, 0, flNear.y);
    floorGrad.addColorStop(0, `rgba(${railRgb}, 0.14)`);
    floorGrad.addColorStop(0.5, 'rgba(10, 14, 20, 0.34)');
    floorGrad.addColorStop(1, 'rgba(7, 9, 12, 0.6)');
    ctx.fillStyle = floorGrad;
    ctx.beginPath();
    ctx.moveTo(flFar.x, flFar.y);
    ctx.lineTo(frFar.x, frFar.y);
    ctx.lineTo(frNear.x, frNear.y);
    ctx.lineTo(flNear.x, flNear.y);
    ctx.closePath();
    ctx.fill();

    // Corner rails (left cyan-tinted, right volt-tinted floor curbs for instant hand-side intuition!)
    const corners = [
      [-1, -1, false, '50, 230, 255'],
      [1, -1, false, '200, 245, 59'],
      [1, 1, true, '200, 245, 59'],
      [-1, 1, true, '50, 230, 255'],
    ];
    for (const [wx, wy, isFloor, curbRgb] of corners) {
      const pFar = this._project(wx, wy, farZ, cam);
      const pNear = this._project(wx, wy, 0, cam);
      if (isFloor) {
        ctx.strokeStyle = `rgba(${curbRgb}, 0.25)`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(pFar.x, pFar.y);
        ctx.lineTo(pNear.x, pNear.y);
        ctx.stroke();
        ctx.strokeStyle = `rgba(${curbRgb}, 0.78)`;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(pFar.x, pFar.y);
        ctx.lineTo(pNear.x, pNear.y);
        ctx.stroke();
      } else {
        ctx.strokeStyle = `rgba(${curbRgb}, 0.2)`;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(pFar.x, pFar.y);
        ctx.lineTo(pNear.x, pNear.y);
        ctx.stroke();
      }
    }

    // Speeding depth ribs
    const frameCount = 6;
    for (let i = 0; i < frameCount; i++) {
      let z = ((i / frameCount) - this.tunnelScroll + 1) % 1;
      z = z * (SPAWN_Z + 0.08) - 0.08;
      if (z < -0.05 || z > SPAWN_Z) continue;
      const tl = this._project(-1, -1, z, cam);
      const br = this._project(1, 1, z, cam);
      const depthAlpha = clamp(1 - z / SPAWN_Z, 0.08, 1) * (z < 0 ? clamp(1 + z * 8, 0, 1) : 1);
      ctx.strokeStyle = `rgba(${railRgb}, ${(0.06 + depthAlpha * 0.16).toFixed(3)})`;
      ctx.lineWidth = 1 + depthAlpha * 0.8;
      ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    }

    // Far portal + rotating target ring
    ctx.fillStyle = 'rgba(7, 9, 12, 0.42)';
    ctx.fillRect(fTL.x, fTL.y, fBR.x - fTL.x, fBR.y - fTL.y);
    ctx.strokeStyle = `rgba(${railRgb}, 0.48)`;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(fTL.x, fTL.y, fBR.x - fTL.x, fBR.y - fTL.y);

    const spinR = Math.min(fBR.x - fTL.x, fBR.y - fTL.y) * 0.36;
    const rot = nowMs * 0.0018;
    ctx.strokeStyle = `rgba(${railRgb}, 0.45)`;
    ctx.lineWidth = 1.8;
    for (let a = 0; a < 4; a++) {
      const start = rot + (a * Math.PI) / 2;
      ctx.beginPath();
      ctx.arc(fCx, fCy, spinR, start, start + Math.PI * 0.25);
      ctx.stroke();
    }

    // 3D velocity warp streaks
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const st of this.warpStreaks) {
      const zHead = st.z;
      const zTail = Math.min(SPAWN_Z, st.z + st.len * (isFever ? 1.5 : 1));
      if (zHead > SPAWN_Z) continue;
      const p1 = this._project(st.wx, st.wy, zHead, cam);
      const p2 = this._project(st.wx, st.wy, zTail, cam);
      const a = clamp(1 - zHead / SPAWN_Z, 0.05, 0.82) * (st.bright ? 0.65 : 0.35);
      ctx.strokeStyle = st.bright ? `rgba(${railRgb}, ${a.toFixed(3)})` : `rgba(244, 247, 250, ${(a * 0.65).toFixed(3)})`;
      ctx.lineWidth = Math.max(1, 2.1 * p1.s);
      ctx.beginPath();
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    ctx.restore();

    ctx.restore();
  }

  _drawStartDemo(ctx, cam, nowMs) {
    // Live floating Cyan & Volt 3D demo crystals hovering inside the start screen arena
    const bob = Math.sin(nowMs * 0.0028) * 0.06;
    this._drawCrystal(ctx, { side: 'left', wx: -0.44, wy: -0.05 + bob, z: 0.22, spin: nowMs * 0.0025 }, cam, nowMs);
    this._drawCrystal(ctx, { side: 'right', wx: 0.44, wy: -0.05 - bob, z: 0.22, spin: -nowMs * 0.0025 }, cam, nowMs);
  }

  _draw3DEntitiesSorted(ctx, cam, nowMs) {
    const items = [];
    for (const t of this.targets) {
      if (!t.smashed) items.push({ kind: 'target', z: t.z, ref: t });
    }
    for (const l of this.lasers) {
      items.push({ kind: 'laser', z: l.z, ref: l });
    }
    items.sort((a, b) => b.z - a.z);

    for (const item of items) {
      if (item.kind === 'target') {
        this._drawCrystal(ctx, item.ref, cam, nowMs);
      } else {
        this._drawLaserSweep(ctx, item.ref, cam, nowMs);
      }
    }
  }

  _drawCrystal(ctx, t, cam, nowMs) {
    const pt = this._project(t.wx, t.wy, t.z, cam);
    const floorPt = this._project(t.wx, 1.0, t.z, cam);
    const farFade = clamp((SPAWN_Z - t.z) * 4.2 + 0.25, 0.2, 1);
    const nearFade = t.z < -0.04 ? clamp(1 - (-0.04 - t.z) / 0.14, 0, 1) : 1;
    const alpha = farFade * nearFade;
    if (alpha <= 0.01) return;

    const r = clamp(this.playW * 0.084, 26, 42) * pt.s;
    const isLeft = t.side === 'left';
    const isGold = t.side === 'gold';
    const mainColor = isGold ? COLORS.amber : isLeft ? COLORS.cyan : COLORS.volt;
    const rgb = isGold ? '255, 184, 46' : isLeft ? '50, 230, 255' : '200, 245, 59';
    const inStrikeZone = t.z <= STRIKE_Z_MAX && t.z >= STRIKE_Z_MIN;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Floor reflection glow directly beneath crystal
    ctx.fillStyle = `rgba(${rgb}, 0.26)`;
    ctx.beginPath();
    ctx.ellipse(floorPt.x, floorPt.y - 2, r * 0.95, Math.max(2.5, r * 0.22), 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(pt.x, pt.y);

    // Radiant additive halo bloom
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const bloomR = r * (inStrikeZone ? 2.15 : 1.7);
    const grad = ctx.createRadialGradient(0, 0, r * 0.15, 0, 0, bloomR);
    grad.addColorStop(0, `rgba(${rgb}, ${inStrikeZone ? 0.55 : 0.34})`);
    grad.addColorStop(0.55, `rgba(${rgb}, 0.14)`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, bloomR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Collapsing Strike Timing Ring (turns crisp white-hot inside strike window!)
    if (t.z < 0.65 && t.z > STRIKE_Z_MIN) {
      const ringFactor = 1 + clamp((t.z - 0.06) / 0.6, 0, 1) * 1.15;
      ctx.strokeStyle = inStrikeZone ? '#ffffff' : `rgba(${rgb}, 0.55)`;
      ctx.lineWidth = inStrikeZone ? Math.max(2, 3.2 * pt.s) : Math.max(1.2, 2 * pt.s);
      ctx.beginPath();
      ctx.arc(0, 0, r * ringFactor, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Faceted 3D Rotating Octahedron Crystal
    ctx.save();
    ctx.rotate(Math.sin(t.spin) * 0.28);
    const facetW = r * (0.78 + Math.abs(Math.cos(t.spin)) * 0.24);
    const facetH = r * 1.12;

    // Dark translucent gem body
    const bodyGrad = ctx.createLinearGradient(-facetW, -facetH, facetW, facetH);
    bodyGrad.addColorStop(0, '#ffffff');
    bodyGrad.addColorStop(0.28, mainColor);
    bodyGrad.addColorStop(1, '#0d141c');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.moveTo(0, -facetH);
    ctx.lineTo(facetW, 0);
    ctx.lineTo(0, facetH);
    ctx.lineTo(-facetW, 0);
    ctx.closePath();
    ctx.fill();

    // Facet ridge highlight
    ctx.strokeStyle = inStrikeZone ? '#ffffff' : `rgba(${rgb}, 0.95)`;
    ctx.lineWidth = Math.max(1.4, 2.4 * pt.s);
    ctx.stroke();

    // Inner geometric core diamond
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    const cr = r * 0.34;
    ctx.beginPath();
    ctx.moveTo(0, -cr);
    ctx.lineTo(cr, 0);
    ctx.lineTo(0, cr);
    ctx.lineTo(-cr, 0);
    ctx.closePath();
    ctx.fill();

    // Side label cue ("L" / "R" / "★") once close enough
    if (r > 18) {
      ctx.font = `700 ${clamp(Math.round(r * 0.42), 10, 15)}px "Chakra Petch", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#080c10';
      ctx.fillText(isGold ? '★' : isLeft ? 'L' : 'R', 0, clamp(Math.round(r * 0.14), 4, 6));
      ctx.textAlign = 'left';
    }

    ctx.restore();
    ctx.restore();
  }

  _drawLaserSweep(ctx, l, cam, nowMs) {
    const zFront = l.z;
    const zBack = l.z + l.depth;
    const farFade = clamp((SPAWN_Z - zFront) * 4.5 + 0.25, 0.2, 1);
    const nearFade = zFront < -0.02 ? clamp(1 - (-0.02 - zFront) / 0.14, 0, 1) : 1;
    const alpha = farFade * nearFade;
    if (alpha <= 0.01) return;

    const wy1 = -0.58;
    const wy2 = 0.14;
    const fTL = this._project(-1, wy1, zFront, cam);
    const fTR = this._project(1, wy1, zFront, cam);
    const fBL = this._project(-1, wy2, zFront, cam);
    const bTL = this._project(-1, wy1, zBack, cam);
    const bTR = this._project(1, wy1, zBack, cam);

    const fw = fTR.x - fTL.x;
    const fh = fBL.y - fTL.y;
    const cleared = this.isDucked;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Top bevel
    if (fTL.y > cam.vpY) {
      ctx.fillStyle = cleared ? 'rgba(200, 245, 59, 0.24)' : 'rgba(220, 46, 22, 0.44)';
      ctx.beginPath();
      ctx.moveTo(fTL.x, fTL.y);
      ctx.lineTo(fTR.x, fTR.y);
      ctx.lineTo(bTR.x, bTR.y);
      ctx.lineTo(bTL.x, bTL.y);
      ctx.closePath();
      ctx.fill();
    }

    const grad = ctx.createLinearGradient(fTL.x, fTL.y, fTL.x, fBL.y);
    if (cleared) {
      grad.addColorStop(0, 'rgba(200, 245, 59, 0.12)');
      grad.addColorStop(0.5, 'rgba(200, 245, 59, 0.28)');
      grad.addColorStop(1, 'rgba(50, 230, 255, 0.22)');
    } else {
      grad.addColorStop(0, 'rgba(255, 62, 36, 0.84)');
      grad.addColorStop(0.5, 'rgba(255, 92, 48, 0.62)');
      grad.addColorStop(1, 'rgba(255, 52, 28, 0.9)');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(fTL.x, fTL.y, fw, fh);

    // Additive plasma wave
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const midY = fTL.y + fh * 0.5;
    const wave = Math.sin(nowMs * 0.022 + zFront * 12) * 3.5 * fTL.s;
    ctx.strokeStyle = cleared ? 'rgba(200, 245, 59, 0.72)' : 'rgba(255, 110, 74, 0.88)';
    ctx.lineWidth = Math.max(3, 9 * fTL.s);
    ctx.beginPath();
    ctx.moveTo(fTL.x, midY);
    ctx.quadraticCurveTo(fTL.x + fw * 0.5, midY + wave, fTR.x, midY);
    ctx.stroke();

    ctx.strokeStyle = cleared ? '#f4ffbf' : '#fff2ec';
    ctx.lineWidth = Math.max(1.2, 2.8 * fTL.s);
    ctx.beginPath();
    ctx.moveTo(fTL.x, midY);
    ctx.quadraticCurveTo(fTL.x + fw * 0.5, midY + wave, fTR.x, midY);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = cleared ? COLORS.volt : '#ff8a70';
    ctx.lineWidth = Math.max(1.2, 2.2 * fTL.s);
    ctx.strokeRect(fTL.x, fTL.y, fw, fh);

    if (fw > 90) {
      const fontSize = clamp(Math.round(14 * fTL.s), 9, 16);
      const badgeText = cleared ? 'CLEAR ✓' : 'DUCK LASER';
      ctx.font = `700 ${fontSize}px "Chakra Petch", sans-serif`;
      const tw = ctx.measureText(badgeText).width;
      const bw = tw + 18;
      const bh = fontSize + 10;
      const bx = fTL.x + (fw - bw) * 0.5;
      const by = fBL.y - bh - Math.max(6, 10 * fTL.s);
      ctx.fillStyle = cleared ? COLORS.volt : 'rgba(9, 12, 16, 0.9)';
      this._roundRect(ctx, bx, by, bw, bh, 5);
      ctx.fill();
      ctx.fillStyle = cleared ? '#090c04' : '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(badgeText, fTL.x + fw * 0.5, by + bh - 6);
      ctx.textAlign = 'left';
    }

    ctx.restore();
  }

  _drawHandGloves(ctx, nowMs) {
    // 1. Live Camera Mode: glowing 3D energy gauntlets tracking Left (Cyan) & Right (Volt) hands
    if (this.controlMode === 'camera' && this.poseState.hands) {
      const gloveR = clamp(this.playW * 0.056, 20, 28);
      const defs = [
        { key: 'left', color: COLORS.cyan, rgb: '50, 230, 255', label: 'L' },
        { key: 'right', color: COLORS.volt, rgb: '200, 245, 59', label: 'R' },
      ];

      for (const d of defs) {
        const hand = this.poseState.hands[d.key];
        const trail = this.handTrails[d.key];

        // Comet trail
        if (trail.length > 1) {
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.lineCap = 'round';
          for (let i = 1; i < trail.length; i++) {
            const frac = 1 - i / trail.length;
            ctx.strokeStyle = `rgba(${d.rgb}, ${(frac * 0.42).toFixed(3)})`;
            ctx.lineWidth = Math.max(2, gloveR * 0.6 * frac);
            ctx.beginPath();
            ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
            ctx.lineTo(trail[i].x, trail[i].y);
            ctx.stroke();
          }
          ctx.restore();
        }

        if (!hand || !hand.visible) continue;

        const punchBoost = clamp(hand.speed / 650, 0, 0.45);
        const r = gloveR * (1 + punchBoost);

        ctx.save();
        ctx.translate(hand.x, hand.y);

        // Additive energy aura
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createRadialGradient(0, 0, 4, 0, 0, r * 1.7);
        g.addColorStop(0, `rgba(${d.rgb}, ${(0.42 + punchBoost * 0.4).toFixed(3)})`);
        g.addColorStop(1, `rgba(${d.rgb}, 0)`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(0, 0, r * 1.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Outer spinning energy bracket ring
        ctx.save();
        ctx.rotate(nowMs * (d.key === 'left' ? -0.003 : 0.003));
        ctx.strokeStyle = d.color;
        ctx.lineWidth = 2.4;
        for (let k = 0; k < 4; k++) {
          const a = (k * Math.PI) / 2;
          ctx.beginPath();
          ctx.arc(0, 0, r, a + 0.18, a + Math.PI * 0.32);
          ctx.stroke();
        }
        ctx.restore();

        // Tactile diamond fist core
        ctx.fillStyle = 'rgba(10, 14, 20, 0.72)';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        const c = r * 0.56;
        ctx.beginPath();
        ctx.moveTo(0, -c);
        ctx.lineTo(c, 0);
        ctx.lineTo(0, c);
        ctx.lineTo(-c, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.font = '700 11px "Chakra Petch", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = d.color;
        ctx.fillText(d.label, 0, 4);
        ctx.textAlign = 'left';
        ctx.restore();
      }
    }

    // 2. Practice Mode virtual punch bursts
    if (this.virtualPunches.length > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const vp of this.virtualPunches) {
        const alpha = clamp(vp.life / vp.maxLife, 0, 1);
        const r = 24 + (1 - alpha) * 28;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = vp.color;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.arc(vp.x, vp.y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  _drawPoseOverlay(ctx, nowMs) {
    const p = this.poseState;

    if (p.calibrated) {
      const duckY = p.duckLineY * this.viewH;
      const isDucked = p.isDucked;
      ctx.save();
      ctx.strokeStyle = isDucked ? COLORS.volt : 'rgba(255, 255, 255, 0.24)';
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
      ctx.restore();
    }

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
      ctx.strokeStyle = align.aligned ? COLORS.cyan : COLORS.amber;
      ctx.lineWidth = align.aligned ? 2.4 : 1.8;
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

      if (p.hasPose && p.trackedPointPx && p.calibrationProgress > 0) {
        ctx.strokeStyle = COLORS.cyan;
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
      } else if (p.hasPose && p.trackedPointPx && !align.aligned) {
        ctx.strokeStyle = 'rgba(255, 184, 46, 0.55)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(p.trackedPointPx.x, p.trackedPointPx.y);
        ctx.lineTo(boxCx, boxCy);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    const lms = p.mappedLandmarks;
    if (!p.hasPose || !lms) return;

    ctx.save();
    ctx.strokeStyle = 'rgba(50, 230, 255, 0.34)';
    ctx.lineWidth = 1.4;
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
    if (p.trackedPointPx) {
      const pulse = 1 + Math.sin(nowMs * 0.008) * 0.1;
      ctx.fillStyle = COLORS.cyan;
      ctx.beginPath();
      ctx.arc(p.trackedPointPx.x, p.trackedPointPx.y, 3.6 * pulse, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawPracticeDuckZone(ctx) {
    const duckZoneY = this.viewH * 0.78;
    const active = this.isDucked;
    ctx.save();
    ctx.strokeStyle = active ? 'rgba(200, 245, 59, 0.55)' : 'rgba(255, 255, 255, 0.14)';
    ctx.lineWidth = 1.3;
    ctx.setLineDash([5, 7]);
    ctx.beginPath();
    ctx.moveTo(this.playLeft + 14, duckZoneY);
    ctx.lineTo(this.playRight - 14, duckZoneY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '700 9.5px "JetBrains Mono", monospace';
    ctx.fillStyle = active ? COLORS.volt : 'rgba(255, 255, 255, 0.38)';
    ctx.textAlign = 'right';
    ctx.fillText(active ? 'DUCKED' : 'HOLD HERE TO DUCK', this.playRight - 16, duckZoneY + 14);
    ctx.textAlign = 'left';
    ctx.restore();
  }

  _drawShockwaves(ctx) {
    if (this.shockwaves.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const sw of this.shockwaves) {
      const alpha = clamp(sw.life / sw.maxLife, 0, 1);
      ctx.globalAlpha = alpha * 0.85;
      ctx.strokeStyle = sw.color;
      ctx.lineWidth = Math.max(1, sw.lineWidth * alpha);
      ctx.beginPath();
      ctx.arc(sw.x, sw.y, sw.radius, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawParticles(ctx) {
    if (this.particles.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const pt of this.particles) {
      const alpha = clamp(pt.life / pt.maxLife, 0, 1);
      ctx.globalAlpha = alpha;
      const tailX = pt.x - pt.vx * 0.032;
      const tailY = pt.y - pt.vy * 0.032;
      ctx.strokeStyle = pt.color;
      ctx.lineWidth = pt.size * (0.65 + alpha * 0.5);
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawSpeedLines(ctx, nowMs) {
    const intensity = clamp((this.combo - 2) * 0.14 + (this.elapsedRunSec / 120) * 0.35, 0, 0.85);
    if (intensity <= 0.05 || this.state !== 'playing') return;
    const zone = this._getCurrentZone();
    const rgb = this.combo >= 4 ? '200, 245, 59' : zone.rgb;
    const cx = this.viewW * 0.5;
    const cy = this.viewH * 0.44;
    const maxR = Math.hypot(this.viewW, this.viewH) * 0.62;
    const count = 14;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const baseAngle = (Math.PI * 2 * i) / count + Math.sin(i * 7.3) * 0.14;
      const pulse = (nowMs * 0.0024 + i * 0.37) % 1;
      const rInner = maxR * (0.58 + pulse * 0.22);
      const rOuter = maxR * (0.86 + pulse * 0.28);
      const alpha = intensity * (1 - pulse) * 0.42;

      ctx.strokeStyle = `rgba(${rgb}, ${alpha.toFixed(3)})`;
      ctx.lineWidth = 1.4 + (1 - pulse) * 1.4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(baseAngle) * rInner, cy + Math.sin(baseAngle) * rInner);
      ctx.lineTo(cx + Math.cos(baseAngle) * rOuter, cy + Math.sin(baseAngle) * rOuter);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawCallouts(ctx) {
    if (this.callouts.length === 0) return;
    ctx.save();
    ctx.textAlign = 'center';
    for (const c of this.callouts) {
      const progress = 1 - clamp(c.life / c.maxLife, 0, 1);
      const scale = progress < 0.15 ? 0.72 + (progress / 0.15) * 0.38 : 1.0;
      const alpha = clamp(c.life / (c.maxLife * 0.55), 0, 1);

      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.scale(scale, scale);
      ctx.globalAlpha = alpha;
      ctx.font = `italic 700 ${c.size}px "Chakra Petch", sans-serif`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(7, 9, 12, 0.92)';
      ctx.strokeText(c.text, 0, 0);
      ctx.fillStyle = c.color;
      ctx.fillText(c.text, 0, 0);
      ctx.restore();
    }
    ctx.textAlign = 'left';
    ctx.restore();
  }

  _drawZoneBanner(ctx) {
    if (!this.zoneBanner) return;
    const b = this.zoneBanner;
    const alpha = clamp(Math.min(b.life * 2.2, (b.maxLife - b.life) * 4), 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    const cx = this.viewW * 0.5;
    const cy = this.viewH * 0.34;
    ctx.font = '700 13px "JetBrains Mono", monospace';
    ctx.fillStyle = b.color;
    ctx.fillText(b.tag, cx, cy - 26);
    ctx.font = 'italic 700 34px "Chakra Petch", sans-serif';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(7, 9, 12, 0.9)';
    ctx.strokeText(b.name, cx, cy + 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(b.name, cx, cy + 4);
    ctx.restore();
  }

  _drawReadyBanner(ctx) {
    ctx.save();
    const alpha = clamp(this.readyTimer / 0.6, 0, 1);
    const scale = 1.15 - alpha * 0.15;
    ctx.translate(this.viewW * 0.5, this.viewH * 0.42);
    ctx.scale(scale, scale);
    ctx.globalAlpha = Math.min(1, alpha * 1.9);
    ctx.font = 'italic 700 50px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(7, 9, 12, 0.88)';
    ctx.strokeText('STRIKE!', 0, 0);
    ctx.fillStyle = COLORS.cyan;
    ctx.fillText('STRIKE!', 0, 0);
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
  new StrikeGame();
});
