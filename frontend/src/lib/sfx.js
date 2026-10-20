// Synthesised game sounds via Web Audio (no audio files needed).
let ctx = null;
let muted = localStorage.getItem("apex_sfx_muted") === "1";
const listeners = new Set();

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

function tone(freq, { dur = 0.08, type = "sine", vol = 0.12, slide = 0, delay = 0 } = {}) {
  if (muted) return;
  const c = ac();
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise({ dur = 0.3, vol = 0.25, delay = 0 } = {}) {
  if (muted) return;
  const c = ac();
  const t = c.currentTime + delay;
  const buf = c.createBuffer(1, Math.floor(c.sampleRate * dur), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
  const src = c.createBufferSource();
  const f = c.createBiquadFilter();
  const g = c.createGain();
  f.type = "lowpass"; f.frequency.value = 900;
  g.gain.value = vol;
  src.buffer = buf;
  src.connect(f).connect(g).connect(c.destination);
  src.start(t);
}

export const sfx = {
  click: () => tone(520, { dur: 0.04, type: "square", vol: 0.04 }),
  pick: () => tone(740, { dur: 0.07, type: "triangle", vol: 0.09, slide: 180 }),
  unpick: () => tone(520, { dur: 0.06, type: "triangle", vol: 0.07, slide: -140 }),
  bet: () => { tone(300, { dur: 0.06, type: "square", vol: 0.05 }); tone(450, { dur: 0.08, type: "square", vol: 0.05, delay: 0.05 }); },
  draw: () => tone(380 + Math.random() * 80, { dur: 0.05, type: "sine", vol: 0.06 }),
  hit: () => { tone(880, { dur: 0.09, type: "triangle", vol: 0.1 }); tone(1320, { dur: 0.12, type: "sine", vol: 0.08, delay: 0.05 }); },
  gem: () => { tone(988, { dur: 0.08, type: "triangle", vol: 0.1 }); tone(1480, { dur: 0.16, type: "sine", vol: 0.08, delay: 0.06 }); },
  bomb: () => { tone(160, { dur: 0.4, type: "sawtooth", vol: 0.12, slide: -120 }); noise({ dur: 0.45, vol: 0.35 }); },
  peg: () => tone(1100 + Math.random() * 500, { dur: 0.03, type: "sine", vol: 0.035 }),
  tick: (p = 0) => tone(300 + p * 900, { dur: 0.03, type: "square", vol: 0.025 }),
  lose: () => { tone(330, { dur: 0.14, type: "triangle", vol: 0.08, slide: -60 }); tone(247, { dur: 0.22, type: "triangle", vol: 0.08, slide: -60, delay: 0.12 }); },
  win: () => [523, 659, 784].forEach((f, i) => tone(f, { dur: 0.14, type: "triangle", vol: 0.1, delay: i * 0.08 })),
  bigWin: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone(f, { dur: 0.18, type: "triangle", vol: 0.11, delay: i * 0.09 }));
    [1319, 1568].forEach((f, i) => tone(f, { dur: 0.35, type: "sine", vol: 0.07, delay: 0.38 + i * 0.06 }));
  },
  isMuted: () => muted,
  setMuted: (m) => {
    muted = m;
    localStorage.setItem("apex_sfx_muted", m ? "1" : "0");
    listeners.forEach((fn) => fn(m));
    if (!m) sfx.click();
  },
  subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
};
