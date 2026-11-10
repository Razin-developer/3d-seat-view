// Isolated-world relay: page (inject.js, MAIN world) <-> extension side panel.
(() => {
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'bms3d-page') return;
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
