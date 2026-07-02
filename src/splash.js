// Tag the page for the loading splash only when it can actually be a plaintext
// markdown document; text/html pages (e.g. GitHub blob views) must stay visible.
// Injected at document_start alongside loader.css, before the bundle runs —
// deliberately dependency-free (no imports, no build step needed).
const t = (document.contentType || '').toLowerCase();
if (t === 'text/plain' || t === 'text/markdown' || t === 'text/x-markdown' || t === 'text/x-web-markdown') {
  document.documentElement.dataset.skimSplash = '1';
}
