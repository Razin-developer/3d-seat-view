import layout from './demo/fixture.js';

// Paste the Chrome Web Store listing address here once the extension is published.
const STORE_URL = '';

// Waitlist API (Cloudflare Worker + D1, see /waitlist in the project).
const WAITLIST_API = 'https://seatview-waitlist.sunithvs2002.workers.dev';

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
  const x0 = Math.min(...xs) - 34, x1 = Math.max(...xs) + 16, y0 = Math.min(...ys) - 50, y1 = Math.max(...ys) + 74;
  mapSvg.setAttribute('viewBox', `${x0} ${y0} ${x1 - x0} ${y1 - y0}`);
  const add = (tag, attrs, text) => {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (text) el.textContent = text;
    mapSvg.append(el);
    return el;
  };
  const kind = { 1: 'a', 2: 's', 4: 'b', 9: 'p' };
  // price bands sit in the gaps between seat blocks, like a real booking page
  const midX = (x0 + x1) / 2 + 9;
  const BANDS = ['PREMIUM XL', 'PREMIUM', 'EXECUTIVE', 'NORMAL'];
  (layout.headers || []).forEach((hd, i) => {
    const price = (seats.find((s) => s.y > hd.y) || {}).price;
    add('text', { class: 'band', x: midX, y: hd.y + 14, 'text-anchor': 'middle' }, `${BANDS[i] || 'SEATS'} · ₹${price}`);
    add('line', { class: 'rule', x1: x0 + 26, x2: x1 - 8, y1: hd.y + 23, y2: hd.y + 23 });
  });
  const rects = new Map();
  const rowsDone = new Set();
  for (const s of seats) {
    if (!rowsDone.has(s.row)) { rowsDone.add(s.row); add('text', { x: x0 + 6, y: s.y + 4 }, s.row); }
    const r = add('rect', {
      x: s.x - 10, y: s.y - 10, width: 20, height: 20, rx: 5, 'stroke-width': 1.5,
      class: kind[s.st] || 'a', tabindex: 0, role: 'button', 'aria-label': `Row ${s.row} seat ${s.num}`,
    });
    const tip = document.createElementNS(NS, 'title'); tip.textContent = `${s.row}${s.num} · ₹${s.price}`; r.append(tip);
    const go = () => pick(s.id);
    r.addEventListener('click', go);
    r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
    rects.set(s.id, r);
  }
  // curved screen with a soft glow under it
  const sy = y1 - 40;
  add('path', { class: 'glow', d: `M${midX - 150} ${sy} Q${midX} ${sy - 16} ${midX + 150} ${sy} L${midX + 176} ${sy + 34} L${midX - 176} ${sy + 34} Z` });
  add('path', { class: 'scr', d: `M${midX - 150} ${sy} Q${midX} ${sy - 16} ${midX + 150} ${sy}` });
  add('text', { class: 'scrText', x: midX, y: sy + 22, 'text-anchor': 'middle' }, 'SCREEN THIS WAY');

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
    // footer of the mock booking page follows the selection
    const mine = a.model.seats.filter((s) => s.status === 'picked');
    const total = mine.reduce((n, s) => n + Number(s.price || 0), 0);
    document.getElementById('mapPicked').textContent = mine.length ? `${mine.length} seat${mine.length === 1 ? '' : 's'} · ${mine.map((s) => s.row + s.num).join(', ')}` : 'Pick a seat';
    document.getElementById('mapPay').textContent = mine.length ? `Pay ₹${total.toLocaleString('en-IN')}` : 'Pay';
    document.getElementById('mapTix').textContent = `${Math.max(1, mine.length)} Ticket${mine.length > 1 ? 's' : ''}`;
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

// ---- mobile waitlist (hero form and the full form further down share this)
for (const wl of document.querySelectorAll('[data-waitlist]')) {
  const msg = wl.querySelector('.waitMsg'), input = wl.querySelector('input[type=email]'), btn = wl.querySelector('button');
  const say = (text, kind) => { msg.textContent = text; msg.dataset.kind = kind || ''; };
  input.addEventListener('input', () => say(''));
  wl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = input.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { say('Enter a valid email address.', 'err'); input.focus(); return; }
    btn.disabled = true; say('Adding you…');
    try {
      const res = await fetch(WAITLIST_API + '/join', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, platform: wl.platform ? wl.platform.value : '', website: wl.website.value }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
      // one signup covers both forms
      for (const f of document.querySelectorAll('[data-waitlist]')) {
        f.classList.add('done');
        const m = f.querySelector('.waitMsg');
        m.textContent = f === wl || f.id === 'waitlist' ? 'You are on the list. We will email you once when the mobile version is ready.' : '';
        m.dataset.kind = 'ok';
      }
    } catch (err) {
      say(err instanceof TypeError ? 'Could not reach the server. Check your connection and try again.' : err.message, 'err');
    } finally { btn.disabled = false; }
  });
}

// ---- explainer video: swap the poster for the YouTube player on click
for (const b of document.querySelectorAll('[data-yt]')) {
  b.addEventListener('click', () => {
    const f = document.createElement('iframe');
    f.src = `https://www.youtube-nocookie.com/embed/${b.dataset.yt}?autoplay=1&rel=0`;
    f.title = '3D Seat View explainer video';
    f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    f.allowFullscreen = true;
    b.replaceWith(f);
  });
}
