// The Scholar-style file-access walkthrough tab. Opened by the background
// worker when the user navigates to a local .md file while "Allow access to
// file URLs" is off. The hash carries the originating tab (#tab=<id>) so that
// the moment access is granted we reload that file and close this tab —
// one better than asking the user to reload it themselves.

const params = new URLSearchParams(location.hash.slice(1));
const sourceTabId = Number(params.get('tab'));

const SETTINGS_URL =
  `chrome://extensions/?id=${chrome.runtime.id}#:~:text=Allow%20access%20to%20file%20URLs`;

async function fileAccessAllowed() {
  try { return await chrome.extension.isAllowedFileSchemeAccess(); }
  catch { return false; }
}

async function closeSelf() {
  try {
    const me = await chrome.tabs.getCurrent();
    if (me && typeof me.id === 'number') await chrome.tabs.remove(me.id);
  } catch { window.close(); }
}

async function onGranted() {
  document.getElementById('toggle-pic').classList.add('on');
  const status = document.getElementById('status');
  status.textContent = '✓ Enabled — opening your file…';
  status.classList.add('ok');
  chrome.runtime.sendMessage({ type: 'skim-refresh-badge' }).catch(() => {});
  if (Number.isFinite(sourceTabId) && sourceTabId > 0) {
    try {
      await chrome.tabs.reload(sourceTabId);
      await chrome.tabs.update(sourceTabId, { active: true });
    } catch { /* the file's tab was closed meanwhile */ }
  }
  setTimeout(closeSelf, 600);
}

function watchAccess() {
  const tick = async () => {
    if (await fileAccessAllowed()) { onGranted(); return; }
    setTimeout(tick, 1000);
  };
  tick();
}

document.getElementById('open-settings').addEventListener('click', () => {
  chrome.tabs.create({ url: SETTINGS_URL });
});

document.getElementById('no-thanks').addEventListener('click', async () => {
  try { await chrome.storage.sync.set({ fileCtaDismissed: true }); } catch { /* ignore */ }
  closeSelf();
});

watchAccess();
