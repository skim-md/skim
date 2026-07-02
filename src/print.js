// PDF export. A custom replacement for the browser's Ctrl+P that (1) prepends a
// table-of-contents cover page, (2) lets the reader choose a light or dark
// theme for the output, and (3) drives print-only CSS that wraps long table
// rows / code lines instead of letting them overflow off the page. The actual
// rendering is still done by window.print() -> "Save as PDF", which is the only
// reliable way to produce a PDF from a content script.

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of [].concat(children)) {
    node.append(c instanceof Node ? c : document.createTextNode(c));
  }
  return node;
}

// Append a heading's content to a node. Headings containing rendered KaTeX get
// their math cloned in (nested <a> unwrapped, since a link can't hold a link);
// the common math-free case stays plain text.
function appendHeadingContent(node, h) {
  if (h.html && h.html.includes('skim-math')) {
    const tmp = el('span');
    tmp.innerHTML = h.html;
    tmp.querySelectorAll('a').forEach((a) => a.replaceWith(...a.childNodes));
    node.append(...tmp.childNodes);
  } else {
    node.append(document.createTextNode(h.text));
  }
}

// Hierarchical section numbers ("1", "1.1", "1.2.1", …) aligned with the
// headings array, normalized to whatever the document's top heading level is so
// a doc that starts at H2 still numbers from 1.
function computeSectionNumbers(headings) {
  const minLevel = Math.min(...headings.map((h) => h.level));
  const counters = [];
  return headings.map((h) => {
    const rank = h.level - minLevel;
    counters.length = rank + 1;            // truncate deeper levels (reset them)
    for (let i = 0; i < rank; i++) if (counters[i] == null) counters[i] = 1;
    counters[rank] = (counters[rank] || 0) + 1;
    return counters.join('.');
  });
}

// Build the "Contents" cover section from the collected headings. Each entry is
// a real in-document anchor (Chrome's "Save as PDF" turns these into clickable
// internal links) prefixed with its section number. Hidden on screen (CSS);
// revealed only in @media print, where it carries a page break.
function buildCover(headings, numbers) {
  const cover = el('section', { className: 'skim-print-cover' });

  const title = (document.title || '').trim();
  if (title) cover.append(el('h1', { className: 'skim-print-title', textContent: title }));

  if (headings.length >= 2) {
    cover.append(el('div', { className: 'skim-print-toc-heading', textContent: 'Contents' }));
    const minLevel = Math.min(...headings.map((h) => h.level));
    const list = el('ul', { className: 'skim-print-toc' });
    headings.forEach((h, i) => {
      const link = el('a', { href: `#${h.id}`, className: 'skim-print-toc-link' });
      link.style.paddingInlineStart = `${(h.level - minLevel) * 16}px`;
      link.append(el('span', { className: 'skim-print-toc-num', textContent: numbers[i] }));
      const text = el('span', { className: 'skim-print-toc-text' });
      appendHeadingContent(text, h);
      link.append(text);
      list.append(el('li', { className: 'skim-print-toc-item' }, link));
    });
    cover.append(list);
  }
  return cover;
}

// Run the print flow. Exports always force the light theme (dark export was
// removed). The cover page is injected just before printing and removed
// afterwards, and the on-screen theme is restored so the live view is untouched.
function runPrint(article, headings) {
  const theme = 'light';
  const html = document.documentElement;
  const main = article.closest('.skim-main') || article.parentNode;
  if (!main) return;

  const prevTheme = html.getAttribute('data-theme');
  const numbers = headings.length ? computeSectionNumbers(headings) : [];
  const cover = buildCover(headings, numbers);
  // Only prepend the cover when it actually has content (a title and/or TOC),
  // so a heading-less, title-less document doesn't get a blank first page.
  if (cover.childNodes.length) main.insertBefore(cover, main.firstChild);

  // Stamp the same section numbers onto the live headings so the body matches
  // the TOC. Added only for the print, then removed.
  const stamps = [];
  headings.forEach((h, i) => {
    const head = document.getElementById(h.id);
    if (!head) return;
    const span = el('span', { className: 'skim-print-num', textContent: `${numbers[i]} ` });
    head.insertBefore(span, head.firstChild);
    stamps.push(span);
  });

  if (theme) html.setAttribute('data-theme', theme);

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    cover.remove();
    stamps.forEach((s) => s.remove());
    if (theme) {
      if (prevTheme) html.setAttribute('data-theme', prevTheme);
      else html.removeAttribute('data-theme');
    }
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);

  // window.print() is synchronous in Chromium: it returns once the print
  // dialog is dismissed, at which point afterprint has already fired. The
  // timeout is a backstop for browsers where afterprint never arrives.
  try {
    window.print();
  } finally {
    setTimeout(cleanup, 1500);
  }
}

// Build the toolbar "Export PDF" button and intercept Ctrl/Cmd+P so both export
// the document (always in the light theme). Returns the button to drop into the
// toolbar.
export function setupPrintExport(article, headings) {
  const btn = el('button', { className: 'skim-export-toggle', type: 'button', textContent: '⤓ Export PDF' });
  btn.addEventListener('click', () => runPrint(article, headings));

  // Ctrl/Cmd+P: replace the native print with our flow.
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      runPrint(article, headings);
    }
  });

  return btn;
}
