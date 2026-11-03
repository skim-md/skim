// The Scholar-style file-access walkthrough tab. Opened by the background
// worker when the user navigates to a local .md file while "Allow access to
// file URLs" is off. The hash carries the originating tab (#tab=<id>) so that
// the moment access is granted we reload that file and close this tab,
// one better than asking the user to reload it themselves.
import { isFileAccessAllowed } from '../file-access-check.js';
import { isFirefox, requestFileAccess } from '../browser-env.js';

const params = new URLSearchParams(location.hash.slice(1));
const sourceTabId = Number(params.get('tab'));


async function closeSelf() {
  try {
    const me = await chrome.tabs.getCurrent();
    if (me && typeof me.id === 'number') await chrome.tabs.remove(me.id);
  } catch { window.close(); }
}

async function onGranted() {
  document.getElementById('toggle-pic').classList.add('on');
  const status = document.getElementById('status');
  status.textContent = '✓ Enabled. Opening your file…';
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
    if (await isFileAccessAllowed()) { onGranted(); return; }
    setTimeout(tick, 1000);
  };
  tick();
}

// Firefox: no switch to show. The same button raises Firefox's permission
// prompt, and the watcher below picks up the grant.
if (isFirefox()) {
  document.querySelector('h1').textContent = 'To read local markdown files with Skim, allow it to read files on your computer. This file then reloads by itself.';
  document.querySelector('.toggle-row span').textContent = 'Access your data for file:///*';
  document.getElementById('status').textContent = 'Waiting for your OK…';
  document.getElementById('open-settings').textContent = 'Allow local files';
}

document.getElementById('open-settings').addEventListener('click', () => { requestFileAccess(); });

document.getElementById('no-thanks').addEventListener('click', async () => {
  try { await chrome.storage.sync.set({ fileCtaDismissed: true }); } catch { /* ignore */ }
  closeSelf();
});

watchAccess();
