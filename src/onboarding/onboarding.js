import { renderMarkdown } from '../render.js';
import { isFileAccessAllowed } from '../file-access-check.js';
import { isFirefox, requestFileAccess } from '../browser-env.js';

async function watchFileAccess() {
  const status = document.getElementById('file-status');
  const step = document.getElementById('step-file');
  const tick = async () => {
    const ok = await isFileAccessAllowed();
    status.textContent = ok ? '✓ enabled' : 'not enabled yet';
    status.classList.toggle('ok', ok);
    step.classList.toggle('done', ok);
    if (ok) {
      // Access just got granted (this loop stops here), so clear the "!" badge
      // immediately instead of waiting for the next install/startup check.
      chrome.runtime.sendMessage({ type: 'skim-refresh-badge' }).catch(() => {});
    } else {
      setTimeout(tick, 1000);
    }
  };
  tick();
}

// Firefox has no "Allow access to file URLs" switch: local files need a host
// permission, which the reader grants from a prompt behind this same button.
if (isFirefox()) {
  document.getElementById('file-intro').textContent = 'Firefox asks once before an add-on may read files on your computer.';
  document.getElementById('open-settings').textContent = 'Allow local files';
  document.getElementById('file-hint').textContent = 'Click it and accept the prompt. This page notices automatically.';
}

document.getElementById('open-settings').addEventListener('click', () => { requestFileAccess(); });

fetch(chrome.runtime.getURL('examples/sample.md'))
  .then((r) => r.text())
  .then((src) => { document.getElementById('demo').innerHTML = renderMarkdown(src); })
  .catch(() => { document.getElementById('demo').textContent = 'Sample unavailable.'; });

watchFileAccess();
