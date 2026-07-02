import { getSettings, setSetting } from '../settings.js';

const $ = (id) => document.getElementById(id);

async function fileAccessAllowed() {
  try { return await chrome.extension.isAllowedFileSchemeAccess(); }
  catch { return false; }
}

async function init() {
  try {
    const [settings, allowed, [tab]] = await Promise.all([
      getSettings(),
      fileAccessAllowed(),
      chrome.tabs.query({ active: true, currentWindow: true }),
    ]);

    $('controls').hidden = false;
    if (!allowed) {
      $('file-cta').hidden = false;
      if (tab?.url?.startsWith('file:') && /\.(md|markdown|mdown|mkd|mkdn|mdx)([?#].*)?$/i.test(tab.url)) {
        $('file-cta-msg').innerHTML = 'This tab <em>is</em> a markdown file — flip one switch and Skim will render it beautifully:';
      }
      $('open-settings').addEventListener('click', () => {
        chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
        window.close();
      });
    }

    if (location.pathname.endsWith('/options.html')) {
      $('force-render').hidden = true;
    }

    $('theme').value = settings.theme;
    $('zoom').value = String(settings.readingZoom);
    $('autoreload').checked = settings.autoReload;
    $('mermaid').checked = settings.mermaid;
    $('theme').addEventListener('change', (e) => setSetting('theme', e.target.value));
    $('zoom').addEventListener('change', (e) => setSetting('readingZoom', Number(e.target.value)));
    $('autoreload').addEventListener('change', (e) => setSetting('autoReload', e.target.checked));
    $('mermaid').addEventListener('change', (e) => setSetting('mermaid', e.target.checked));

    $('force-render').addEventListener('click', async () => {
      if (!tab?.id) return;
      try {
        await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['src/skim.css'] });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => { window.__skimForce = true; } });
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['dist/content.bundle.js'] });
        window.close();
      } catch (err) {
        console.error('Skim: force-render failed', err);
        $('force-render').textContent = "Can't render this page";
      }
    });

    chrome.runtime.sendMessage({ type: 'skim-refresh-badge' }).catch(() => {});
  } catch (err) {
    console.error('Skim: popup init failed', err);
    $('controls').hidden = false;
  }
}
init();
