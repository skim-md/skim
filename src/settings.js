// Extension-wide settings, stored in chrome.storage.sync so they follow the
// user across origins and devices. Falls back to defaults when the chrome
// APIs are unavailable (tests, preview script).
export const DEFAULTS = {
  theme: 'dark',      // 'dark' | 'light' (base brightness)
  scheme: 'none',     // 'none' | 'grape' | 'rose' | 'ocean' | 'sunset' | 'forest' | 'mono' (color vibe)
  density: 'normal',  // 'normal' | 'big'
  printMargin: 'narrow', // PDF export page margin: 'none' | 'narrow' | 'normal' | 'wide'
  readingZoom: 0,     // 0 = off; otherwise a browser zoom factor, e.g. 1.5
  autoReload: true,   // re-render when the underlying file changes
  mermaid: true,      // render ```mermaid fences as diagrams
  zen: false,         // hide the table of contents and center the column
  // Folder view column sort, remembered across folders and sessions. Newest
  // first by default: a listing is usually opened to reach recent work.
  folderSort: { key: 'date', dir: -1 }, // key: 'name' | 'size' | 'date'; dir: 1 asc | -1 desc
};

const hasSync = () => typeof chrome !== 'undefined' && chrome.storage?.sync;

export async function getSettings() {
  if (!hasSync()) return { ...DEFAULTS };
  const stored = await chrome.storage.sync.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export async function setSetting(key, value) {
  if (!(key in DEFAULTS)) throw new Error(`unknown setting: ${key}`);
  if (!hasSync()) return;
  await chrome.storage.sync.set({ [key]: value });
}

// Calls listener({key: newValue, ...}) whenever another context changes settings.
export function onSettingsChanged(listener) {
  if (!hasSync() || !chrome.storage.onChanged) return;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    const patch = {};
    for (const [k, c] of Object.entries(changes)) if (k in DEFAULTS) patch[k] = c.newValue;
    if (Object.keys(patch).length) listener(patch);
  });
}

// One-time migration of the beta's per-origin localStorage settings. Runs in
// the content script, but only for local files: the beta kept its settings in
// the file:// origin's localStorage, which is the reader's own. On a web origin
// localStorage belongs to whoever serves the page, so a hostile .md host could
// otherwise plant values that end up in the reader's synced settings.
// Existing sync values always win.
//
// The shipped beta (before the Glow -> Skim rebrand) wrote `glow-md-theme` /
// `glow-md-density`; that's the real legacy data readers may still have. The
// `skim-md-*` names never shipped as the *source* of truth but are read too
// (and migrated) in case anything wrote them during the rebrand window.
// `glow-md-*` wins when both are present.
const isLocalDocument = () => typeof window !== 'undefined' && window.location?.protocol === 'file:';

export async function migrateLocalSettings() {
  if (!hasSync() || !isLocalDocument()) return;
  let theme = null, density = null;
  try {
    theme = localStorage.getItem('glow-md-theme') ?? localStorage.getItem('skim-md-theme');
    density = localStorage.getItem('glow-md-density') ?? localStorage.getItem('skim-md-density');
  } catch { return; }
  if (theme === null && density === null) return;
  const stored = await chrome.storage.sync.get(['theme', 'density']);
  const patch = {};
  if (stored.theme === undefined && (theme === 'light' || theme === 'dark')) patch.theme = theme;
  if (stored.density === undefined && (density === 'big' || density === 'normal')) patch.density = density;
  if (Object.keys(patch).length) await chrome.storage.sync.set(patch);
  try {
    localStorage.removeItem('glow-md-theme');
    localStorage.removeItem('glow-md-density');
    localStorage.removeItem('skim-md-theme');
    localStorage.removeItem('skim-md-density');
  } catch { /* ignore */ }
}
