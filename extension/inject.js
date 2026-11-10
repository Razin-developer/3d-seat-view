// Runs in the page's MAIN world on BookMyShow and District seat-layout pages.
// Reads the seat map into a common layout shape, reports seat clicks, and can
// click seats on request from the side panel. One adapter per site.
(() => {
  if (window.__bms3dInjected) return;
  window.__bms3dInjected = true;

  const post = (type, payload) =>
    window.postMessage({ source: 'bms3d-page', type, payload }, location.origin);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pageLines = () => {
    const lines = document.body.innerText.split('\n').map((s) => s.trim()).filter(Boolean);
    const i0 = /skip to main/i.test(lines[0] || '') ? 1 : 0;
    return { title: lines[i0] || '', sub: lines[i0 + 1] || '' };
  };

  let quiet = false; // true while we click seats ourselves: don't echo them as user clicks

  // ------------------------------------------------------------ BookMyShow
  // The map is a Konva canvas; every seat is a Konva Group with a `seatObj`.
  const bms = {
    name: 'bookmyshow',
    groupPick: true, // one click selects the whole ticket count
    isSeat: (n) => !!(n && n.attrs && n.attrs.seatObj),
    idOf: (n) => n.attrs.seatObj.seatId || n.id(),

    find() {
      const K = window.Konva;
      if (!K || !K.stages) return null;
      for (const st of K.stages) {
        try { if (st.findOne(bms.isSeat)) return st; } catch (_) { /* ignore */ }
      }
      return null;
    },

    extract(stage) {
      const seatNodes = stage.find(bms.isSeat);
      if (!seatNodes.length) return null;
      const layer = seatNodes[0].getLayer();
      // A picked seat is re-rendered as a group plus children that each carry
      // seatObj (without a seatStatus) – collapse those to one entry.
      const seen = new Map();
      for (const g of seatNodes) {
        const id = bms.idOf(g);
        const picked = ![1, 2, 4].includes(Number(g.attrs.seatObj.seatStatus));
        const prev = seen.get(id);
        if (!prev) seen.set(id, { g, picked });
        else if (picked) prev.picked = true;
      }
      const seats = [...seen.values()].map(({ g, picked }) => {
        const o = g.attrs.seatObj;
        const r = g.getClientRect({ relativeTo: layer });
        return {
          id: bms.idOf(g),
          row: String(o.rowNumber ?? ''),
          num: String(o.displaySeatNumber ?? o.cinemaSeatNumber ?? o.seatNumber ?? '').replace(/^0+(?=\d)/, ''),
          x: Math.round(r.x + r.width / 2),
          y: Math.round(r.y + r.height / 2),
          st: picked ? 9 : Number(o.seatStatus),
          price: o.curPrice || '',
        };
      });

      // Category headers ("₹350 PREMIUM") take vertical space that is not real floor.
      const headers = [];
      let screen = null;
      const inSeat = (n) => bms.isSeat(n.getParent()) || bms.isSeat(n.getParent()?.getParent());
      for (const n of layer.find('Text')) {
        if (inSeat(n)) continue;
        if (/[₹]|rs\.?\s*\d/i.test(String(n.attrs.text || ''))) headers.push({ y: Math.round(n.attrs.y || 0), h: 64 });
      }
      for (const n of layer.find('Image')) {
        if (inSeat(n)) continue;
        const r = n.getClientRect({ relativeTo: layer });
        if (r.width > 80) screen = { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width };
      }
      const qty = Number((document.body.innerText.match(/(\d+)\s*Tickets?\b/i) || [])[1]) || 1;
      return { seats, headers, screen, qty, qtyFixed: true };
    },

    hook(stage) {
      if (stage.__bms3dHooked) return;
      stage.__bms3dHooked = true;
      stage.on('click.bms3d tap.bms3d', (e) => {
        if (quiet) return;
        let n = e.target;
        while (n && !bms.isSeat(n)) n = n.getParent && n.getParent();
        if (n) post('seat', { id: bms.idOf(n) });
      });
    },

    // Movie artwork lives at predictable CDN paths keyed by the event code.
    artKey: () => (location.pathname.match(/ET\d+/i) || [])[0] || '',
    async art() {
      const code = bms.artKey().toUpperCase();
      return code ? [`https://in.bmscdn.com/events/mobile/${code}.jpg`, `https://in.bmscdn.com/events/moviecard/${code}.jpg`] : [];
    },

    click(stage, id) {
      const g = stage.findOne((n) => bms.isSeat(n) && bms.idOf(n) === id);
      if (!g) return false;
      const target = (g.children && g.children[0]) || g;
      target.fire('click', { evt: new MouseEvent('click', { bubbles: true }), target }, true);
      return true;
    },
  };

  // ------------------------------------------------------------ District
  // Plain DOM: one div per seat. Available/unavailable seats describe
  // themselves in aria-label; a selected seat becomes a bare <img>, so its
  // row/column/number are inferred from its neighbours.
  const district = {
    name: 'district',
    groupPick: false, // every seat is clicked on its own
    cells: new Map(), // seat id -> seat cell element
    ids: new WeakMap(),

    find() {
      const wrap = document.querySelector('[class*="seatLayoutContainer"]');
      return wrap && wrap.querySelector('[class*="seatDiv"]') ? wrap : null;
    },

    extract(wrap) {
      const w = wrap.getBoundingClientRect();
      const raw = [];
      for (const cell of wrap.querySelectorAll('[class*="seatDiv"]')) {
        const el = cell.firstElementChild;
        const r = cell.getBoundingClientRect();
        if (!el || !r.width) continue;
        const a = el.getAttribute('aria-label') || '';
        const cls = String(el.className || '');
        const grab = (re) => (a.match(re) || [])[1];
        let st = 1;
        if (el.tagName === 'IMG' || /selected/i.test(cls) || /^selected/i.test(a)) st = 9;
        else if (/^unavailable/i.test(a) || /disable/i.test(cls)) st = 2;
        else if (el.style && (el.style.boxShadow || el.style.border)) st = 4; // highlighted "Best Seats"
        const numTxt = el.textContent.trim();
        raw.push({
          cell, st,
          x: Math.round(r.left - w.left + r.width / 2),
          y: Math.round(r.top - w.top + r.height / 2),
          row: grab(/row\s+([^,]+)/i)?.trim(),
          col: grab(/column\s+(\d+)/i) ? Number(grab(/column\s+(\d+)/i)) : null,
          price: grab(/price\s+(\d+)/i) || '',
          num: /^\d+$/.test(numTxt) ? Number(numTxt) : null,
        });
      }
      if (!raw.length) return null;

      // group into rows by y, then fill what selected/unavailable seats lack
      raw.sort((p, q) => p.y - q.y || p.x - q.x);
      const rows = [];
      for (const s of raw) {
        const last = rows[rows.length - 1];
        if (last && Math.abs(last.y - s.y) <= 4) last.seats.push(s);
        else rows.push({ y: s.y, seats: [s] });
      }
      const dxs = new Map();
      for (const r of rows) {
        for (let i = 1; i < r.seats.length; i++) {
          const d = r.seats[i].x - r.seats[i - 1].x;
          dxs.set(d, (dxs.get(d) || 0) + 1);
        }
      }
      const pitch = [...dxs.entries()].sort((p, q) => q[1] - p[1])[0]?.[0] || 32;
      const rowTags = [...wrap.querySelectorAll('[class*="rowIdsName"]')].map((e) => {
        const r = e.getBoundingClientRect();
        return { y: r.top - w.top + r.height / 2, text: e.textContent.trim() };
      });
      const nearest = (list, i, key) => {
        for (let d = 1; d < list.length; d++) {
          for (const j of [i - d, i + d]) if (list[j] && list[j][key] != null) return j;
        }
        return -1;
      };

      district.cells = new Map();
      const seats = [];
      rows.forEach((r, ri) => {
        const tag = rowTags.find((t) => Math.abs(t.y - r.y) < 12);
        const label = r.seats.find((s) => s.row)?.row || tag?.text || String.fromCharCode(65 + ri);
        const price = r.seats.find((s) => s.price)?.price || '';
        r.seats.forEach((s, i) => {
          if (s.col == null) {
            const j = nearest(r.seats, i, 'col');
            s.colFill = j < 0 ? Math.round(s.x / pitch) : r.seats[j].col + Math.round((s.x - r.seats[j].x) / pitch);
          }
          if (s.num == null) {
            const j = nearest(r.seats, i, 'num');
            s.numFill = j < 0 ? i + 1 : r.seats[j].num + (i - j);
          }
        });
        for (const s of r.seats) {
          const id = `${label}-${s.col ?? s.colFill}`;
          district.cells.set(id, s.cell);
          district.ids.set(s.cell, id);
          seats.push({
            id, row: label, num: String(s.num ?? s.numFill), x: s.x, y: r.y, st: s.st,
            price: s.price || price,
          });
        }
      });

      const headers = [...wrap.querySelectorAll('[class*="seatAreaName"]')].map((e) => {
        const r = e.getBoundingClientRect();
        return { y: Math.round(r.top - w.top), h: Math.round(r.height) };
      });
      let screen = null;
      const img = wrap.querySelector('img[class*="screenImg"]') || document.querySelector('img[class*="screenImg"]');
      if (img) {
        const r = img.getBoundingClientRect();
        if (r.width) screen = { x: r.left - w.left + r.width / 2, y: r.top - w.top + r.height / 2, w: r.width };
      }
      const qty = seats.filter((s) => s.st === 9).length || 1;
      return { seats, headers, screen, qty, qtyFixed: false };
    },

    hook() {
      if (district.hooked) return;
      district.hooked = true;
      document.addEventListener('click', (e) => {
        if (quiet) return;
        const cell = e.target.closest && e.target.closest('[class*="seatDiv"]');
        const id = cell && district.ids.get(cell);
        if (id) post('seat', { id });
      }, true);
    },

    // The seat page carries no artwork; the movie's own page names its poster
    // in og:image. Read only the start of that page, then stop the download.
    artKey: () => new URLSearchParams(location.search).get('contentid') || '',
    async art(title) {
      const id = district.artKey();
      const slug = String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (!id || !slug) return [];
      const res = await fetch(`/movies/${slug}-movie-tickets-in-gurgaon-MV${id}`, { credentials: 'omit' });
      if (!res.ok || !res.body) return [];
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let html = '';
      try {
        while (html.length < 400000) {
          const { done, value } = await reader.read();
          if (done) break;
          html += dec.decode(value, { stream: true });
          const m = html.match(/property="og:image"\s+content="([^"]+)"/) || html.match(/content="([^"]+)"\s+property="og:image"/);
          if (m) return [m[1]];
          if (html.includes('</head>')) break;
        }
      } finally { reader.cancel().catch(() => {}); }
      return [];
    },

    click(_wrap, id) {
      const el = district.cells.get(id)?.firstElementChild;
      if (!el) return false;
      el.click();
      return true;
    },
  };

  const adapters = [bms, district];

  function current() {
    for (const a of adapters) {
      const ctx = a.find();
      if (ctx) return { a, ctx };
    }
    return null;
  }

  function read() {
    const cur = current();
    if (!cur) return null;
    cur.a.hook(cur.ctx);
    const layout = cur.a.extract(cur.ctx);
    if (!layout) return null;
    const lines = pageLines();
    return { ...cur, layout: { url: location.href, site: cur.a.name, ...lines, ...layout, art: artFor(cur.a, lines.title) } };
  }

  // Artwork URLs are looked up once per movie; the layout is re-sent when they arrive.
  const artCache = new Map();
  function artFor(a, title) {
    const key = a.name + ':' + a.artKey();
    if (!artCache.has(key)) {
      artCache.set(key, []);
      a.art(title).then((urls) => {
        if (urls && urls.length) { artCache.set(key, urls); tick(true); }
      }).catch(() => {});
    }
    return artCache.get(key);
  }

  let lastSig = '';
  let hadLayout = false;

  function tick(force) {
    const got = read();
    if (!got) {
      if (hadLayout || force) { hadLayout = false; lastSig = ''; post('layout', null); }
      return;
    }
    const { layout } = got;
    const sig = location.pathname + location.search + '|' + layout.qty + '|' + layout.seats.map((s) => s.id + s.st).join(',');
    if (sig !== lastSig || force) {
      lastSig = sig;
      hadLayout = true;
      post('layout', layout);
    }
  }

  // Select exactly `ids` on the site. On group-pick sites the first click
  // selects a run of seats, so each later seat is clicked only if still missing.
  async function pick(ids) {
    quiet = true;
    try {
      const picked = () => new Set((read()?.layout.seats || []).filter((s) => s.st === 9).map((s) => s.id));
      const want = new Set(ids);
      let got = read();
      if (!got) return;
      if (!got.a.groupPick) {
        for (const id of picked()) {
          if (!want.has(id)) { got.a.click(got.ctx, id); await sleep(180); got = read() || got; }
        }
      }
      for (const id of ids) {
        if (picked().has(id)) continue;
        got = read() || got;
        got.a.click(got.ctx, id);
        await sleep(got.a.groupPick ? 700 : 200);
      }
    } finally {
      quiet = false;
      tick(true);
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'bms3d-ext') return;
    if (e.data.type === 'request') tick(true);
    else if (e.data.type === 'pick' && Array.isArray(e.data.payload?.ids)) pick(e.data.payload.ids.map(String));
  });

  setInterval(() => tick(false), 1000);
  tick(false);
})();
