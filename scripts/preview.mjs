// Build a standalone preview.html by running the real render pipeline over a
// markdown file, mirroring how main.js assembles the page. For visual checks.
import '../tests/setup-dom.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { renderMarkdown } = await import('../src/render.js');

const mdPath = process.argv[2] || resolve(root, 'examples/sample.md');
const source = readFileSync(mdPath, 'utf8');
const inner = renderMarkdown(source);

const doc = global.document;
const article = doc.createElement('article');
article.className = 'skim markdown-body';
article.dir = 'auto';
article.innerHTML = inner;
article
  .querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, ul, ol, blockquote, td, th, dd, dt')
  .forEach((n) => n.setAttribute('dir', 'auto'));

// Minimal static TOC (interactive behavior lives in ui.js at runtime).
const used = new Set();
const slug = (t) => {
  let b = t.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-') || 'section';
  let s = b, n = 1; while (used.has(s)) s = `${b}-${n++}`; used.add(s); return s;
};
const heads = [...article.querySelectorAll('h1,h2,h3,h4,h5,h6')];
heads.forEach((h) => { if (!h.id) h.id = slug(h.textContent); });
const minL = Math.min(...heads.map((h) => +h.tagName[1]));
const tocItems = heads.map((h) =>
  `<li class="skim-toc-item"><a class="skim-toc-link" href="#${h.id}" style="padding-left:${(+h.tagName[1]-minL)*14+12}px">${h.textContent}</a></li>`
).join('');

const skimCss = readFileSync(resolve(root, 'src/skim.css'), 'utf8');

const html = `<!doctype html>
<html data-skim-md="1" data-theme="dark">
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="vendor/katex.min.css">
<style>${skimCss}</style>
</head>
<body class="skim-body">
<div class="skim-container has-toc">
  <nav class="skim-toc"><button class="skim-toc-toggle">☰ Contents</button><div class="skim-toc-body"><ul class="skim-toc-list">${tocItems}</ul></div></nav>
  <main class="skim-main">${article.outerHTML}</main>
</div>
<button class="skim-view-toggle">View Raw</button>
</body></html>`;

writeFileSync(resolve(root, 'preview.html'), html);
console.log('wrote preview.html');
