// Re-fetch the current document's raw bytes (auto-reload, encoding repair).
//
// file:// pages are opaque origins: page-context fetch AND XMLHttpRequest are
// always blocked there ("file: URLs are treated as unique security origins",
// logged as a console error even when caught). So for file:// we go straight
// to the background relay, whose service-worker fetch works because the
// manifest declares host_permissions on file:///* and the user has enabled
// "Allow access to file URLs" (the same toggle that let us inject at all).
// This is the same architecture simov/markdown-viewer and md-reader use.
// http(s) keeps the cheap in-page transports first. null = unreadable.
function b64ToBuffer(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return bytes.buffer;
}

export function isFileUrl(url) {
  return /^file:/i.test(String(url));
}

async function relayFetch(url) {
  try {
    const res = await chrome.runtime.sendMessage({ type: 'skim-fetch', url });
    if (res && res.ok && typeof res.b64 === 'string') return b64ToBuffer(res.b64);
  } catch { /* no background */ }
  return null;
}

export async function fetchSourceBytes(url = location.href) {
  if (isFileUrl(url)) return relayFetch(url);
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (res.ok || res.status === 0) return await res.arrayBuffer();
  } catch { /* next transport */ }
  const viaXhr = await new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url);
      xhr.responseType = 'arraybuffer';
      xhr.onload = () => {
        const ok = xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300);
        resolve(ok && xhr.response && xhr.response.byteLength >= 0 ? xhr.response : null);
      };
      xhr.onerror = () => resolve(null);
      xhr.send();
    } catch { resolve(null); }
  });
  if (viaXhr) return viaXhr;
  return relayFetch(url);
}
