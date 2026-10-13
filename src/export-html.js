// Export the rendered document as a single self-contained .html file: the
// markup plus all CSS and (woff2) fonts inlined as data URLs, so it opens
// anywhere with no network and no extension. One button beside Print/Copy.

// Base64-encode an ArrayBuffer without blowing the call stack on large fonts.
function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return res.text();
}

async function fetchDataUrl(url, mime) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  return `data:${mime};base64,${bufToBase64(await res.arrayBuffer())}`;
}

// Fetch one extension stylesheet and return its CSS with fonts inlined. To keep
// the export small we keep only woff2 sources: drop the woff/ttf `url() format()`
// fallbacks, then swap each remaining woff2 reference for a data: URL resolved
// against the sheet's own location.
async function inlineStylesheet(path) {
  const base = chrome.runtime.getURL(path);
  let css = await fetchText(base);
  // Remove woff/ttf fallback entries (with their optional format()).
  css = css.replace(/,?\s*url\(\s*["']?[^)"']+\.(?:woff|ttf)["']?\s*\)(?:\s*format\(\s*["'][^)"']*["']\s*\))?/gi, '');
  // Embed the remaining woff2 references.
  const refs = [...css.matchAll(/url\(\s*["']?([^)"']+\.woff2)["']?\s*\)/gi)];
  const seen = new Map();
  for (const m of refs) {
    const rel = m[1];
    if (!seen.has(rel)) {
      try {
        const abs = new URL(rel, base).href;
        seen.set(rel, await fetchDataUrl(abs, 'font/woff2'));
      } catch { seen.set(rel, null); }
    }
  }
  css = css.replace(/url\(\s*["']?([^)"']+\.woff2)["']?\s*\)/gi, (whole, rel) => {
    const data = seen.get(rel);
    return data ? `url("${data}")` : whole;
  });
  return css;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function safeFilename(title) {
  const base = (title || 'document').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w.\- ]+/g, '').trim().replace(/\s+/g, '-');
  return (base || 'document') + '.html';
}

// The export is a static page: no scripts, frames, forms or fetches, ever. Its
// own CSS and fonts are inlined (style-src 'unsafe-inline', font-src data:), and
// images/media the document referenced stay viewable from any host — but with
// no referrer, so opening the file leaks nothing about where it came from.
const EXPORT_CSP = [
  "default-src 'none'",
  // `*` already admits the document's own scheme, but say file: outright so
  // images next to the exported file work when it is opened from disk.
  'img-src * data: blob: file:',
  'media-src * data: blob: file:',
  "style-src 'unsafe-inline'",
  'font-src data:',
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

// Build the standalone HTML string for the current document.
export async function buildStandaloneHtml(article) {
  const main = article.closest('.skim-main') || article;
  const clone = main.cloneNode(true);
  // Strip on-screen-only chrome from the clone.
  clone.querySelectorAll('.skim-copy-btn, .skim-copy-latex, .skim-mermaid-expand, .skim-raw')
    .forEach((n) => n.remove());
  // Interactive artifacts: the raw/rendered toggle state and any injected marks.
  clone.querySelectorAll('[data-skim-lightbox]').forEach((n) => n.removeAttribute('data-skim-lightbox'));

  const hasMath = !!article.querySelector('.skim-math');
  const sheets = ['src/skim.css', 'vendor/fonts.css'];
  if (hasMath) sheets.push('vendor/katex.min.css');

  const cssParts = [];
  for (const s of sheets) {
    try { cssParts.push(await inlineStylesheet(s)); }
    catch (e) { console.warn('Skim export: could not inline', s, e); }
  }

  const title = (document.title || 'Markdown document').trim();

  // Carry the whole look over, not just the dark/light base: the colour scheme
  // ("vibe") and reading density are separate <html> attributes, and an export
  // that dropped them came out in the plain dark/light palette instead of the
  // one on screen.
  const root = document.documentElement;
  const theme = root.getAttribute('data-theme') || 'dark';
  const carried = ['data-scheme', 'data-skim-density', 'data-skim-print-margin']
    .map((name) => [name, root.getAttribute(name)])
    .filter(([, value]) => value)
    .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
    .join('');

  return `<!doctype html>
<html lang="${escapeHtml(root.lang || 'en')}" data-skim-md="1" data-theme="${escapeHtml(theme)}"${carried}>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${EXPORT_CSP}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="Skim markdown viewer">
<title>${escapeHtml(title)}</title>
<style>
${cssParts.join('\n\n')}
body.skim-body { margin: 0; }
</style>
</head>
<body class="skim-body">
<div class="skim-container">
${clone.outerHTML}
</div>
</body>
</html>`;
}

// Trigger a download of the standalone HTML.
async function runExport(article, btn) {
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = '⏳ Exporting…';
  try {
    const html = await buildStandaloneHtml(article);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = safeFilename(document.title);
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch (e) {
    console.error('Skim: HTML export failed', e);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// Build the toolbar "Export HTML" button.
export function setupExportHtml(article) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'skim-export-html';
  btn.textContent = '🌐 Export HTML';
  btn.addEventListener('click', () => runExport(article, btn));
  return btn;
}
