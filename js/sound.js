// All sounds are synthesised with WebAudio, so there are no audio files to
// license. Browsers only allow audio after a tap, so the context starts lazily.

let ctx = null;
let master = null;
let enabled = true;
let ambient = null;

function ac() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function noiseBuffer(seconds, color = 'white') {
  const a = ac();
  const len = Math.floor(a.sampleRate * seconds);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (color === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else d[i] = w;
  }
  return buf;
}

function knock(t, { freq = 180, noiseFreq = 1700, gain = 0.5, dur = 0.07 } = {}) {
  const a = ac();
  const n = a.createBufferSource();
  n.buffer = noiseBuffer(dur);
  const bp = a.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = noiseFreq; bp.Q.value = 1.2;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  n.connect(bp).connect(g).connect(master);
  n.start(t); n.stop(t + dur);
  const o = a.createOscillator();
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(freq * 0.6, t + dur);
  const og = a.createGain();
  og.gain.setValueAtTime(gain * 0.8, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(og).connect(master);
  o.start(t); o.stop(t + dur);
}

function tone(t, freq, dur, type = 'sine', gain = 0.18) {
  const a = ac();
  const o = a.createOscillator();
  o.type = type; o.frequency.value = freq;
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

export const sound = {
  setEnabled(v) { enabled = v; },
  unlock() { if (enabled) ac(); },
  move(san = '') {
    if (!enabled) return;
    const t = ac().currentTime;
    if (san.includes('x')) { knock(t, { gain: 0.7, noiseFreq: 1300 }); knock(t + 0.05, { gain: 0.35, freq: 140 }); }
    else knock(t);
    if (san.includes('#')) { tone(t + 0.08, 392, 0.5, 'triangle', 0.15); tone(t + 0.2, 311, 0.7, 'triangle', 0.15); }
    else if (san.includes('+')) tone(t + 0.06, 880, 0.18, 'triangle', 0.12);
  },
  good() { if (!enabled) return; const t = ac().currentTime; [523, 659, 784].forEach((f, i) => tone(t + i * 0.08, f, 0.3)); },
  bad() { if (!enabled) return; const t = ac().currentTime; tone(t, 160, 0.25, 'sawtooth', 0.06); },
  alert() { if (!enabled) return; const t = ac().currentTime; tone(t, 440, 0.12, 'sine', 0.08); },

  // Ambient beds: 'fire', 'rain', 'off', or a user-supplied loop (File).
  setAmbient(kind, file = null) {
    if (ambient) { ambient.stop(); ambient = null; }
    if (kind === 'off' || !enabled) return;
    const a = ac();
    const out = a.createGain();
    out.gain.value = 0;
    out.connect(master);
    out.gain.linearRampToValueAtTime(kind === 'rain' ? 0.25 : 0.35, a.currentTime + 2);
    const nodes = [];
    let timer = null;
    let el = null;
    if (kind === 'file' && file) {
      el = new Audio(URL.createObjectURL(file));
      el.loop = true;
      const src = a.createMediaElementSource(el);
      src.connect(out);
      el.play();
    } else {
      const bed = a.createBufferSource();
      bed.buffer = noiseBuffer(4, kind === 'rain' ? 'white' : 'brown');
      bed.loop = true;
      const f = a.createBiquadFilter();
      if (kind === 'rain') { f.type = 'highpass'; f.frequency.value = 900; }
      else { f.type = 'lowpass'; f.frequency.value = 500; }
      bed.connect(f).connect(out);
      bed.start();
      nodes.push(bed);
      if (kind === 'fire') {
        // Random crackles and pops.
        const crackle = () => {
          const t = a.currentTime;
          const n = 1 + Math.floor(Math.random() * 3);
          for (let i = 0; i < n; i++) {
            const s = a.createBufferSource();
            s.buffer = noiseBuffer(0.03);
            const hp = a.createBiquadFilter();
            hp.type = 'bandpass'; hp.frequency.value = 2000 + Math.random() * 3000;
            const g = a.createGain();
            const tt = t + i * (0.02 + Math.random() * 0.05);
            g.gain.setValueAtTime(0.05 + Math.random() * 0.25, tt);
            g.gain.exponentialRampToValueAtTime(0.001, tt + 0.03);
            s.connect(hp).connect(g).connect(out);
            s.start(tt);
          }
          timer = setTimeout(crackle, 120 + Math.random() * 900);
        };
        crackle();
      }
    }
    ambient = {
      stop() {
        out.gain.cancelScheduledValues(a.currentTime);
        out.gain.setValueAtTime(out.gain.value, a.currentTime);
        out.gain.linearRampToValueAtTime(0, a.currentTime + 0.6);
        clearTimeout(timer);
        setTimeout(() => { nodes.forEach((n) => n.stop()); if (el) el.pause(); out.disconnect(); }, 700);
      },
    };
  },
};
