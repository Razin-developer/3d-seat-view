// Toolbar icon opens the side panel.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((e) => console.warn('[bms3d] sidePanel behaviour', e));

// The on-page pill asks for the panel. open() needs the user gesture that the
// pill click carries, so call it straight away.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.bms3d && msg.type === 'open-panel' && sender.tab) {
    chrome.sidePanel.open({ tabId: sender.tab.id }).catch((e) => console.warn('[bms3d] open panel', e));
  }
});

// YouTube refuses embeds that arrive with no recognisable Referer (error 153),
// and a side panel sends none. Give requests that come from extension pages
// (tab id -1, i.e. not from any website) a Referer, and only those.
async function setReferer() {
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [1],
      addRules: [{
        id: 1, priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'referer', operation: 'set', value: 'https://seats.movie/' }] },
        condition: {
          requestDomains: ['youtube-nocookie.com', 'youtube.com'],
          resourceTypes: ['sub_frame'],
          tabIds: [chrome.tabs.TAB_ID_NONE],
        },
      }],
    });
  } catch (e) { console.warn('[bms3d] referer rule', e); }
}
setReferer();
chrome.runtime.onInstalled.addListener(setReferer);
chrome.runtime.onStartup.addListener(setReferer);
