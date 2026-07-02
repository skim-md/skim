// Lazy mermaid: the ~3.3MB bundle is only imported when a document actually
// contains a mermaid fence.
let mermaidPromise = null;

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
      code.closest('pre').replaceWith(holder);
      rendered++;
    } catch { /* leave source visible */ }
  }
  return rendered;
}
