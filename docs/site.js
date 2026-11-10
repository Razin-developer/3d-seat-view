import layout from './demo/fixture.js';

// Paste the Chrome Web Store listing address here once the extension is published.
const STORE_URL = '';

// Live demo: the real extension panel running on sample data, with a neutral screen.
const DEMO_URL = 'demo/panel.html?theme=dark&art=0&pick=3'
  + '&title=' + encodeURIComponent('Friday Premiere (3D)')
  + '&sub=' + encodeURIComponent('Screen 2 | Fri, 13 Nov | 7:30 PM');

const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- install buttons: the store once it is listed, the install guide until then
if (STORE_URL) {
  for (const a of document.querySelectorAll('[data-store]')) {
    a.href = STORE_URL; a.target = '_blank'; a.rel = 'noopener';
    const label = a.querySelector('span');
    if (label && a.dataset.storeLabel) label.textContent = a.dataset.storeLabel;
  }
  document.querySelector('[data-soon-note]')?.remove();
}

// ---- starbursts: n-pointed stars drawn from data-burst="points,outer,inner"
for (const svg of document.querySelectorAll('[data-burst]')) {
  const [n, r1, r2] = svg.dataset.burst.split(',').map(Number);
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r2 : r1, a = (i * Math.PI) / n - Math.PI / 2;
    pts.push((r * Math.cos(a)).toFixed(1) + ',' + (r * Math.sin(a)).toFixed(1));
  }
  svg.innerHTML = `<polygon points="${pts.join(' ')}"/>`;
}

// ---- reveal sections as they enter the viewport
// The hero shows straight away; the rest is watched by IntersectionObserver,
// with a plain scroll check as a safety net so content can never stay hidden.
const pending = new Set(document.querySelectorAll('.reveal'));
function show(el) {
  if (!pending.delete(el)) return;
  el.classList.add('in');
  el.querySelectorAll('[data-count]').forEach(countUp);
}
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { show(e.target); seen.unobserve(e.target); }
}, { threshold: 0.18 });
pending.forEach((el) => seen.observe(el));
function sweep() {
  for (const el of [...pending]) {
    const r = el.getBoundingClientRect();
    if (r.top < innerHeight * 0.85 && r.bottom > 0) show(el);
  }
}
setTimeout(() => show(document.querySelector('.hero')), 80);
addEventListener('scroll', sweep, { passive: true });
addEventListener('load', sweep);
setTimeout(sweep, 1200);

function countUp(el) {
  const to = Number(el.dataset.count);
  if (still) { el.textContent = to; return; }
  const t0 = performance.now() + 500, dur = 1400;
  const step = (t) => {
    const k = Math.min(1, Math.max(0, (t - t0) / dur));
    el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---- panels in the About tile straighten up as the section scrolls through
const tilts = [...document.querySelectorAll('[data-tilt]')].map((el) => {
  const [from, to] = el.dataset.tilt.split(',').map(Number);
  return { el, from, to };
});
let ticking = false;
function onScroll() {
  ticking = false;
  for (const t of tilts) {
    const r = t.el.parentElement.getBoundingClientRect();
    const k = Math.min(1, Math.max(0, 1 - (r.top + r.height * 0.35) / innerHeight));
    const deg = t.from + (t.to - t.from) * k;
    t.el.style.transform = `translateY(${(1 - k) * 34}px) rotate(${deg.toFixed(2)}deg)`;
  }
}
if (!still && tilts.length) {
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  onScroll();
}

// ---- feature carousel arrows
const track = document.querySelector('.track');
const prev = document.querySelector('[data-prev]'), next = document.querySelector('[data-next]');
if (track && prev && next) {
  const stepBy = (dir) => {
    const card = track.querySelector('article');
    track.scrollBy({ left: dir * (card.offsetWidth + 18), behavior: still ? 'auto' : 'smooth' });
  };
  prev.onclick = () => stepBy(-1);
  next.onclick = () => stepBy(1);
  const sync = () => {
    const end = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
    prev.classList.toggle('on', track.scrollLeft > 4);
    next.classList.toggle('on', !end);
  };
  track.addEventListener('scroll', sync, { passive: true });
  sync();
}

// ---- live demo dialog (the iframe loads only when opened)
const dlg = document.getElementById('demo');
if (dlg) {
  const frame = dlg.querySelector('iframe');
  for (const b of document.querySelectorAll('[data-demo]')) {
    b.addEventListener('click', () => {
      if (!frame.src) frame.src = DEMO_URL;
      dlg.showModal();
    });
  }
  dlg.querySelector('[data-close]').onclick = () => dlg.close();
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
}

// ---- interactive hero (desktop only): our own seat map drives the real 3D panel
const mapSvg = document.getElementById('seatMap');
const heroFrame = document.getElementById('heroDemo');
if (mapSvg && heroFrame && matchMedia('(min-width: 921px)').matches) {
  const NS = 'http://www.w3.org/2000/svg';
  const seats = layout.seats;
  const xs = seats.map((s) => s.x), ys = seats.map((s) => s.y);
  const x0 = Math.min(...xs) - 34, x1 = Math.max(...xs) + 16, y0 = Math.min(...ys) - 16, y1 = Math.max(...ys) + 52;
  mapSvg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
  const add = (tag, attrs, text) => {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (text) el.textContent = text;
    mapSvg.append(el);
    return el;
  };
  const kind = { 1: 'a', 2: 's', 4: 'b', 9: 'p' };
  const rects = new Map();
  const rowsDone = new Set();
  for (const s of seats) {
    if (!rowsDone.has(s.row)) { rowsDone.add(s.row); add('text', { x: x0 + 6, y: s.y + 3 }, s.row); }
    const r = add('rect', {
      x: s.x - 10, y: s.y - 10, width: 20, height: 20, rx: 5, 'stroke-width': 1.5,
      class: kind[s.st] || 'a', tabindex: 0, role: 'button', 'aria-label': `Row ${s.row} seat ${s.num}`,
    });
    const go = () => pick(s.id);
    r.addEventListener('click', go);
    r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    rects.set(s.id, r);
  }
  const mid = (x0 + x1) / 2;
  add('rect', { class: 'scr', x: mid - 150, y: y1 - 26, width: 300, height: 6, rx: 3 });
  add('text', { x: mid, y: y1 - 6, 'text-anchor': 'middle' }, 'Screen this way');

  const api = () => { try { return heroFrame.contentWindow.__bms3d; } catch (_) { return null; } };
  let current = '';
  function paint() {
    const a = api();
    if (!a || !a.model) return;
    heroFrame.classList.add('ready');
    for (const s of a.model.seats) {
      const r = rects.get(s.id);
      if (!r) continue;
      r.setAttribute('class', (s.status === 'picked' ? 'p' : s.status === 'sold' ? 's' : s.status === 'best' ? 'b' : 'a')
        + (s.id === a.selected ? ' on' : ''));
    }
    current = a.selected;
  }
  function pick(id) {
    const a = api();
    if (!a) return;
    a.select(id);
    document.querySelector('.hint')?.remove();
    paint();
  }
  // load the panel once the page itself has settled, then keep the map in step with it
  const start = () => { heroFrame.src = DEMO_URL; setInterval(paint, 500); };
  if (document.readyState === 'complete') setTimeout(start, 600);
  else addEventListener('load', () => setTimeout(start, 600));
}
