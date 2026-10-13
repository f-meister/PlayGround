import * as THREE from 'three';

/* ============================================================
   METAL MOON: BACK TO RUIN
   Harvest Moon: Back to Nature tribute x Guilty Gear Strive metal
   3D farm sim — fully procedural, no external assets.
   ============================================================ */

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const randi = (a, b) => Math.floor(rand(a, b + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/* ---------------- GAME STATE ---------------- */
const SAVE_KEY = 'metal-moon-save-v1';
const GOAL_G = 1000;
const state = {
  started: false,
  gold: 100, seeds: 6, carried: 0, carriedValue: 0,
  stamina: 100, maxStamina: 100,
  day: 1, dayT: 0.12, // 0..1 maps 06:00..24:00
  weather: 'BLOOD SUN', weatherIdx: 0,
  tool: 'hoe',
  combo: 0, comboTimer: 0, bestCombo: 0,
  earnedTotal: 0, harvestedTotal: 0,
  questDone: false, questCount: 0,
  eggsPending: 0,
  fert: 0,
  camMode: 0,
  exhausted: false,
  muted: false,
};
const DAY_LEN = 360; // seconds per full day
const WEATHERS = ['BLOOD SUN', 'BLOOD RAIN', 'ASH STORM', 'VOID ECLIPSE'];

/* ---------------- LOG / ANNOUNCE / TOAST ---------------- */
function log(msg, cls = '') {
  const el = document.createElement('div');
  el.className = 'logline ' + cls;
  el.textContent = msg;
  const box = $('log');
  box.prepend(el);
  while (box.children.length > 6) box.lastChild.remove();
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .5s'; setTimeout(() => el.remove(), 550); }, 5200);
}
function toast(msg) {
  const el = document.createElement('div');
  el.className = 'toastmsg'; el.textContent = msg;
  $('toast').appendChild(el);
  setTimeout(() => el.remove(), 2200);
}
let announceTimer = null;
function announce(big, sub = '', red = false) {
  $('announce-big').textContent = big;
  $('announce-big').className = 'big' + (red ? ' red' : '');
  $('announce-sub').textContent = sub;
  const a = $('announce');
  a.classList.remove('show'); void a.offsetWidth; a.classList.add('show');
  document.body.classList.add('duel');
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => document.body.classList.remove('duel'), 2400);
}
function flashSlash() {
  const f = $('flash');
  f.classList.remove('slash'); void f.offsetWidth; f.classList.add('slash');
}

/* ---------------- PROCEDURAL METAL AUDIO ---------------- */
const Audio2 = {
  ctx: null, master: null, musicGain: null, sfxGain: null,
  step: 0, riffRoot: [82.4, 82.4, 98, 110], // E2 E2 G2 A2 power-chord bounce
  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain(); this.musicGain.gain.value = state.muted ? 0 : 0.5;
      const dist = this.ctx.createWaveShaper();
      const curve = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(3.2 * x); }
      dist.curve = curve;
      const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
      this.musicGain.connect(dist); dist.connect(lp); lp.connect(this.master);
      this.sfxGain = this.ctx.createGain(); this.sfxGain.gain.value = 0.8;
      this.sfxGain.connect(this.master);
      this.loop = setInterval(() => this.schedule(), 150);
    } catch (e) { console.warn('audio blocked', e); }
  },
  schedule() {
    if (!this.ctx || this.ctx.state === 'suspended') this.ctx?.resume();
    if (state.muted || !state.started) return;
    const spb = 60 / 168 / 2; // 168bpm 8th notes
    this.playStep(this.step, this.ctx.currentTime + 0.05);
    this.step = (this.step + 1) % 32;
    // schedule a second 8th ahead for tightness
    this.playStep((this.step) % 32, this.ctx.currentTime + 0.05 + spb);
  },
  guitar(freq, t, dur, vol = 0.5) {
    const c = this.ctx, g = c.createGain();
    const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = freq;
    const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = freq * 0.5;
    const o3 = c.createOscillator(); o3.type = 'sawtooth'; o3.frequency.value = freq * 1.005;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o1.connect(g); o2.connect(g); o3.connect(g); g.connect(this.musicGain);
    o1.start(t); o2.start(t); o3.start(t);
    o1.stop(t + dur + 0.05); o2.stop(t + dur + 0.05); o3.stop(t + dur + 0.05);
  },
  drum(t, kind) {
    const c = this.ctx;
    if (kind === 'kick') {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.11);
      g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
      o.connect(g); g.connect(this.musicGain); o.start(t); o.stop(t + 0.2);
    } else if (kind === 'hat') {
      const b = c.createBuffer(1, 1200, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const s = c.createBufferSource(); s.buffer = b;
      const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
      const g = c.createGain(); g.gain.value = 0.25;
      s.connect(f); f.connect(g); g.connect(this.musicGain); s.start(t);
    } else if (kind === 'snare') {
      const b = c.createBuffer(1, 4000, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
      const s = c.createBufferSource(); s.buffer = b;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2200;
      const g = c.createGain(); g.gain.setValueAtTime(0.6, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
      s.connect(f); f.connect(g); g.connect(this.musicGain); s.start(t);
    }
  },
  playStep(s, t) {
    const spb = 60 / 168 / 2;
    const bar = Math.floor(s / 8) % 4;
    const root = this.riffRoot[bar];
    // gallop riff: chug chug chord
    const accent = (s % 2 === 0);
    this.guitar(root * (s % 8 === 6 ? 1.5 : 1), t, spb * 0.95, accent ? 0.34 : 0.2);
    this.guitar(root * 1.498, t, spb * 0.9, accent ? 0.22 : 0.12); // fifth
    if (s % 2 === 0) this.drum(t, 'kick');
    if (s % 4 === 2) this.drum(t, 'snare');
    this.drum(t + spb / 2, 'hat');
    if (s === 0 || s === 16) { // crash-ish
      this.guitar(root * 4, t, 0.5, 0.1);
    }
  },
  sfx(kind) {
    if (!this.ctx || state.muted) return;
    const c = this.ctx, t = c.currentTime;
    const env = (o, g, f0, f1, dur, vol) => {
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + dur + 0.02);
    };
    if (kind === 'swing') { const o = c.createOscillator(), g = c.createGain(); env(o, g, 1800, 220, 0.18, 0.3); o.type = 'sawtooth'; }
    else if (kind === 'till') { const o = c.createOscillator(), g = c.createGain(); env(o, g, 160, 55, 0.22, 0.6); o.type = 'square'; }
    else if (kind === 'coin') { [880, 1174, 1568].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(); o.type = 'square'; const tt = t + i * 0.07; o.frequency.value = f; g.gain.setValueAtTime(0.16, tt); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.12); o.connect(g); g.connect(this.sfxGain); o.start(tt); o.stop(tt + 0.15); }); }
    else if (kind === 'plant') { const o = c.createOscillator(), g = c.createGain(); env(o, g, 500, 980, 0.12, 0.3); o.type = 'triangle'; }
    else if (kind === 'water') { const o = c.createOscillator(), g = c.createGain(); env(o, g, 900, 300, 0.3, 0.22); o.type = 'sine'; }
    else if (kind === 'error') { const o = c.createOscillator(), g = c.createGain(); env(o, g, 140, 90, 0.25, 0.4); o.type = 'sawtooth'; }
    else if (kind === 'harvest') { [660, 880, 1320, 1760].forEach((f, i) => { const o = c.createOscillator(), g = c.createGain(); o.type = 'sawtooth'; const tt = t + i * 0.05; o.frequency.value = f; g.gain.setValueAtTime(0.2, tt); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.16); o.connect(g); g.connect(this.sfxGain); o.start(tt); o.stop(tt + 0.2); }); }
    else if (kind === 'sleep') { const o = c.createOscillator(), g = c.createGain(); env(o, g, 600, 80, 0.8, 0.35); o.type = 'triangle'; }
    else if (kind === 'thunder') {
      const b = c.createBuffer(1, c.sampleRate * 1.2, c.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
      const s = c.createBufferSource(); s.buffer = b;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320;
      const g = c.createGain(); g.gain.value = 0.9;
      s.connect(f); f.connect(g); g.connect(this.sfxGain); s.start(t);
    }
    else if (kind === 'cluck') { const o = c.createOscillator(), g = c.createGain(); o.type = 'square'; o.frequency.setValueAtTime(700, t); o.frequency.setValueAtTime(420, t + 0.09); g.gain.setValueAtTime(0.25, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22); o.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + 0.25); }
  }
};

/* ---------------- THREE SETUP ---------------- */
const app = $('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.28;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0510);
scene.fog = new THREE.FogExp2(0x1a060c, 0.028);

const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 220);
camera.position.set(0, 12, 12);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// cel gradient map
const gradData = new Uint8Array([110, 170, 255, 255]);
const gradMap = new THREE.DataTexture(gradData, 4, 1, THREE.RedFormat);
gradMap.minFilter = THREE.NearestFilter; gradMap.magFilter = THREE.NearestFilter;
gradMap.needsUpdate = true;
function toon(color, extra = {}) {
  return new THREE.MeshToonMaterial({ color, gradientMap: gradMap, ...extra });
}
function outline(child, s = 1.06, color = 0x050505) {
  const o = new THREE.Mesh(child.geometry, new THREE.MeshBasicMaterial({ color, side: THREE.BackSide }));
  o.scale.setScalar(s);
  child.add(o);
  return o;
}

/* lights */
scene.add(new THREE.HemisphereLight(0x8a6aa8, 0x2a0d08, 1.25));
const moonLight = new THREE.DirectionalLight(0xffd9d9, 2.2);
moonLight.position.set(-9, 16, 6);
moonLight.castShadow = true;
moonLight.shadow.mapSize.set(2048, 2048);
moonLight.shadow.camera.left = -20; moonLight.shadow.camera.right = 20;
moonLight.shadow.camera.top = 20; moonLight.shadow.camera.bottom = -20;
scene.add(moonLight);
const rimLight = new THREE.DirectionalLight(0x8b2bff, 1.1);
rimLight.position.set(10, 8, -10);
scene.add(rimLight);
const pitLight = new THREE.PointLight(0xe01b2f, 60, 40, 1.8);
pitLight.position.set(0, 5, 2);
scene.add(pitLight);
const spotA = new THREE.SpotLight(0xe01b2f, 900, 60, 0.5, 0.5, 1.6);
spotA.position.set(-12, 14, -6); spotA.target.position.set(0, 0, 0);
scene.add(spotA, spotA.target);
const spotB = new THREE.SpotLight(0x8b2bff, 900, 60, 0.5, 0.5, 1.6);
spotB.position.set(12, 14, -6); spotB.target.position.set(0, 0, 0);
scene.add(spotB, spotB.target);
const houseGlow = new THREE.PointLight(0xffc93c, 25, 14, 1.8);
houseGlow.position.set(-9.5, 3, -7.5);
scene.add(houseGlow);

/* ---------------- STAGE WORLD ---------------- */
const world = new THREE.Group(); scene.add(world);

// giant blood moon
{
  const moon = new THREE.Mesh(new THREE.SphereGeometry(14, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xff2a3c, fog: false }));
  moon.position.set(-38, 26, -78); scene.add(moon);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(16.5, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xff2a3c, transparent: true, opacity: 0.28, fog: false }));
  halo.position.copy(moon.position); scene.add(halo);
  // star field
  const sg = new THREE.BufferGeometry(); const N = 700; const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { pos[i * 3] = rand(-140, 140); pos[i * 3 + 1] = rand(8, 90); pos[i * 3 + 2] = rand(-140, -20); }
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffd0d8, size: 0.35, fog: false })));
  // hell dome
  const dome = new THREE.Mesh(new THREE.SphereGeometry(150, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshBasicMaterial({ color: 0x150309, side: THREE.BackSide, fog: false }));
  dome.position.y = -4; scene.add(dome);
}

// main stage disc
{
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(15.5, 16.5, 1.2, 40),
    toon(0x17131c, {}));
  disc.position.y = -0.6; disc.receiveShadow = true; world.add(disc);
  outline(disc, 1.005);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(15.5, 0.35, 10, 60),
    new THREE.MeshBasicMaterial({ color: 0xe01b2f }));
  rim.rotation.x = Math.PI / 2; rim.position.y = 0.02; world.add(rim);
  // plank rings
  for (let r = 4; r < 15; r += 2.4) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.05, 6, 48),
      new THREE.MeshBasicMaterial({ color: 0x3d1520 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.015; world.add(ring);
  }
  // pentagram glow under farm
  const pent = new THREE.Mesh(new THREE.RingGeometry(5.4, 5.9, 5),
    new THREE.MeshBasicMaterial({ color: 0xe01b2f, transparent: true, opacity: 0.55, side: THREE.DoubleSide }));
  pent.rotation.x = -Math.PI / 2; pent.position.y = 0.02; pent.name = 'pent';
  world.add(pent);
  const pent2 = pent.clone(); pent2.scale.setScalar(0.72); pent2.rotation.z = Math.PI / 5; world.add(pent2);
}

/* speaker stacks + truss + pyro */
const speakers = [];
function speakerStack(x, z, s = 1) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.6 * s, 1.3 * s, 1.4 * s), toon(0x0e0f14));
    box.position.y = 0.65 * s + i * 1.32 * s; box.castShadow = true; g.add(box); outline(box);
    const cone = new THREE.Mesh(new THREE.CircleGeometry(0.42 * s, 20),
      new THREE.MeshBasicMaterial({ color: 0xe01b2f }));
    cone.position.set(0, 0.65 * s + i * 1.32 * s, 0.71 * s); g.add(cone);
  }
  g.position.set(x, 0, z); g.lookAt(0, 0, 0);
  world.add(g); speakers.push(g);
}
speakerStack(-13.5, -4); speakerStack(13.5, -4); speakerStack(-12, 7, 0.8); speakerStack(12, 7, 0.8);
function truss(x, z, color) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 13, 8), toon(0x23262f));
  pole.position.y = 6.5; pole.castShadow = true; g.add(pole);
  const head = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.7, 1.1), toon(0x0c0d12));
  head.position.y = 13.1; g.add(head); outline(head);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 12), new THREE.MeshBasicMaterial({ color }));
  lens.position.set(0, 12.7, 0.35); g.add(lens);
  g.position.set(x, 0, z); world.add(g);
}
truss(-13, -9, 0xe01b2f); truss(13, -9, 0x8b2bff); truss(-14, 3, 0xffc93c); truss(14, 3, 0xe01b2f);

// floating rocks
const floaters = [];
for (let i = 0; i < 9; i++) {
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.5, 1.3), 0),
    toon(pick([0x2a2033, 0x3d1520, 0x1d1b2e])));
  const a = rand(0, Math.PI * 2), r = rand(19, 30);
  m.position.set(Math.cos(a) * r, rand(4, 12), Math.sin(a) * r - 4);
  m.userData = { y0: m.position.y, sp: rand(0.4, 1.2), ph: rand(0, 6) };
  world.add(m); outline(m, 1.05); floaters.push(m);
}
// torii skull gate (farm entrance, NPC stands here)
{
  const g = new THREE.Group();
  const mat = toon(0x8a0f1e);
  const p1 = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 7, 10), mat); p1.position.set(-3.4, 3.5, 0);
  const p2 = p1.clone(); p2.position.x = 3.4;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.7, 0.9), mat); beam.position.y = 6.9;
  const beam2 = new THREE.Mesh(new THREE.BoxGeometry(7, 0.5, 0.7), mat); beam2.position.y = 5.4;
  [p1, p2, beam, beam2].forEach(m => { m.castShadow = true; g.add(m); outline(m); });
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.7, 14, 14), toon(0xf3ead8));
  skull.position.y = 7.7; g.add(skull); outline(skull);
  g.position.set(0, 0, -11.5); world.add(g);
}

/* coffin house */
const housePos = new THREE.Vector3(-9.5, 0, -7);
{
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.6, 3.6), toon(0x241722));
  base.position.y = 1.3; base.castShadow = true; g.add(base); outline(base);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(3.6, 2.2, 4), toon(0x8a0f1e));
  roof.position.y = 3.7; roof.rotation.y = Math.PI / 4; roof.castShadow = true; g.add(roof); outline(roof);
  const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.9, 0.15), toon(0x0b090d));
  door.position.set(0, 0.95, 1.85); g.add(door);
  const winL = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.1),
    new THREE.MeshBasicMaterial({ color: 0xffc93c }));
  winL.position.set(-1.3, 1.6, 1.83); g.add(winL);
  const winR = winL.clone(); winR.position.x = 1.3; g.add(winR);
  // coffin bed sign
  const coffin = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.5, 2.2), toon(0x3d0d16));
  coffin.position.set(3.4, 0.25, 0.6); coffin.castShadow = true; g.add(coffin); outline(coffin);
  const bat = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.9, 6), new THREE.MeshBasicMaterial({ color: 0xe01b2f }));
  bat.position.set(3.4, 1.1, 0.6); bat.rotation.x = Math.PI; g.add(bat);
  g.position.copy(housePos); g.rotation.y = 0.5;
  world.add(g);
  // "SLEEP" marker
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 6), toon(0x333333));
  pole.position.set(housePos.x + 3.4, 1.3, housePos.z + 2.2); world.add(pole);
  const flag = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 0.06),
    new THREE.MeshBasicMaterial({ color: 0xe01b2f }));
  flag.position.set(housePos.x + 3.4, 2.4, housePos.z + 2.2); world.add(flag);
}

/* shipping skull-anvil */
const binPos = new THREE.Vector3(8.8, 0, -6.5);
{
  const g = new THREE.Group();
  const chest = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 1.6), toon(0x4d0d18));
  chest.position.y = 0.7; chest.castShadow = true; g.add(chest); outline(chest);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.35, 1.8), toon(0x1a1d24));
  lid.position.y = 1.55; g.add(lid); outline(lid);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.55, 14, 14), toon(0xf3ead8));
  skull.position.y = 2.15; skull.castShadow = true; g.add(skull); outline(skull);
  const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.5), toon(0xf3ead8));
  jaw.position.set(0, 1.7, 0.25); g.add(jaw);
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 8), new THREE.MeshBasicMaterial({ color: 0xe01b2f }));
  eyeL.position.set(-0.2, 2.25, 0.45); g.add(eyeL);
  const eyeR = eyeL.clone(); eyeR.position.x = 0.2; g.add(eyeR);
  g.position.copy(binPos); g.rotation.y = -0.5;
  world.add(g);
}

/* chicken coop + merchant stand */
const coopPos = new THREE.Vector3(9.5, 0, 4.5);
const shopPos = new THREE.Vector3(-8.5, 0, 5.5);
{
  const coop = new THREE.Group();
  const hut = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 2.2), toon(0x2e1a12));
  hut.position.y = 0.8; hut.castShadow = true; coop.add(hut); outline(hut);
  const roof = new THREE.Mesh(new THREE.ConeGeometry(2.2, 1.3, 4), toon(0x121016));
  roof.position.y = 2.2; roof.rotation.y = Math.PI / 4; coop.add(roof); outline(roof);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.5, 14), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  hole.position.set(0, 0.7, 1.12); coop.add(hole);
  coop.position.copy(coopPos); world.add(coop);

  const st = new THREE.Group();
  const counter = new THREE.Mesh(new THREE.BoxGeometry(3, 1.1, 1.4), toon(0x1c1420));
  counter.position.y = 0.55; counter.castShadow = true; st.add(counter); outline(counter);
  const pole1 = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 3, 6), toon(0x444444));
  pole1.position.set(-1.4, 1.5, 0); st.add(pole1);
  const pole2 = pole1.clone(); pole2.position.x = 1.4; st.add(pole2);
  const awn = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.18, 2.2),
    new THREE.MeshBasicMaterial({ color: 0xe01b2f }));
  awn.position.y = 3; awn.rotation.z = 0.06; st.add(awn);
  st.position.copy(shopPos); st.rotation.y = 0.7; world.add(st);
}

/* fences */
{
  const mat = toon(0x2b1a14);
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    if (Math.abs(a - Math.PI * 1.5) < 0.4) continue; // gate gap
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.3, 0.28), mat);
    post.position.set(Math.cos(a) * 14.6, 0.65, Math.sin(a) * 14.6);
    post.castShadow = true; world.add(post);
  }
}

/* ---------------- FARM GRID ---------------- */
const GW = 10, GH = 7, TILE = 1.15;
const gridOrigin = new THREE.Vector3(-(GW - 1) * TILE / 2, 0, -0.6);
const tiles = [];
const tileGroup = new THREE.Group(); world.add(tileGroup);
function tileWorld(r, c) {
  return new THREE.Vector3(gridOrigin.x + c * TILE, 0, gridOrigin.z + r * TILE);
}
const soilGeo = new THREE.BoxGeometry(TILE * 0.94, 0.22, TILE * 0.94);
const waterGeo = new THREE.PlaneGeometry(TILE * 0.8, TILE * 0.8);
for (let r = 0; r < GH; r++) {
  tiles[r] = [];
  for (let c = 0; c < GW; c++) {
    const p = tileWorld(r, c);
    const m = new THREE.Mesh(soilGeo, toon(0x4a3220));
    m.position.set(p.x, 0.11, p.z); m.receiveShadow = true;
    tileGroup.add(m);
    const w = new THREE.Mesh(waterGeo, new THREE.MeshBasicMaterial({ color: 0x2e9bff, transparent: true, opacity: 0.0 }));
    w.rotation.x = -Math.PI / 2; w.position.set(p.x, 0.235, p.z);
    tileGroup.add(w);
    const cell = { r, c, phase: 0, watered: false, dryDays: 0, mesh: m, water: w, crop: null };
    tiles[r][c] = cell;
  }
}
// phases: 0 untilled, 1 tilled, 2 seed, 3 sprout, 4 bush, 5 mature, 6 dead
function paintTile(cell) {
  const m = cell.mesh.material;
  if (cell.phase === 0) m.color.setHex(0x4a3220);
  else if (cell.phase === 1) m.color.setHex(0x6b3a22);
  else if (cell.phase === 6) m.color.setHex(0x1a1a1a);
  else m.color.setHex(0x6b3a24);
  cell.water.material.opacity = cell.watered ? 0.55 : 0;
}
function clearCrop(cell) {
  if (cell.crop) { tileGroup.remove(cell.crop); cell.crop = null; }
}
function buildCropMesh(phase, t) {
  const g = new THREE.Group();
  if (phase === 2) {
    const s = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 6), toon(0x9be7a0));
    s.position.y = 0.32; g.add(s); outline(s, 1.15);
  } else if (phase === 3) {
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.5, 6), toon(0x3fa34d));
    stem.position.y = 0.45; g.add(stem);
    for (const s of [-1, 1]) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), toon(0x53e06b));
      leaf.scale.set(1.4, 0.5, 0.8); leaf.position.set(0.2 * s, 0.55, 0); leaf.rotation.z = 0.5 * s;
      g.add(leaf); outline(leaf, 1.12);
    }
  } else if (phase === 4) {
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), toon(0x1f7a34));
    bush.position.y = 0.6; bush.castShadow = true; g.add(bush); outline(bush);
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 5), toon(0x8b2bff));
    spike.position.y = 1.0; g.add(spike);
  } else if (phase === 5) {
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.36, 14, 14),
      new THREE.MeshToonMaterial({ color: 0xf3ead8, gradientMap: gradMap, emissive: 0xe01b2f, emissiveIntensity: 0.55 }));
    orb.position.y = 0.62; orb.castShadow = true; g.add(orb); outline(orb);
    for (let i = 0; i < 6; i++) {
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 5), toon(0xe01b2f));
      const a = (i / 6) * Math.PI * 2;
      spike.position.set(Math.cos(a) * 0.34, 0.62, Math.sin(a) * 0.34);
      spike.rotation.z = -Math.cos(a) * 1.2; spike.rotation.x = Math.sin(a) * 1.2;
      g.add(spike);
    }
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xff2a3c, transparent: true, opacity: 0.3 }));
    glow.position.y = 0.62; g.add(glow);
    // eyes
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshBasicMaterial({ color: 0x0a0a0a }));
      e.position.set(0.12 * s, 0.7, 0.3); g.add(e);
    }
    g.userData.born = t;
  } else if (phase === 6) {
    const dead = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 5), toon(0x333333));
    dead.position.y = 0.4; dead.rotation.z = 0.7; g.add(dead);
  }
  return g;
}
function setPhase(cell, phase, t) {
  cell.phase = phase; clearCrop(cell);
  if (phase >= 2) {
    const g = buildCropMesh(phase, t);
    const p = tileWorld(cell.r, cell.c);
    g.position.set(p.x, 0.2, p.z);
    tileGroup.add(g); cell.crop = g;
  }
  paintTile(cell);
}

/* selection ring */
const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 8, 24),
  new THREE.MeshBasicMaterial({ color: 0xffc93c }));
ring.rotation.x = Math.PI / 2; ring.position.y = 0.28;
scene.add(ring);

/* ---------------- CHARACTERS ---------------- */
function makeFarmer() {
  const g = new THREE.Group();
  const coat = toon(0x14141c), skin = toon(0xe8b88a), red = toon(0xe01b2f);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.36), coat); legs.position.y = 0.55; g.add(legs); outline(legs);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.7, 0.46), coat); torso.position.y = 1.2; torso.castShadow = true; g.add(torso); outline(torso);
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.14, 0.48), red); belt.position.y = 0.92; g.add(belt);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.2), coat); armL.position.set(-0.48, 1.2, 0); g.add(armL); outline(armL);
  const armR = armL.clone(); armR.position.x = 0.48; g.add(armR);
  const fistR = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 8), skin); fistR.position.set(0.48, 0.85, 0.1); g.add(fistR);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 16), skin); head.position.y = 1.92; head.castShadow = true; g.add(head); outline(head);
  const hair = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 8), toon(0x1a1a22)); hair.position.set(0, 2.15, -0.22); hair.rotation.x = -0.35; g.add(hair); outline(hair);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.46, 0.22, 12), red); hat.position.y = 2.22; g.add(hat); outline(hat);
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 14), red); brim.position.y = 2.12; g.add(brim);
  // guitar-axe on back
  const neck = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 0.08), toon(0x5a3218)); neck.position.set(0.3, 1.7, -0.35); neck.rotation.z = 0.5; g.add(neck);
  const bodyG = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.12), red); bodyG.position.set(-0.05, 1.15, -0.4); bodyG.rotation.z = 0.5; g.add(bodyG); outline(bodyG);
  // tool in hand (swapped per tool)
  const toolG = new THREE.Group(); toolG.position.set(0.48, 0.85, 0.35); g.add(toolG);
  g.userData.toolG = toolG;
  // shadow blob
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.7, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4 }));
  blob.rotation.x = -Math.PI / 2; blob.position.y = 0.02; g.add(blob);
  return g;
}
const player = makeFarmer();
player.position.set(0, 0, 4);
scene.add(player);
let playerDir = 0, targetDir = 0, walkPhase = 0, moving = false;

function rebuildHandTool() {
  const tg = player.userData.toolG;
  while (tg.children.length) tg.remove(tg.children[0]);
  let m;
  if (state.tool === 'hoe') {
    m = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.1, 6), toon(0x5a3218)); m.add(stick);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.08, 0.22), toon(0x9aa2b0)); blade.position.y = 0.55; m.add(blade); outline(blade, 1.1);
    m.rotation.x = 0.9;
  } else if (state.tool === 'seed') {
    m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), new THREE.MeshBasicMaterial({ color: 0x53e06b }));
    m.position.y = 0.1;
  } else if (state.tool === 'water') {
    m = new THREE.Group();
    const can = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.34, 0.24), toon(0x2e6b8a)); m.add(can); outline(can);
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.5, 6), toon(0x9aa2b0)); spout.position.set(0.2, 0.2, 0); spout.rotation.z = -0.8; m.add(spout);
  } else {
    m = new THREE.Group();
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3, 6), toon(0x14141c)); m.add(stick);
    const axe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.06), new THREE.MeshBasicMaterial({ color: 0xdfe6f2 })); axe.position.y = 0.6; m.add(axe);
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.08, 0.07), new THREE.MeshBasicMaterial({ color: 0xe01b2f })); edge.position.y = 0.6; m.add(edge);
    m.rotation.x = 0.9;
  }
  tg.add(m);
}
rebuildHandTool();

/* NPC mentor */
const npcPos = new THREE.Vector3(2.5, 0, -10);
const npc = new THREE.Group();
{
  const robe = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2.2, 8), toon(0x4d0d8a));
  robe.position.y = 1.1; robe.castShadow = true; npc.add(robe); outline(robe);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 14), toon(0xd9cfc0));
  head.position.y = 2.35; npc.add(head); outline(head);
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.0, 8), toon(0x14141c));
  hat.position.y = 2.95; npc.add(hat); outline(hat);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 8), new THREE.MeshBasicMaterial({ color: 0x8b2bff }));
  glow.position.set(0, 2.35, 0.28); npc.add(glow);
  const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6), toon(0x333333));
  staff.position.set(0.7, 1.2, 0); npc.add(staff);
  const orb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 10, 10), new THREE.MeshBasicMaterial({ color: 0xe01b2f }));
  orb.position.set(0.7, 2.5, 0); npc.add(orb);
  npc.position.copy(npcPos); scene.add(npc);
}
/* merchant */
const merchant = new THREE.Group();
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.6), toon(0x6b4a1a));
  body.position.y = 1.0; body.castShadow = true; merchant.add(body); outline(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 12), toon(0xe8b88a));
  head.position.y = 1.9; merchant.add(head); outline(head);
  const mohawk = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.6), new THREE.MeshBasicMaterial({ color: 0xe01b2f }));
  mohawk.position.y = 2.25; merchant.add(mohawk);
  merchant.position.set(shopPos.x, 0, shopPos.z - 1.4); scene.add(merchant);
}
/* hell chicken */
const chicken = new THREE.Group();
let chickenDir = 0, chickenTimer = 0, eggTimer = 20, eggMesh = null;
{
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.34, 12, 12), toon(0x14141c));
  body.position.y = 0.45; body.castShadow = true; chicken.add(body); outline(body);
  const comb = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 6), new THREE.MeshBasicMaterial({ color: 0xe01b2f }));
  comb.position.y = 0.85; chicken.add(comb);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.22, 6), toon(0xffc93c));
  beak.position.set(0, 0.5, 0.36); beak.rotation.x = Math.PI / 2; chicken.add(beak);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff2a3c }));
    eye.position.set(0.14 * s, 0.58, 0.28); chicken.add(eye);
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 5), toon(0xffc93c));
    leg.position.set(0.12 * s, 0.15, 0); chicken.add(leg);
  }
  chicken.position.set(coopPos.x - 2, 0, coopPos.z + 1);
  scene.add(chicken);
}

/* floating name markers */
function marker(text, color = '#ffc93c') {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const x = cv.getContext('2d');
  x.font = 'bold 34px sans-serif'; x.textAlign = 'center';
  x.fillStyle = '#000'; x.fillText(text, 130, 44);
  x.fillStyle = color; x.fillText(text, 128, 42);
  const tex = new THREE.CanvasTexture(cv);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(2.6, 0.65, 1);
  return sp;
}
const sleepMark = marker('☠ SLEEP'); sleepMark.position.set(housePos.x + 3.4, 3.4, housePos.z + 2.2); scene.add(sleepMark);
const shipMark = marker('⛧ SHIP', '#ff6b7d'); shipMark.position.set(binPos.x, 3.2, binPos.z); scene.add(shipMark);
const npcMark = marker('♪ AXL', '#d9a7ff'); npcMark.position.set(npcPos.x, 3.6, npcPos.z); scene.add(npcMark);
const shopMark = marker('SHOP [B]', '#ffc93c'); shopMark.position.set(shopPos.x, 4, shopPos.z); scene.add(shopMark);
const coopMark = marker('EGG?', '#9be7ff'); coopMark.position.set(coopPos.x, 2.8, coopPos.z); scene.add(coopMark);

/* ---------------- PARTICLES ---------------- */
const PMAX = 900;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(PMAX * 3);
const pCol = new Float32Array(PMAX * 3);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
const points = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false }));
points.frustumCulled = false; scene.add(points);
const parts = [];
for (let i = 0; i < PMAX; i++) parts.push({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, x: 0, y: -99, z: 0 });
let pCursor = 0;
const tmpC = new THREE.Color();
function burst(x, y, z, n, color, speed = 4, up = 4, life = 0.8) {
  tmpC.set(color);
  for (let i = 0; i < n; i++) {
    const p = parts[pCursor]; pCursor = (pCursor + 1) % PMAX;
    p.life = p.max = life * rand(0.6, 1.2);
    p.x = x; p.y = y; p.z = z;
    const a = rand(0, Math.PI * 2), s = rand(0.3, 1) * speed;
    p.vx = Math.cos(a) * s; p.vz = Math.sin(a) * s; p.vy = rand(0.4, 1) * up;
    const j = pCursor * 3;
    pCol[j] = tmpC.r * rand(0.8, 1.2); pCol[j + 1] = tmpC.g * rand(0.8, 1.2); pCol[j + 2] = tmpC.b * rand(0.8, 1.2);
  }
  pGeo.attributes.color.needsUpdate = true;
}
function updateParticles(dt) {
  for (let i = 0; i < PMAX; i++) {
    const p = parts[i], j = i * 3;
    if (p.life > 0) {
      p.life -= dt;
      p.vy -= 9 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.4; }
      pPos[j] = p.x; pPos[j + 1] = p.y; pPos[j + 2] = p.z;
      if (p.life <= 0) pPos[j + 1] = -99;
    }
  }
  pGeo.attributes.position.needsUpdate = true;
}
// ambient embers
setInterval(() => {
  if (!state.started) return;
  burst(rand(-13, 13), rand(1, 6), rand(-11, 9), 2, pick([0xe01b2f, 0xff7a2e, 0x8b2bff]), 0.6, 1.2, 2.2);
}, 220);

/* slash arc VFX */
const slashMesh = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.12, 8, 24, Math.PI * 1.2),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
slashMesh.position.y = 1; scene.add(slashMesh);
let slashT = 1;
function slashFX(x, y, z) {
  slashMesh.position.set(x, y, z);
  slashMesh.rotation.set(rand(0, 3), rand(0, 3), rand(0, 3));
  slashT = 0;
  flashSlash();
}

/* ---------------- INPUT ---------------- */
const keys = {};
addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
  if (e.repeat) return;
  keys[e.key.toLowerCase()] = true;
  if (!state.started) return;
  if (e.key === '1') selectTool('hoe');
  else if (e.key === '2') selectTool('seed');
  else if (e.key === '3') selectTool('water');
  else if (e.key === '4') selectTool('scythe');
  else if (e.key.toLowerCase() === 'e' || e.key === ' ') doContext();
  else if (e.key.toLowerCase() === 'b') toggleShop();
  else if (e.key.toLowerCase() === 'm') toggleMute();
  else if (e.key.toLowerCase() === 'c') { state.camMode = (state.camMode + 1) % 3; toast(['CAM: PIT FOLLOW', 'CAM: OVERLORD TOP', 'CAM: CROWD LOW'][state.camMode]); }
  else if (e.key.toLowerCase() === 'h') $('help').classList.toggle('show');
  else if (e.key.toLowerCase() === 'p') saveGame(true);
});
addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
document.querySelectorAll('.tool').forEach(el => {
  el.addEventListener('click', () => selectTool(el.dataset.tool));
});
function selectTool(t) {
  state.tool = t; rebuildHandTool();
  document.querySelectorAll('.tool').forEach(el => el.classList.toggle('sel', el.dataset.tool === t));
  Audio2.sfx('plant');
}
$('rockbtn').addEventListener('click', startGame);
$('btn-audio').addEventListener('click', toggleMute);
$('btn-help').addEventListener('click', () => $('help').classList.toggle('show'));
$('btn-save').addEventListener('click', () => saveGame(true));
$('btn-cam').addEventListener('click', () => { state.camMode = (state.camMode + 1) % 3; });
$('helpclose').addEventListener('click', () => $('help').classList.remove('show'));
$('shopclose').addEventListener('click', () => toggleShop(false));
$('buy-seed').addEventListener('click', () => buy('seed'));
$('buy-brew').addEventListener('click', () => buy('brew'));
$('buy-fert').addEventListener('click', () => buy('fert'));
function toggleMute() {
  state.muted = !state.muted;
  $('btn-audio').textContent = state.muted ? '🔇 METAL: OFF [M]' : '🔊 METAL: ON [M]';
}
function toggleShop(force) {
  const s = $('shop');
  const show = force !== undefined ? force : !s.classList.contains('show');
  s.classList.toggle('show', show);
  refreshShop();
}
function refreshShop() {
  $('buy-seed').disabled = state.gold < 20;
  $('buy-brew').disabled = state.gold < 50 || state.stamina >= state.maxStamina;
  $('buy-fert').disabled = state.gold < 80;
}

/* ---------------- DIALOG ---------------- */
const DLG = [
  "Kid… this dirt died in 1999. But death is just a key change. TILL it with hate. (Tool 1 + E)",
  "Seeds are riffs — plant 'em deep and they SCREAM. Buy more with [B] if you run dry. (Tool 2 + E)",
  "Blood-water every cursed sprout or it withers like a ballad. (Tool 3 + E)",
  "When the turnip grows a SKULL — that's maturity. Reap it with the Axe. (Tool 4 + E)",
  "Dump loot in the skull-anvil [E] for GOLD. Sleep in the coffin to summon dawn. Earn 1000G. HEADLINE OR DIE.",
];
let dlgIdx = 0, dlgOpen = false;
function openDialog() {
  dlgOpen = true; $('dialog').classList.add('show');
  $('dlg-txt').textContent = DLG[dlgIdx % DLG.length];
}
function advanceDialog() {
  dlgIdx++;
  if (dlgIdx % DLG.length === 0) { closeDialog(); log('AXL: "Now GO. Make the soil bleed."'); }
  else $('dlg-txt').textContent = DLG[dlgIdx % DLG.length];
  Audio2.sfx('plant');
}
function closeDialog() { dlgOpen = false; $('dialog').classList.remove('show'); }

/* ---------------- SHOP ---------------- */
function buy(kind) {
  if (kind === 'seed' && state.gold >= 20) { state.gold -= 20; state.seeds++; log('+1 Skull-Turnip seed. It whispers…', 'gold'); Audio2.sfx('coin'); }
  else if (kind === 'brew' && state.gold >= 50) { state.gold -= 50; state.stamina = clamp(state.stamina + 45, 0, state.maxStamina); log('Berserker Brew chugged! +45 stamina.', 'gold'); Audio2.sfx('coin'); }
  else if (kind === 'fert' && state.gold >= 80) {
    const cell = facingTile();
    if (cell && cell.phase >= 2 && cell.phase < 5) {
      state.gold -= 80; setPhase(cell, cell.phase + 1, elapsed);
      burst(tileWorld(cell.r, cell.c).x, 1, tileWorld(cell.r, cell.c).z, 26, 0x9be7ff, 3, 5, 1);
      log('Moonlight Fertilizer! Crop surges forward.', 'gold'); Audio2.sfx('harvest');
    } else { toast('FERT NEEDS A GROWING CROP IN FRONT'); Audio2.sfx('error'); return; }
  }
  else { Audio2.sfx('error'); return; }
  refreshShop(); updateHUD();
}

/* ---------------- FARM ACTIONS ---------------- */
function facingTile() {
  const fx = Math.sin(playerDir), fz = Math.cos(playerDir);
  const px = player.position.x + fx * 1.3, pz = player.position.z + fz * 1.3;
  let best = null, bd = 1.1;
  for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
    const p = tileWorld(r, c);
    const d = Math.hypot(p.x - px, p.z - pz);
    if (d < bd) { bd = d; best = tiles[r][c]; }
  }
  return best;
}
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function spendStamina(n) {
  if (state.weather === 'ASH STORM') n += 1;
  state.stamina -= n;
  if (state.stamina <= 0) { state.stamina = 0; exhaust(); return false; }
  return true;
}
function exhaust() {
  if (state.exhausted) return;
  state.exhausted = true;
  announce('EXHAUSTED', 'THE PIT CONSUMES YOU — FORCED SLUMBER', true);
  Audio2.sfx('sleep');
  setTimeout(() => sleep(true), 1600);
}
function useToolOn(cell) {
  const p = tileWorld(cell.r, cell.c);
  if (state.tool === 'hoe') {
    if (cell.phase !== 0) { toast('ALREADY TORN OPEN'); Audio2.sfx('error'); return; }
    if (!spendStamina(4)) return;
    setPhase(cell, 1, elapsed);
    burst(p.x, 0.5, p.z, 22, 0x7a4a2a, 3.5, 4, 0.7);
    Audio2.sfx('till'); shake(0.12);
  } else if (state.tool === 'seed') {
    if (cell.phase !== 1) { toast('NEEDS TILLED SOIL (HOE FIRST)'); Audio2.sfx('error'); return; }
    if (state.seeds <= 0) { toast('NO SEEDS — PRESS B FOR SUPPLY'); Audio2.sfx('error'); return; }
    if (!spendStamina(2)) return;
    state.seeds--;
    cell.dryDays = 0;
    setPhase(cell, 2, elapsed);
    burst(p.x, 0.7, p.z, 16, 0x53e06b, 2.5, 4, 0.8);
    Audio2.sfx('plant');
  } else if (state.tool === 'water') {
    if (cell.phase < 1 || cell.phase >= 6) { toast('NOTHING TO DRENCH HERE'); Audio2.sfx('error'); return; }
    if (cell.watered) { toast('ALREADY DRENCHED'); Audio2.sfx('error'); return; }
    if (!spendStamina(3)) return;
    cell.watered = true; cell.dryDays = 0; paintTile(cell);
    burst(p.x, 0.8, p.z, 26, 0x2e9bff, 2.5, 5, 0.9);
    Audio2.sfx('water');
  } else if (state.tool === 'scythe') {
    if (cell.phase === 5) { harvest(cell); return; }
    if (cell.phase === 6 || cell.phase === 1) {
      if (!spendStamina(2)) return;
      const wasDead = cell.phase === 6;
      setPhase(cell, 0, elapsed);
      burst(p.x, 0.5, p.z, 18, 0x555555, 3, 4, 0.7);
      Audio2.sfx('swing'); shake(0.1);
      log(wasDead ? 'Cleared the rot.' : 'Soil reset.');
    } else { toast('NOT RIPE — WAIT FOR THE SKULL'); Audio2.sfx('error'); return; }
  }
  updateHUD();
}
function harvest(cell) {
  if (!spendStamina(2)) return;
  const p = tileWorld(cell.r, cell.c);
  const now = elapsed;
  // combo
  if (now - state.comboTimer < 7) state.combo++;
  else state.combo = 1;
  state.comboTimer = now;
  state.bestCombo = Math.max(state.bestCombo, state.combo);
  const bonus = Math.min(30, (state.combo - 1) * 6);
  const value = 60 + bonus;
  state.carried++; state.carriedValue += value;
  state.harvestedTotal++; state.questCount++;
  setPhase(cell, 1, elapsed);
  // FX: slash + shake + hitstop
  slashFX(p.x, 1.1, p.z);
  burst(p.x, 1, p.z, 46, 0xffffff, 5, 6, 1);
  burst(p.x, 1, p.z, 30, 0xe01b2f, 4, 5, 1);
  burst(p.x, 1, p.z, 16, 0xffc93c, 3, 6, 1.1);
  Audio2.sfx('swing'); setTimeout(() => Audio2.sfx('harvest'), 90);
  shake(0.35); hitstop(90);
  const cEl = $('combo');
  if (state.combo >= 2) {
    $('combo-n').textContent = 'x' + state.combo;
    cEl.classList.add('show');
    clearTimeout(cEl._t); cEl._t = setTimeout(() => cEl.classList.remove('show'), 2500);
    announce(pick(['SLASH!', 'BRUTAL!', 'DIVINE HARVEST!', 'ENCORE!']), `COMBO x${state.combo} — SKULL-TURNIP +${value}G LOOT`, state.combo >= 4);
  } else {
    announce('REAPED!', `SKULL-TURNIP +${value}G LOOT — SHIP IT AT THE ANVIL`);
  }
  log(`Reaped Skull-Turnip (+${value}G loot). Carry: ${state.carried}`, 'gold');
  if (!state.questDone && state.questCount >= 5) {
    state.questDone = true; state.gold += 150; state.earnedTotal += 150;
    setTimeout(() => { announce('QUEST COMPLETE', 'AXL PAYS 150G — THE PIT APPROVES', true); Audio2.sfx('coin'); }, 2400);
    log("Quest complete! AXL +150G. The old ghoul weeps.", 'gold');
  }
  if (state.earnedTotal + state.carriedValue >= GOAL_G && state.earnedTotal < GOAL_G) {
    setTimeout(() => announce('HEADLINER!', '1000G — YOU OWN THE PIT', true), 2600);
  }
  updateHUD();
}

/* context interaction: NPC > bin > bed > chicken/egg > shopkeep > tile */
function doContext() {
  if (dlgOpen) { advanceDialog(); return; }
  if ($('shop').classList.contains('show')) { toggleShop(false); return; }
  const pp = player.position;
  if (dist2(pp, npcPos) < 2.6) { openDialog(); Audio2.sfx('plant'); return; }
  if (dist2(pp, binPos) < 2.8) { shipAll(); return; }
  if (dist2(pp, new THREE.Vector3(housePos.x + 3.4, 0, housePos.z + 2.2)) < 2.4) { sleep(); return; }
  if (dist2(pp, chicken.position) < 2.2 || dist2(pp, coopPos) < 2.8) { collectEgg(); return; }
  if (dist2(pp, new THREE.Vector3(shopPos.x, 0, shopPos.z - 1)) < 2.6) { toggleShop(true); return; }
  const cell = facingTile();
  if (cell) useToolOn(cell);
  else { toast('FACE THE SOIL'); Audio2.sfx('error'); }
}
function shipAll() {
  if (state.carried <= 0 && state.eggsPending <= 0 && !(eggMesh)) { toast('NOTHING TO SHIP — REAP FIRST'); Audio2.sfx('error'); return; }
  const total = state.carriedValue + state.eggsPending * 30;
  const n = state.carried + state.eggsPending;
  state.gold += total; state.earnedTotal += total;
  burst(binPos.x, 2, binPos.z, 50, 0xffc93c, 4, 6, 1.1);
  Audio2.sfx('coin'); shake(0.2);
  announce('SOLD TO THE PIT!', `${n} LOOT — +${total}G`, true);
  log(`Shipped ${n} loot for ${total}G. The crowd roars.`, 'gold');
  state.carried = 0; state.carriedValue = 0; state.eggsPending = 0;
  updateHUD(); checkRank();
}
function collectEgg() {
  if (eggMesh) {
    scene.remove(eggMesh); eggMesh = null;
    state.eggsPending++;
    burst(chicken.position.x, 1, chicken.position.z, 24, 0xffc93c, 3, 5, 0.9);
    log('Hellcluck egg seized! (30G at the anvil)', 'gold');
    Audio2.sfx('cluck'); setTimeout(() => Audio2.sfx('coin'), 150);
  } else {
    burst(chicken.position.x, 1, chicken.position.z, 10, 0xffffff, 2, 3, 0.5);
    log('You pet Hellcluck. It judges you. No egg yet.');
    Audio2.sfx('cluck');
  }
  updateHUD();
}

/* ---------------- DAY / NIGHT / WEATHER ---------------- */
function gameHour() { return 6 + state.dayT * 18; } // 06:00..24:00
function fmtHour() {
  const h = gameHour(), hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}
function sleep(forced = false) {
  Audio2.sfx('sleep');
  announce('DAY ' + state.day + ' — SLAYED', 'THE COFFIN CLAIMS YOU…', true);
  burst(player.position.x, 1, player.position.z, 40, 0x8b2bff, 3, 5, 1.2);
  setTimeout(() => {
    // overnight growth
    for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
      const cell = tiles[r][c];
      if (cell.phase >= 2 && cell.phase <= 4) {
        if (cell.watered) { setPhase(cell, cell.phase + 1, elapsed); cell.dryDays = 0; }
        else { cell.dryDays++; if (cell.dryDays >= 2) { setPhase(cell, 6, elapsed); } }
        cell.watered = false; paintTile(cell);
      } else if (cell.phase === 5) { cell.watered = false; paintTile(cell); }
      else if (cell.phase === 1 && cell.watered) { cell.watered = false; paintTile(cell); }
    }
    state.day++;
    state.dayT = 0;
    state.stamina = state.maxStamina;
    state.exhausted = false;
    // new weather
    const roll = Math.random();
    state.weather = roll < 0.45 ? 'BLOOD SUN' : roll < 0.7 ? 'BLOOD RAIN' : roll < 0.88 ? 'ASH STORM' : 'VOID ECLIPSE';
    if (state.weather === 'BLOOD RAIN') {
      for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
        const cell = tiles[r][c];
        if (cell.phase >= 1 && cell.phase <= 5) { cell.watered = true; cell.dryDays = 0; paintTile(cell); }
      }
      log('Blood Rain soaks every tile. Free water!', 'gold');
    }
    saveGame(false);
    announce('DAY ' + state.day, `☠ ${state.weather} ☠ — MAKE IT BLEED`, true);
    log(`— Dawn of Day ${state.day} (${state.weather}) —`);
    updateHUD();
  }, forced ? 400 : 1400);
}
function checkRank() {
  const t = state.earnedTotal + state.carriedValue;
  const rank = t >= GOAL_G ? 'HEADLINER ⛧' : t >= 600 ? 'SUPPORT ACT' : t >= 300 ? 'OPENER' : 'ROADIE';
  $('rankline').textContent = `RANK: ${rank} — ${t}G / ${GOAL_G}G`;
  $('rhp').style.transform = `scaleX(${clamp(1 - t / GOAL_G, 0.02, 1)})`;
  $('rhpghost').style.transform = `scaleX(${clamp(1 - t / GOAL_G, 0.02, 1)})`;
}

/* ---------------- HUD ---------------- */
function updateHUD() {
  $('st-gold').textContent = state.gold;
  $('st-seed').textContent = state.seeds;
  $('st-carry').textContent = state.carried + (state.eggsPending ? `+${state.eggsPending}🥚` : '');
  $('st-stam').textContent = Math.ceil(state.stamina);
  $('hp').style.transform = `scaleX(${clamp(state.stamina / state.maxStamina, 0, 1)})`;
  $('hpghost').style.transform = `scaleX(${clamp(state.stamina / state.maxStamina, 0, 1)})`;
  $('daybadge').textContent = 'DAY ' + state.day;
  $('clock').textContent = '☾ ' + fmtHour();
  $('weather').textContent = '◆ ' + state.weather;
  $('tensionfill').style.transform = `scaleX(${clamp(state.dayT, 0, 1)})`;
  $('tensionflame').style.left = `calc(${(state.dayT * 100).toFixed(1)}% - 10px)`;
  const seg = Math.ceil((state.stamina / state.maxStamina) * 5);
  [...$('burst').children].forEach((el, i) => el.classList.toggle('on', i < seg));
  checkRank();
  refreshShop();
}
function updatePrompt() {
  const el = $('prompt');
  if (!state.started || dlgOpen) { el.style.display = 'none'; return; }
  const pp = player.position;
  let txt = null;
  if (dist2(pp, npcPos) < 2.6) txt = 'TALK TO AXL';
  else if (dist2(pp, binPos) < 2.8) txt = state.carried ? `SHIP ${state.carried} LOOT (+${state.carriedValue}G)` : 'SKULL-ANVIL (REAP FIRST)';
  else if (dist2(pp, new THREE.Vector3(housePos.x + 3.4, 0, housePos.z + 2.2)) < 2.4) txt = 'SLEEP TILL DAWN';
  else if (dist2(pp, chicken.position) < 2.2 || dist2(pp, coopPos) < 2.8) txt = eggMesh ? 'SEIZE EGG' : 'PET HELLCLUCK';
  else if (dist2(pp, new THREE.Vector3(shopPos.x, 0, shopPos.z - 1)) < 2.6) txt = 'OPEN SUPPLY [B]';
  else {
    const cell = facingTile();
    if (cell) {
      if (state.tool === 'hoe') txt = cell.phase === 0 ? 'TILL SOIL' : 'ALREADY TORN';
      else if (state.tool === 'seed') txt = cell.phase === 1 ? 'PLANT RIFF' : 'NEEDS TILLED SOIL';
      else if (state.tool === 'water') txt = cell.phase >= 1 && cell.phase < 6 ? (cell.watered ? 'DRENCHED ✓' : 'DRENCH IN BLOOD') : 'NO CROP HERE';
      else txt = cell.phase === 5 ? 'REAP THE SKULL!' : cell.phase === 6 ? 'CLEAR ROT' : 'NOT RIPE';
    }
  }
  if (txt) { $('prompt-txt').textContent = txt; el.style.display = 'block'; }
  else el.style.display = 'none';
}

/* ---------------- SAVE / LOAD ---------------- */
function saveGame(loud) {
  try {
    const data = {
      gold: state.gold, seeds: state.seeds, day: state.day, earnedTotal: state.earnedTotal,
      harvestedTotal: state.harvestedTotal, questDone: state.questDone, questCount: state.questCount,
      bestCombo: state.bestCombo,
      farm: tiles.map(row => row.map(c => ({ p: c.phase, w: c.watered ? 1 : 0 })))
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    if (loud) { toast('ENGRAVED IN BLOOD (SAVED)'); log('Progress etched into the vinyl of fate.', 'gold'); }
  } catch (e) { if (loud) toast('SAVE FAILED'); }
}
function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const d = JSON.parse(raw);
    state.gold = d.gold ?? 100; state.seeds = d.seeds ?? 6; state.day = d.day ?? 1;
    state.earnedTotal = d.earnedTotal ?? 0; state.harvestedTotal = d.harvestedTotal ?? 0;
    state.questDone = !!d.questDone; state.questCount = d.questCount ?? 0;
    state.bestCombo = d.bestCombo ?? 0;
    if (d.farm) for (let r = 0; r < GH && r < d.farm.length; r++)
      for (let c = 0; c < GW && c < d.farm[r].length; c++) {
        const s = d.farm[r][c];
        setPhase(tiles[r][c], clamp(s.p ?? 0, 0, 6), 0);
        tiles[r][c].watered = !!s.w;
        paintTile(tiles[r][c]);
      }
    return true;
  } catch { return false; }
}

/* ---------------- CAMERA / SHAKE / HITSTOP ---------------- */
let shakeAmt = 0, hitstopT = 0;
function shake(a) { shakeAmt = Math.min(0.8, shakeAmt + a); }
function hitstop(ms) { hitstopT = ms / 1000; }
const camPos = new THREE.Vector3(0, 12, 12), camLook = new THREE.Vector3();
function updateCamera(dt) {
  const p = player.position;
  let want, look;
  if (state.camMode === 0) { want = new THREE.Vector3(p.x * 0.82, 10.5, p.z * 0.82 + 9.5); look = new THREE.Vector3(p.x, 0.8, p.z - 1); }
  else if (state.camMode === 1) { want = new THREE.Vector3(p.x * 0.5, 21, p.z * 0.5 + 3); look = new THREE.Vector3(p.x, 0, p.z); }
  else { want = new THREE.Vector3(p.x - Math.sin(playerDir) * 5, 3.2, p.z - Math.cos(playerDir) * 5); look = new THREE.Vector3(p.x + Math.sin(playerDir) * 4, 1.6, p.z + Math.cos(playerDir) * 4); }
  camPos.lerp(want, 1 - Math.pow(0.001, dt));
  camLook.lerp(look, 1 - Math.pow(0.0005, dt));
  camera.position.copy(camPos);
  if (shakeAmt > 0.001) {
    camera.position.x += rand(-1, 1) * shakeAmt;
    camera.position.y += rand(-1, 1) * shakeAmt * 0.6;
    shakeAmt *= Math.pow(0.02, dt);
  }
  camera.lookAt(camLook);
}

/* ---------------- START ---------------- */
const hadSave = loadGame();
function startGame() {
  if (state.started) return;
  state.started = true;
  Audio2.init();
  $('title').classList.add('hide');
  announce('HEAVEN OR HELL', 'DUEL 1 — LET\'S ROCK!', false);
  setTimeout(() => { if (state.started) announce('TILL! PLANT! REAP!', 'E = ACT · 1-4 = TOOLS · B = SHOP'); }, 2600);
  log(hadSave ? 'The vinyl spins again — save restored.' : 'Day 1. Grandpa\'s cursed deed in hand. Talk to AXL by the gate!', hadSave ? 'gold' : '');
  log('Go: HOE (1) → SEED (2) → WATER (3) → SLEEP → AXE (4) → SHIP.');
  updateHUD();
}
$('rockbtn').addEventListener('click', () => { Audio2.init(); Audio2.ctx?.resume(); });

/* ---------------- MAIN LOOP ---------------- */
const clock = new THREE.Clock();
let elapsed = 0, fpsAcc = 0, fpsN = 0, fpsT = 0, boltT = 8;
const fwd = new THREE.Vector3();

function tick() {
  requestAnimationFrame(tick);
  let dt = Math.min(clock.getDelta(), 0.05);
  if (hitstopT > 0) { hitstopT -= dt; dt *= 0.08; }
  elapsed += dt;

  if (state.started) {
    /* movement */
    let ix = 0, iz = 0;
    if (keys['w'] || keys['arrowup']) iz -= 1;
    if (keys['s'] || keys['arrowdown']) iz += 1;
    if (keys['a'] || keys['arrowleft']) ix -= 1;
    if (keys['d'] || keys['arrowright']) ix += 1;
    // 's' doubles as save on keydown only; movement uses held key too — but S conflicts with save!
    moving = (ix !== 0 || iz !== 0);
    if (moving) {
      const sp = state.weather === 'ASH STORM' ? 4.4 : 5.2;
      const l = Math.hypot(ix, iz); ix /= l; iz /= l;
      player.position.x += ix * sp * dt;
      player.position.z += iz * sp * dt;
      const rr = Math.hypot(player.position.x, player.position.z);
      if (rr > 14.2) { player.position.x *= 14.2 / rr; player.position.z *= 14.2 / rr; }
      targetDir = Math.atan2(ix, iz);
      walkPhase += dt * 11;
      if (Math.random() < dt * 6) burst(player.position.x, 0.15, player.position.z, 1, 0x5a4a3a, 1, 1.5, 0.4);
    }
    let dd = targetDir - playerDir;
    while (dd > Math.PI) dd -= Math.PI * 2;
    while (dd < -Math.PI) dd += Math.PI * 2;
    playerDir += dd * Math.min(1, dt * 12);
    player.rotation.y = playerDir;
    player.position.y = moving ? Math.abs(Math.sin(walkPhase)) * 0.09 : 0;
    player.rotation.z = moving ? Math.sin(walkPhase) * 0.04 : 0;
    // squash the guitar
    player.userData.toolG.rotation.x = Math.sin(elapsed * 3) * 0.08;

    /* day clock */
    state.dayT += dt / DAY_LEN;
    if (state.dayT >= 1) { state.dayT = 0; sleep(true); }
    // blood rain passive watering shimmer
    if (state.weather === 'BLOOD RAIN' && Math.random() < dt * 4) {
      const r = randi(0, GH - 1), c = randi(0, GW - 1);
      const cell = tiles[r][c];
      if (cell.phase >= 1 && cell.phase <= 5 && !cell.watered) { cell.watered = true; paintTile(cell); }
      const p = tileWorld(r, c);
      burst(p.x, 2, p.z, 1, 0xe01b2f, 0.5, 0.5, 0.5);
    }

    /* combo decay */
    if (state.combo > 0 && elapsed - state.comboTimer > 7) { state.combo = 0; $('combo').classList.remove('show'); }

    /* selection ring */
    const cell = facingTile();
    if (cell) {
      const p = tileWorld(cell.r, cell.c);
      ring.position.set(p.x, 0.28, p.z);
      ring.material.color.set(state.tool === 'scythe' && cell.phase === 5 ? 0xff2020 : 0xffc93c);
      const s = 1 + Math.sin(elapsed * 6) * 0.05;
      ring.scale.set(s, s, 1);
      ring.visible = true;
    } else ring.visible = false;

    /* NPC idle */
    npc.position.y = Math.sin(elapsed * 2) * 0.06;
    npc.rotation.y = Math.sin(elapsed * 0.5) * 0.3;
    merchant.rotation.y = Math.sin(elapsed * 1.2) * 0.4;
    merchant.position.y = Math.sin(elapsed * 3) * 0.03;

    /* chicken wander + eggs */
    chickenTimer -= dt;
    if (chickenTimer <= 0) { chickenTimer = rand(2, 5); chickenDir = rand(0, Math.PI * 2); }
    chicken.position.x += Math.sin(chickenDir) * 1.4 * dt;
    chicken.position.z += Math.cos(chickenDir) * 1.4 * dt;
    const cr = Math.hypot(chicken.position.x - coopPos.x, chicken.position.z - coopPos.z);
    if (cr > 4.5) chickenDir += Math.PI;
    chicken.position.x = clamp(chicken.position.x, -13, 13);
    chicken.position.z = clamp(chicken.position.z, -10, 10);
    chicken.rotation.y = chickenDir;
    chicken.position.y = Math.abs(Math.sin(elapsed * 10)) * 0.06;
    eggTimer -= dt;
    if (eggTimer <= 0) {
      eggTimer = rand(35, 60);
      if (!eggMesh) {
        eggMesh = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10),
          new THREE.MeshBasicMaterial({ color: 0xffc93c }));
        eggMesh.scale.y = 1.3;
        eggMesh.position.set(coopPos.x + rand(-1, 1), 0.3, coopPos.z + rand(-1, 1));
        scene.add(eggMesh);
        log('🥚 Hellcluck laid an egg! Grab it (E).', 'gold');
        Audio2.sfx('cluck');
      }
    }
    if (eggMesh) eggMesh.position.y = 0.3 + Math.sin(elapsed * 4) * 0.05;

    /* mature crop pulse */
    for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
      const cc = tiles[r][c];
      if (cc.crop && cc.phase === 5) {
        const s = 1 + Math.sin(elapsed * 5 + r + c) * 0.07;
        cc.crop.scale.set(s, s, s);
        cc.crop.rotation.y += dt * 0.8;
      }
    }

    updatePrompt();
    if ((fpsT += dt) > 0.25) { updateHUD(); fpsT = 0; }
  }

  /* ambient world motion (always) */
  for (const f of floaters) {
    f.position.y = f.userData.y0 + Math.sin(elapsed * f.userData.sp + f.userData.ph) * 1.1;
    f.rotation.x += dt * 0.3; f.rotation.y += dt * 0.4;
  }
  spotA.position.x = Math.sin(elapsed * 0.7) * 13;
  spotB.position.x = Math.sin(elapsed * 0.7 + Math.PI) * 13;
  pitLight.intensity = 55 + Math.sin(elapsed * 7) * 8 + Math.sin(elapsed * 23) * 4;
  const pent = world.getObjectByName('pent');
  if (pent) pent.rotation.z += dt * 0.15;
  sleepMark.position.y = 3.4 + Math.sin(elapsed * 2.5) * 0.15;
  shipMark.position.y = 3.2 + Math.sin(elapsed * 2.5 + 1) * 0.15;
  // lightning
  boltT -= dt;
  if (boltT <= 0) {
    boltT = rand(9, 22);
    moonLight.intensity = 4;
    setTimeout(() => moonLight.intensity = 1.6, 120);
    if (state.started && Math.random() < 0.7) Audio2.sfx('thunder');
    burst(rand(-10, 10), 8, rand(-10, 5), 12, 0xd9a7ff, 2, 1, 0.5);
  }
  // slash decay
  if (slashT < 1) {
    slashT = Math.min(1, slashT + dt * 4);
    slashMesh.material.opacity = 1 - slashT;
    slashMesh.scale.setScalar(1 + slashT * 1.6);
  } else slashMesh.material.opacity = 0;

  updateParticles(dt);
  updateCamera(dt);
  renderer.render(scene, camera);

  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 0.5) { $('fps').textContent = Math.round(fpsN / fpsAcc) + ' fps · three.js ' + THREE.REVISION; fpsAcc = 0; fpsN = 0; }
}
updateHUD();
tick();
// debug handle (used by automated smoke test)
window.__mm = { state, tiles, sleep, shipAll, selectTool, useToolOn, facingTile, player };
