// Lazy mermaid: the ~3.3MB bundle is only imported when a document actually
// contains a mermaid fence.
import { openNode } from './lightbox.js';

let mermaidPromise = null;

// Add a hover-visible "expand" control to a rendered diagram. Big diagrams are
// unreadable at column width; clicking opens the SVG in the shared zoom/pan
// overlay. No settings, one control.
function addMermaidControls(holder) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'skim-mermaid-expand';
  btn.setAttribute('aria-label', 'Expand diagram');
  btn.title = 'Expand (zoom & pan)';
  // Corner-arrows "expand" glyph.
  btn.innerHTML = '<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M2 2h5v2H4v3H2V2zm12 0v5h-2V4H9V2h5zM2 9h2v3h3v2H2V9zm10 3v-3h2v5H9v-2h3z"/></svg>';
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const svg = holder.querySelector('svg');
    if (svg) openNode(svg.cloneNode(true));
  });
  holder.append(btn);
}

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import(chrome.runtime.getURL('dist/mermaid.bundle.js')).then((mod) => {
      const mermaid = mod.default;
      const light = document.documentElement.getAttribute('data-theme') === 'light';
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: light ? 'default' : 'dark' });
      return mermaid;
    });
  }
  return mermaidPromise;
}

let counter = 0;

// Replace each mermaid source block with its rendered SVG. Parse errors leave
// the source block untouched. Returns how many diagrams rendered.
export async function renderMermaidBlocks(article) {
  const blocks = article.querySelectorAll('pre.skim-mermaid-src > code.language-mermaid');
  if (!blocks.length) return 0;
  const mermaid = await loadMermaid();
  let rendered = 0;
  for (const code of blocks) {
    const holder = document.createElement('div');
    holder.className = 'skim-mermaid';
    try {
      const { svg } = await mermaid.render(`skim-mmd-${counter++}`, code.textContent);
      holder.innerHTML = svg; // securityLevel: 'strict' sanitizes labels
      addMermaidControls(holder);
      code.closest('pre').replaceWith(holder);
      rendered++;
    } catch { /* leave source visible */ }
  }
  return rendered;
}
