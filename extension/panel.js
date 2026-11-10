import * as THREE from './vendor/three.module.min.js';
import { DEFAULTS, buildModel, seatMetrics, seatDistance, eyeOf, bestBlock } from './model.js';

const $ = (id) => document.getElementById(id);

// Show runtime errors in the panel itself instead of failing silently.
function report(err) {
  const box = $('err');
  if (!box) return;
  const where = err?.stack?.match(/(\w+\.js):(\d+)/);
  $('errText').textContent = `${err?.message || err}${where ? ` (${where[1]}:${where[2]})` : ''}`;
  box.hidden = false;
  console.error('[3D Seat View]', err);
}
window.addEventListener('error', (e) => report(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => report(e.reason));
const safe = (fn) => (...args) => { try { return fn(...args); } catch (e) { report(e); } };
const COLORS = { available: 0x2fbf71, best: 0xf5b942, sold: 0x4a4d57, picked: 0xff9db5, selected: 0xff3d6e };
const CFG_KEY = 'bms3d.cfg';

// ---------------------------------------------------------------- state
let cfg = { ...DEFAULTS };
try { cfg = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(CFG_KEY) || '{}') }; } catch (_) { /* defaults */ }
let layout = null;
let model = null;
let selectedId = null;
let prevId = null;
let mode = 'hall';
let pref = 'seat';              // view the user wants: seat first, Hall only when they ask
let want = 1;                 // how many seats to find together
let sendPick = () => {};      // set below: asks the booking page to select seats

// ---------------------------------------------------------------- three setup
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020203);
const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 300);

// House lights (guide mode) vs. movie-playing darkness (realistic mode).
const houseAmb = new THREE.AmbientLight(0xfff1e0, 1.5);
const houseDir = new THREE.DirectionalLight(0xffffff, 1.8);
houseDir.position.set(4, 14, 10);
// Light coming off the screen: a wide shadow-casting spot plus a soft fill.
const spill = new THREE.SpotLight(0xffd2ad, 40, 0, 1.25, 0.7, 1.5);
spill.castShadow = true;
spill.shadow.mapSize.set(1024, 1024);
spill.shadow.bias = -0.0015;
spill.shadow.camera.near = 0.5;
spill.shadow.camera.far = 60;
const fill = new THREE.PointLight(0xffc9a0, 8, 0, 1.6);
scene.add(houseAmb, houseDir, spill, spill.target, fill);

const LIGHTS = {
  guide: { amb: 1.5, dir: 1.8, spill: 6, fill: 3 },
  real: { amb: 0.42, dir: 0.12, spill: 170, fill: 22 },    // from the seat, film running
  realHall: { amb: 0.6, dir: 0.35, spill: 170, fill: 22 }, // overview with house lights dimmed
};

let root = null;       // everything built from the model
let chairs = null;     // InstancedMesh – upholstered seat + back (pick target)
let guideGroup = null; // row letters, sight line: only in guide look
let realGroup = null;  // audience, projector beam, halo: only in realistic look
let screenMesh = null;
let texGuide = null, texMovie = null;
let artBitmap = null;  // the movie's artwork, once fetched
let artKey = '';
let marker = null;
let sightLine = null;
let selfBody = null;  // your own legs, seen when you look down from the seat

// "Guide" look = status colours + test pattern; off = realistic cinema.
const guideOn = { hall: true, seat: false };
const isGuide = () => guideOn[mode];

const orbit = { theta: 0.6, phi: 1.0, r: 22, target: new THREE.Vector3() };
const look = { yaw: 0, pitch: 0, hfov: 95 };
const goalPos = new THREE.Vector3();
const goalQuat = new THREE.Quaternion();
let goalFov = 50;
let snap = true; // jump camera instead of easing (first frame / rebuild)

function disposeRoot() {
  if (!root) return;
  scene.remove(root);
  root.traverse((o) => {
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    mats.forEach((m) => { m.map?.dispose(); m.dispose(); });
  });
  texGuide?.dispose(); texMovie?.dispose();
  root = chairs = guideGroup = realGroup = screenMesh = texGuide = texMovie = marker = sightLine = selfBody = null;
}

// deterministic pseudo-random in [0,1)
const rnd = (i, salt = 0) => {
  const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

function grain(g, w, h, amount, n = 5000) {
  for (let i = 0; i < n; i++) {
    const v = rnd(i, 3) > 0.5 ? 255 : 0;
    g.fillStyle = `rgba(${v},${v},${v},${amount * rnd(i, 7)})`;
    g.fillRect(rnd(i, 1) * w, rnd(i, 2) * h, 1.5, 1.5);
  }
}

// Test pattern: thirds + centre cross make off-centre distortion easy to read.
function guideTexture(aspect) {
  return canvasTex(1024, Math.round(1024 / aspect), (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#1d3b6e'); grad.addColorStop(0.55, '#3f6fb0'); grad.addColorStop(1, '#0f1d38');
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2;
    for (let i = 1; i < 3; i++) {
      g.beginPath(); g.moveTo((w * i) / 3, 0); g.lineTo((w * i) / 3, h); g.stroke();
      g.beginPath(); g.moveTo(0, (h * i) / 3); g.lineTo(w, (h * i) / 3); g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 3;
    g.beginPath(); g.arc(w / 2, h / 2, h * 0.16, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(w / 2 - h * 0.24, h / 2); g.lineTo(w / 2 + h * 0.24, h / 2);
    g.moveTo(w / 2, h / 2 - h * 0.24); g.lineTo(w / 2, h / 2 + h * 0.24); g.stroke();
    g.strokeStyle = '#fff'; g.lineWidth = 10; g.strokeRect(5, 5, w - 10, h - 10);
    g.fillStyle = 'rgba(255,255,255,.92)'; g.font = `600 ${Math.round(h * 0.11)}px system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('SCREEN', w / 2, h * 0.14);
  });
}

// What plays on the screen in the realistic look: the movie's own artwork
// when the booking page gave us some, else a painted stand-in frame.
function movieTexture(aspect) {
  return artBitmap ? artFrame(aspect, artBitmap) : paintedFrame(aspect);
}

function artFrame(aspect, bmp) {
  return canvasTex(1536, Math.round(1536 / aspect), (g, w, h) => {
    const cover = (scale = 1) => {
      const s = Math.max(w / bmp.width, h / bmp.height) * scale;
      g.drawImage(bmp, (w - bmp.width * s) / 2, (h - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
    };
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    if (bmp.width / bmp.height >= 1.3) {
      cover(); // landscape still: fill the frame
    } else {
      // portrait poster: soft blown-up backdrop, sharp poster in the middle
      g.filter = 'blur(26px) brightness(0.6) saturate(1.2)';
      cover(1.15);
      g.filter = 'none';
      const ph = h * 0.94, pw = ph * (bmp.width / bmp.height);
      g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 40;
      g.drawImage(bmp, (w - pw) / 2, (h - ph) / 2, pw, ph);
      g.shadowBlur = 0;
    }
    const vg = g.createRadialGradient(w / 2, h / 2, h * 0.45, w / 2, h / 2, w * 0.65);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.4)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
    grain(g, w, h, 0.05, 7000);
  });
}

// A procedurally painted film frame (dusk over mountains) – no bundled artwork.
function paintedFrame(aspect) {
  return canvasTex(1536, Math.round(1536 / aspect), (g, w, h) => {
    const hz = h * 0.66;
    const sky = g.createLinearGradient(0, 0, 0, hz);
    sky.addColorStop(0, '#070b24'); sky.addColorStop(0.45, '#3a2a66');
    sky.addColorStop(0.8, '#d6603f'); sky.addColorStop(1, '#ffd08a');
    g.fillStyle = sky; g.fillRect(0, 0, w, hz);
    for (let i = 0; i < 140; i++) { // stars
      g.fillStyle = `rgba(255,255,255,${0.2 + 0.6 * rnd(i, 4)})`;
      g.fillRect(rnd(i, 5) * w, rnd(i, 6) * hz * 0.5, 1.6, 1.6);
    }
    const sx = w * 0.6, sy = hz - h * 0.03;
    const sun = g.createRadialGradient(sx, sy, 0, sx, sy, h * 0.55);
    sun.addColorStop(0, 'rgba(255,246,214,1)'); sun.addColorStop(0.08, 'rgba(255,214,140,.95)');
    sun.addColorStop(0.3, 'rgba(255,140,80,.35)'); sun.addColorStop(1, 'rgba(255,120,80,0)');
    g.fillStyle = sun; g.fillRect(0, 0, w, hz);
    for (let i = 0; i < 9; i++) { // cloud streaks
      const cy = hz * (0.35 + 0.5 * rnd(i, 8)), cx = rnd(i, 9) * w, cw = w * (0.15 + 0.25 * rnd(i, 10));
      const cg = g.createLinearGradient(cx - cw, 0, cx + cw, 0);
      cg.addColorStop(0, 'rgba(255,170,120,0)'); cg.addColorStop(0.5, 'rgba(255,180,130,.28)'); cg.addColorStop(1, 'rgba(255,170,120,0)');
      g.fillStyle = cg; g.fillRect(cx - cw, cy, cw * 2, h * 0.012);
    }
    // water with sun reflection
    const sea = g.createLinearGradient(0, hz, 0, h);
    sea.addColorStop(0, '#e08a5a'); sea.addColorStop(0.25, '#5a3560'); sea.addColorStop(1, '#0a0c1e');
    g.fillStyle = sea; g.fillRect(0, hz, w, h - hz);
    for (let i = 0; i < 90; i++) {
      const y = hz + (h - hz) * rnd(i, 11), spread = w * (0.02 + 0.12 * (y - hz) / (h - hz));
      g.fillStyle = `rgba(255,220,160,${0.5 * (1 - (y - hz) / (h - hz))})`;
      g.fillRect(sx - spread + rnd(i, 12) * spread * 2 - w * 0.03, y, w * 0.06 * rnd(i, 13) + 6, 2);
    }
    // mountain ridges, far to near
    const ridge = (base, amp, color, seed) => {
      g.fillStyle = color; g.beginPath(); g.moveTo(0, h);
      for (let x = 0; x <= w; x += 6) {
        const t = x / w;
        const y = base - amp * (0.5 + 0.28 * Math.sin(t * 7 + seed) + 0.16 * Math.sin(t * 17 + seed * 2.3) + 0.06 * Math.sin(t * 43 + seed * 5));
        g.lineTo(x, y);
      }
      g.lineTo(w, h); g.closePath(); g.fill();
    };
    ridge(hz + h * 0.02, h * 0.30, '#4a2f5e', 1.3);
    ridge(hz + h * 0.05, h * 0.22, '#2c1d44', 4.1);
    g.save(); g.beginPath(); g.rect(0, 0, w * 0.42, h); g.clip();
    ridge(h * 1.02, h * 0.55, '#0b0a16', 2.2); g.restore();
    g.save(); g.beginPath(); g.rect(w * 0.8, 0, w * 0.2, h); g.clip();
    ridge(h * 1.05, h * 0.45, '#0d0b19', 6.0); g.restore();
    // vignette + grain
    const vg = g.createRadialGradient(w / 2, h / 2, h * 0.4, w / 2, h / 2, w * 0.62);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.5)');
    g.fillStyle = vg; g.fillRect(0, 0, w, h);
    grain(g, w, h, 0.07, 9000);
  });
}

function labelSprite(text) {
  const t = canvasTex(64, 64, (g) => {
    g.fillStyle = '#e4e7f2'; g.font = '600 40px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 32, 34);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false }));
  s.scale.set(0.55, 0.55, 1);
  return s;
}

const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, ...o });

function fabricTex(repeat) {
  return canvasTex(128, 128, (g, w, h) => {
    g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, w, h);
    grain(g, w, h, 0.18, 6000);
  }, repeat);
}

function carpetTex(repeat) {
  return canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#2a2530'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) { // loose confetti pattern typical of multiplex carpet
      g.strokeStyle = ['#5a2a3a', '#3b3a5c', '#6a4a2a'][i % 3]; g.lineWidth = 5;
      const x = rnd(i, 20) * w, y = rnd(i, 21) * h, a = rnd(i, 22) * 6.28;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 26, y + Math.sin(a) * 26); g.stroke();
    }
    grain(g, w, h, 0.3, 9000);
  }, repeat);
}

// Acoustic wall panels with a warm sconce wash on every second panel.
function wallTex(repeat) {
  return canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = '#2b2024'; g.fillRect(0, 0, w, h);
    grain(g, w, h, 0.18, 9000);
    for (let i = 0; i < 2; i++) {
      const x0 = (i * w) / 2;
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(x0, 0, 5, h);
      g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(x0 + 5, 0, 2, h);
    }
    g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, h * 0.7, w, 4); // dado rail
    g.fillStyle = '#1b1518'; g.fillRect(0, h * 0.7 + 4, w, h * 0.3);
    const cx = w * 0.25, cy = h * 0.42;
    const gl = g.createRadialGradient(cx, cy, 0, cx, cy, h * 0.3);
    gl.addColorStop(0, 'rgba(255,196,120,.85)'); gl.addColorStop(0.15, 'rgba(255,170,90,.35)'); gl.addColorStop(1, 'rgba(255,150,80,0)');
    g.fillStyle = gl; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffe6c0'; g.fillRect(cx - 7, cy - 3, 14, 20);
  }, repeat);
}

function curtainTex(repeat) {
  return canvasTex(256, 64, (g, w, h) => {
    for (let x = 0; x < w; x++) {
      const v = 0.5 + 0.5 * Math.sin((x / w) * Math.PI * 2 * 8);
      const l = Math.round(22 + 60 * v * v);
      g.fillStyle = `rgb(${l + 30},${Math.round(l * 0.18)},${Math.round(l * 0.22)})`;
      g.fillRect(x, 0, 1, h);
    }
  }, repeat);
}

function plane(w, h, mat) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.receiveShadow = true;
  return m;
}

// Side profile of a cinema chair (x = towards the screen, y = up), extruded
// across the seat width: sprung cushion, reclined high back, rounded edges.
function chairGeometry(width) {
  const s = new THREE.Shape();
  s.moveTo(0.27, 0.36);
  s.lineTo(0.28, 0.45);
  s.quadraticCurveTo(0.28, 0.53, 0.19, 0.52);
  s.lineTo(-0.08, 0.49);
  s.lineTo(-0.19, 1.0);
  s.quadraticCurveTo(-0.22, 1.09, -0.31, 1.05);
  s.lineTo(-0.22, 0.36);
  s.closePath();
  const bev = 0.025;
  const g = new THREE.ExtrudeGeometry(s, {
    depth: width - bev * 2, bevelEnabled: true, bevelThickness: bev, bevelSize: bev,
    bevelSegments: 3, curveSegments: 8,
  });
  g.translate(0, 0, -(width - bev * 2) / 2);
  g.rotateY(Math.PI / 2); // shape x -> world -Z (towards screen), extrusion -> world X
  g.computeVertexNormals();
  return g;
}

function buildScene() {
  disposeRoot();
  if (!model) return;
  root = new THREE.Group();
  guideGroup = new THREE.Group();
  realGroup = new THREE.Group();
  scene.add(root);
  root.add(guideGroup, realGroup);
  const { cfg: c, screen, wallL, wallR, backZ } = model;
  const hallW = wallR - wallL, midX = (wallL + wallR) / 2;
  const ceil = Math.max(screen.bottom + screen.h + 1.4, model.topFloor + 3.4);
  const frontZ = -0.8;

  // ---- floor: carpeted apron, then one carpeted step per row unit
  const stepFront = model.firstRow - 0.5;
  const carpet = std({ map: carpetTex([hallW / 1.6, 1]), color: 0xb8b0c0 });
  const apron = new THREE.Mesh(new THREE.BoxGeometry(hallW, 0.1, stepFront - frontZ), carpet);
  apron.material = std({ map: carpetTex([hallW / 1.6, (stepFront - frontZ) / 1.6]), color: 0xb8b0c0 });
  apron.position.set(midX, -0.05, (stepFront + frontZ) / 2);
  apron.receiveShadow = true;
  root.add(apron);
  const nSteps = model.maxUnits + 1;
  for (let u = 0; u < nSteps; u++) {
    const h = 0.15 + u * c.rise;
    const depth = u === model.maxUnits ? backZ - (stepFront + u * c.rowPitch) : c.rowPitch;
    const step = new THREE.Mesh(new THREE.BoxGeometry(hallW, h, depth), carpet);
    step.position.set(midX, h / 2, stepFront + u * c.rowPitch + depth / 2);
    step.receiveShadow = true;
    root.add(step);
  }
  // LED nosing strips on the side-aisle steps
  const ledW = 0.9;
  const leds = new THREE.InstancedMesh(new THREE.BoxGeometry(ledW, 0.015, 0.03),
    new THREE.MeshBasicMaterial({ color: 0xffb45a }), nSteps * 2);
  const m = new THREE.Matrix4();
  for (let u = 0; u < nSteps; u++) {
    const y = 0.15 + u * c.rise + 0.008, z = stepFront + u * c.rowPitch + 0.02;
    m.makeTranslation(wallL + 0.1 + ledW / 2, y, z); leds.setMatrixAt(u * 2, m);
    m.makeTranslation(wallR - 0.1 - ledW / 2, y, z); leds.setMatrixAt(u * 2 + 1, m);
  }
  root.add(leds);

  // ---- shell. Walls face inward only, so the orbit camera can look in from outside.
  const depthZ = backZ - frontZ, zMid = (backZ + frontZ) / 2;
  const sideMat = () => std({ map: wallTex([depthZ / 2.6, 1]) });
  const wl = plane(depthZ, ceil, sideMat()); wl.rotation.y = Math.PI / 2; wl.position.set(wallL, ceil / 2, zMid);
  const wr = plane(depthZ, ceil, sideMat()); wr.rotation.y = -Math.PI / 2; wr.position.set(wallR, ceil / 2, zMid);
  const wb = plane(hallW, ceil, std({ map: wallTex([hallW / 2.6, 1]) })); wb.rotation.y = Math.PI; wb.position.set(midX, ceil / 2, backZ);
  const wf = plane(hallW, ceil, std({ color: 0x050506 })); wf.position.set(midX, ceil / 2, frontZ);
  const top = plane(hallW, depthZ, std({ color: 0x0c0c0f })); top.rotation.x = Math.PI / 2; top.position.set(midX, ceil, zMid);
  root.add(wl, wr, wb, wf, top);

  // pleated curtains either side of the screen, black masking around it
  const curtainZ = frontZ + 0.25;
  for (const [x0, x1] of [[wallL, -screen.w / 2 - 0.25], [screen.w / 2 + 0.25, wallR]]) {
    if (x1 - x0 < 0.2) continue;
    const cu = plane(x1 - x0, ceil, std({ map: curtainTex([(x1 - x0) / 1.4, 1]), roughness: 0.8 }));
    cu.position.set((x0 + x1) / 2, ceil / 2, curtainZ);
    root.add(cu);
  }
  const mask = plane(screen.w + 0.5, screen.h + 0.5, new THREE.MeshBasicMaterial({ color: 0x000000 }));
  mask.position.set(0, screen.cy, -0.03);
  root.add(mask);

  // exit signs near the front
  for (const side of [-1, 1]) {
    const ex = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.26), new THREE.MeshBasicMaterial({
      map: canvasTex(128, 48, (g, w, h) => {
        g.fillStyle = '#0b7a3b'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#eafff2'; g.font = '700 30px system-ui, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('EXIT', w / 2, h / 2 + 2);
      }),
    }));
    ex.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    ex.position.set(side < 0 ? wallL + 0.02 : wallR - 0.02, 2.4, 1.6);
    root.add(ex);
  }

  // ---- screen
  texGuide = guideTexture(c.aspect);
  texMovie = movieTexture(c.aspect);
  screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(screen.w, screen.h),
    new THREE.MeshBasicMaterial({ map: texGuide, toneMapped: false }));
  screenMesh.position.set(0, screen.cy, 0);
  root.add(screenMesh);
  spill.position.set(0, screen.cy, 0.4);
  spill.target.position.set(0, model.topFloor * 0.5, backZ * 0.65);
  fill.position.set(0, screen.cy, 1.8);

  // ---- seats
  const n = model.seats.length;
  const bodyW = Math.max(0.36, c.seatW - 0.09);
  chairs = new THREE.InstancedMesh(chairGeometry(bodyW), std({ map: fabricTex([3, 3]), roughness: 0.9 }), n);
  const plastic = std({ color: 0x141418, roughness: 0.55 });
  const bases = new THREE.InstancedMesh(new THREE.BoxGeometry(bodyW * 0.7, 0.37, 0.34), plastic, n);
  const arms = new THREE.InstancedMesh(new THREE.BoxGeometry(0.075, 0.3, 0.44), plastic, n * 2);
  model.seats.forEach((s, i) => {
    m.makeTranslation(s.X, s.floor, s.Z); chairs.setMatrixAt(i, m);
    m.makeTranslation(s.X, s.floor + 0.185, s.Z + 0.02); bases.setMatrixAt(i, m);
    m.makeTranslation(s.X - c.seatW / 2, s.floor + 0.52, s.Z - 0.03); arms.setMatrixAt(i * 2, m);
    m.makeTranslation(s.X + c.seatW / 2, s.floor + 0.52, s.Z - 0.03); arms.setMatrixAt(i * 2 + 1, m);
  });
  for (const o of [chairs, bases, arms]) { o.castShadow = true; o.receiveShadow = true; }
  root.add(chairs, bases, arms);

  // ---- audience on booked seats (realistic look only)
  // Each person: shoulders + torso, neck, skull, ears and one of several hair
  // styles, with small differences in height, lean and head turn.
  const taken = model.seats.filter((s) => s.status === 'sold');
  if (taken.length) {
    const N = taken.length;
    const inst = (geo, mat, count = N) => {
      const o = new THREE.InstancedMesh(geo, mat, count);
      o.castShadow = true; o.receiveShadow = true;
      realGroup.add(o);
      return o;
    };
    const unit = new THREE.SphereGeometry(1, 24, 18);
    const clothMat = std({ roughness: 1 });
    const skinMat = std({ roughness: 0.62 });
    const hairMat = std({ roughness: 0.86 }); // matte: glossy hair reads as a helmet
    const torsos = inst(new THREE.CapsuleGeometry(0.15, 0.3, 6, 14), clothMat);
    const shoulders = inst(unit, clothMat);
    const necks = inst(new THREE.CylinderGeometry(0.048, 0.056, 0.12, 14), skinMat);
    const skulls = inst(unit, skinMat);
    const ears = inst(unit, skinMat, N * 2);
    // hair cap: the top ~60% of a sphere, tipped back so it covers crown and nape
    const caps = inst(new THREE.SphereGeometry(1, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.6), hairMat);
    const drapes = inst(new THREE.CapsuleGeometry(0.1, 0.2, 6, 14), hairMat); // long hair over the neck
    const buns = inst(unit, hairMat);

    const cloth = [0x2b3a55, 0x4a2d2d, 0x2e4a3a, 0x55504a, 0x1f1f26, 0x5a3b5e, 0x6b5a2e, 0x7a7f8a, 0x8a3b2e, 0x30475e, 0xb9b3a6];
    const hair = [0x0d0b0a, 0x15100c, 0x21160e, 0x111114, 0x2e2015, 0x3b3b3f];
    const skin = [0xc68e68, 0xa8704c, 0x8a5a3c, 0xd9a47c, 0x6e4630, 0xb98058];
    const pickOf = (list, k, salt) => list[Math.floor(rnd(k, salt) * list.length)];

    const col = new THREE.Color();
    const pos = new THREE.Vector3(), off = new THREE.Vector3(), sc = new THREE.Vector3();
    const qHead = new THREE.Quaternion(), qBody = new THREE.Quaternion(), qPart = new THREE.Quaternion(), q = new THREE.Quaternion();
    const eul = new THREE.Euler();
    const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
    // place a part at `local` offset from the head centre, in the head's frame
    const put = (mesh, i, head, local, scale, partQ) => {
      off.copy(local).applyQuaternion(qHead);
      pos.copy(head).add(off);
      q.copy(qHead);
      if (partQ) q.multiply(partQ);
      m.compose(pos, q, scale);
      mesh.setMatrixAt(i, m);
    };
    const head = new THREE.Vector3(), L = new THREE.Vector3();

    taken.forEach((s, i) => {
      const k = s.index;
      const tall = (rnd(k, 31) - 0.5) * 0.13;       // sitting height
      const jx = (rnd(k, 32) - 0.5) * 0.07;         // off-centre in the seat
      const lean = (rnd(k, 33) - 0.5) * 0.16;       // body lean sideways
      const size = 0.95 + rnd(k, 37) * 0.12;        // head size
      const build = 0.9 + rnd(k, 38) * 0.22;        // shoulder width
      const style = rnd(k, 39);                     // <.5 short, <.78 long, <.9 bun, else bald

      // body
      qBody.setFromAxisAngle(UP_Z, lean);
      pos.set(s.X + jx, s.floor + 0.79 + tall * 0.4, s.Z + 0.03); sc.set(1.18 * build, 1, 0.78);
      m.compose(pos, qBody, sc); torsos.setMatrixAt(i, m);
      pos.set(s.X + jx - lean * 0.2, s.floor + 0.99 + tall * 0.7, s.Z + 0.035); sc.set(0.215 * build, 0.07, 0.115);
      m.compose(pos, qBody, sc); shoulders.setMatrixAt(i, m);
      pos.set(s.X + jx - lean * 0.28, s.floor + 1.06 + tall * 0.85, s.Z + 0.03); sc.set(size, 1, size);
      m.compose(pos, qBody, sc); necks.setMatrixAt(i, m);

      // head: turned and tilted a little, most people face the screen
      head.set(s.X + jx - lean * 0.36, s.floor + 1.185 + tall, s.Z + 0.015);
      eul.set((rnd(k, 41) - 0.6) * 0.22, (rnd(k, 42) - 0.5) * 0.5, lean * 0.6 + (rnd(k, 43) - 0.5) * 0.12, 'YXZ');
      qHead.setFromEuler(eul);
      put(skulls, i, head, L.set(0, 0, 0), sc.set(0.088 * size, 0.112 * size, 0.1 * size));
      put(ears, i * 2, head, L.set(-0.088 * size, -0.012, 0.004), sc.set(0.011, 0.03, 0.019).multiplyScalar(size));
      put(ears, i * 2 + 1, head, L.set(0.088 * size, -0.012, 0.004), sc.set(0.011, 0.03, 0.019).multiplyScalar(size));

      // hair
      const bald = style >= 0.9;
      const long = style >= 0.5 && style < 0.78;
      const bun = style >= 0.78 && style < 0.9;
      if (bald) caps.setMatrixAt(i, ZERO);
      else {
        // +Z is away from the screen, so tipping the cap about X pulls it down the back of the head
        qPart.setFromAxisAngle(UP_X, long || bun ? 0.62 : 0.5);
        const puff = (long ? 1.1 : bun ? 1.05 : 1.045 + rnd(k, 44) * 0.05) * size;
        put(caps, i, head, L.set(0, 0.004, 0.006), sc.set(0.088 * puff, 0.112 * puff, 0.1 * puff), qPart);
      }
      if (long) put(drapes, i, head, L.set(0, -0.14 * size, 0.05), sc.set(0.92 * size, 1 + rnd(k, 45) * 0.5, 0.62));
      else drapes.setMatrixAt(i, ZERO);
      if (bun) put(buns, i, head, L.set(0, 0.07 * size, 0.085 * size), sc.setScalar(0.042 * size));
      else buns.setMatrixAt(i, ZERO);

      const cc = pickOf(cloth, k, 34), hc = pickOf(hair, k, 35), skc = pickOf(skin, k, 36);
      torsos.setColorAt(i, col.setHex(cc)); shoulders.setColorAt(i, col);
      necks.setColorAt(i, col.setHex(skc)); skulls.setColorAt(i, col);
      ears.setColorAt(i * 2, col); ears.setColorAt(i * 2 + 1, col);
      caps.setColorAt(i, col.setHex(hc)); drapes.setColorAt(i, col); buns.setColorAt(i, col);
    });
  }

  // projector beam: faint additive pyramid from the booth to the screen corners
  const booth = new THREE.Vector3(0, Math.min(ceil - 0.5, model.topFloor + 2.6), backZ - 0.1);
  const hw = screen.w / 2, y0 = screen.bottom, y1 = screen.bottom + screen.h;
  const corners = [[-hw, y0], [hw, y0], [hw, y1], [-hw, y1]].map(([x, y]) => new THREE.Vector3(x, y, 0.05));
  const tri = [];
  for (let i = 0; i < 4; i++) tri.push(booth, corners[i], corners[(i + 1) % 4]);
  const beam = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints(tri), new THREE.MeshBasicMaterial({
    color: 0xffe2c4, transparent: true, opacity: 0.01, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  }));
  realGroup.add(beam);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.07, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
  lens.rotation.y = Math.PI; lens.position.copy(booth);
  realGroup.add(lens);

  // soft bloom around the lit screen
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(screen.w * 1.7, screen.h * 2.4), new THREE.MeshBasicMaterial({
    map: canvasTex(128, 128, (g, w, h) => {
      const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      r.addColorStop(0, 'rgba(255,190,140,.6)'); r.addColorStop(0.5, 'rgba(255,180,130,.22)'); r.addColorStop(1, 'rgba(255,170,120,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    }),
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.3,
  }));
  halo.position.set(0, screen.cy, -0.015); // behind the screen, so it only shows around it
  realGroup.add(halo);

  // ---- guide overlays: row letters at both ends of each row
  for (const r of model.rows) {
    for (const x of [r.seats[0].X - c.seatW * 0.5 - 0.5, r.seats[r.seats.length - 1].X + c.seatW * 0.5 + 0.5]) {
      const sp = labelSprite(r.label);
      sp.position.set(x, r.floor + 0.6, r.z);
      guideGroup.add(sp);
    }
  }

  // selection marker + sight line to screen centre
  marker = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.5, 4),
    new THREE.MeshBasicMaterial({ color: COLORS.selected, toneMapped: false }));
  marker.rotation.x = Math.PI;
  marker.visible = false;
  sightLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: COLORS.selected, transparent: true, opacity: 0.8, toneMapped: false }));
  sightLine.visible = false;
  root.add(marker, sightLine);

  // first-person body: thighs + shins of the person sitting in the chosen seat
  selfBody = new THREE.Group();
  const denim = std({ color: 0x27344d, roughness: 1 });
  for (const side of [-1, 1]) {
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, 0.36, 4, 10), denim);
    thigh.rotation.x = Math.PI / 2;
    thigh.position.set(side * 0.11, 0.57, -0.2);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.4, 4, 10), denim);
    shin.position.set(side * 0.11, 0.3, -0.43);
    selfBody.add(thigh, shin);
  }
  selfBody.visible = false;
  root.add(selfBody);

  applyLook();
}
const UP_Z = new THREE.Vector3(0, 0, 1);
const UP_X = new THREE.Vector3(1, 0, 0);

// Fetch the movie artwork (first URL that loads) and put it on the screen.
async function loadArt(urls) {
  const list = urls || [];
  const key = list.join('|');
  if (key === artKey) return;
  artKey = key;
  let bmp = null;
  for (const u of list) {
    try {
      const res = await fetch(u);
      if (!res.ok) continue;
      bmp = await createImageBitmap(await res.blob());
      if (bmp.width >= 200) break;
    } catch (_) { /* blocked or missing: try the next one */ }
  }
  if (key !== artKey) return; // a newer layout took over while loading
  artBitmap = bmp;
  // tint the light that spills off the screen with the artwork's average colour
  const tint = new THREE.Color(0xffd2ad);
  if (bmp) {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(bmp, 0, 0, 8, 8);
    const d = g.getImageData(0, 0, 8, 8).data;
    let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    const mx = Math.max(r, gg, b, 1);
    tint.setRGB(r / mx, gg / mx, b / mx, THREE.SRGBColorSpace).lerp(new THREE.Color(0xffffff), 0.4);
  }
  spill.color.copy(tint);
  fill.color.copy(tint);
  if (!root || !model) return;
  texMovie?.dispose();
  texMovie = movieTexture(model.cfg.aspect);
  applyLook();
}

// Switch between guide (status colours, test pattern, house lights) and
// realistic (upholstery, audience, film frame, dark hall).
function applyLook() {
  if (!root || !model) return;
  const g = isGuide();
  guideGroup.visible = g;
  realGroup.visible = !g;
  screenMesh.material.map = g ? texGuide : texMovie;
  screenMesh.material.needsUpdate = true;
  $('btnGuide').classList.toggle('on', g);
  $('legend').hidden = !g;
  paintSeats();
  placeMarker();
}

function paintSeats() {
  if (!chairs || !model) return;
  const g = isGuide();
  const col = new THREE.Color();
  model.seats.forEach((s, i) => {
    if (g) col.setHex(s.id === selectedId ? COLORS.selected : COLORS[s.status]);
    else col.setHex(0x8f1d27).multiplyScalar(0.85 + 0.3 * rnd(i, 40)); // worn red velvet
    chairs.setColorAt(i, col);
  });
  chairs.instanceColor.needsUpdate = true;
}

function placeMarker() {
  if (!marker || !model) return;
  const s = model.byId.get(selectedId);
  const show = !!s && mode === 'hall';
  marker.visible = show;
  sightLine.visible = show && isGuide();
  selfBody.visible = !!s && mode === 'seat';
  if (!s) return;
  selfBody.position.set(s.X, s.floor, s.Z);
  marker.position.set(s.X, s.floor + 1.75, s.Z);
  const e = eyeOf(model, s);
  sightLine.geometry.setFromPoints([
    new THREE.Vector3(e.x, e.y, e.z), new THREE.Vector3(0, model.screen.cy, 0.02)]);
}

// ---------------------------------------------------------------- camera
function resetCamera() {
  if (!model) return;
  const depth = model.backZ;
  orbit.target.set((model.wallL + model.wallR) / 2, model.topFloor * 0.4 + 1, depth * 0.45);
  orbit.theta = 0.5; orbit.phi = 0.95;
  // narrow (portrait) panels need the camera further back to fit the hall width
  const fit = Math.min(1, camera.aspect || 1);
  orbit.r = (Math.max(depth, model.wallR - model.wallL) * 1.05) / Math.max(0.55, fit);
  const s = model.byId.get(selectedId);
  if (s) {
    const e = eyeOf(model, s);
    look.yaw = 0; // seats face straight ahead – shows how off-centre the screen sits
    look.pitch = Math.atan2(model.screen.cy - e.y, e.z);
  }
  look.hfov = 95;
}

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function updateGoal() {
  if (!model) return;
  const s = model.byId.get(selectedId);
  if (mode === 'seat' && s) {
    const e = eyeOf(model, s);
    goalPos.set(e.x, e.y, e.z);
    const cp = Math.cos(look.pitch);
    _v.set(Math.sin(look.yaw) * cp, Math.sin(look.pitch), -Math.cos(look.yaw) * cp).add(goalPos);
    _m.lookAt(goalPos, _v, UP);
    const aspect = camera.aspect || 1;
    const v = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(look.hfov) / 2) / aspect);
    goalFov = Math.min(100, THREE.MathUtils.radToDeg(v));
  } else {
    const sp = Math.sin(orbit.phi);
    goalPos.set(sp * Math.sin(orbit.theta), Math.cos(orbit.phi), sp * Math.cos(orbit.theta))
      .multiplyScalar(orbit.r).add(orbit.target);
    _m.lookAt(goalPos, orbit.target, UP);
    goalFov = 50;
  }
  goalQuat.setFromRotationMatrix(_m);
}

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(canvas);

let lastT = 0;
function frame(t) {
  requestAnimationFrame(frame);
  // time-based easing: settles in ~0.4 s whatever the frame rate
  const dt = Math.min(1000, t - lastT);
  lastT = t;
  if (!model) return;
  updateGoal();
  const ease = (ms) => 1 - Math.exp(-dt / ms);
  const k = snap ? 1 : ease(110);
  snap = false;
  camera.position.lerp(goalPos, k);
  camera.quaternion.slerp(goalQuat, k);
  if (Math.abs(camera.fov - goalFov) > 0.01) {
    camera.fov += (goalFov - camera.fov) * k;
    camera.updateProjectionMatrix();
  }
  // ease lighting towards the current look; the film flickers a little
  const L = LIGHTS[isGuide() ? 'guide' : mode === 'hall' ? 'realHall' : 'real'];
  const flick = isGuide() ? 1 : 1 + 0.07 * Math.sin(t / 900) + 0.04 * Math.sin(t / 210) + 0.02 * Math.sin(t / 67);
  const kl = ease(180);
  houseAmb.intensity += (L.amb - houseAmb.intensity) * kl;
  houseDir.intensity += (L.dir - houseDir.intensity) * kl;
  spill.intensity += (L.spill * flick - spill.intensity) * kl;
  fill.intensity += (L.fill * flick - fill.intensity) * kl;
  if (marker?.visible) {
    const s = model.byId.get(selectedId);
    marker.position.y = s.floor + 1.75 + Math.sin(t / 300) * 0.08;
    marker.rotation.y = t / 600;
  }
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// ---------------------------------------------------------------- pointer input
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let drag = null;

function seatAt(ev) {
  if (!chairs) return null;
  const r = canvas.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(chairs, false)[0];
  return hit ? model.seats[hit.instanceId] : null;
}

canvas.addEventListener('pointerdown', (ev) => {
  canvas.setPointerCapture(ev.pointerId);
  drag = { x: ev.clientX, y: ev.clientY, moved: 0 };
  $('tip').hidden = true;
});
canvas.addEventListener('pointermove', (ev) => {
  if (drag) {
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    drag.x = ev.clientX; drag.y = ev.clientY;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    if (mode === 'seat') {
      const k = THREE.MathUtils.degToRad(look.hfov) / canvas.clientWidth;
      look.yaw = THREE.MathUtils.clamp(look.yaw - dx * k, -2.6, 2.6);
      look.pitch = THREE.MathUtils.clamp(look.pitch + dy * k, -1.2, 1.2);
    } else {
      orbit.theta -= dx * 0.008;
      orbit.phi = THREE.MathUtils.clamp(orbit.phi - dy * 0.008, 0.08, 1.52);
    }
    return;
  }
  const s = seatAt(ev);
  const tip = $('tip');
  if (!s) { tip.hidden = true; return; }
  const r = canvas.getBoundingClientRect();
  tip.textContent = `${s.row}${s.num}${s.price ? ' · ₹' + s.price : ''}${s.status === 'sold' ? ' · sold' : ''}`;
  tip.style.left = ev.clientX - r.left + 'px';
  tip.style.top = ev.clientY - r.top + 'px';
  tip.hidden = false;
});
canvas.addEventListener('pointerup', (ev) => {
  const wasClick = drag && drag.moved < 5;
  drag = null;
  if (wasClick) {
    const s = seatAt(ev);
    if (s) select(s.id);
  }
});
canvas.addEventListener('pointerleave', () => { $('tip').hidden = true; });
canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const f = Math.exp(ev.deltaY * 0.0012);
  if (mode === 'seat') look.hfov = THREE.MathUtils.clamp(look.hfov * f, 35, 125);
  else orbit.r = THREE.MathUtils.clamp(orbit.r * f, 3, 120);
}, { passive: false });

// ---------------------------------------------------------------- UI
function setMode(next) {
  if (next === 'seat' && !model?.byId.get(selectedId)) next = 'hall';
  mode = next;
  $('btnHall').classList.toggle('on', mode === 'hall');
  $('btnSeat').classList.toggle('on', mode === 'seat');
  applyLook();
}

function select(id) {
  if (!model || !model.byId.has(id)) return;
  if (id !== selectedId) prevId = selectedId;
  selectedId = id;
  const s = model.byId.get(id);
  const e = eyeOf(model, s);
  look.yaw = 0;
  look.pitch = Math.atan2(model.screen.cy - e.y, e.z);
  $('btnSeat').disabled = false;
  pref = 'seat';
  setMode('seat'); // sit in it: first-person view is the default answer to a click
  renderInfo();
}

const fmt = (v, d = 1) => v.toFixed(d);

function renderInfo() {
  const s = model?.byId.get(selectedId);
  const ring = $('score');
  if (!s) {
    ring.firstElementChild.textContent = '–';
    ring.style.setProperty('--p', 0);
    $('seatName').textContent = 'Pick a seat';
    $('verdict').textContent = 'Click any seat to sit in it.';
    $('metrics').innerHTML = '';
    renderGroup();
    return;
  }
  const mt = seatMetrics(model, s);
  const c = model.cfg;
  ring.firstElementChild.textContent = mt.score;
  ring.style.setProperty('--p', mt.score);
  ring.style.setProperty('--c', mt.score >= 85 ? '#22a35a' : mt.score >= 70 ? '#8bbf3a' : mt.score >= 50 ? '#e5a52a' : '#e5484d');
  $('seatName').textContent = `${s.row}${s.num}${s.price ? ' · ₹' + s.price : ''}${s.status === 'sold' ? ' · sold' : ''}`;
  const note = mt.notes.join(', ');
  $('verdict').textContent = `${mt.verdict} · ${note[0].toUpperCase()}${note.slice(1)}`;

  const side = mt.offset > 0 ? 'right' : 'left';
  const centred = Math.abs(mt.offset) < c.seatW * 0.6;
  const plural = (n) => `${n} seat${n === 1 ? '' : 's'}`;
  // [label, value, detail under the value]
  const items = [
    ['Distance to screen', `${fmt(mt.dist)} m`],
    ['From centre', centred ? 'Centred' : `${fmt(Math.abs(mt.offset))} m ${side}`,
      centred ? '' : `${plural(mt.offsetSeats)} · ${fmt(mt.offAxis, 0)}° off-axis`],
    ['Screen fills', `${fmt(mt.hAngle, 0)}°`,
      mt.hAngle >= 36 ? 'immersive' : mt.hAngle >= 30 ? 'comfortable' : 'looks small'],
    ['Neck tilt', `${fmt(Math.abs(mt.lookUp), 0)}° ${mt.lookUp >= 0 ? 'up' : 'down'}`],
    ['Row', `${mt.rowIndex} of ${mt.rowCount}`, 'from the screen'],
    ['Nearest aisle', mt.aisle.seats === 0 ? `On the ${mt.aisle.side}` : `${plural(mt.aisle.seats)} ${mt.aisle.side}`,
      mt.aisle.seats === 0 ? '' : `${fmt(mt.aisle.dist)} m`],
    ['Spacing', `${fmt(c.seatW, 2)} m seats`, `${fmt(c.rowPitch, 2)} m rows`],
  ];
  const p = model.byId.get(prevId);
  if (p && p !== s) items.push([`From ${p.row}${p.num}`, `${fmt(seatDistance(model, s, p))} m`]);

  $('metrics').innerHTML = '';
  for (const [k, v, sub] of items) {
    const d = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    if (sub) { const sm = document.createElement('small'); sm.textContent = sub; dd.append(sm); }
    d.append(dt, dd);
    $('metrics').append(d);
  }
  renderGroup();
}

// Seats currently selected on the booking page: one chip each, click to sit in it.
function renderGroup() {
  const box = $('group');
  const picked = model ? model.seats.filter((s) => s.status === 'picked') : [];
  box.hidden = !picked.length;
  box.innerHTML = '';
  if (!picked.length) return;
  const lab = document.createElement('span');
  lab.className = 'groupLabel';
  lab.textContent = picked.length === 1 ? 'Your seat' : `Your ${picked.length} seats`;
  box.append(lab);
  let sum = 0;
  for (const s of picked) {
    const sc = seatMetrics(model, s).score;
    sum += sc;
    const b = document.createElement('button');
    b.className = 'seatChip' + (s.id === selectedId ? ' on' : '');
    b.textContent = `${s.row}${s.num}`;
    b.title = `Score ${sc} – sit here`;
    b.onclick = () => select(s.id);
    box.append(b);
  }
  if (picked.length > 1) {
    const avg = document.createElement('span');
    avg.className = 'groupAvg';
    avg.textContent = `avg ${Math.round(sum / picked.length)}`;
    box.append(avg);
  }
}

function syncQty() {
  const fixed = !!model?.qtyFixed;
  if (fixed) want = model.qty;
  $('qty').textContent = want;
  $('qtyMinus').disabled = fixed || want <= 1;
  $('qtyPlus').disabled = fixed || want >= 10;
  $('qtyBox').title = fixed ? 'Ticket count is set on the booking page' : 'How many seats together';
  $('btnBest').textContent = want === 1 ? 'Find the best seat' : `Find the best ${want} together`;
}

function pickBest() {
  if (!model) return;
  const block = bestBlock(model, want);
  const note = $('pickNote');
  note.hidden = !!block;
  if (!block) { note.textContent = `No ${want} free seats side by side in this show.`; return; }
  // BookMyShow extends a selection towards the viewer's left, so lead with the right-most seat.
  sendPick(block.map((s) => s.id).reverse());
  let top = block[0], topScore = -1;
  for (const s of block) { const sc = seatMetrics(model, s).score; if (sc > topScore) { topScore = sc; top = s; } }
  select(top.id);
}

function syncCalib() {
  for (const k of ['seatW', 'rowPitch', 'rise', 'firstRow']) $(k).value = cfg[k];
  $('aspect').value = String(cfg.aspect);
  $('oSeatW').textContent = `${fmt(cfg.seatW, 2)} m`;
  $('oRowPitch').textContent = `${fmt(cfg.rowPitch, 2)} m`;
  $('oRise').textContent = `${fmt(cfg.rise * 100, 0)} cm`;
  $('oFirstRow').textContent = cfg.firstRow > 0 ? `${fmt(cfg.firstRow, 2)} m` : `auto${model ? ` (${fmt(model.firstRow)} m)` : ''}`;
}

function rebuild() {
  model = layout ? buildModel(layout, cfg) : null;
  const has = !!model;
  $('empty').hidden = has;
  $('info').hidden = !has;
  $('calib').hidden = !has;
  if (has) {
    $('title').textContent = model.title || '3D Seat View';
    $('sub').textContent = model.sub || `${model.seats.length} seats · ${model.rows.length} rows`;
    if (!model.byId.has(selectedId)) { selectedId = null; prevId = null; }
  } else {
    $('title').textContent = '3D Seat View';
    $('sub').textContent = 'Waiting for a seat layout…';
    selectedId = prevId = null;
  }
  buildScene(); // old scene is gone before anything repaints against the new model
  if (has && !selectedId) {
    // seat first: start in a seat – one already picked on the site, else the best free one
    const start = model.seats.find((s) => s.status === 'picked') || bestBlock(model, 1)?.[0] || model.seats[0];
    selectedId = start.id;
    const e = eyeOf(model, start);
    look.yaw = 0;
    look.pitch = Math.atan2(model.screen.cy - e.y, e.z);
  }
  $('btnSeat').disabled = !selectedId;
  setMode(has ? pref : 'hall');
  renderInfo();
  syncCalib();
  syncQty();
}

let lastKey = '';
function setLayout(l) {
  layout = l && l.seats && l.seats.length ? l : null;
  const key = layout ? layout.url.split('?')[0] : '';
  const fresh = key !== lastKey;
  lastKey = key;
  if (fresh) { selectedId = prevId = null; pref = 'seat'; want = Math.max(1, layout?.qty || 1); $('pickNote').hidden = true; }
  rebuild();
  if (fresh) { resetCamera(); snap = true; resize(); }
  loadArt(layout?.art).catch(report);
}

$('btnHall').onclick = () => { pref = 'hall'; setMode('hall'); };
$('btnSeat').onclick = () => { pref = 'seat'; setMode('seat'); };
$('errClose').onclick = () => { $('err').hidden = true; };
$('btnReset').onclick = () => resetCamera();
$('btnGuide').onclick = () => { guideOn[mode] = !guideOn[mode]; applyLook(); };
$('btnBest').onclick = pickBest;
$('qtyMinus').onclick = () => { want = Math.max(1, want - 1); syncQty(); };
$('qtyPlus').onclick = () => { want = Math.min(10, want + 1); syncQty(); };
for (const k of ['seatW', 'rowPitch', 'rise', 'firstRow']) {
  $(k).oninput = (e) => { cfg[k] = Number(e.target.value); saveCfg(); rebuild(); };
}
$('aspect').onchange = (e) => { cfg.aspect = Number(e.target.value); saveCfg(); rebuild(); };
$('btnDefaults').onclick = () => { cfg = { ...DEFAULTS }; saveCfg(); rebuild(); };
function saveCfg() { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (_) { /* private mode */ } }

// ---------------------------------------------------------------- data source
const inExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;

if (inExtension) {
  const request = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      await chrome.tabs.sendMessage(tab.id, { bms3d: true, type: 'request' });
    } catch (_) {
      safe(setLayout)(null); // not a booking tab, or page predates the extension
    }
  };
  chrome.runtime.onMessage.addListener(safe((msg, sender) => {
    if (!msg || !msg.bms3d) return;
    if (sender.tab && sender.tab.active === false) return;
    if (msg.type === 'layout') setLayout(msg.payload);
    else if (msg.type === 'seat') select(msg.payload.id);
  }));
  sendPick = async (ids) => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) await chrome.tabs.sendMessage(tab.id, { bms3d: true, type: 'pick', payload: { ids } });
    } catch (_) { /* page gone or needs a reload */ }
  };
  chrome.tabs.onActivated.addListener(request);
  chrome.tabs.onUpdated.addListener((_id, info) => { if (info.status === 'complete') request(); });
  rebuild();
  request();
} else {
  // Opened as a plain web page: run on bundled demo data.
  const { default: demo } = await import('./fixture.js');
  const q0 = new URLSearchParams(location.search);
  if (q0.get('sub')) demo.sub = q0.get('sub');
  if (q0.get('title')) demo.title = q0.get('title');
  if (q0.get('art') === '0') demo.art = []; // neutral painted screen, no movie artwork
  setLayout(demo);
  // no booking page here: apply the pick to the demo data instead
  sendPick = (ids) => {
    for (const s of layout.seats) { if (s.st === 9) s.st = 1; if (ids.includes(s.id)) s.st = 9; }
    setLayout(layout);
  };
  // demo-only URL switches, used to capture store screenshots:
  // ?pick=3&seat=Seat-H-9&mode=hall&guide=1&yaw=0.4&scroll=300&theme=dark
  const q = new URLSearchParams(location.search);
  if (q.get('theme')) document.documentElement.dataset.theme = q.get('theme');
  if (q.get('pick')) { want = Number(q.get('pick')); syncQty(); pickBest(); }
  if (q.get('seat')) select(q.get('seat'));
  if (q.get('mode') === 'hall') { pref = 'hall'; setMode('hall'); }
  if (q.has('guide')) { guideOn[mode] = q.get('guide') === '1'; applyLook(); }
  if (q.get('yaw')) look.yaw = Number(q.get('yaw'));
  snap = true;
  if (q.get('scroll')) setTimeout(() => scrollTo(0, Number(q.get('scroll'))), 400);
}

// Debug handle for the demo page and the simulator. Not present in the real extension.
if (!inExtension || chrome.runtime.id === 'sim') {
  window.__bms3d = { select, setMode, look, orbit, loadArt, setGuide(v) { guideOn[mode] = v; applyLook(); }, get model() { return model; }, get selected() { return selectedId; } };
}
