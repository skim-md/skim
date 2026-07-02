// Extension-wide settings, stored in chrome.storage.sync so they follow the
// user across origins and devices. Falls back to defaults when the chrome
// APIs are unavailable (tests, preview script).
export const DEFAULTS = {
  theme: 'dark',      // 'dark' | 'light'
  density: 'normal',  // 'normal' | 'big'
  readingZoom: 0,     // 0 = off; otherwise a browser zoom factor, e.g. 1.5
  autoReload: true,   // re-render when the underlying file changes
  mermaid: true,      // render ```mermaid fences as diagrams
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
// the content script; each origin visited migrates its own legacy values, but
// existing sync values always win.
//
// The shipped beta (before the Glow -> Skim rebrand) wrote `glow-md-theme` /
// `glow-md-density`; that's the real legacy data readers may still have. The
// `skim-md-*` names never shipped as the *source* of truth but are read too
// (and migrated) in case anything wrote them during the rebrand window.
// `glow-md-*` wins when both are present.
export async function migrateLocalSettings() {
  if (!hasSync()) return;
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
