// Lightweight synthesized sound: no files, just WebAudio voices.
// Ambience beds (forest, water, shrine) plus short effects.
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }
  start() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(c.destination);
    // shared noise buffer
    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // ambience beds
    this.wind = this.bed(400, 0.0, 'lowpass');
    this.water = this.bed(900, 0.0, 'bandpass', 0.8);
    this.drone = c.createGain();
    this.drone.gain.value = 0;
    this.drone.connect(this.master);
    for (const f of [55, 82.5, 110.3]) {
      const o = c.createOscillator();
      o.frequency.value = f;
      o.type = 'sine';
      const g = c.createGain();
      g.gain.value = f === 55 ? 0.5 : 0.18;
      o.connect(g).connect(this.drone);
      o.start();
    }
    this.birdT = 2;
    this.dripT = 1;
    this.mode = 'day';
  }
  bed(freq, gain, type, q = 0.5) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(this.master);
    src.start();
    return { g, f };
  }
  setMode(mode) {
    this.mode = mode;
  }
  // called every frame with how close water is (0..1)
  tick(dt, waterNear, bossActive) {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const day = this.mode === 'day';
    const windTarget = day ? 0.05 + Math.sin(t * 0.3) * 0.02 : 0.015;
    this.wind.g.gain.setTargetAtTime(windTarget, t, 0.5);
    this.water.g.gain.setTargetAtTime(waterNear * (day ? 0.12 : 0.07), t, 0.3);
    this.drone.gain.setTargetAtTime(day ? 0 : bossActive ? 0.09 : 0.04, t, 0.8);
    if (day) {
      this.birdT -= dt;
      if (this.birdT <= 0) {
        this.birdT = 1.5 + Math.random() * 4;
        this.bird();
      }
    } else {
      this.dripT -= dt;
      if (this.dripT <= 0) {
        this.dripT = 0.8 + Math.random() * 2.5;
        this.tone(1400 + Math.random() * 900, 0.06, 0.12, 'sine', 0.6);
      }
    }
  }
  bird() {
    const c = this.ctx, t = c.currentTime;
    const n = 2 + Math.floor(Math.random() * 4);
    const base = 2200 + Math.random() * 1600;
    for (let i = 0; i < n; i++) {
      const o = c.createOscillator();
      const g = c.createGain();
      const st = t + i * (0.09 + Math.random() * 0.05);
      o.frequency.setValueAtTime(base, st);
      o.frequency.exponentialRampToValueAtTime(base * (1.2 + Math.random() * 0.4), st + 0.05);
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(0.025, st + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.08);
      o.connect(g).connect(this.master);
      o.start(st);
      o.stop(st + 0.1);
    }
  }
  tone(freq, gain, dur, type = 'sine', fall = 1, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (fall !== 1) o.frequency.exponentialRampToValueAtTime(freq * fall, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  burst(freq, gain, dur, type = 'lowpass', q = 1, sweep = 1, delay = 0) {
    const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = c.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep !== 1) f.frequency.exponentialRampToValueAtTime(freq * sweep, t + dur);
    f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.02);
  }
  play(name, vol = 1) {
    if (!this.ctx || this.muted) return;
    const v = vol;
    switch (name) {
      case 'step': this.burst(380 + Math.random() * 160, 0.09 * v, 0.06); break;
      case 'wade': this.burst(1200, 0.08 * v, 0.14, 'bandpass', 1.5, 0.6); break;
      case 'jump': this.burst(700, 0.05 * v, 0.1, 'bandpass', 1, 1.6); break;
      case 'land': this.burst(260, 0.16 * v, 0.12); break;
      case 'swing': this.burst(1800, 0.12 * v, 0.13, 'bandpass', 2, 0.4); break;
      case 'dash': this.burst(900, 0.12 * v, 0.2, 'bandpass', 1.5, 0.5); break;
      case 'hit': this.tone(160, 0.25 * v, 0.12, 'sine', 0.5); this.burst(1600, 0.1 * v, 0.06, 'highpass'); break;
      case 'die': this.burst(600, 0.15 * v, 0.35, 'lowpass', 1, 0.3); this.tone(300, 0.08 * v, 0.3, 'triangle', 0.4); break;
      case 'hurt': this.tone(420, 0.12 * v, 0.22, 'square', 0.5); break;
      case 'blop': this.tone(180, 0.06 * v, 0.1, 'sine', 1.8); break;
      case 'spit': this.burst(2400, 0.07 * v, 0.08, 'bandpass', 3, 0.5); this.tone(520, 0.05 * v, 0.07, 'triangle', 0.6); break;
      case 'grind': this.burst(150, 0.12 * v, 0.5, 'lowpass', 2, 1.4); break;
      case 'stomp': this.tone(70, 0.4 * v, 0.45, 'sine', 0.5); this.burst(300, 0.22 * v, 0.4); break;
      case 'flutter': for (let i = 0; i < 4; i++) this.burst(500, 0.03 * v, 0.04, 'bandpass', 2, 1, i * 0.05); break;
      case 'pot': this.burst(2600, 0.14 * v, 0.18, 'highpass'); this.tone(900, 0.04 * v, 0.1, 'triangle', 0.7); break;
      case 'crack': this.burst(500, 0.2 * v, 0.2, 'lowpass', 1, 0.5); break;
      case 'chime':
        [880, 1318.5, 1760, 2637].forEach((f, i) => this.tone(f, 0.08 / (i + 1) * 1.6, 2.6 - i * 0.4, 'sine', 1, i * 0.04));
        break;
      case 'door': this.burst(120, 0.25, 2.2, 'lowpass', 3, 1.5); this.tone(55, 0.2, 2.2, 'sine', 0.9); break;
      case 'secret': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.06, 0.5, 'triangle', 1, i * 0.09)); break;
      case 'pickup': [784, 1175].forEach((f, i) => this.tone(f, 0.06, 0.18, 'triangle', 1, i * 0.06)); break;
      case 'lever': this.burst(900, 0.15, 0.08, 'bandpass', 4); this.tone(200, 0.1, 0.15, 'square', 0.6); break;
      case 'read': this.tone(660, 0.03, 0.25, 'sine'); break;
      case 'roar': this.tone(90, 0.3, 1.2, 'sawtooth', 0.6); this.burst(400, 0.2, 1.2, 'bandpass', 1, 0.4); break;
      case 'charge': this.burst(300, 0.2, 0.6, 'lowpass', 1, 2.5); break;
      case 'bossCue':
        [0, 0.45, 0.9, 1.15].forEach((d) => this.tone(58, 0.35, 0.5, 'sine', 0.6, d));
        this.tone(110, 0.05, 2.5, 'sawtooth', 1, 0.2);
        break;
      case 'victory': [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.07, 1.4, 'triangle', 1, i * 0.14)); break;
    }
  }
}
