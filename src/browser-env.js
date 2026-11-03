// Which browser are we in, and the few things that differ between them.
//
// Chrome-family browsers (Chrome, Edge, Brave, Opera, Vivaldi, Arc) share one
// build and one store. Firefox runs the same code with two differences that
// matter to Skim: it has no "Allow access to file URLs" switch (file access is
// an ordinary host permission the reader can grant from a button), and its
// store is addons.mozilla.org.

export function isFirefox() {
  try {
    return typeof chrome !== 'undefined' && chrome.runtime.getURL('').startsWith('moz-extension:');
  } catch {
    return false;
  }
}

const FILE_ORIGINS = { origins: ['file:///*'] };

// Ask for local-file access. Must run inside a click handler (Firefox only
// shows the permission prompt for a user gesture). Resolves true when granted.
// On Chrome there is no prompt: open Skim's card on chrome://extensions, scrolled
// to the switch, and resolve false (the caller keeps polling for the grant).
export async function requestFileAccess() {
  if (isFirefox()) {
    try { return await chrome.permissions.request(FILE_ORIGINS); } catch { return false; }
  }
  try {
    await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}#:~:text=Allow%20access%20to%20file%20URLs` });
  } catch {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/file-access/file-access.html') }).catch(() => {});
  }
  return false;
}
