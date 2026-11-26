// SWERVE — Zero-asset Web Audio API synthesizer
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
      // Ignore storage errors (e.g. private browsing)
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
      this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 0.72, now, 0.015);
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

  unlock() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return false;

    if (!this.ctx) {
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.72;
      this.masterGain.connect(this.ctx.destination);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    if (!this.unlocked) {
      try {
        // Silent 1-sample buffer reliably unlocks Web Audio on iOS Safari
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
    attack = 0.006,
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
    filter.Q.value = 1.2;

    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(gain, now + 0.008);
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
      freqStart: 620,
      freqEnd: 460,
      duration: 0.045,
      gain: 0.11,
      attack: 0.003,
    });
  }

  dodge(combo = 1) {
    const semitoneBoost = Math.min(combo - 1, 10);
    const root = 280 * Math.pow(2, semitoneBoost / 18);
    this._playTone({
      type: 'triangle',
      freqStart: root,
      freqEnd: root * 1.48,
      duration: 0.095,
      gain: 0.14,
      attack: 0.005,
      filterFreq: 2400,
    });
    this._playNoise({
      duration: 0.06,
      gain: 0.04,
      filterType: 'highpass',
      freqStart: 1600,
      freqEnd: 2800,
    });
  }

  closeCall(combo = 1) {
    const shift = Math.min(combo - 1, 8) * 18;
    this._playTone({
      type: 'sine',
      freqStart: 660 + shift,
      freqEnd: 990 + shift,
      duration: 0.12,
      gain: 0.18,
      attack: 0.004,
    });
    this._playTone({
      type: 'triangle',
      freqStart: 990 + shift,
      freqEnd: 1320 + shift,
      duration: 0.16,
      delay: 0.05,
      gain: 0.16,
      attack: 0.005,
    });
  }

  goldRing(combo = 1) {
    const pitchScale = Math.pow(2, Math.min(combo - 1, 6) / 24);
    const notes = [659.25, 987.77, 1318.51]; // E5, B5, E6
    notes.forEach((freq, idx) => {
      this._playTone({
        type: 'sine',
        freqStart: freq * pitchScale,
        freqEnd: freq * pitchScale * 1.01,
        duration: 0.17,
        delay: idx * 0.048,
        gain: 0.16 - idx * 0.02,
        attack: 0.004,
      });
    });
  }

  duck() {
    this._playTone({
      type: 'sine',
      freqStart: 360,
      freqEnd: 145,
      duration: 0.11,
      gain: 0.14,
      attack: 0.004,
    });
    this._playNoise({
      duration: 0.085,
      gain: 0.055,
      filterType: 'lowpass',
      freqStart: 1200,
      freqEnd: 320,
    });
  }

  hit() {
    // Punchy low impact + filtered crunch
    this._playTone({
      type: 'sawtooth',
      freqStart: 165,
      freqEnd: 46,
      duration: 0.24,
      gain: 0.26,
      attack: 0.004,
      filterFreq: 520,
    });
    this._playTone({
      type: 'sine',
      freqStart: 95,
      freqEnd: 34,
      duration: 0.26,
      gain: 0.28,
      attack: 0.003,
    });
    this._playNoise({
      duration: 0.16,
      gain: 0.22,
      filterType: 'bandpass',
      freqStart: 750,
      freqEnd: 140,
    });
  }

  ready() {
    // Crisp studio arcade lock-in triad (A4 -> C#5 -> E5)
    const freqs = [440, 554.37, 659.25];
    freqs.forEach((f, idx) => {
      this._playTone({
        type: 'triangle',
        freqStart: f,
        freqEnd: f,
        duration: 0.16,
        delay: idx * 0.055,
        gain: 0.15,
        attack: 0.006,
        filterFreq: 2800,
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
    const notes = [392.0, 329.63, 261.63, 196.0]; // G4, E4, C4, G3
    notes.forEach((f, idx) => {
      this._playTone({
        type: 'sawtooth',
        freqStart: f,
        freqEnd: f * 0.96,
        duration: idx === notes.length - 1 ? 0.36 : 0.16,
        delay: idx * 0.095,
        gain: 0.14,
        attack: 0.008,
        filterFreq: 950,
      });
    });
  }
}
