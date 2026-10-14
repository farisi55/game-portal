// Synthesized card sounds using the Web Audio API (no external files needed).
let ctx = null;
let noiseBuf = null;
let muted = false;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const len = ctx.sampleRate * 1;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noise(t, dur, { freq = 3000, q = 0.8, gain = 0.25, type = 'bandpass', attack = 0.004, sweepTo = null } = {}) {
  const c = ctx;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(c.destination);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

function tone(t, freq, dur, gain = 0.12, type = 'sine') {
  const c = ctx;
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export const Sound = {
  get muted() { return muted; },
  setMuted(v) { muted = v; },
  unlock() { ac(); },

  shuffle() {
    if (muted || !ac()) return;
    const t0 = ctx.currentTime;
    // Riffle: many tiny clicks accelerating, two passes
    for (let pass = 0; pass < 2; pass++) {
      const base = t0 + pass * 0.42;
      const n = 26;
      for (let i = 0; i < n; i++) {
        const t = base + (i / n) ** 0.85 * 0.34 + Math.random() * 0.006;
        noise(t, 0.025, { freq: 2500 + Math.random() * 2500, q: 1.2, gain: 0.12 + Math.random() * 0.08 });
      }
      noise(base + 0.35, 0.09, { freq: 900, q: 0.7, gain: 0.18, sweepTo: 400 });
    }
  },

  deal() {
    if (muted || !ac()) return;
    const t = ctx.currentTime;
    noise(t, 0.08, { freq: 5000, q: 0.6, gain: 0.14, sweepTo: 1800 });
    noise(t + 0.05, 0.03, { freq: 1200, q: 1, gain: 0.1 });
  },

  flip() {
    if (muted || !ac()) return;
    const t = ctx.currentTime;
    noise(t, 0.05, { freq: 3800, q: 1.4, gain: 0.2, sweepTo: 2200 });
    noise(t + 0.035, 0.03, { freq: 1500, q: 2, gain: 0.12 });
  },

  place() {
    if (muted || !ac()) return;
    const t = ctx.currentTime;
    noise(t, 0.06, { freq: 1100, q: 0.9, gain: 0.22, type: 'lowpass', sweepTo: 500 });
    noise(t, 0.02, { freq: 4000, q: 1, gain: 0.07 });
  },

  foundation() {
    if (muted || !ac()) return;
    const t = ctx.currentTime;
    noise(t, 0.05, { freq: 1100, q: 0.9, gain: 0.18, type: 'lowpass' });
    tone(t + 0.02, 880, 0.18, 0.05, 'triangle');
    tone(t + 0.06, 1320, 0.22, 0.035, 'sine');
  },

  invalid() {
    if (muted || !ac()) return;
    const t = ctx.currentTime;
    tone(t, 180, 0.12, 0.08, 'triangle');
    tone(t + 0.07, 140, 0.14, 0.07, 'triangle');
  },

  recycle() {
    if (muted || !ac()) return;
    const t = ctx.currentTime;
    noise(t, 0.25, { freq: 1500, q: 0.5, gain: 0.16, sweepTo: 5000 });
  },

  win() {
    if (muted || !ac()) return;
    const t = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5];
    const times = [0, 0.12, 0.24, 0.36, 0.52, 0.62, 0.74];
    notes.forEach((f, i) => {
      tone(t + times[i], f, i === notes.length - 1 ? 0.9 : 0.22, 0.09, 'triangle');
      tone(t + times[i], f * 2, 0.15, 0.025, 'sine');
    });
  },
};
