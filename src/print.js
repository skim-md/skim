// PDF export. A custom replacement for the browser's Ctrl+P that (1) prepends a
// table-of-contents cover page, (2) lets the reader choose a light or dark
// theme for the output, and (3) drives print-only CSS that wraps long table
// rows / code lines instead of letting them overflow off the page. The actual
// rendering is still done by window.print() -> "Save as PDF", which is the only
// reliable way to produce a PDF from a content script.
import { setSetting } from './settings.js';
import { applyPrintMargin } from './ui.js';

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
  if (h.content && h.content.querySelector('.skim-math')) {
    const tmp = el('span');
    tmp.append(h.content.cloneNode(true));
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

// A heading that already carries its own number: "5. Model", "5) Model",
// "5.1 Model", "5.1. Model", "01-02. Model" (a section covering a range). A
// bare leading figure is deliberately not enough ("3 ways to win", "2024 in
// review" are titles, not section numbers), so a single-level number has to be
// followed by a "." or ")" to count.
const SELF_NUMBERED = /^\s*(?:\d+(?:\.\d+)+[.)]?|\d+(?:[-\u2013]\d+)?[.)])\s+\S/;

// Whether the document numbers its own headings, in which case the export must
// not stamp a second, computed number on top ("1.5 5. Model"). One match can be
// a coincidence, so it takes two — or a doc whose every heading is numbered.
function isSelfNumbered(headings) {
  const n = headings.filter((h) => SELF_NUMBERED.test(h.text)).length;
  return n >= 2 || (n > 0 && n === headings.length);
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
      // No number column at all when the document numbers itself — the heading
      // text already starts with "5.", and the entry stays left-aligned.
      if (numbers[i]) link.append(el('span', { className: 'skim-print-toc-num', textContent: numbers[i] }));
      const text = el('span', { className: 'skim-print-toc-text' });
      appendHeadingContent(text, h);
      link.append(text);
      list.append(el('li', { className: 'skim-print-toc-item' }, link));
    });
    cover.append(list);
  }
  return cover;
}

// Chrome never paints the document background into the sheet's @page margin
// area, so a themed export comes out as a coloured block floating in a white
// frame. Fix: for the duration of the export drop the page margin to zero (the
// background then bleeds to the paper edge) and draw the margin ourselves.
//
// Padding alone can't do it: on a multi-page document padding only indents the
// first and last page. Empty <thead>/<tfoot> rows are the one box Chrome
// repeats on every printed page, so the body is wrapped in a table whose
// header/footer rows are the top/bottom gutters and whose cell padding is the
// left/right gutter. Returns an undo function.
//
// The `@page` override lives in an injected stylesheet rather than skim.css so
// a plain browser-menu print (which never runs this flow, and so has no gutter
// table) keeps the normal margins instead of printing edge-to-edge.
function installPageGutters(main, skip) {
  const style = el('style', {
    className: 'skim-print-page-style',
    textContent: '@media print { @page { margin: 0; } }',
  });
  (document.head || document.documentElement).append(style);

  const gutterRow = () => el('tr', {}, el('td', { className: 'skim-print-gutter' }));
  const cell = el('td', { className: 'skim-print-cell' });
  const table = el('table', { className: 'skim-print-page' }, [
    el('thead', {}, gutterRow()),
    el('tfoot', {}, gutterRow()),
    el('tbody', {}, el('tr', {}, cell)),
  ]);

  // Attach the table before moving anything into it, so the content is never
  // detached from the document (which would collapse the scroll position).
  main.append(table);
  const moved = [...main.childNodes].filter((n) => n !== table && n !== skip);
  cell.append(...moved);

  return () => {
    main.append(...[...cell.childNodes]);   // cover stays first; the rest keep order
    table.remove();
    style.remove();
  };
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

  // Expand every collapsed <details> so its content prints instead of being
  // hidden behind a closed <summary>. Remember only the ones we actually
  // opened, so afterprint restores each to exactly how it was: already-open
  // ones are left untouched (stay open), and the ones we forced open get
  // closed again.
  const openedDetails = [];
  article.querySelectorAll('details').forEach((d) => {
    if (!d.open) { d.open = true; openedDetails.push(d); }
  });

  // Number the sections ourselves, unless the document already does.
  const numbers = headings.length && !isSelfNumbered(headings) ? computeSectionNumbers(headings) : [];
  const cover = buildCover(headings, numbers);
  // Only prepend the cover when it actually has content (a title and/or TOC),
  // so a heading-less, title-less document doesn't get a blank first page.
  if (cover.childNodes.length) main.insertBefore(cover, main.firstChild);

  // Stamp the same section numbers onto the live headings so the body matches
  // the TOC. Added only for the print, then removed.
  const stamps = [];
  if (numbers.length) {
    headings.forEach((h, i) => {
      const head = document.getElementById(h.id);
      if (!head) return;
      const span = el('span', { className: 'skim-print-num', textContent: `${numbers[i]} ` });
      head.insertBefore(span, head.firstChild);
      stamps.push(span);
    });
  }

  if (theme) html.setAttribute('data-theme', theme);

  // The cover is left outside the gutter table: it is a page of its own and
  // pads itself, and its break-after keeps working as a plain sibling.
  const scrollY = window.scrollY;
  const removeGutters = installPageGutters(main, cover);

  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    removeGutters();
    if (scrollY) window.scrollTo(0, scrollY);
    cover.remove();
    stamps.forEach((s) => s.remove());
    openedDetails.forEach((d) => { d.open = false; });
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

// Page-margin choices, offered next to the export button. The sizes themselves
// live in skim.css (--skim-print-margin per tier).
const MARGINS = [
  { value: 'none',   label: '0',  title: 'No margin, content to the paper edge' },
  { value: 'narrow', label: 'S',  title: 'Narrow margin (0.8 cm)' },
  { value: 'normal', label: 'M',  title: 'Normal margin (1.6 cm)' },
  { value: 'wide',   label: 'L',  title: 'Wide margin (2.4 cm)' },
];

// The margin row under the export button. Writes the same `printMargin` setting
// as the popup, and reads the current value straight off <html> so both stay in
// step without either having to know about the other.
function buildMarginPicker() {
  // Two stacked lines ("Export" over "Margin") so the label says what the
  // margin applies to without widening the row.
  const row = el('div', { className: 'skim-export-margins' }, el('span', {
    className: 'skim-export-margins-label',
  }, [el('span', { textContent: 'Export' }), el('span', { textContent: 'Margin' })]));
  const optByValue = new Map();
  const mark = () => {
    const cur = document.documentElement.getAttribute('data-skim-print-margin') || 'normal';
    for (const [value, opt] of optByValue) opt.classList.toggle('active', value === cur);
  };
  for (const m of MARGINS) {
    const opt = el('button', { className: 'skim-export-margin-opt', type: 'button', textContent: m.label, title: m.title });
    opt.dataset.value = m.value;
    opt.addEventListener('click', () => {
      applyPrintMargin(m.value);
      setSetting('printMargin', m.value).catch(() => {});
      mark();
    });
    optByValue.set(m.value, opt);
    row.append(opt);
  }
  mark();
  row.skimSync = mark;
  return row;
}

// Build the toolbar export control — the "Export PDF" button plus its page-margin
// picker — and intercept Ctrl/Cmd+P so both export the document (always in the
// light theme). Returns the control to drop into the toolbar.
export function setupPrintExport(article, headings) {
  const btn = el('button', { className: 'skim-export-toggle', type: 'button', textContent: '📄 Export PDF' });
  btn.addEventListener('click', () => runPrint(article, headings));

  // Ctrl/Cmd+P: replace the native print with our flow.
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'p' || e.key === 'P')) {
      e.preventDefault();
      runPrint(article, headings);
    }
  });

  const margins = buildMarginPicker();
  const wrap = el('div', { className: 'skim-export-control' }, [btn, margins]);
  wrap.skimSync = margins.skimSync;   // resync after a popup/other-tab change
  return wrap;
}
