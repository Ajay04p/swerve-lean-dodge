// MOTION ARCADE — Shared zero-asset Web Audio API synthesizer + mobile haptics
// Unlocked on first user tap for iOS Safari / mobile browser compatibility.

const STORAGE_MUTE_KEY = 'swerve_muted';

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.muted = this._loadMuted();
    this.unlocked = false;
  }

  _loadMuted() {
    try {
      return localStorage.getItem(STORAGE_MUTE_KEY) === '1';
    } catch {
      return false;
    }
  }

  _saveMuted() {
    try {
      localStorage.setItem(STORAGE_MUTE_KEY, this.muted ? '1' : '0');
    } catch {
      // Ignore storage errors
    }
  }

  isMuted() {
    return this.muted;
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    this._saveMuted();
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.75, now, 0.015);
    }
  }

  toggleMute() {
    this.setMuted(!this.muted);
    if (!this.muted) {
      this.unlock();
      this.click();
    }
    return this.muted;
  }

  vibrate(pattern) {
    try {
      if (navigator.vibrate) {
        navigator.vibrate(pattern);
      }
    } catch {
      // Ignore on unsupported devices
    }
  }

  unlock() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.75;
      this.masterGain.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    if (!this.unlocked) {
      try {
        const buffer = this.ctx.createBuffer(1, 1, 22050);
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(this.masterGain);
        src.start(0);
        this.unlocked = true;
      } catch {
        // Ignore unlock errors
      }
    }

    return true;
  }

  _canPlay() {
    if (this.muted) return false;
    if (!this.ctx) this.unlock();
    if (!this.ctx) return false;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return true;
  }

  _playTone({
    type = 'sine',
    freqStart = 440,
    freqEnd = null,
    duration = 0.12,
    delay = 0,
    gain = 0.2,
    attack = 0.005,
    filterFreq = null,
  }) {
    if (!this._canPlay()) return;
    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, now);
    if (freqEnd !== null && freqEnd !== freqStart) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);
    }

    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(gain, now + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    let dest = this.masterGain;
    if (filterFreq) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(filterFreq, now);
      filter.connect(this.masterGain);
      dest = filter;
    }

    osc.connect(env);
    env.connect(dest);

    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  _playNoise({ duration = 0.14, delay = 0, gain = 0.18, filterType = 'bandpass', freqStart = 900, freqEnd = 240 }) {
    if (!this._canPlay()) return;
    const now = this.ctx.currentTime + delay;
    const sampleCount = Math.max(1, Math.floor(this.ctx.sampleRate * duration));
    const buffer = this.ctx.createBuffer(1, sampleCount, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.setValueAtTime(freqStart, now);
    if (freqEnd && freqEnd !== freqStart) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), now + duration);
    }
    filter.Q.value = 1.25;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(gain, now + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    src.connect(filter);
    filter.connect(env);
    env.connect(this.masterGain);

    src.start(now);
    src.stop(now + duration + 0.02);
  }

  click() {
    this._playTone({
      type: 'triangle',
      freqStart: 680,
      freqEnd: 480,
      duration: 0.045,
      gain: 0.11,
      attack: 0.003,
    });
  }

  beatPulse(zoneIndex = 0, combo = 1, isDownbeat = false) {
    const roots = [55, 61.74, 65.41, 73.42];
    const root = roots[zoneIndex % roots.length];
    const freq = isDownbeat ? root : root * 1.5;
    const energy = Math.min(1, 0.35 + (combo - 1) * 0.08);

    this._playTone({
      type: 'triangle',
      freqStart: freq * 1.6,
      freqEnd: freq,
      duration: isDownbeat ? 0.14 : 0.09,
      gain: (isDownbeat ? 0.11 : 0.065) * energy,
      attack: 0.004,
      filterFreq: 320 + combo * 45,
    });
    if (isDownbeat && combo >= 4) {
      this._playNoise({
        duration: 0.04,
        gain: 0.032,
        filterType: 'highpass',
        freqStart: 4200,
        freqEnd: 6500,
      });
    }
  }

  dodge(combo = 1) {
    const semitoneBoost = Math.min(combo - 1, 12);
    const root = 293.66 * Math.pow(2, semitoneBoost / 16);
    this._playTone({
      type: 'triangle',
      freqStart: root,
      freqEnd: root * 1.5,
      duration: 0.1,
      gain: 0.15,
      attack: 0.004,
      filterFreq: 2600,
    });
    this._playNoise({
      duration: 0.065,
      gain: 0.045,
      filterType: 'highpass',
      freqStart: 1800,
      freqEnd: 3400,
    });
  }

  punchSmash(combo = 1, isPerfect = false) {
    this.vibrate(isPerfect ? 24 : 16);
    const boost = Math.pow(2, Math.min(combo - 1, 10) / 18);
    // Low punch thump
    this._playTone({
      type: 'sine',
      freqStart: 180,
      freqEnd: 58,
      duration: 0.12,
      gain: 0.24,
      attack: 0.002,
    });
    // Crystalline shatter chime
    this._playTone({
      type: 'triangle',
      freqStart: 520 * boost,
      freqEnd: (isPerfect ? 1040 : 780) * boost,
      duration: 0.13,
      gain: 0.18,
      attack: 0.003,
      filterFreq: 3600,
    });
    if (isPerfect) {
      this._playTone({
        type: 'sine',
        freqStart: 1046.5 * boost,
        freqEnd: 1396.9 * boost,
        duration: 0.16,
        delay: 0.035,
        gain: 0.14,
        attack: 0.003,
      });
    }
    this._playNoise({
      duration: 0.09,
      gain: 0.14,
      filterType: 'bandpass',
      freqStart: 2400,
      freqEnd: 900,
    });
  }

  doubleSmash(combo = 1) {
    this.vibrate([18, 22, 26]);
    this.punchSmash(combo, true);
    this._playTone({
      type: 'sawtooth',
      freqStart: 440,
      freqEnd: 880,
      duration: 0.18,
      delay: 0.04,
      gain: 0.1,
      attack: 0.004,
      filterFreq: 2800,
    });
  }

  closeCall(combo = 1) {
    this.vibrate(18);
    const shift = Math.min(combo - 1, 8) * 20;
    this._playTone({
      type: 'sine',
      freqStart: 700 + shift,
      freqEnd: 1080 + shift,
      duration: 0.12,
      gain: 0.19,
      attack: 0.003,
    });
    this._playTone({
      type: 'triangle',
      freqStart: 1080 + shift,
      freqEnd: 1480 + shift,
      duration: 0.18,
      delay: 0.048,
      gain: 0.17,
      attack: 0.004,
    });
  }

  goldRing(combo = 1) {
    this.vibrate(14);
    const pitchScale = Math.pow(2, Math.min(combo - 1, 6) / 24);
    const notes = [659.25, 987.77, 1318.51, 1567.98];
    notes.forEach((freq, idx) => {
      this._playTone({
        type: idx === 3 ? 'triangle' : 'sine',
        freqStart: freq * pitchScale,
        freqEnd: freq * pitchScale * 1.015,
        duration: 0.18,
        delay: idx * 0.042,
        gain: 0.16 - idx * 0.02,
        attack: 0.003,
      });
    });
  }

  duck() {
    this._playTone({
      type: 'sine',
      freqStart: 380,
      freqEnd: 140,
      duration: 0.11,
      gain: 0.15,
      attack: 0.004,
    });
    this._playNoise({
      duration: 0.09,
      gain: 0.06,
      filterType: 'lowpass',
      freqStart: 1300,
      freqEnd: 300,
    });
  }

  zoneUp() {
    this.vibrate([15, 30, 25]);
    const notes = [440, 554.37, 659.25, 880];
    notes.forEach((f, idx) => {
      this._playTone({
        type: 'sawtooth',
        freqStart: f,
        freqEnd: f * 1.01,
        duration: 0.24,
        delay: idx * 0.055,
        gain: 0.11,
        attack: 0.006,
        filterFreq: 2400,
      });
    });
  }

  hit() {
    this.vibrate([45, 35, 60]);
    this._playTone({
      type: 'sawtooth',
      freqStart: 170,
      freqEnd: 42,
      duration: 0.26,
      gain: 0.27,
      attack: 0.003,
      filterFreq: 560,
    });
    this._playTone({
      type: 'sine',
      freqStart: 98,
      freqEnd: 32,
      duration: 0.28,
      gain: 0.3,
      attack: 0.003,
    });
    this._playNoise({
      duration: 0.18,
      gain: 0.24,
      filterType: 'bandpass',
      freqStart: 850,
      freqEnd: 130,
    });
  }

  ready() {
    const freqs = [440, 554.37, 659.25, 880];
    freqs.forEach((f, idx) => {
      this._playTone({
        type: 'triangle',
        freqStart: f,
        freqEnd: f,
        duration: 0.17,
        delay: idx * 0.05,
        gain: 0.15,
        attack: 0.005,
        filterFreq: 3000,
      });
    });
  }

  recenter() {
    this._playTone({
      type: 'sine',
      freqStart: 523.25,
      freqEnd: 783.99,
      duration: 0.11,
      gain: 0.14,
      attack: 0.004,
    });
  }

  gameOver() {
    this.vibrate([60, 40, 90]);
    const notes = [392.0, 329.63, 261.63, 196.0];
    notes.forEach((f, idx) => {
      this._playTone({
        type: 'sawtooth',
        freqStart: f,
        freqEnd: f * 0.95,
        duration: idx === notes.length - 1 ? 0.4 : 0.17,
        delay: idx * 0.095,
        gain: 0.14,
        attack: 0.007,
        filterFreq: 980,
      });
    });
  }
}
