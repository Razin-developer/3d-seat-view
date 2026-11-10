// Isolated-world relay: page (inject.js, MAIN world) <-> extension side panel.
// Also shows a small pill at the bottom of the page while a seat is selected;
// clicking it opens the side panel.
(() => {
  // ---------------------------------------------------------------- pill
  let pill = null;
  let dismissed = false;

  function ensurePill() {
    if (pill) return pill;
    const host = document.createElement('div');
    host.id = 'bms3d-pill';
    host.style.cssText = 'all:initial;position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        .pill { display:flex; align-items:center; gap:4px; padding:4px 4px 4px 6px; border-radius:999px;
          background:#15171c; color:#fff; font:600 13px/1 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
          box-shadow:0 6px 24px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.08);
          animation:in .25s ease-out; white-space:nowrap; }
        @keyframes in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:none; } }
        button { all:unset; cursor:pointer; box-sizing:border-box; }
        .go { display:flex; align-items:center; gap:8px; padding:9px 14px 9px 10px; border-radius:999px; }
        .go:hover { background:rgba(255,255,255,.1); }
        .go:focus-visible, .x:focus-visible { outline:2px solid #ff4d79; outline-offset:1px; }
        .ico { width:22px; height:22px; border-radius:50%; background:#ff4d79; display:grid; place-items:center; }
        .x { width:26px; height:26px; border-radius:50%; display:grid; place-items:center; color:#9aa0b0; font-size:16px; }
        .x:hover { color:#fff; background:rgba(255,255,255,.1); }
        @media (max-width:480px) { .pill { font-size:12px; } }
      </style>
      <div class="pill" role="group">
        <button class="go" type="button" aria-label="Open 3D seat view for the selected seat">
          <span class="ico"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/></svg></span>
          <span>Check how it views from this seat</span>
        </button>
        <button class="x" type="button" aria-label="Hide this suggestion">&times;</button>
      </div>`;
    root.querySelector('.go').addEventListener('click', () => {
      try { chrome.runtime.sendMessage({ bms3d: true, type: 'open-panel' }).catch(() => {}); } catch (_) { /* extension reloaded */ }
      // the panel asks for the layout itself when it loads; nudge in case it was already open
      setTimeout(() => window.postMessage({ source: 'bms3d-ext', type: 'request' }, location.origin), 700);
    });
    root.querySelector('.x').addEventListener('click', () => { dismissed = true; show(false); });
    pill = host;
    return host;
  }

  function show(on) {
    if (on && !dismissed) {
      const p = ensurePill();
      if (!p.isConnected) document.documentElement.appendChild(p);
    } else if (pill && pill.isConnected) pill.remove();
  }

  // ---------------------------------------------------------------- relay
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'bms3d-page') return;
    if (e.data.type === 'layout') {
      const l = e.data.payload;
      const has = !!(l && l.seats && l.seats.some((s) => s.st === 9));
      if (!has) dismissed = false; // selection cleared: offer the pill again next time
      show(has);
    }
    try {
      // Fails harmlessly when the side panel is closed (no receiver).
      chrome.runtime.sendMessage({ bms3d: true, type: e.data.type, payload: e.data.payload })
        .catch(() => {});
    } catch (_) { /* extension reloaded; page needs refresh */ }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.bms3d && (msg.type === 'request' || msg.type === 'pick')) {
      window.postMessage({ source: 'bms3d-ext', type: msg.type, payload: msg.payload }, location.origin);
    }
  });
})();
