// Copy-as-Markdown: when the user copies a selection from the rendered article,
// put the equivalent Markdown source on the clipboard instead of the rendered
// text. Math comes back as $latex$ (from the stored source), emoji as their
// character, prettified symbols (⇒ etc.) as their original character.
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { b64decode } from './render.js';

let service = null;

function getService() {
  if (service) return service;
  service = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  });
  service.use(gfm);

  // Strip UI-only bits that may fall inside a selection.
  service.remove((node) => node.classList && (
    node.classList.contains('skim-table-copy') ||
    node.classList.contains('skim-sort-ind') ||
    node.classList.contains('skim-copy-btn')
  ));

  // Rendered math -> $latex$ / $$latex$$ from the stored source.
  service.addRule('skim-math', {
    filter: (node) => node.classList && node.classList.contains('skim-math'),
    replacement: (content, node) => {
      let src = '';
      try { src = b64decode(node.getAttribute('data-latex') || ''); } catch { src = ''; }
      if (!src) return content;
      return node.classList.contains('skim-math-display') ? `\n\n$$\n${src}\n$$\n\n` : `$${src}$`;
    },
  });

  // Prettified symbols (⇒, ≤, …) -> their original character.
  service.addRule('skim-sym', {
    filter: (node) => node.classList && node.classList.contains('skim-sym'),
    replacement: (content, node) => node.getAttribute('data-sym') || content,
  });

  // Emoji rendered as <img class="skim-emoji" alt="..."> -> the emoji
  // character from its alt text. Skim renders emoji natively (no image-based
  // emoji font), so this is defensive/legacy handling in case any img with
  // this class and an alt character ever reaches the selection.
  service.addRule('skim-emoji', {
    filter: (node) => node.nodeName === 'IMG' && node.classList && node.classList.contains('skim-emoji'),
    replacement: (_content, node) => node.getAttribute('alt') || '',
  });

  return service;
}

// Convert a rendered-HTML fragment to Markdown.
export function htmlToMarkdown(html) {
  return getService().turndown(html).trim();
}

// Intercept copy within `article` and replace the clipboard text with Markdown.
export function setupMarkdownCopy(article) {
  document.addEventListener('copy', (e) => {
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    // Only handle selections that live inside the rendered article.
    if (!article.contains(sel.anchorNode) && !article.contains(sel.focusNode)) return;

    const container = document.createElement('div');
    for (let i = 0; i < sel.rangeCount; i++) {
      container.appendChild(sel.getRangeAt(i).cloneContents());
    }
    const md = htmlToMarkdown(container.innerHTML);
    if (!md || !e.clipboardData) return;
    e.clipboardData.setData('text/plain', md);
    e.preventDefault();
  });
}
