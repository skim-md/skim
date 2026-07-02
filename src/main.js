// Content-script entry point. Detect a plaintext markdown page, render it in the
// dark theme (styled after charmbracelet's glow terminal app), and mount the UI chrome.
import { detectMarkdown, findPlaintextPre, isHugeSource } from './detect.js';
import { renderMarkdown } from './render.js';
import { fetchSourceBytes } from './source.js';
import { decodeMarkdownBytes } from './encoding.js';
import { watchSource } from './reload.js';
import { setupBlockNavigation } from './nav.js';
import { enhanceTables, refreshBreakouts } from './table.js';
import { decorateGlyphs } from './glyphs.js';
import { setupMarkdownCopy } from './copy-markdown.js';
import { setupAnchors } from './anchors.js';
import { setupPrintExport } from './print.js';
import { extractFrontmatter, buildFrontmatterCard } from './frontmatter.js';
import { renderMermaidBlocks } from './mermaid.js';
import {
  collectHeadings,
  buildToc,
  addCopyCodeButtons,
  enableMathCopy,
  buildViewToggle,
  buildThemeToggle,
  buildPaddingControl,
  buildToolbar,
  buildFolderButton,
  buildCopySourceButton,
  applyTheme,
  applyDensity,
} from './ui.js';
import { DEFAULTS, getSettings, migrateLocalSettings, onSettingsChanged } from './settings.js';

// The content script can't change browser zoom itself, so it asks the service
// worker. Only fired when the user has opted into a readingZoom setting.
function requestZoom(zoom) {
  try {
    chrome.runtime.sendMessage({ type: 'skim-set-zoom', zoom });
  } catch { /* extension context unavailable */ }
}

function injectExtensionStylesheet(path) {
  const href = chrome.runtime.getURL(path);
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  (document.head || document.documentElement).append(link);
}

// Reveal the page and dismiss the document_start loading splash (loader.css).
function markReady() {
  document.documentElement.dataset.skimReady = '1';
}

async function run() {
  const force = window.__skimForce === true;
  const detected = force
    ? { source: (findPlaintextPre(document) || document.body)?.textContent ?? '' }
    : detectMarkdown(document, location.href, document.contentType);
  // Not a plaintext markdown page: leave it untouched, but still clear the
  // splash so the original page shows.
  if (!detected) { markReady(); return; }

  // Chrome guessed the charset for the plaintext view; if the guess produced
  // replacement characters, re-read the bytes and decode properly.
  if (detected && detected.source.includes('�')) {
    const buf = await fetchSourceBytes();
    if (buf) detected.source = decodeMarkdownBytes(buf);
  }

  try {
    let settings;
    try {
      await migrateLocalSettings();
      settings = await getSettings();
    } catch {
      // Storage itself errored (e.g. quota/permissions) — render with defaults
      // rather than leaving the page stuck behind the loading splash.
      settings = { ...DEFAULTS };
    }
    render(detected, settings);
  } finally {
    // Always lift the splash — even if rendering throws — so we never get stuck
    // on the loader.
    markReady();
  }
}

// Fill `article` from markdown source and run every per-article decoration.
// Used for both the first render and in-place reloads (Task 8), so it must
// not assume anything about what was in `article` before.
function populateArticle(article, source, settings) {
  // Tear down the previous pass's listeners before re-running everything.
  // The article node itself survives auto-reload (only its innerHTML is
  // replaced), so without this, enhanceTables' window resize listener and
  // setupAnchors' article click listener would stack per reload. On the
  // first render these properties don't exist yet, so this is a no-op.
  article.skimTableTeardown?.();
  article.skimAnchorsTeardown?.();

  article.innerHTML = renderMarkdown(source);

  // Per-block bidi: let each block pick its own direction from its first strong
  // character so Hebrew renders RTL and English LTR within the same document.
  article
    .querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, ul, ol, blockquote, td, th, dd, dt')
    .forEach((node) => { node.setAttribute('dir', 'auto'); });

  // Open external links in a new tab; leave in-page anchors alone.
  article.querySelectorAll('a[href]').forEach((a) => {
    const href = a.getAttribute('href');
    if (href && !href.startsWith('#')) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
  });

  // Drop any baked-in image/video sizing so our CSS caps fully govern.
  article.querySelectorAll('img, video').forEach((media) => {
    media.removeAttribute('width');
    media.removeAttribute('height');
    for (const prop of ['width', 'height', 'max-width', 'max-height', 'min-width', 'min-height']) {
      media.style.removeProperty(prop);
    }
  });

  const huge = isHugeSource(source);

  // Star ratings, pretty symbols (⇒ etc.), and emoji presentation normalization.
  if (!huge) decorateGlyphs(article);

  // In-document anchors ({#id}) and smooth-scrolling internal links.
  setupAnchors(article);

  addCopyCodeButtons(article);
  enableMathCopy(article);

  // Needs the article mounted in the document (breakout needs layout) — both
  // callers only invoke populateArticle after the article is in the DOM.
  if (!huge) enhanceTables(article);

  // Mermaid diagrams: lazily import the bundled renderer only when the
  // article actually contains mermaid fences. Both callers (first render and
  // auto-reload) get this automatically since they only ever call
  // populateArticle after the article is mounted.
  if (settings.mermaid) renderMermaidBlocks(article).catch((e) => console.warn('Skim: mermaid failed to load', e));
}

function render(detected, settings) {
  // Mark the root so skim.css (injected via manifest) applies, and so we never
  // double-process. Checked first, before anything else runs (including the
  // zoom request), so a second call is a true no-op.
  if (document.documentElement.dataset.skimMd === '1') return;
  document.documentElement.dataset.skimMd = '1';

  if (settings.readingZoom > 0) requestZoom(settings.readingZoom);

  const rawSource = detected.source;
  let currentSource = rawSource;

  applyTheme(settings.theme);
  applyDensity(settings.density);

  injectExtensionStylesheet('vendor/fonts.css');
  injectExtensionStylesheet('vendor/katex.min.css');

  const article = document.createElement('article');
  article.className = 'skim markdown-body';
  article.dir = 'auto';

  // Mount an empty skeleton first so populateArticle's enhanceTables call has
  // real layout to measure.
  document.body.replaceChildren();
  document.body.className = 'skim-body';
  const container = document.createElement('div');
  container.className = 'skim-container';
  const main = document.createElement('main');
  main.className = 'skim-main';
  main.append(article);
  container.append(main);
  document.body.append(container);

  const { fields, body } = extractFrontmatter(rawSource);
  populateArticle(article, body, settings);
  if (fields) article.before(buildFrontmatterCard(fields));

  const headings = collectHeadings(article);

  // Build UI pieces (need headings from the now-populated article).
  const toc = buildToc(article, headings);
  const { button: viewToggle, rawPre } = buildViewToggle(article, rawSource);
  const themeToggle = buildThemeToggle(settings);
  const paddingControl = buildPaddingControl(settings);
  const exportControl = setupPrintExport(article, headings);
  const copySourceButton = buildCopySourceButton(() => currentSource);
  const folderButton = buildFolderButton();

  // Finish composing the page.
  if (toc) {
    container.classList.add('has-toc');
    container.prepend(toc);
  }
  main.append(rawPre);
  const toolbar = buildToolbar([themeToggle, paddingControl, exportControl, copySourceButton, viewToggle, folderButton].filter(Boolean));
  document.body.append(toolbar);

  // populateArticle sized table breakouts before the TOC existed, i.e. against
  // a wider column. Re-measure now that the final layout is in place, or wide
  // tables overflow the viewport (visible especially at high zoom / narrow
  // windows).
  refreshBreakouts(article);

  // Copying a selection yields the equivalent Markdown source.
  setupMarkdownCopy(article);

  // Tab / Shift+Tab block navigation (now that the article is in the document).
  // Keep the handle: auto-reload replaces article.innerHTML, which detaches
  // the blocks this snapshotted, so we resync via nav.refresh() instead of
  // calling setupBlockNavigation again (that would register a second
  // document-level keydown listener).
  const nav = setupBlockNavigation(article);

  // Title from the first heading, if any.
  const firstH = article.querySelector('h1, h2');
  if (firstH) document.title = firstH.textContent.trim();

  // Honor an initial #hash now that ids exist.
  if (location.hash) {
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) target.scrollIntoView();
  }

  // Live-sync theme/density changes made from another tab or the popup.
  // Resync the toolbar's own theme label and padding active-marks too, or
  // they'd read stale until the reader interacts with them directly.
  onSettingsChanged((patch) => {
    if (patch.theme) { applyTheme(patch.theme); themeToggle.skimSync?.(); }
    if (patch.density) { applyDensity(patch.density); paddingControl.skimSync?.(); }
  });

  // Auto-reload: poll the underlying file and re-render in place when it
  // changes on disk. setupMarkdownCopy delegates from `document`, so it
  // survives the article's innerHTML being replaced. setupBlockNavigation
  // does NOT: it snapshots blocks and binds per-node listeners at call time,
  // so those go stale once innerHTML is replaced — we resync via
  // nav.refresh() below instead of re-invoking setupBlockNavigation (which
  // would stack a second document-level keydown listener). Likewise each TOC
  // owns its own scrollspy window listeners via an AbortController; tear the
  // old one down before replacing/removing it so listeners don't accumulate.
  if (settings.autoReload) {
    watchSource({
      onChange: (text) => {
        currentSource = text;
        const y = window.scrollY;
        const { fields: freshFields, body: freshBody } = extractFrontmatter(text);
        document.querySelector('.skim-frontmatter')?.remove();
        populateArticle(article, freshBody, settings);
        if (freshFields) article.before(buildFrontmatterCard(freshFields));
        nav.refresh();
        const freshHeadings = collectHeadings(article);
        const freshToc = buildToc(article, freshHeadings);
        const oldToc = document.querySelector('.skim-toc');
        oldToc?.skimTeardown?.();
        if (oldToc && freshToc) oldToc.replaceWith(freshToc);
        else if (oldToc && !freshToc) { oldToc.remove(); container.classList.remove('has-toc'); }
        else if (!oldToc && freshToc) { container.classList.add('has-toc'); container.prepend(freshToc); }
        refreshBreakouts(article); // TOC swap may have changed column geometry
        rawPre.querySelector('code').textContent = text;
        window.scrollTo(0, y);
      },
    });
  }
}

function runSafely() {
  run().catch((e) => console.error('Skim: render failed', e));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', runSafely, { once: true });
} else {
  runSafely();
}
