// Turns BookMyShow's flat seat map (pixels) into an approximate physical hall
// (metres) and computes per-seat viewing metrics. BookMyShow publishes no real
// dimensions, so everything is derived from typical multiplex geometry and is
// tunable via the config.

export const DEFAULTS = {
  seatW: 0.56,      // seat centre-to-centre, m
  rowPitch: 1.05,   // row front-to-back, m
  rise: 0.3,        // stadium step per row, m
  eye: 1.15,        // seated eye height above row floor, m
  firstRow: 0,      // front row to screen, m (0 = auto from screen width)
  aspect: 2.39,     // screen aspect ratio
  screenFrac: 0.85, // screen width as fraction of seating width
};

const HEADER_PX = 64;     // fallback vertical space a category header takes on the map
const SCREEN_BOTTOM = 1.4; // screen bottom edge above front floor, m
const SIDE_AISLE = 1.2;    // wall clearance beside outermost seat, m

const STATUS = { 1: 'available', 2: 'sold', 4: 'best', 9: 'picked' }; // 9 = in the user's BMS selection

function mode(values) {
  const c = new Map();
  let best = null, bestN = 0;
  for (const v of values) {
    const n = (c.get(v) || 0) + 1;
    c.set(v, n);
    if (n > bestN) { bestN = n; best = v; }
  }
  return best;
}

export function buildModel(layout, cfg = DEFAULTS) {
  // ---- group into rows
  const rowMap = new Map();
  for (const s of layout.seats) {
    const k = s.row + '@' + s.y;
    if (!rowMap.has(k)) rowMap.set(k, { label: s.row, y: s.y, seats: [] });
    rowMap.get(k).seats.push(s);
  }
  const rows = [...rowMap.values()];
  rows.forEach((r) => r.seats.sort((a, b) => a.x - b.x));

  // ---- pixel pitches
  const dxs = [];
  rows.forEach((r) => { for (let i = 1; i < r.seats.length; i++) dxs.push(r.seats[i].x - r.seats[i - 1].x); });
  const seatPx = mode(dxs.filter((d) => d > 2)) || 28;
  const ys = [...new Set(rows.map((r) => r.y))].sort((a, b) => a - b);
  const dys = [];
  for (let i = 1; i < ys.length; i++) dys.push(ys[i] - ys[i - 1]);
  const rowPx = dys.length ? Math.min(...dys.filter((d) => d > 4)) : 27;

  // ---- orientation: which side of the map is the screen
  const allX = layout.seats.map((s) => s.x);
  const minPx = Math.min(...allX), maxPx = Math.max(...allX);
  const midY = (ys[0] + ys[ys.length - 1]) / 2;
  const screenBelow = layout.screen ? layout.screen.y > midY : true;
  const cx = layout.screen ? layout.screen.x : (minPx + maxPx) / 2;

  // front row first
  rows.sort((a, b) => (screenBelow ? b.y - a.y : a.y - b.y));

  // ---- depth in "row units" (empty grid rows = walkways)
  const headers = layout.headers || [];
  let units = 0;
  rows.forEach((r, i) => {
    if (i > 0) {
      const p = rows[i - 1];
      const lo = Math.min(p.y, r.y), hi = Math.max(p.y, r.y);
      const headPx = headers.filter((h) => h.y > lo && h.y < hi).reduce((a, h) => a + (h.h || HEADER_PX), 0);
      units += Math.max(1, Math.round((hi - lo - headPx) / rowPx));
    }
    r.units = units;
    r.index = i;
  });

  // ---- metres
  // Viewer faces the screen, so their right-hand side is mirrored vs the map.
  const sign = screenBelow ? -1 : 1;
  const toX = (px) => (sign * (px - cx)) / seatPx * cfg.seatW;
  const xA = toX(minPx), xB = toX(maxPx);
  const minX = Math.min(xA, xB), maxX = Math.max(xA, xB);
  const wallL = minX - cfg.seatW / 2 - SIDE_AISLE;
  const wallR = maxX + cfg.seatW / 2 + SIDE_AISLE;

  let screenW = cfg.screenFrac * (maxX - minX + cfg.seatW);
  screenW = Math.max(4, Math.min(screenW, 2 * Math.min(-wallL, wallR) - 0.6));
  const screenH = screenW / cfg.aspect;
  const firstRow = cfg.firstRow > 0 ? cfg.firstRow : Math.max(3.5, 0.45 * screenW);

  const seats = [];
  const byId = new Map();
  for (const r of rows) {
    r.z = firstRow + r.units * cfg.rowPitch;
    r.floor = 0.15 + r.units * cfg.rise;
    const raw = r.seats.sort((a, b) => toX(a.x) - toX(b.x)); // viewer's left -> right
    r.seats = [];
    raw.forEach((s, i) => {
      const seat = {
        id: s.id, row: r.label, num: s.num, price: s.price, type: s.type,
        status: STATUS[s.st] || 'sold',
        X: toX(s.x), Z: r.z, floor: r.floor,
        rowRef: r, col: i, index: seats.length,
      };
      r.seats.push(seat);
      seats.push(seat);
      byId.set(seat.id, seat);
    });
  }

  const last = rows[rows.length - 1];
  return {
    cfg, rows, seats, byId, seatPx, rowPx,
    wallL, wallR,
    backZ: last.z + 1.6,
    topFloor: last.floor,
    maxUnits: last.units,
    firstRow,
    screen: { w: screenW, h: screenH, bottom: SCREEN_BOTTOM, cy: SCREEN_BOTTOM + screenH / 2 },
    title: layout.title || '', sub: layout.sub || '',
    site: layout.site || '', qty: Math.max(1, layout.qty || 1), qtyFixed: !!layout.qtyFixed,
  };
}

export function eyeOf(model, seat) {
  return { x: seat.X, y: seat.floor + model.cfg.eye, z: seat.Z };
}

const deg = (r) => (r * 180) / Math.PI;
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export function seatMetrics(model, seat) {
  const { screen, cfg } = model;
  const e = eyeOf(model, seat);
  const dy = screen.cy - e.y;
  const dist = Math.hypot(e.x, dy, e.z);

  // angle the screen width subtends at the eye
  const a1 = Math.atan2(-screen.w / 2 - e.x, e.z);
  const a2 = Math.atan2(screen.w / 2 - e.x, e.z);
  const hAngle = deg(a2 - a1);

  const ground = Math.hypot(e.x, e.z);
  const lookUp = deg(Math.atan2(dy, ground));                          // to screen centre
  const lookTop = deg(Math.atan2(screen.bottom + screen.h - e.y, e.z)); // to top edge
  const offAxis = deg(Math.atan2(Math.abs(e.x), e.z));

  const offset = e.x; // + = viewer's right of screen centre
  const offsetSeats = Math.round(Math.abs(offset) / cfg.seatW);

  // nearest gap / row end on each side
  const row = seat.rowRef.seats;
  const gap = cfg.seatW * 1.5;
  let l = 0, r = 0;
  for (let i = seat.col; i > 0 && row[i].X - row[i - 1].X < gap; i--) l++;
  for (let i = seat.col; i < row.length - 1 && row[i + 1].X - row[i].X < gap; i++) r++;
  const aisle = l <= r ? { side: 'left', seats: l } : { side: 'right', seats: r };
  aisle.dist = (aisle.seats + 0.5) * cfg.seatW;

  // score: screen fill, centring, neck angle
  const sFill = hAngle < 36 ? clamp01((hAngle - 18) / 18) : hAngle <= 55 ? 1 : clamp01(1 - (hAngle - 55) / 35);
  const sAxis = clamp01(1 - offAxis / 35);
  const sNeck = lookUp <= 8 ? 1 : clamp01(1 - (lookUp - 8) / 27);
  const score = Math.round(100 * (0.4 * sFill + 0.35 * sAxis + 0.25 * sNeck));

  const notes = [];
  if (hAngle > 60) notes.push('very close – screen overflows your view');
  else if (hAngle < 30) notes.push('far back – screen looks small');
  if (lookUp > 20) notes.push('neck tilts up a lot');
  if (offAxis > 22) notes.push('noticeably off to the side');
  if (!notes.length) notes.push(score >= 85 ? 'sweet spot' : 'comfortable view');

  return {
    dist, ground, hAngle, lookUp, lookTop, offAxis, offset, offsetSeats, aisle,
    rowIndex: seat.rowRef.index + 1, rowCount: model.rows.length,
    score, notes,
    verdict: score >= 85 ? 'Excellent' : score >= 70 ? 'Good' : score >= 50 ? 'Okay' : 'Poor',
  };
}

export function seatDistance(model, a, b) {
  const ea = eyeOf(model, a), eb = eyeOf(model, b);
  return Math.hypot(ea.x - eb.x, ea.y - eb.y, ea.z - eb.z);
}

// Best run of `n` side-by-side seats that can still be booked (no gap or sold
// seat between them), ranked by average score, then by the weakest seat.
// Returned left-to-right as the viewer sees them; null if no such run exists.
export function bestBlock(model, n = 1) {
  const gap = model.cfg.seatW * 1.5;
  let best = null, bestAvg = -1, bestMin = -1;
  for (const row of model.rows) {
    const scores = row.seats.map((s) => (s.status === 'sold' ? -1 : seatMetrics(model, s).score));
    for (let i = 0; i + n <= row.seats.length; i++) {
      let ok = true, sum = 0, min = 101;
      for (let j = i; j < i + n; j++) {
        if (scores[j] < 0 || (j > i && row.seats[j].X - row.seats[j - 1].X > gap)) { ok = false; break; }
        sum += scores[j]; min = Math.min(min, scores[j]);
      }
      if (!ok) continue;
      const avg = sum / n;
      if (avg > bestAvg || (avg === bestAvg && min > bestMin)) {
        bestAvg = avg; bestMin = min; best = row.seats.slice(i, i + n);
      }
    }
  }
  return best;
}
