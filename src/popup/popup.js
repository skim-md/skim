import { getSettings, setSetting } from '../settings.js';
import { isFileAccessAllowed } from '../file-access-check.js';
import { openClipboardViewer } from '../clipboard/open-clipboard.js';

const $ = (id) => document.getElementById(id);

// Mirror the viewer's Dark/Light choice onto the popup's own chrome
// (popup.css is keyed on the same data-theme attribute skim.css uses).
const applyTheme = (theme) => {
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
};

// Bind one control, tolerating its absence: the popup and the options page share
// this script but are separate markup files, so one can lack a control the other
// has. Without this a single missing id threw and left *every* control unbound.
function bind(id, value, event, handler) {
  const node = $(id);
  if (!node) return;
  if (node.type === 'checkbox') node.checked = value;
  else node.value = String(value);
  node.addEventListener(event, handler);
}

// The nag must never contradict reality: if any open file:// markdown tab was
// rendered by our content script, file access is granted no matter what the
// detection APIs claim (content scripts cannot run on file: pages without it).
// Only consulted on the nag path, so the common case pays nothing.
const MD_FILE_URL = /^file:.*\.(md|markdown|mdown|mkd|mkdn|mdx)([?#].*)?$/i;
async function hasRenderedFileTab() {
  try {
    const tabs = await chrome.tabs.query({ url: 'file:///*' });
    const mdTabs = tabs.filter((t) => t.id != null && MD_FILE_URL.test(t.url || '')).slice(0, 8);
    const rendered = await Promise.all(mdTabs.map((t) =>
      chrome.scripting.executeScript({
        target: { tabId: t.id },
        func: () => document.documentElement.dataset.skimMd === '1',
      }).then((r) => r?.[0]?.result === true, () => false)));
    return rendered.some(Boolean);
  } catch {
    return false;
  }
}

async function init() {
  // Show the controls right away: the file-access check can end up reading a
  // file:// URL to be sure of its answer, and the popup must not wait on that.
  $('controls').hidden = false;
  try {
    const [settings, allowed, [tab]] = await Promise.all([
      getSettings(),
      isFileAccessAllowed(),
      chrome.tabs.query({ active: true, currentWindow: true }),
    ]);

    // The popup dresses like the viewer: same palette, same dark/light choice.
    applyTheme(settings.theme);

    if (!allowed && !(await hasRenderedFileTab())) {
      $('file-cta').hidden = false;
      if (tab?.url?.startsWith('file:') && MD_FILE_URL.test(tab.url)) {
        $('file-cta-msg').innerHTML = 'This tab <em>is</em> a markdown file. Flip one switch and Skim will render it beautifully:';
      }
      $('open-settings').addEventListener('click', async () => {
        // Deep-link straight to Skim's card on chrome://extensions, scrolled to
        // the file-URLs switch. Awaited BEFORE window.close(): closing tears
        // this context down and an un-awaited create can vanish with it (the
        // "button does nothing" bug). If a build refuses chrome:// URLs from
        // tabs.create, fall back to the packaged walkthrough tab.
        try {
          await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}#:~:text=Allow%20access%20to%20file%20URLs` });
        } catch {
          await chrome.tabs.create({ url: chrome.runtime.getURL('src/file-access/file-access.html') }).catch(() => {});
        }
        window.close();
      });
    }

    // Only settings with no equivalent in the rendered page's own toolbar live
    // in the popup; the options page (same script) still binds the full set.
    bind('theme', settings.theme, 'change', (e) => { setSetting('theme', e.target.value); applyTheme(e.target.value); });
    bind('scheme', settings.scheme, 'change', (e) => setSetting('scheme', e.target.value));
    bind('font', settings.font, 'change', (e) => setSetting('font', e.target.value));
    bind('zoom', settings.readingZoom, 'change', (e) => setSetting('readingZoom', Number(e.target.value)));
    bind('print-margin', settings.printMargin, 'change', (e) => setSetting('printMargin', e.target.value));
    bind('autoreload', settings.autoReload, 'change', (e) => setSetting('autoReload', e.target.checked));

    $('clip-render')?.addEventListener('click', async () => {
      const btn = $('clip-render');
      btn.disabled = true;
      try {
        await openClipboardViewer();
        window.close();
      } catch (err) {
        console.error('Skim: clipboard render failed', err);
        btn.disabled = false;
        btn.textContent = "Couldn't open the clipboard";
      }
    });

    // Claude Code's conventional local answer file. Awaited before close so
    // the tab create cannot be torn down with the popup context.
    $('claude-clip')?.addEventListener('click', async () => {
      try {
        await chrome.tabs.create({ url: 'file:///tmp/claude-1000/response.md' });
        window.close();
      } catch (err) {
        console.error('Skim: opening Claude clipboard failed', err);
      }
    });

    // Hand the quiz protocol to other people's agents: the shipped
    // SKIM-QUIZ-PROTOCOL.md is the single source of truth, copied verbatim.
    $('copy-quiz-skill')?.addEventListener('click', async () => {
      try {
        const res = await fetch(chrome.runtime.getURL('SKIM-QUIZ-PROTOCOL.md'));
        await navigator.clipboard.writeText(await res.text());
        $('quiz-skill-label').textContent = '✓ Copied — paste it to your agent';
        setTimeout(() => window.close(), 900);
      } catch (err) {
        console.error('Skim: quiz skill copy failed', err);
        $('quiz-skill-label').textContent = "Couldn't copy";
      }
    });

    chrome.runtime.sendMessage({ type: 'skim-refresh-badge' }).catch(() => {});
  } catch (err) {
    console.error('Skim: popup init failed', err);
    $('controls').hidden = false;
  }
}
init();
