// UI chrome: table of contents, raw/rendered toggle, copy-code & copy-LaTeX buttons.
import { b64decode } from './render.js';
import { setSetting } from './settings.js';

// Turn heading text into a stable, unique slug id.
export function slugify(text, used) {
  let base = String(text)
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!base) base = 'section';
  let slug = base;
  let n = 1;
  while (used.has(slug)) slug = `${base}-${n++}`;
  used.add(slug);
  return slug;
}

// Assign ids to every heading in `article` and return TOC entries.
export function collectHeadings(article) {
  const used = new Set();
  const entries = [];
  article.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
    const custom = stripTrailingId(h);
    if (custom) { h.id = custom; used.add(custom); }
    else if (!h.id) h.id = slugify(h.textContent, used);
    else used.add(h.id);
    // Capture the rendered HTML too (it holds KaTeX math) so the TOC can show
    // math instead of textContent's garbled MathML+HTML concatenation. Safe to
    // reuse: this is already-sanitized article markup, captured before copy
    // buttons are attached.
    entries.push({ level: Number(h.tagName[1]), text: h.textContent, id: h.id, html: h.innerHTML });
  });
  return entries;
}

// Pull a trailing `{#custom-id}` off a heading: removes it from the rendered
// text and returns the id (or null). Lets `## Title {#id}` set a stable anchor.
export function stripTrailingId(el) {
  let node = el;
  while (node && node.lastChild) node = node.lastChild;
  if (!node || node.nodeType !== 3) return null; // 3 = TEXT_NODE
  const m = node.nodeValue.match(/\s*\{#([A-Za-z0-9_-]+)\}\s*$/);
  if (!m) return null;
  node.nodeValue = node.nodeValue.slice(0, m.index);
  return m[1];
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of [].concat(children)) {
    node.append(c instanceof Node ? c : document.createTextNode(c));
  }
  return node;
}

// Fill a TOC link. Headings with math get their rendered KaTeX cloned in (with
// any nested <a> unwrapped, since a link can't contain a link); the common
// math-free case stays plain text.
function setTocLinkContent(link, h) {
  if (h.html && h.html.includes('skim-math')) {
    const tmp = el('span');
    tmp.innerHTML = h.html;
    tmp.querySelectorAll('a').forEach((a) => a.replaceWith(...a.childNodes));
    link.append(...tmp.childNodes);
  } else {
    link.textContent = h.text;
  }
}

// Build the collapsible TOC sidebar. Hidden when fewer than 2 headings.
export function buildToc(article, headings) {
  if (headings.length < 2) return null;
  const minLevel = Math.min(...headings.map((h) => h.level));

  const list = el('ul', { className: 'skim-toc-list' });
  const linkById = new Map();
  for (const h of headings) {
    const link = el('a', { href: `#${h.id}`, className: 'skim-toc-link' });
    setTocLinkContent(link, h);
    link.style.paddingLeft = `${(h.level - minLevel) * 14 + 12}px`;
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = document.getElementById(h.id);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        history.replaceState(null, '', `#${h.id}`);
      }
    });
    linkById.set(h.id, link);
    list.append(el('li', { className: 'skim-toc-item' }, link));
  }

  const toc = el('nav', { className: 'skim-toc' });
  const toggle = el('button', { className: 'skim-toc-toggle', title: 'Toggle contents', textContent: '☰ Contents' });
  toggle.addEventListener('click', () => toc.classList.toggle('collapsed'));
  const body = el('div', { className: 'skim-toc-body' }, list);
  toc.append(toggle, body);

  setupScrollSpy(article, headings, linkById, toc);
  return toc;
}

// Highlight the TOC entry for whichever section is currently at the top of the
// viewport, and keep it scrolled into view within the sidebar. Auto-reload
// rebuilds a fresh TOC per content change, so each call gets its own
// AbortController; the caller must invoke the returned toc's
// `skimTeardown()` before discarding it, or the window listeners leak.
function setupScrollSpy(article, headings, linkById, toc) {
  const ids = headings.map((h) => h.id);
  let active = null;
  const controller = new AbortController();
  toc.skimTeardown = () => controller.abort();

  const update = () => {
    const offset = 120; // a heading counts as "current" once it passes this y
    let current = ids[0];
    for (const id of ids) {
      const elTop = document.getElementById(id)?.getBoundingClientRect().top ?? Infinity;
      if (elTop - offset <= 0) current = id;
      else break;
    }
    if (current === active) return;
    if (active) linkById.get(active)?.classList.remove('active');
    const link = linkById.get(current);
    if (link) {
      link.classList.add('active');
      // Keep the active item visible in a long, scrollable TOC.
      const body = toc.querySelector('.skim-toc-body');
      if (body && link.offsetTop < body.scrollTop) body.scrollTop = link.offsetTop - 8;
      else if (body && link.offsetTop + link.offsetHeight > body.scrollTop + body.clientHeight) {
        body.scrollTop = link.offsetTop + link.offsetHeight - body.clientHeight + 8;
      }
    }
    active = current;
  };

  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; update(); });
  };
  window.addEventListener('scroll', onScroll, { passive: true, signal: controller.signal });
  window.addEventListener('resize', onScroll, { passive: true, signal: controller.signal });
  update();
}

export async function copyText(text, button, okLabel) {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = okLabel;
  } catch {
    button.textContent = 'Failed';
  }
  setTimeout(() => { button.textContent = original; }, 1200);
}

// Add a hover "Copy" button to each code block.
export function addCopyCodeButtons(article) {
  article.querySelectorAll('pre.skim-code').forEach((pre) => {
    const code = pre.querySelector('code');
    if (!code) return;
    const btn = el('button', { className: 'skim-copy-btn', textContent: '⧉ Copy', type: 'button' });
    btn.addEventListener('click', () => copyText(code.textContent, btn, '✓ Copied'));
    pre.append(btn);
  });
}

// Double-click a rendered math block to copy its original LaTeX source.
export function enableMathCopy(article) {
  article.querySelectorAll('.skim-math[data-latex]').forEach((node) => {
    node.title = 'Double-click to copy LaTeX';
    node.addEventListener('dblclick', async (e) => {
      e.preventDefault();
      // Avoid leaving a text selection from the double-click.
      const sel = window.getSelection && window.getSelection();
      if (sel) sel.removeAllRanges();
      const source = b64decode(node.getAttribute('data-latex'));
      try {
        await navigator.clipboard.writeText(source);
        flashToast('Copied LaTeX');
      } catch {
        flashToast('Copy failed');
      }
    });
  });
}

// Brief floating confirmation toast.
let toastTimer = null;
function flashToast(message) {
  let toast = document.querySelector('.skim-toast');
  if (!toast) {
    toast = el('div', { className: 'skim-toast' });
    document.body.append(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 1100);
}

// Dark/Light theme toggle. Persisted via settings.js (chrome.storage.sync).
export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
}

export function buildThemeToggle(settings) {
  const label = (theme) => (theme === 'light' ? '☾ Dark' : '☀ Light');
  const btn = el('button', { className: 'skim-theme-toggle', type: 'button' });
  const sync = () => {
    const cur = document.documentElement.getAttribute('data-theme');
    btn.textContent = label(cur);
    btn.title = cur === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  };
  btn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next);
    sync();
    setSetting('theme', next).catch(() => {});
  });
  applyTheme(settings.theme);
  sync();
  // Exposed so callers can resync the label after applying an *external*
  // theme change (e.g. from onSettingsChanged, when the popup or another tab
  // changed it) without re-registering the click handler.
  btn.skimSync = sync;
  return btn;
}

// Reading density ("Padding"): normal (default) or big (more spacing).
// Persisted via settings.js and reflected on <html data-skim-density>.
export function applyDensity(density) {
  document.documentElement.setAttribute('data-skim-density', density);
}

// A "Padding" button that expands to let the reader choose Normal or Big spacing.
export function buildPaddingControl(settings) {
  const wrap = el('div', { className: 'skim-padding-control' });
  const toggle = el('button', { className: 'skim-padding-toggle', type: 'button', textContent: '↕ Padding' });
  const options = el('div', { className: 'skim-padding-options' });

  const make = (label, value) => {
    const b = el('button', { className: 'skim-padding-opt', type: 'button', textContent: label });
    b.dataset.value = value;
    b.addEventListener('click', () => {
      applyDensity(value);
      setSetting('density', value).catch(() => {});
      mark();
      wrap.classList.remove('open');
    });
    return b;
  };
  const normalBtn = make('Normal', 'normal');
  const bigBtn = make('Big', 'big');
  options.append(normalBtn, bigBtn);

  const mark = () => {
    const cur = document.documentElement.getAttribute('data-skim-density');
    normalBtn.classList.toggle('active', cur === 'normal');
    bigBtn.classList.toggle('active', cur === 'big');
  };

  toggle.addEventListener('click', () => wrap.classList.toggle('open'));
  wrap.append(toggle, options);
  applyDensity(settings.density);
  mark();
  // Exposed so callers can resync the active option after applying an
  // *external* density change (e.g. from onSettingsChanged) without
  // re-registering the option click handlers.
  wrap.skimSync = mark;
  return wrap;
}

// A collapsed half-tab fixed top-right. Clicking it reveals the given buttons;
// losing focus (click/tab away) or pressing Escape collapses it again.
export function buildToolbar(buttons) {
  const toolbar = el('div', { className: 'skim-toolbar' });
  const panel = el('div', { className: 'skim-toolbar-panel' });
  for (const b of buttons) panel.append(b);

  const handle = el('button', { className: 'skim-toolbar-handle', type: 'button', title: 'Options' });
  const sync = () => { handle.textContent = toolbar.classList.contains('open') ? '›' : '‹'; };
  const close = () => { toolbar.classList.remove('open'); sync(); };

  handle.addEventListener('click', () => { toolbar.classList.toggle('open'); sync(); });
  toolbar.addEventListener('focusout', (e) => {
    if (!toolbar.contains(e.relatedTarget)) close();
  });
  toolbar.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); handle.blur(); }
  });

  // panel first so it slides out to the left of the edge-anchored handle.
  toolbar.append(panel, handle);
  sync();
  return toolbar;
}

// "Open containing folder" button, shown for file:// documents only.
export function buildFolderButton() {
  if (location.protocol !== 'file:') return null;
  const btn = el('button', { className: 'skim-folder-btn', type: 'button', textContent: '📁 Folder' });
  btn.addEventListener('click', () => { location.href = new URL('.', location.href).href; });
  return btn;
}

// Copy the whole document's markdown source — one click to feed an LLM.
export function buildCopySourceButton(getSource) {
  const btn = el('button', { className: 'skim-copy-source', type: 'button', textContent: '⧉ Copy for AI' });
  btn.addEventListener('click', () => copyText(getSource(), btn, '✓ Copied'));
  return btn;
}

// Raw/Rendered toggle button fixed in the corner. Swaps the article for a <pre>
// of the original source and back.
export function buildViewToggle(article, rawSource) {
  let showingRaw = false;
  const pre = el('pre', { className: 'skim-raw', dir: 'auto' }, el('code', { textContent: rawSource }));
  pre.style.display = 'none';

  const btn = el('button', { className: 'skim-view-toggle', type: 'button', textContent: '</> View Raw' });
  btn.addEventListener('click', () => {
    showingRaw = !showingRaw;
    article.style.display = showingRaw ? 'none' : '';
    pre.style.display = showingRaw ? '' : 'none';
    btn.textContent = showingRaw ? '¶ View Rendered' : '</> View Raw';
  });
  return { button: btn, rawPre: pre };
}
