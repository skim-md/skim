// In-document anchors and internal links.
//   - Define a target anywhere with `{#my-id}` (becomes an invisible anchor).
//   - Headings take a trailing `{#my-id}` as their id (handled in ui.js).
//   - Jump to one with a normal Markdown link: `[label](#my-id)`.
// Internal links get smooth scrolling and a distinct underline (see skim.css).
import { replaceInTextNodes } from './glyphs.js';

const ANCHOR_RE = /\{#([A-Za-z0-9_-]+)\}/g;

// Turn `{#id}` tokens in body text into empty <a id="id"> anchor targets.
export function createAnchorMarkup(root) {
  replaceInTextNodes(root, ANCHOR_RE, (match) => {
    const a = document.createElement('a');
    a.className = 'skim-anchor';
    a.id = match.slice(2, -1);          // strip "{#" and "}"
    a.setAttribute('aria-hidden', 'true');
    return a;
  });
}

// Smooth-scroll clicks on in-page links (href="#id") and reflect the hash.
//
// Auto-reload calls setupAnchors again on the same `article` node each time
// the file changes on disk (Task 8); since the article element itself is
// reused (only its innerHTML is replaced), a plain addEventListener here
// would stack a new click listener per pass. Tie it to an AbortController
// whose abort function is exposed as `article.skimAnchorsTeardown` (mirroring
// `toc.skimTeardown` in ui.js); the caller (main.js) tears down the previous
// pass before invoking this again.
export function enableInternalLinks(article) {
  const controller = new AbortController();
  article.skimAnchorsTeardown = () => controller.abort();
  article.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || !article.contains(a)) return;
    const id = decodeURIComponent(a.getAttribute('href').slice(1));
    const target = id && document.getElementById(id);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try { history.replaceState(null, '', `#${id}`); } catch { /* ignore */ }
  }, { signal: controller.signal });
}

export function setupAnchors(article) {
  createAnchorMarkup(article);
  enableInternalLinks(article);
}
