// Demo for the landing page: a booking-style seat map and a mock of the extension's side panel.
// The hall model below is a simple illustration, not the extension's own code.
(() => {
  const REPO = 'sunithvs/3d-seat-view';

  // ---- hall model -------------------------------------------------------
  const ROWS = 'ABCDEFGHIJKLM'.split(''); // A is nearest the screen
  const SEATS = 18;
  const GAPS = [4, 14]; // aisle after these seat numbers
  // price tier header shown above these row indexes (M, K, D)
  const TIER_AT = { 12: '₹350 Recliner', 10: '₹220 Prime', 3: '₹150 Classic' };
  const SCREEN_W = 12, SCREEN_H = 5, SCREEN_BOTTOM = 1.5;
  const SCREEN_MID = SCREEN_BOTTOM + SCREEN_H / 2;
  const FIRST_ROW = 4.5, ROW_STEP = 1.05, RISE = 0.3, EYE = 1.15, PITCH = 0.55, AISLE = 1.0;
  const HALL_HALF = 7.6;

  const seatX = (n) => {
    let x = (n - 1) * PITCH;
    for (const g of GAPS) if (n > g) x += AISLE;
    const last = (SEATS - 1) * PITCH + GAPS.length * AISLE;
    return x - last / 2;
  };
  const rowZ = (i) => FIRST_ROW + i * ROW_STEP;
  const rowFloor = (i) => i * RISE;

  function measure(ri, n) {
    const d = rowZ(ri), x = seatX(n), eye = EYE + rowFloor(ri);
    const dist = Math.hypot(d, x, SCREEN_MID - eye);
    const fill = (2 * Math.atan(SCREEN_W / 2 / d) * 180) / Math.PI;
    const tilt = (Math.atan((SCREEN_MID - eye) / d) * 180) / Math.PI;
    const offAng = (Math.atan(Math.abs(x) / d) * 180) / Math.PI;
    let s = 100;
    s -= Math.max(0, fill - 55) * 0.35 + Math.max(0, 36 - fill) * 0.8;
    s -= offAng;
    s -= Math.max(0, tilt - 10) * 0.8 + Math.max(0, -tilt - 6) * 0.8;
    return { d, x, eye, dist, fill, tilt, score: Math.round(Math.max(20, Math.min(99, s))) };
  }

  // ---- seat map ---------------------------------------------------------
  const map = document.getElementById('map');
  // deterministic "sold" pattern so the demo looks lived-in
  const sold = (ri, n) => {
    const h = Math.sin(ri * 12.9898 + n * 78.233) * 43758.5453;
    const r = h - Math.floor(h);
    const centre = Math.abs(n - 9.5) < 4 && ri > 5 && ri < 11;
    return r < (centre ? 0.42 : 0.16);
  };

  let selected = null;
  for (let ri = ROWS.length - 1; ri >= 0; ri--) {
    if (TIER_AT[ri]) {
      const el = document.createElement('div');
      el.className = 'tier';
      el.textContent = TIER_AT[ri];
      map.appendChild(el);
    }
    const row = document.createElement('div');
    row.className = 'row';
    const lab = document.createElement('span');
    lab.className = 'row-label';
    lab.textContent = ROWS[ri];
    row.appendChild(lab);
    for (let n = 1; n <= SEATS; n++) {
      const b = document.createElement('button');
      b.className = 'seat';
      b.type = 'button';
      b.textContent = n;
      b.dataset.r = ri;
      b.dataset.n = n;
      const isPick = (ROWS[ri] === 'J' && n === 5);
      if (sold(ri, n) && !isPick) {
        b.classList.add('sold');
        b.disabled = true;
        b.setAttribute('aria-label', `${ROWS[ri]}${n} sold`);
      } else {
        b.setAttribute('aria-label', `Seat ${ROWS[ri]}${n}`);
      }
      row.appendChild(b);
      if (GAPS.includes(n)) {
        const g = document.createElement('span');
        g.className = 'gap';
        row.appendChild(g);
      }
    }
    map.appendChild(row);
  }
  map.addEventListener('click', (e) => {
    const b = e.target.closest('.seat');
    if (!b || b.disabled) return;
    select(+b.dataset.r, +b.dataset.n);
  });

  // ---- panel ------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const fmt = (v, d = 1) => v.toFixed(d);

  function verdict(s) {
    if (s >= 88) return ['Great seat', 'var(--good)'];
    if (s >= 75) return ['Good seat', '#9be36d'];
    if (s >= 60) return ['Okay seat', 'var(--ok)'];
    return ['Not great', 'var(--bad)'];
  }

  function select(ri, n) {
    if (selected) selected.classList.remove('sel');
    selected = map.querySelector(`.seat[data-r="${ri}"][data-n="${n}"]`);
    selected.classList.add('sel');
    const m = measure(ri, n);
    const name = ROWS[ri] + n;
    const [v, c] = verdict(m.score);
    $('score').textContent = m.score;
    $('ring').style.setProperty('--p', m.score);
    $('ring').style.setProperty('--c', c);
    $('seat-name').textContent = name;
    $('verdict').textContent = v;
    $('view-tag').textContent = 'Seat ' + name;
    $('m-dist').textContent = fmt(m.dist) + ' m';
    $('m-off').textContent = Math.abs(m.x) < 0.15 ? 'Centre' : `${fmt(Math.abs(m.x))} m ${m.x < 0 ? 'left' : 'right'}`;
    $('m-fill').textContent = Math.round(m.fill) + '°';
    $('m-tilt').textContent = Math.abs(m.tilt) < 0.5 ? 'Level' : `${Math.round(Math.abs(m.tilt))}° ${m.tilt > 0 ? 'up' : 'down'}`;
    $('m-row').textContent = `${ROWS[ri]} · ${ri + 1} of ${ROWS.length} from screen`;
    target = { x: m.x, y: m.eye, z: m.d, ri, n };
    if (!cam) cam = { ...target };
    kick();
  }

  // ---- tiny 3D renderer -------------------------------------------------
  const canvas = $('view');
  const ctx = canvas.getContext('2d');
  let cam = null, target = null, raf = 0;

  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(320, Math.round(r.width * dpr));
    canvas.height = Math.round(canvas.width * 10 / 16);
    draw();
  }

  function kick() {
    if (!raf) raf = requestAnimationFrame(step);
  }
  function step() {
    raf = 0;
    let moving = false;
    for (const k of ['x', 'y', 'z']) {
      const dv = target[k] - cam[k];
      if (Math.abs(dv) > 0.002) { cam[k] += dv * 0.16; moving = true; } else cam[k] = target[k];
    }
    draw();
    if (moving) kick();
  }

  function draw() {
    if (!cam) return;
    const W = canvas.width, H = canvas.height;
    const look = { x: 0, y: SCREEN_MID - 0.3, z: 0 };
    // camera basis: viewer sits at +z looking toward the screen at z=0
    const f = norm({ x: look.x - cam.x, y: look.y - cam.y, z: look.z - cam.z });
    const r = norm(cross(f, { x: 0, y: 1, z: 0 }));
    const u = cross(r, f);
    const focal = (W / 2) / Math.tan((78 / 2) * Math.PI / 180);
    const P = (p) => {
      const v = { x: p.x - cam.x, y: p.y - cam.y, z: p.z - cam.z };
      const zc = dot(v, f);
      if (zc < 0.05) return null;
      return [W / 2 + (focal * dot(v, r)) / zc, H / 2 - (focal * dot(v, u)) / zc];
    };
    const poly = (pts, fill, stroke) => {
      const q = pts.map(P);
      if (q.some((p) => !p)) return;
      ctx.beginPath();
      q.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      if (fill) { ctx.fillStyle = fill; ctx.fill(); }
      if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = Math.max(1, W / 700); ctx.stroke(); }
    };

    ctx.fillStyle = '#07080b';
    ctx.fillRect(0, 0, W, H);

    const near = cam.z - 0.4, top = 9;
    // ceiling, walls, floor in front of the viewer
    poly([{ x: -HALL_HALF, y: top, z: 0 }, { x: HALL_HALF, y: top, z: 0 }, { x: HALL_HALF, y: top, z: near }, { x: -HALL_HALF, y: top, z: near }], '#0b0d12');
    poly([{ x: -HALL_HALF, y: 0, z: 0 }, { x: -HALL_HALF, y: top, z: 0 }, { x: -HALL_HALF, y: top, z: near }, { x: -HALL_HALF, y: rowFloor(target.ri), z: near }], '#15131c');
    poly([{ x: HALL_HALF, y: 0, z: 0 }, { x: HALL_HALF, y: top, z: 0 }, { x: HALL_HALF, y: top, z: near }, { x: HALL_HALF, y: rowFloor(target.ri), z: near }], '#15131c');
    poly([{ x: -HALL_HALF, y: 0, z: 0 }, { x: HALL_HALF, y: 0, z: 0 }, { x: HALL_HALF, y: top, z: 0 }, { x: -HALL_HALF, y: top, z: 0 }], '#0e0f15');
    poly([{ x: -HALL_HALF, y: 0, z: 0 }, { x: HALL_HALF, y: 0, z: 0 }, { x: HALL_HALF, y: 0, z: FIRST_ROW - 0.6 }, { x: -HALL_HALF, y: 0, z: FIRST_ROW - 0.6 }], '#1a1720');

    // screen with a soft glow
    const s0 = P({ x: -SCREEN_W / 2, y: SCREEN_BOTTOM + SCREEN_H, z: 0 });
    const s1 = P({ x: SCREEN_W / 2, y: SCREEN_BOTTOM, z: 0 });
    if (s0 && s1) {
      const g = ctx.createLinearGradient(s0[0], s0[1], s1[0], s1[1]);
      g.addColorStop(0, '#7fb2ff');
      g.addColorStop(0.55, '#ffcf8a');
      g.addColorStop(1, '#ff8a65');
      ctx.save();
      ctx.shadowColor = '#8fb8ffaa';
      ctx.shadowBlur = W / 14;
      poly([{ x: -SCREEN_W / 2, y: SCREEN_BOTTOM, z: 0 }, { x: SCREEN_W / 2, y: SCREEN_BOTTOM, z: 0 },
        { x: SCREEN_W / 2, y: SCREEN_BOTTOM + SCREEN_H, z: 0 }, { x: -SCREEN_W / 2, y: SCREEN_BOTTOM + SCREEN_H, z: 0 }], g);
      ctx.restore();
      // simple "scene" on screen: horizon and a planet
      poly([{ x: -SCREEN_W / 2, y: SCREEN_BOTTOM, z: -0.01 }, { x: SCREEN_W / 2, y: SCREEN_BOTTOM, z: -0.01 },
        { x: SCREEN_W / 2, y: SCREEN_BOTTOM + 1.3, z: -0.01 }, { x: -SCREEN_W / 2, y: SCREEN_BOTTOM + 1.0, z: -0.01 }], '#2b1e3acc');
      const c = P({ x: 2.3, y: SCREEN_BOTTOM + 3.3, z: 0 });
      const e = P({ x: 3.1, y: SCREEN_BOTTOM + 3.3, z: 0 });
      if (c && e) {
        ctx.beginPath();
        ctx.arc(c[0], c[1], Math.abs(e[0] - c[0]), 0, Math.PI * 2);
        ctx.fillStyle = '#fff3d6';
        ctx.fill();
      }
    }

    // stepped floor and seat rows in front of the viewer (far rows first)
    for (let ri = 0; ri < target.ri; ri++) {
      const z = rowZ(ri), fl = rowFloor(ri);
      poly([{ x: -HALL_HALF, y: fl, z: z - 0.6 }, { x: HALL_HALF, y: fl, z: z - 0.6 }, { x: HALL_HALF, y: fl, z: z + 0.45 }, { x: -HALL_HALF, y: fl, z: z + 0.45 }], ri % 2 ? '#1b1822' : '#1e1a26');
      poly([{ x: -HALL_HALF, y: fl, z: z + 0.45 }, { x: HALL_HALF, y: fl, z: z + 0.45 }, { x: HALL_HALF, y: fl + RISE, z: z + 0.45 }, { x: -HALL_HALF, y: fl + RISE, z: z + 0.45 }], '#2a2433');
      const shade = 0.55 + 0.45 * (ri / ROWS.length);
      const seatCol = `rgb(${Math.round(150 * shade)},${Math.round(48 * shade)},${Math.round(58 * shade)})`;
      const topCol = `rgb(${Math.round(185 * shade)},${Math.round(70 * shade)},${Math.round(78 * shade)})`;
      // draw seats from outside in so nearer-to-centre ones overlap correctly
      const order = [...Array(SEATS).keys()].map((i) => i + 1).sort((a, b) => Math.abs(seatX(b) - cam.x) - Math.abs(seatX(a) - cam.x));
      for (const n of order) {
        const x = seatX(n), w = 0.24;
        poly([{ x: x - w, y: fl + 0.42, z: z + 0.1 }, { x: x + w, y: fl + 0.42, z: z + 0.1 }, { x: x + w, y: fl + 1.02, z: z + 0.22 }, { x: x - w, y: fl + 1.02, z: z + 0.22 }], seatCol);
        poly([{ x: x - w, y: fl + 1.02, z: z + 0.22 }, { x: x + w, y: fl + 1.02, z: z + 0.22 }, { x: x + w, y: fl + 1.02, z: z + 0.32 }, { x: x - w, y: fl + 1.02, z: z + 0.32 }], topCol);
      }
    }

    // vignette
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75);
    vg.addColorStop(0, '#0000');
    vg.addColorStop(1, '#000a');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const norm = (a) => { const l = Math.hypot(a.x, a.y, a.z) || 1; return { x: a.x / l, y: a.y / l, z: a.z / l }; };

  select(ROWS.indexOf('J'), 5);
  resize();
  window.addEventListener('resize', resize);

  // ---- release + stars --------------------------------------------------
  const setRelease = (tag, url) => {
    if (!tag) return;
    $('release-text').textContent = `Latest version ${tag}`;
    if (url) $('release-link').href = url;
  };
  fetch('release.json', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : {}))
    .then((j) => setRelease(j.tag, j.url))
    .catch(() => {});
  fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => j && setRelease(j.tag_name, j.html_url))
    .catch(() => {});
  fetch(`https://api.github.com/repos/${REPO}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      if (!j || typeof j.stargazers_count !== 'number') return;
      const el = document.querySelector('.star-count');
      el.textContent = j.stargazers_count.toLocaleString();
      el.hidden = false;
    })
    .catch(() => {});
})();
