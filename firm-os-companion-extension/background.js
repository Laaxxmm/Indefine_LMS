// Service worker. Its only jobs: open the side panel when the toolbar icon is clicked, and open
// the Options page once on first install so the person can paste a pairing token. It makes no
// network calls and touches no web page.
function panelOnIconClick() {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.runtime.onInstalled.addListener((details) => {
  panelOnIconClick();
  if (details.reason === "install") chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(panelOnIconClick);
