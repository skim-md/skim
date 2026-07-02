// Service worker: set the browser zoom for rendered markdown pages, on request
// from the content script. tabs.setZoom needs no extra permissions; the tab id
// comes from the message sender. Chrome remembers zoom per-origin, so repeat
// visits open already-zoomed.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === 'skim-set-zoom' && sender.tab && typeof sender.tab.id === 'number') {
    chrome.tabs.setZoom(sender.tab.id, msg.zoom).catch(() => { /* tab gone / not zoomable */ });
  }
});

// Badge shows "!" until the user grants file:// access, so first-run users
// notice there's a step to enable local-file rendering. Cleared as soon as
// access is granted (checked on install/startup, and on-demand from the
// popup after the user returns from chrome://extensions).
async function refreshBadge() {
  let allowed = false;
  try { allowed = await chrome.extension.isAllowedFileSchemeAccess(); } catch { /* keep false */ }
  chrome.action.setBadgeText({ text: allowed ? '' : '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#7aa2ff' });
}
chrome.runtime.onInstalled.addListener((details) => {
  refreshBadge();
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/onboarding/onboarding.html') });
  }
});
chrome.runtime.onStartup.addListener(refreshBadge);

// When the user flips "Allow access to file URLs", Chrome restarts the
// extension — so a once-per-lifetime sweep here catches the grant no matter
// where it was made (our walkthrough, the popup path, or chrome://extensions
// directly) and reloads any open local .md tabs so they render immediately
// instead of sitting as plain text until a manual refresh. storage.session
// clears on restart, making it a natural once-guard across worker wake-ups.
(async () => {
  try {
    const { reloadSweepDone } = await chrome.storage.session.get('reloadSweepDone');
    if (reloadSweepDone) return;
    await chrome.storage.session.set({ reloadSweepDone: true });
    const allowed = await chrome.extension.isAllowedFileSchemeAccess();
    if (!allowed) return;
    const tabs = await chrome.tabs.query({ url: 'file:///*' });
    for (const tab of tabs) {
      if (tab.id != null && tab.url && /\.(md|markdown|mdown|mkd|mkdn|mdx)([?#].*)?$/i.test(tab.url)) {
        chrome.tabs.reload(tab.id).catch(() => { /* tab gone */ });
      }
    }
  } catch { /* session storage or tabs unavailable — nothing to sweep */ }
})();

// Google-Scholar-style file-access walkthrough: when the user opens a local
// .md file while "Allow access to file URLs" is off (so nothing can render),
// open the walkthrough tab pointing back at their file. The "tabs" permission
// makes file:// tab URLs visible even without file access — that's the whole
// trick; content scripts can't run there yet. Shown at most once per browser
// session, and never again after "No thanks" (fileCtaDismissed).
const MD_URL = /^file:.*\.(md|markdown|mdown|mkd|mkdn|mdx)([?#].*)?$/i;
let ctaOpenedThisSession = false;

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (ctaOpenedThisSession) return;
  const url = changeInfo.url;
  if (!url || !MD_URL.test(url)) return;
  let allowed = true;
  try { allowed = await chrome.extension.isAllowedFileSchemeAccess(); } catch { /* keep true: don't prompt blind */ }
  if (allowed) return;
  try {
    const { fileCtaDismissed } = await chrome.storage.sync.get('fileCtaDismissed');
    if (fileCtaDismissed) return;
  } catch { /* storage unavailable — still offer the walkthrough */ }
  if (ctaOpenedThisSession) return; // re-check after the awaits
  ctaOpenedThisSession = true;
  chrome.tabs.create({
    url: chrome.runtime.getURL(`src/file-access/file-access.html#tab=${tabId}`),
  }).catch(() => { ctaOpenedThisSession = false; });
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'skim-refresh-badge') refreshBadge();
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== 'skim-fetch' || !sender.tab) return undefined;
  // The relay only legitimately re-fetches the sender's own document
  // (see fetchSourceBytes' default `url = location.href` in source.js) —
  // never an arbitrary cross-origin URL a compromised/malicious page could
  // ask the extension to fetch with extension-level privileges.
  if (!sender.url || msg.url !== sender.url) {
    sendResponse({ ok: false });
    return undefined;
  }
  (async () => {
    try {
      const res = await fetch(msg.url, { cache: 'no-store' });
      const buf = await res.arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      sendResponse({ ok: true, b64: btoa(bin) });
    } catch (e) {
      sendResponse({ ok: false });
    }
  })();
  return true; // async sendResponse
});
