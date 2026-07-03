import './setup-dom.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { protectMath, bareTextToProse, b64decode, renderMarkdown } = await import('../src/render.js');
const { hasMarkdownExtension, findPlaintextPre, detectMarkdown, isHugeSource } = await import('../src/detect.js');
const { slugify, collectHeadings, buildToc } = await import('../src/ui.js');
const { setupBlockNavigation } = await import('../src/nav.js');
const { extractFrontmatter, buildFrontmatterCard } = await import('../src/frontmatter.js');
const { EMOJI } = await import('../src/emoji.js');
const { setupLightbox, _test: lightbox } = await import('../src/lightbox.js');

// --- math protection ---------------------------------------------------
test('protectMath extracts block and inline math with placeholders', () => {
  const { text, math } = protectMath('Energy $E=mc^2$ and block:\n$$\\int_0^1 x\\,dx$$');
  assert.equal(math.length, 2);
  assert.ok(math.some((m) => m.display === true && m.source.includes('\\int')));
  assert.ok(math.some((m) => m.display === false && m.source === 'E=mc^2'));
  assert.ok(!text.includes('$'), 'dollar delimiters removed');
  assert.match(text, /SKIMMATH\d/);
});

test('protectMath leaves bare currency alone', () => {
  const { math } = protectMath('It costs $5 and then $6 total.');
  assert.equal(math.length, 0);
});

test('protectMath ignores escaped dollar signs', () => {
  const { math } = protectMath('Literally \\$x\\$ here.');
  assert.equal(math.length, 0);
});

test('protectMath leaves $ inside fenced code alone (no cross-block math)', () => {
  // Two JSON blocks with "$schema" each. Naively, the two `$` would pair up and
  // swallow the closing fence + heading between them into one bogus math span.
  const src = [
    '```json',
    '{ "$schema": "http://json-schema.org/draft-07/schema#" }',
    '```',
    '#### heading',
    '```json',
    '{ "$schema": "http://json-schema.org/draft-07/schema#" }',
    '```',
  ].join('\n');
  const { text, math } = protectMath(src);
  assert.equal(math.length, 0);
  assert.equal(text, src); // untouched: no placeholders injected into code
});

test('protectMath ignores $ inside inline code but keeps real inline math', () => {
  const { math } = protectMath('Use `$schema` here but $x+y$ is math.');
  assert.equal(math.length, 1);
  assert.equal(math[0].source, 'x+y');
});

test('protectMath captures bare \\begin..\\end environments as display math', () => {
  const src = 'Before\n\n\\begin{gathered}\na = b \\\\\nc = d\n\\end{gathered}\n\nAfter';
  const { text, math } = protectMath(src);
  assert.equal(math.length, 1);
  assert.equal(math[0].display, true);
  assert.match(math[0].source, /\\begin\{gathered\}[\s\S]*\\end\{gathered\}/);
  assert.ok(!text.includes('\\begin'), 'environment replaced by placeholder');
});

test('protectMath handles starred environments and aligned/binom', () => {
  const a = protectMath('\\begin{aligned}\n& x = \\binom{1}{2} \\\\\n& y = 0\n\\end{aligned}');
  assert.equal(a.math.length, 1);
  assert.equal(a.math[0].display, true);
  const b = protectMath('\\begin{align*}\na &= b\n\\end{align*}');
  assert.equal(b.math.length, 1);
});

test('protectMath unwraps a prose-only \\text{...} line to plain text (no math)', () => {
  const { math, text } = protectMath('\\text { Algorithm 2 updates two components (the rest do not change), }');
  assert.equal(math.length, 0, 'no math produced');
  assert.ok(!text.includes('\\text'));
  assert.match(text, /Algorithm 2 updates two components \(the rest do not change\),/);
});

test('protectMath keeps a \\text line that contains real math as math', () => {
  const { math } = protectMath('\\text { Case 1: } \\lambda_{1}=0');
  assert.equal(math.length, 1);
  assert.equal(math[0].display, false);
});

test('bareTextToProse joins multiple \\text segments and rejects math', () => {
  assert.equal(
    bareTextToProse('\\text { Algorithm } 2 \\text { updates the vector, }'),
    'Algorithm 2 updates the vector,'
  );
  assert.equal(bareTextToProse('\\text { Case } \\nabla x'), null);
});

test('protectMath leaves ordinary backslashes/prose alone', () => {
  const { math } = protectMath('A path C:\\\\Users and a line.\n\nNormal paragraph.');
  assert.equal(math.length, 0);
});

// --- base64 round trip (incl. Hebrew) ---------------------------------
test('b64 round trips unicode including Hebrew', async () => {
  const { renderMarkdown: _r } = await import('../src/render.js');
  // protectMath then render so data-latex is produced; decode it back.
  const html = renderMarkdown('inline $x_{\\text{שלום}}$ done');
  const m = html.match(/data-latex="([^"]+)"/);
  assert.ok(m, 'rendered math carries data-latex');
  assert.equal(b64decode(m[1]), 'x_{\\text{שלום}}');
});

test('escaped asterisk in math (\\*) renders, not a KaTeX error', () => {
  const html = renderMarkdown('Inline $p^\\*$ done');
  assert.match(html, /skim-math-inline/);
  assert.doesNotMatch(html, /skim-math-error/);
  assert.doesNotMatch(html, /Undefined control sequence/i);
  // Source is preserved verbatim for the Copy-LaTeX button.
  const m = html.match(/data-latex="([^"]+)"/);
  assert.ok(m && b64decode(m[1]) === 'p^\\*');
});

// --- detection ---------------------------------------------------------
test('hasMarkdownExtension matches md variants and not others', () => {
  assert.ok(hasMarkdownExtension('file:///home/a/readme.md'));
  assert.ok(hasMarkdownExtension('https://x.com/a/b.markdown?ref=1'));
  assert.ok(hasMarkdownExtension('https://x.com/a/b.mdx#top'));
  assert.ok(!hasMarkdownExtension('https://x.com/a/b.html'));
  assert.ok(!hasMarkdownExtension('https://x.com/a/index'));
});

test('findPlaintextPre finds the single <pre> Chrome uses for text', () => {
  const dom = new global.window.DOMParser().parseFromString(
    '<html><body><pre>* hi *</pre></body></html>', 'text/html');
  const pre = findPlaintextPre(dom);
  assert.ok(pre);
  assert.equal(pre.textContent, '* hi *');
});

test('findPlaintextPre returns null for a real HTML page', () => {
  const dom = new global.window.DOMParser().parseFromString(
    '<html><body><div><p>hello</p><pre>x</pre></div></body></html>', 'text/html');
  assert.equal(findPlaintextPre(dom), null);
});

test('detectMarkdown requires both md url and plaintext shape', () => {
  const md = new global.window.DOMParser().parseFromString(
    '<html><body><pre># Title</pre></body></html>', 'text/html');
  assert.deepEqual(detectMarkdown(md, 'file:///x/readme.md', 'text/plain'), { source: '# Title' });
  // right shape, wrong url:
  assert.equal(detectMarkdown(md, 'file:///x/readme.txt', 'text/plain'), null);
});

test('huge sources are flagged past 1.5MB', () => {
  assert.equal(isHugeSource('x'.repeat(100)), false);
  assert.equal(isHugeSource('x'.repeat(1_600_000)), true);
});

// --- slugify -----------------------------------------------------------
test('slugify makes unique, url-safe ids', () => {
  const used = new Set();
  assert.equal(slugify('Hello World', used), 'hello-world');
  assert.equal(slugify('Hello World', used), 'hello-world-1');
  assert.equal(slugify('!!!', used), 'section');
});

test('collectHeadings assigns ids and returns structure', () => {
  const doc = global.document;
  const article = doc.createElement('article');
  article.innerHTML = '<h1>Intro</h1><h2>Setup</h2><h2>Setup</h2>';
  const headings = collectHeadings(article);
  assert.equal(headings.length, 3);
  assert.deepEqual(headings.map((h) => h.id), ['intro', 'setup', 'setup-1']);
  assert.deepEqual(headings.map((h) => h.level), [1, 2, 2]);
});

test('buildToc renders KaTeX math in heading links instead of garbled text', () => {
  const doc = global.document;
  const article = doc.createElement('article');
  // Mimic post-render headings: one with KaTeX math, one with a nested link.
  article.innerHTML =
    '<h1>Plain Intro</h1>' +
    '<h2>Energy <span class="skim-math skim-math-inline" data-latex="RT1tYz4y">' +
    '<span class="katex"><span class="katex-mathml">E=mc2</span>' +
    '<span class="katex-html">E=mc²</span></span></span></h2>' +
    '<h2>See <a href="#x">link</a> here</h2>';
  const headings = collectHeadings(article);
  const toc = buildToc(article, headings);
  const links = toc.querySelectorAll('.skim-toc-link');
  // Math heading: the KaTeX markup is cloned into the link.
  assert.ok(links[1].querySelector('.katex'), 'TOC link should contain rendered KaTeX');
  // Nested <a> from the third heading must be unwrapped (no link-in-link).
  assert.equal(links[2].querySelectorAll('a').length, 0);
  assert.match(links[2].textContent, /See\s*link\s*here/);
});

// --- full render -------------------------------------------------------
test('renderMarkdown produces sanitized html with code, math, tables', () => {
  const html = renderMarkdown([
    '# Title',
    '',
    'Some `inline` code and **bold**.',
    '',
    '```js',
    'const x = 1;',
    '```',
    '',
    '| a | b |',
    '| - | - |',
    '| 1 | 2 |',
    '',
    'Math $a^2$ inline.',
  ].join('\n'));
  assert.match(html, /<h1[^>]*>Title<\/h1>/);
  assert.match(html, /skim-code/);
  assert.match(html, /hljs/);
  assert.match(html, /<table>/);
  assert.match(html, /class="skim-math skim-math-inline"/);
  assert.match(html, /katex/);
});

test('renderMarkdown strips dangerous html (sanitization)', () => {
  const html = renderMarkdown('Hi <script>alert(1)</script> <img src=x onerror=alert(1)>');
  assert.ok(!/<script/i.test(html));
  assert.ok(!/onerror/i.test(html));
});

test('renderMarkdown keeps images', () => {
  const html = renderMarkdown('![alt](https://example.com/pic.png)');
  assert.match(html, /<img[^>]+src="https:\/\/example\.com\/pic\.png"/);
});

test('render: mermaid fences keep their source unhighlighted with language class', () => {
  const html = renderMarkdown('```mermaid\ngraph TD; A-->B;\n```');
  assert.match(html, /<pre class="skim-code skim-mermaid-src"><code class="language-mermaid">/);
  assert.match(html, /graph TD; A--&gt;B;/);
});

// --- GitHub alerts / admonitions --------------------------------------
test('renderMarkdown renders a > [!NOTE] blockquote as a styled callout', () => {
  const html = renderMarkdown('> [!NOTE]\n> Useful information.');
  assert.match(html, /<div class="skim-alert skim-alert-note">/);
  assert.match(html, /class="skim-alert-title"[^>]*>[\s\S]*Note/);
  assert.match(html, /Useful information\./);
  // It must not also render a raw blockquote wrapper for the alert.
  assert.ok(!/<blockquote>[\s\S]*\[!NOTE\]/.test(html));
});

test('renderMarkdown supports all five GitHub alert types', () => {
  for (const [kw, cls, title] of [
    ['NOTE', 'note', 'Note'],
    ['TIP', 'tip', 'Tip'],
    ['IMPORTANT', 'important', 'Important'],
    ['WARNING', 'warning', 'Warning'],
    ['CAUTION', 'caution', 'Caution'],
  ]) {
    const html = renderMarkdown(`> [!${kw}]\n> body`);
    assert.match(html, new RegExp(`skim-alert skim-alert-${cls}`), `${kw} class`);
    assert.match(html, new RegExp(`skim-alert-title[^>]*>[\\s\\S]*${title}`), `${kw} title`);
  }
});

test('alert is case-insensitive and carries an inline icon that survives sanitization', () => {
  const html = renderMarkdown('> [!warning]\n> Careful now.');
  assert.match(html, /skim-alert-warning/);
  assert.match(html, /<svg[^>]*class="skim-alert-icon"/);
  assert.match(html, /<path/); // octicon path kept by DOMPurify svg profile
});

test('a plain blockquote (no marker) stays a blockquote, and text after the marker is not an alert', () => {
  assert.match(renderMarkdown('> just a normal quote'), /<blockquote>/);
  // GitHub only treats the marker as an alert when it is alone on the first line.
  const html = renderMarkdown('> [!NOTE] trailing text\n> body');
  assert.ok(!/skim-alert/.test(html));
  assert.match(html, /<blockquote>/);
});

test('alert bodies render nested markdown (bold, lists) inside the callout', () => {
  const html = renderMarkdown('> [!TIP]\n> Use **bold** and:\n>\n> - one\n> - two');
  assert.match(html, /skim-alert-tip/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<li>one<\/li>/);
});

// --- footnotes ---------------------------------------------------------
test('renderMarkdown renders footnote references and a definition list with backrefs', () => {
  const html = renderMarkdown('Text with a note.[^1]\n\n[^1]: The footnote body.');
  // Reference: superscript link into the definition.
  assert.match(html, /<sup>[\s\S]*href="#footnote-1"[\s\S]*>1<\/a>/);
  // Definition list at the end.
  assert.match(html, /<(section|div)[^>]*class="footnotes"/);
  assert.match(html, /id="footnote-1"/);
  assert.match(html, /The footnote body\./);
  // Backref anchor returns to the reference.
  assert.match(html, /href="#footnote-ref-1"/);
});

test('footnote definitions parse inline markdown and survive sanitization', () => {
  const html = renderMarkdown('See below.[^a]\n\n[^a]: A def with **bold** and a [link](https://example.com).');
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /href="https:\/\/example\.com"/);
  assert.ok(!/onerror/i.test(html));
});

test('multiple references to the same footnote share one definition', () => {
  const html = renderMarkdown('First.[^x] Second.[^x]\n\n[^x]: shared.');
  const defs = (html.match(/id="footnote-x"/g) || []).length;
  assert.equal(defs, 1, 'exactly one definition list item for the shared footnote');
});

// --- table helpers -----------------------------------------------------
const { parseNumeric, detectColumnType, compareValues, sortRows, serializeTable, computeBreakout, enhanceTables } = await import('../src/table.js');

test('parseNumeric handles plain, signed, currency, percent, thousands', () => {
  assert.equal(parseNumeric('42'), 42);
  assert.equal(parseNumeric('-3.5'), -3.5);
  assert.equal(parseNumeric('$1,234.50'), 1234.5);
  assert.equal(parseNumeric('80%'), 80);
  assert.equal(parseNumeric('  7 '), 7);
});

test('parseNumeric rejects non-numbers', () => {
  assert.equal(parseNumeric('abc'), null);
  assert.equal(parseNumeric(''), null);
  assert.equal(parseNumeric('5 apples'), null);
  assert.equal(parseNumeric('12/5'), null);
});

test('detectColumnType classifies number, date, text', () => {
  assert.equal(detectColumnType(['1', '2', '3']), 'number');
  assert.equal(detectColumnType(['$1', '2', '']), 'number');
  assert.equal(detectColumnType(['2024-01-15', '2023-12-01']), 'date');
  assert.equal(detectColumnType(['apple', 'banana']), 'text');
  assert.equal(detectColumnType(['', '']), 'text');
});

test('compareValues orders by type and sends empties last', () => {
  assert.ok(compareValues('2', '10', 'number') < 0);
  assert.ok(compareValues('10', '2', 'number') > 0);
  assert.ok(compareValues('', '5', 'number') > 0);
  assert.ok(compareValues('2023-01-01', '2024-01-01', 'date') < 0);
  assert.ok(compareValues('apple', 'banana', 'text') < 0);
});

function rowsFromArrays(arrays) {
  const body = document.createElement('tbody');
  for (const cells of arrays) {
    const tr = document.createElement('tr');
    for (const c of cells) {
      const td = document.createElement('td');
      td.textContent = c;
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  return Array.from(body.rows);
}

test('sortRows sorts numerically ascending and descending, stably', () => {
  const rows = rowsFromArrays([['b', '10'], ['a', '2'], ['c', '2']]);
  const asc = sortRows(rows, 1, 'number', 'asc').map((r) => r.cells[0].textContent);
  assert.deepEqual(asc, ['a', 'c', 'b']);
  const desc = sortRows(rows, 1, 'number', 'desc').map((r) => r.cells[0].textContent);
  assert.deepEqual(desc, ['b', 'a', 'c']);
});

test('serializeTable produces TSV with header and normalized cells', () => {
  const table = document.createElement('table');
  table.innerHTML =
    '<thead><tr><th>Name</th><th>Qty</th></tr></thead>' +
    '<tbody><tr><td>Apple\tPie</td><td>3</td></tr><tr><td>Pear</td><td>5</td></tr></tbody>';
  assert.equal(serializeTable(table), 'Name\tQty\nApple Pie\t3\nPear\t5');
});

test('computeBreakout returns null when the table fits its column', () => {
  assert.equal(computeBreakout({ naturalWidth: 400, columnLeft: 300, columnRight: 800, leftBound: 16, rightBound: 1200 }), null);
});

test('computeBreakout grows symmetrically, bounded by the tighter side', () => {
  const r = computeBreakout({ naturalWidth: 2000, columnLeft: 300, columnRight: 800, leftBound: 290, rightBound: 1200 });
  assert.equal(r.width, 520);
  assert.equal(r.offset, (500 - 520) / 2);
});

test('computeBreakout never exceeds the natural width', () => {
  const r = computeBreakout({ naturalWidth: 560, columnLeft: 300, columnRight: 800, leftBound: 0, rightBound: 2000 });
  assert.equal(r.width, 560);
});

function tableArticle(html) {
  const article = document.createElement('article');
  article.innerHTML = html;
  return article;
}

test('enhanceTables wraps tables and tags numeric cells', () => {
  const article = tableArticle(
    '<table><thead><tr><th>Item</th><th>Price</th></tr></thead>' +
    '<tbody><tr><td>A</td><td>$10</td></tr><tr><td>B</td><td>$2</td></tr></tbody></table>'
  );
  enhanceTables(article);
  const wrap = article.querySelector('.skim-table-wrap');
  assert.ok(wrap);
  assert.ok(wrap.querySelector('table'));
  article.querySelectorAll('tbody tr td:nth-child(2)').forEach((c) => assert.ok(c.classList.contains('skim-col-num')));
  article.querySelectorAll('tbody tr td:nth-child(1)').forEach((c) => assert.ok(!c.classList.contains('skim-col-num')));
  assert.ok(wrap.querySelector('button.skim-table-copy'));
});

test('enhanceTables makes headers sortable and clicking reorders rows', () => {
  const article = tableArticle(
    '<table><thead><tr><th>Item</th><th>Price</th></tr></thead>' +
    '<tbody><tr><td>A</td><td>10</td></tr><tr><td>B</td><td>2</td></tr></tbody></table>'
  );
  enhanceTables(article);
  const priceHeader = article.querySelectorAll('thead th')[1];
  assert.ok(priceHeader.classList.contains('skim-sortable'));
  priceHeader.click();
  let order = Array.from(article.querySelectorAll('tbody td:nth-child(1)')).map((c) => c.textContent);
  assert.deepEqual(order, ['B', 'A']);
  assert.equal(priceHeader.getAttribute('aria-sort'), 'ascending');
  priceHeader.click();
  order = Array.from(article.querySelectorAll('tbody td:nth-child(1)')).map((c) => c.textContent);
  assert.deepEqual(order, ['A', 'B']);
  priceHeader.click();
  order = Array.from(article.querySelectorAll('tbody td:nth-child(1)')).map((c) => c.textContent);
  assert.deepEqual(order, ['A', 'B']);
  assert.equal(priceHeader.hasAttribute('aria-sort'), false);
});

test('enhanceTables skips sorting for tables with merged cells', () => {
  const article = tableArticle(
    '<table><thead><tr><th colspan="2">Spanned</th></tr></thead>' +
    '<tbody><tr><td>A</td><td>1</td></tr></tbody></table>'
  );
  enhanceTables(article);
  assert.ok(!article.querySelector('thead th').classList.contains('skim-sortable'));
  assert.ok(article.querySelector('.skim-table-wrap'));
});

// --- glyph decoration --------------------------------------------------
const { starTier, decorateStars, decorateSymbols, decorateEmoji, decorateGlyphs } = await import('../src/glyphs.js');

test('starTier maps counts to tiers', () => {
  assert.equal(starTier(1), 1);
  assert.equal(starTier(2), 2);
  assert.equal(starTier(3), 3);
  assert.equal(starTier(5), 3);
});

test('decorateStars wraps star runs with tier classes', () => {
  const a = tableArticle('<p>top ★★★ mid ★★ low ★ end</p>');
  decorateStars(a);
  const spans = a.querySelectorAll('.skim-stars');
  assert.equal(spans.length, 3);
  assert.ok(spans[0].classList.contains('skim-stars-3'));
  assert.ok(spans[1].classList.contains('skim-stars-2'));
  assert.ok(spans[2].classList.contains('skim-stars-1'));
});

test('decorateSymbols renders arrows via KaTeX', () => {
  const a = tableArticle('<p>if a then b ⇒ c, and x ≤ y</p>');
  decorateSymbols(a);
  const syms = a.querySelectorAll('.skim-sym');
  assert.equal(syms.length, 2);
  assert.match(syms[0].innerHTML, /katex/);
});

test('glyphs: text-presentation dingbats get emoji presentation', () => {
  const root = document.createElement('article');
  root.innerHTML = '<p>done ✔ and sun ☀</p>';
  document.body.append(root);
  decorateGlyphs(root);
  assert.ok(root.textContent.includes('✔️'));
  assert.ok(root.textContent.includes('☀️'));
  root.remove();
});

test('decorateEmoji aliases dingbats with no emoji form, leaving code alone', () => {
  const a = tableArticle('<p>edit ✎</p><pre><code>code ✎</code></pre><p>★★★</p>');
  decorateEmoji(a);
  assert.ok(a.querySelectorAll('p')[0].textContent.includes('✏️'));
  assert.equal(a.querySelector('pre code').textContent, 'code ✎'); // code untouched
  assert.equal(a.querySelectorAll('p')[1].textContent, '★★★'); // stars untouched by emoji pass
});

test('decorateGlyphs runs all passes without clobbering each other', () => {
  const a = tableArticle('<p>★★ done ⇒ ship \u{1F680}</p>');
  decorateGlyphs(a);
  assert.ok(a.querySelector('.skim-stars-2'));
  assert.ok(a.querySelector('.skim-sym'));
  assert.ok(a.textContent.includes('\u{1F680}'));
});

// --- copy as markdown --------------------------------------------------
const { htmlToMarkdown } = await import('../src/copy-markdown.js');

test('htmlToMarkdown rebuilds markdown incl. latex, symbols, emoji, lists', () => {
  const inline = Buffer.from('E=mc^2').toString('base64');
  const display = Buffer.from('\\int_0^1 x\\,dx').toString('base64');
  const html =
    '<h2>Title</h2>' +
    '<p>Energy <span class="skim-math skim-math-inline" data-latex="' + inline + '"><span class="katex">junk</span></span> ' +
    'so <strong>big</strong> <span class="skim-sym" data-sym="⇒"><span class="katex">x</span></span> ' +
    '<img class="skim-emoji" alt="🚀" src="svg/1f680.svg"></p>' +
    '<div class="skim-math skim-math-display" data-latex="' + display + '"><span class="katex">junk</span></div>' +
    '<ul><li>one</li><li>two</li></ul>';
  const md = htmlToMarkdown(html);
  assert.match(md, /## Title/);
  assert.match(md, /\$E=mc\^2\$/);
  assert.match(md, /\$\$\n\\int_0\^1 x\\,dx\n\$\$/);
  assert.match(md, /\*\*big\*\*/);
  assert.match(md, /⇒/);
  assert.match(md, /🚀/);
  assert.match(md, /-\s+one/);
  assert.match(md, /-\s+two/);
});

test('htmlToMarkdown drops table UI controls but keeps the table', () => {
  const html =
    '<div class="skim-table-wrap"><table><thead><tr>' +
    '<th class="skim-sortable">A<span class="skim-sort-ind"></span></th><th>B</th></tr></thead>' +
    '<tbody><tr><td>1</td><td>2</td></tr></tbody></table>' +
    '<button class="skim-copy-btn skim-table-copy">Copy</button></div>';
  const md = htmlToMarkdown(html);
  assert.match(md, /\| A \| B \|/);
  assert.match(md, /\| 1 \| 2 \|/);
  assert.ok(!/Copy/.test(md), 'copy button text excluded');
});

// --- anchors & internal links -----------------------------------------
const { createAnchorMarkup, setupAnchors } = await import('../src/anchors.js');
const { stripTrailingId, applyTheme, applyDensity, buildThemeToggle, buildPaddingControl } = await import('../src/ui.js');

test('createAnchorMarkup turns {#id} into an empty anchor target', () => {
  const a = document.createElement('article');
  a.innerHTML = '<p>See here {#section-x} for details.</p>';
  createAnchorMarkup(a);
  const anchor = a.querySelector('a#section-x.skim-anchor');
  assert.ok(anchor, 'anchor created with id');
  assert.equal(anchor.textContent, '');
  assert.ok(!a.textContent.includes('{#'), 'token removed from text');
});

test('collectHeadings honors a trailing {#custom-id} and cleans the text', () => {
  const a = document.createElement('article');
  a.innerHTML = '<h2>My Section {#custom}</h2>';
  const entries = collectHeadings(a);
  assert.equal(a.querySelector('h2').id, 'custom');
  assert.equal(entries[0].text.trim(), 'My Section');
});

test('stripTrailingId returns null when no anchor present', () => {
  const h = document.createElement('h2');
  h.textContent = 'Just a heading';
  assert.equal(stripTrailingId(h), null);
  assert.equal(h.textContent, 'Just a heading');
});

// --- table/anchors listener teardown (no leak across auto-reload passes) ---
test('enhanceTables + setupAnchors tear down their previous listeners each pass (mirrors populateArticle)', async () => {
  const doc = global.document;
  const article = doc.createElement('article');
  doc.body.append(article);

  // Mirrors what main.js's populateArticle does on every render/reload pass:
  // tear down the prior pass's listeners (no-op on the very first call, since
  // the teardown properties don't exist yet), then repopulate and re-run the
  // per-pass enhancers.
  const runPass = (n) => {
    article.skimTableTeardown?.();
    article.skimAnchorsTeardown?.();
    article.innerHTML = `<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>${n}</td></tr></tbody></table>` +
      `<p><a href="#target-${n}">jump</a></p><a id="target-${n}"></a>`;
    enhanceTables(article);
    setupAnchors(article);
  };

  let resizeCalls = 0;
  const origWindowAdd = window.addEventListener.bind(window);
  window.addEventListener = (type, fn, opts) => {
    if (type !== 'resize') return origWindowAdd(type, fn, opts);
    return origWindowAdd(type, (...args) => { resizeCalls++; fn(...args); }, opts);
  };

  let clickCalls = 0;
  const origArticleAdd = article.addEventListener.bind(article);
  article.addEventListener = (type, fn, opts) => {
    if (type !== 'click') return origArticleAdd(type, fn, opts);
    return origArticleAdd(type, (...args) => { clickCalls++; fn(...args); }, opts);
  };

  try {
    runPass(1); // first render: no teardown call needed/possible yet
    runPass(2); // reload: must abort pass 1's listeners before attaching new ones

    window.dispatchEvent(new window.Event('resize'));
    article.querySelector('a[href^="#"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(resizeCalls, 1, 'only the current pass\'s resize listener should fire — no accumulation across reloads');
    assert.equal(clickCalls, 1, 'only the current pass\'s click listener should fire — no accumulation across reloads');
  } finally {
    window.addEventListener = origWindowAdd;
    article.addEventListener = origArticleAdd;
    doc.body.removeChild(article);
  }
});

test('applyTheme sets data-theme, treating anything but "light" as dark', () => {
  applyTheme('light');
  assert.equal(document.documentElement.getAttribute('data-theme'), 'light');
  applyTheme('dark');
  assert.equal(document.documentElement.getAttribute('data-theme'), 'dark');
  applyTheme('nonsense');
  assert.equal(document.documentElement.getAttribute('data-theme'), 'dark');
});

test('applyDensity reflects the given density on <html data-skim-density>', () => {
  applyDensity('big');
  assert.equal(document.documentElement.getAttribute('data-skim-density'), 'big');
  applyDensity('normal');
  assert.equal(document.documentElement.getAttribute('data-skim-density'), 'normal');
});

// --- table boundary fix ------------------------------------------------
const { fixTableBoundaries } = await import('../src/render.js');

test('a non-row line glued after a table is not absorbed into it', () => {
  const md = [
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    'Trailing note, not a row.',
  ].join('\n');
  const html = renderMarkdown(md);
  const beforeClose = html.split('</table>')[0];
  assert.ok(!/Trailing note/.test(beforeClose), 'trailing line is outside the table');
  assert.match(html, /<p>Trailing note, not a row\.<\/p>/);
  assert.equal((html.match(/<tr>/g) || []).length, 2); // header + one body row
});

test('fixTableBoundaries leaves real rows and fenced code intact', () => {
  const md = [
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '| 3 | 4 |',
    '',
    '```',
    '| not | a | table |',
    'plain code line',
    '```',
  ].join('\n');
  const fixed = fixTableBoundaries(md);
  assert.equal(fixed, md, 'well-formed table + code block unchanged');
});

// --- settings (chrome.storage.sync) -----------------------------------
import { DEFAULTS, getSettings, setSetting, migrateLocalSettings, onSettingsChanged } from '../src/settings.js';

function installFakeChromeStorage(initial = {}) {
  const data = { ...initial };
  globalThis.chrome = {
    storage: {
      sync: {
        async get(keys) {
          const out = {};
          for (const k of [].concat(keys)) if (k in data) out[k] = data[k];
          return out;
        },
        async set(patch) { Object.assign(data, patch); },
      },
      onChanged: { addListener() {} },
    },
  };
  return data;
}

test('settings: defaults returned when storage empty', async () => {
  installFakeChromeStorage();
  const s = await getSettings();
  assert.deepEqual(s, DEFAULTS);
});

test('settings: stored values override defaults', async () => {
  installFakeChromeStorage({ theme: 'light' });
  const s = await getSettings();
  assert.equal(s.theme, 'light');
  assert.equal(s.density, DEFAULTS.density);
});

test('settings: setSetting persists and rejects unknown keys', async () => {
  const data = installFakeChromeStorage();
  await setSetting('density', 'big');
  assert.equal(data.density, 'big');
  await assert.rejects(() => setSetting('nope', 1), /unknown setting/);
});

test('settings: migrateLocalSettings moves the beta\'s real legacy keys (glow-md-*) once', async () => {
  const data = installFakeChromeStorage();
  localStorage.setItem('glow-md-theme', 'light');
  localStorage.setItem('glow-md-density', 'big');
  await migrateLocalSettings();
  assert.equal(data.theme, 'light');
  assert.equal(data.density, 'big');
  assert.equal(localStorage.getItem('glow-md-theme'), null);
  assert.equal(localStorage.getItem('glow-md-density'), null);
});

test('settings: migrateLocalSettings also moves skim-md-* localStorage once', async () => {
  const data = installFakeChromeStorage();
  localStorage.setItem('skim-md-theme', 'light');
  localStorage.setItem('skim-md-density', 'big');
  await migrateLocalSettings();
  assert.equal(data.theme, 'light');
  assert.equal(data.density, 'big');
  assert.equal(localStorage.getItem('skim-md-theme'), null);
  assert.equal(localStorage.getItem('skim-md-density'), null);
});

test('settings: migrateLocalSettings prefers glow-md-* over skim-md-* when both are present', async () => {
  const data = installFakeChromeStorage();
  localStorage.setItem('glow-md-theme', 'light');
  localStorage.setItem('skim-md-theme', 'dark');
  await migrateLocalSettings();
  assert.equal(data.theme, 'light', 'the true legacy (glow-md-*) key should win');
  assert.equal(localStorage.getItem('glow-md-theme'), null);
  assert.equal(localStorage.getItem('skim-md-theme'), null);
});

test('settings: migration never clobbers existing sync values', async () => {
  const data = installFakeChromeStorage({ theme: 'dark' });
  localStorage.setItem('glow-md-theme', 'light');
  await migrateLocalSettings();
  assert.equal(data.theme, 'dark');
  localStorage.removeItem('glow-md-theme');
});

test('onSettingsChanged fires only for known keys in a sync-area change, not local/unknown', async () => {
  let registered = null;
  globalThis.chrome = {
    storage: {
      sync: {
        async get() { return {}; },
        async set() {},
      },
      onChanged: { addListener(cb) { registered = cb; } },
    },
  };
  const calls = [];
  onSettingsChanged((patch) => calls.push(patch));
  assert.equal(typeof registered, 'function', 'listener should be registered');

  // Known keys, sync area: fires with only the known keys.
  registered(
    { theme: { newValue: 'light' }, bogus: { newValue: 'x' } },
    'sync'
  );
  assert.deepEqual(calls, [{ theme: 'light' }]);

  // Local area: must not fire.
  registered({ theme: { newValue: 'dark' } }, 'local');
  assert.equal(calls.length, 1);

  // Unknown keys only, sync area: must not fire (empty patch).
  registered({ notASetting: { newValue: 1 } }, 'sync');
  assert.equal(calls.length, 1);
});

// --- ui.js builders driven by settings ---------------------------------

test('buildThemeToggle reflects settings.theme and persists a click via setSetting', async () => {
  const data = installFakeChromeStorage();
  const btn = buildThemeToggle({ theme: 'dark' });
  assert.equal(document.documentElement.getAttribute('data-theme'), 'dark');
  assert.match(btn.textContent, /Light/);
  btn.click();
  assert.equal(document.documentElement.getAttribute('data-theme'), 'light');
  assert.match(btn.textContent, /Dark/);
  // setSetting() persists asynchronously; let its microtasks flush.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(data.theme, 'light');
});

test('buildPaddingControl reflects settings.density and persists a click via setSetting', async () => {
  const data = installFakeChromeStorage();
  const wrap = buildPaddingControl({ density: 'normal' });
  assert.equal(document.documentElement.getAttribute('data-skim-density'), 'normal');
  const normalBtn = wrap.querySelector('.skim-padding-opt[data-value="normal"]');
  const bigBtn = wrap.querySelector('.skim-padding-opt[data-value="big"]');
  assert.ok(normalBtn.classList.contains('active'));
  assert.ok(!bigBtn.classList.contains('active'));
  bigBtn.click();
  assert.equal(document.documentElement.getAttribute('data-skim-density'), 'big');
  assert.ok(bigBtn.classList.contains('active'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(data.density, 'big');
});

test('buildCopySourceButton returns a button that copies source via clipboard on click', async () => {
  const { buildCopySourceButton } = await import('../src/ui.js');
  const sourceText = '# My Document\n\nSome content here.';
  let clipboardText = null;
  const originalClipboard = navigator.clipboard;
  navigator.clipboard = {
    writeText: async (text) => { clipboardText = text; },
  };
  try {
    const btn = buildCopySourceButton(() => sourceText);
    assert.equal(btn.tagName, 'BUTTON');
    assert.ok(btn.classList.contains('skim-copy-source'));
    assert.equal(btn.type, 'button');
    assert.match(btn.textContent, /Copy for AI/);
    btn.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(clipboardText, sourceText, 'clipboard should contain the source text from getSource()');
  } finally {
    navigator.clipboard = originalClipboard;
  }
});

// --- encoding (byte transport & charset robustness) ----------------------
const { decodeMarkdownBytes } = await import('../src/encoding.js');
const { isFileUrl } = await import('../src/source.js');

test('source: file:// URLs route to the background relay transport', () => {
  assert.equal(isFileUrl('file:///home/nir/notes/plan.md'), true);
  assert.equal(isFileUrl('FILE:///C:/docs/readme.md'), true);
  assert.equal(isFileUrl('https://example.com/plan.md'), false);
  assert.equal(isFileUrl('http://localhost/readme.md'), false);
});

test('encoding: utf-8 with BOM', () => {
  const bytes = new Uint8Array([0xEF, 0xBB, 0xBF, 0x23, 0x20, 0xD7, 0xA9]); // "# ש"
  assert.equal(decodeMarkdownBytes(bytes.buffer), '# ש');
});

test('encoding: plain utf-8', () => {
  const bytes = new TextEncoder().encode('# héllo — ∑');
  assert.equal(decodeMarkdownBytes(bytes.buffer), '# héllo — ∑');
});

test('encoding: utf-16le with BOM', () => {
  const s = '# hi';
  const buf = new Uint8Array(2 + s.length * 2);
  buf[0] = 0xFF; buf[1] = 0xFE;
  for (let i = 0; i < s.length; i++) buf[2 + i * 2] = s.charCodeAt(i);
  assert.equal(decodeMarkdownBytes(buf.buffer), s);
});

test('encoding: windows-1255 hebrew fallback', () => {
  // "שלום" in windows-1255: 0xF9 0xEC 0xE5 0xED — invalid as UTF-8
  const bytes = new Uint8Array([0xF9, 0xEC, 0xE5, 0xED]);
  assert.equal(decodeMarkdownBytes(bytes.buffer), 'שלום');
});

test('encoding: windows-1252 fallback', () => {
  // "café" with 0xE9 é — invalid as UTF-8, low high-byte ratio in E0-FA range… 0xE9 IS in the hebrew range;
  // use a longer latin text so the ratio heuristic picks 1252.
  const s = 'r\xE9sum\xE9 na\xEFve d\xE9j\xE0 vu caf\xE9';
  const bytes = new Uint8Array([...s].map((c) => c.charCodeAt(0)));
  assert.equal(decodeMarkdownBytes(bytes.buffer), 'résumé naïve déjà vu café');
});

test('encoding: mixed mostly-ASCII doc with windows-1255 hebrew words', () => {
  // "# Notes\n\nThe word שלום appears here.\n\nAlso עברית inline."
  const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
  const bytes = new Uint8Array([
    ...ascii('# Notes\n\nThe word '), 0xF9, 0xEC, 0xE5, 0xED,
    ...ascii(' appears here.\n\nAlso '), 0xF2, 0xE1, 0xF8, 0xE9, 0xFA,
    ...ascii(' inline.'),
  ]);
  const out = decodeMarkdownBytes(bytes.buffer);
  assert.ok(out.includes('שלום'), `expected shalom, got: ${out}`);
  assert.ok(out.includes('עברית'), `expected ivrit, got: ${out}`);
});

// --- reload (auto-reload watcher) -----------------------------------------
const { watchSource } = await import('../src/reload.js');

const enc = (s) => new TextEncoder().encode(s).buffer;

test('reload: fires onChange only when content differs', async () => {
  const feed = ['# a', '# a', '# b'];
  let i = 0;
  const changes = [];
  const watcher = await watchSource({
    intervalMs: 5,
    fetchBytes: async () => enc(feed[Math.min(i++, feed.length - 1)]),
    onChange: (text) => changes.push(text),
  });
  assert.ok(watcher);
  await new Promise((r) => setTimeout(r, 60));
  watcher.stop();
  assert.deepEqual(changes, ['# b']);
});

test('reload: returns null when the source is unreadable', async () => {
  const watcher = await watchSource({ intervalMs: 5, fetchBytes: async () => null, onChange: () => {} });
  assert.equal(watcher, null);
});

// --- nav (Tab block navigation survives auto-reload) ------------------
test('setupBlockNavigation().refresh() resyncs to new blocks after innerHTML replacement', () => {
  const doc = global.document;
  const article = doc.createElement('article');
  article.innerHTML = '<p>one</p><p>two</p><p>three</p>';
  doc.body.append(article);

  const nav = setupBlockNavigation(article);
  const staleBlocks = Array.from(article.children);

  // Before any reload: Tab lands on one of the original blocks. jsdom's
  // getBoundingClientRect always returns zeros, so setupBlockNavigation's
  // topmost()/inView() can't distinguish real scroll position — but the
  // very first Tab press always takes the `current === -1` branch, which
  // is deterministic regardless of layout.
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  const before = article.querySelector('.skim-current');
  assert.ok(before, 'Tab should mark a current block');
  assert.ok(staleBlocks.includes(before), 'current block should be one of the original nodes');

  // Simulate what the auto-reload handler does: replace the article's
  // contents wholesale, detaching every block setupBlockNavigation snapshotted.
  article.innerHTML = '<p>alpha</p><p>beta</p><p>gamma</p>';
  const freshBlocks = Array.from(article.children);
  nav.refresh();

  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  const after = article.querySelector('.skim-current');
  assert.ok(after, 'Tab should mark a current block after refresh()');
  assert.ok(freshBlocks.includes(after), 'current block after refresh() must be a NEW node, not a stale detached one');
  assert.ok(!staleBlocks.includes(after), 'current block must not be one of the pre-reload nodes');

  doc.body.removeChild(article);
});

// --- ui (scrollspy listener teardown, no leak on reload) ---------------
test('buildToc scrollspy listeners are removed via toc.skimTeardown()', async () => {
  const doc = global.document;
  const article = doc.createElement('article');
  article.innerHTML = '<h1>One</h1><p>a</p><h1>Two</h1><p>b</p><h1>Three</h1>';
  doc.body.append(article);

  const headings = collectHeadings(article);
  const toc = buildToc(article, headings);
  assert.equal(typeof toc.skimTeardown, 'function', 'toc must expose a teardown for its scrollspy listeners');

  const links = Array.from(toc.querySelectorAll('.skim-toc-link'));
  // setupScrollSpy's initial update() ran with jsdom's all-zero rects, which
  // makes every heading look "passed" — so it lands on the last one.
  assert.equal(toc.querySelector('.skim-toc-link.active'), links[2]);

  // Give the second and third headings distinguishable positions so a
  // subsequent update() would pick a different active link.
  document.getElementById(headings[1].id).getBoundingClientRect = () => ({ top: 0, bottom: 20 });
  document.getElementById(headings[2].id).getBoundingClientRect = () => ({ top: 500, bottom: 520 });

  toc.skimTeardown();
  window.dispatchEvent(new window.Event('scroll'));
  // The handler defers to requestAnimationFrame; flush a macrotask so it
  // would have had a chance to run if the listener were still attached.
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(
    toc.querySelector('.skim-toc-link.active'),
    links[2],
    'active link must not change after teardown — the scroll listener should be gone',
  );

  doc.body.removeChild(article);
});

// --- frontmatter --------------------------------------------------------
test('frontmatter: scalars and lists extracted, body stripped', () => {
  const src = '---\ntitle: Plan\ntags:\n  - ai\n  - docs\nstatus: "draft"\n---\n# Body\n';
  const { fields, body } = extractFrontmatter(src);
  assert.deepEqual(fields, [['title', 'Plan'], ['tags', ['ai', 'docs']], ['status', 'draft']]);
  assert.equal(body, '# Body\n');
});

test('frontmatter: absent -> null fields, untouched body', () => {
  const src = '# No frontmatter\n---\nnot: frontmatter\n---\n';
  const { fields, body } = extractFrontmatter(src);
  assert.equal(fields, null);
  assert.equal(body, src);
});

test('frontmatter: thematic break (--- with blank line after) is not frontmatter', () => {
  const src = '---\n\n# Just a rule\n';
  assert.equal(extractFrontmatter(src).fields, null);
});

test('frontmatter: unparseable yaml left alone', () => {
  const src = '---\n{ complex: [nested, yaml] }\n---\nbody\n';
  const { fields, body } = extractFrontmatter(src);
  assert.equal(fields, null);
  assert.equal(body, src);
});

test('frontmatter: CRLF line endings are tolerated', () => {
  const src = '---\r\ntitle: X\r\n---\r\nbody\r\n';
  const { fields, body } = extractFrontmatter(src);
  assert.deepEqual(fields, [['title', 'X']]);
  assert.equal(body, 'body\r\n');
});

test('buildFrontmatterCard renders rows with keys and joined list values', () => {
  const fields = [['title', 'Plan'], ['tags', ['ai', 'docs']], ['status', 'draft']];
  const card = buildFrontmatterCard(fields);
  assert.equal(card.tagName, 'SECTION');
  assert.ok(card.classList.contains('skim-frontmatter'));
  const rows = card.querySelectorAll('.skim-fm-row');
  assert.equal(rows.length, 3);
  const keys = Array.from(card.querySelectorAll('.skim-fm-key')).map((n) => n.textContent);
  const values = Array.from(card.querySelectorAll('.skim-fm-value')).map((n) => n.textContent);
  assert.deepEqual(keys, ['title', 'tags', 'status']);
  assert.deepEqual(values, ['Plan', 'ai · docs', 'draft']);
});

// --- emoji shortcodes --------------------------------------------------

test('emoji: known :shortcodes: become Unicode glyphs', () => {
  const html = renderMarkdown('Ship it :rocket: with :tada: and :+1:');
  assert.ok(html.includes(EMOJI.rocket), 'rocket glyph present');
  assert.ok(html.includes(EMOJI.tada), 'tada glyph present');
  assert.ok(html.includes(EMOJI['+1']), 'thumbsup glyph present');
  assert.ok(!/:rocket:/.test(html), 'shortcode text is gone');
});

test('emoji: unknown shortcodes are left untouched', () => {
  const html = renderMarkdown('not an emoji :definitelynotanemoji: here');
  assert.match(html, /:definitelynotanemoji:/);
});

test('emoji: shortcodes inside code are not replaced', () => {
  const inline = renderMarkdown('use `:rocket:` literally');
  assert.match(inline, /<code>:rocket:<\/code>/);
  const fenced = renderMarkdown('```\n:rocket:\n```');
  assert.ok(!fenced.includes(EMOJI.rocket), 'no glyph inside fenced code');
  const el = document.createElement('div');
  el.innerHTML = fenced;
  // highlight.js may split the token across spans; the text content is intact.
  assert.match(el.textContent, /:rocket:/);
});

test('emoji: a lone colon or time like 10:30 is not mangled', () => {
  assert.match(renderMarkdown('meet at 10:30 sharp'), /10:30 sharp/);
  assert.match(renderMarkdown('ratio a:b here'), /a:b here/);
});

// --- bare-URL autolink (lock-in: marked gfm already does this) ----------

test('autolink: bare http(s) and www URLs become links, code is untouched', () => {
  const html = renderMarkdown('See https://example.com/x and www.foo.com now');
  assert.match(html, /<a href="https:\/\/example\.com\/x">https:\/\/example\.com\/x<\/a>/);
  assert.match(html, /<a href="http:\/\/www\.foo\.com">www\.foo\.com<\/a>/);
  const code = renderMarkdown('run `curl https://example.com`');
  assert.match(code, /<code>curl https:\/\/example\.com<\/code>/);
  assert.ok(!/<a /.test(code));
});

// --- embedded-HTML audit (survives DOMPurify) --------------------------

test('embedded HTML: <details>/<summary> survive sanitization', () => {
  const html = renderMarkdown('<details><summary>More</summary>\n\nhidden\n\n</details>');
  assert.match(html, /<details>/);
  assert.match(html, /<summary>More<\/summary>/);
  assert.match(html, /hidden/);
});

test('embedded HTML: <img> width/height attributes are preserved', () => {
  const html = renderMarkdown('<img src="https://x/y.png" width="120" height="80" alt="a">');
  assert.match(html, /width="120"/);
  assert.match(html, /height="80"/);
});

test('embedded HTML: <kbd>, <sup>, <sub> survive', () => {
  assert.match(renderMarkdown('Press <kbd>Ctrl</kbd>'), /<kbd>Ctrl<\/kbd>/);
  assert.match(renderMarkdown('x<sup>2</sup>'), /<sup>2<\/sup>/);
  assert.match(renderMarkdown('H<sub>2</sub>O'), /<sub>2<\/sub>/);
});

// --- image lightbox ----------------------------------------------------

test('lightbox: clicking a content image opens the overlay; Esc closes it', () => {
  lightbox.close();
  const article = document.createElement('article');
  article.innerHTML = '<p><img src="https://example.com/pic.png" alt="pic"></p>';
  document.body.append(article);
  setupLightbox(article);
  assert.equal(lightbox.isOpen(), false);
  article.querySelector('img').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(lightbox.isOpen(), true);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(lightbox.isOpen(), false);
  article.remove();
});

test('lightbox: a linked image is left to its link (does not open)', () => {
  lightbox.close();
  const article = document.createElement('article');
  article.innerHTML = '<p><a href="https://example.com"><img src="https://example.com/pic.png" alt="pic"></a></p>';
  document.body.append(article);
  setupLightbox(article);
  article.querySelector('img').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  assert.equal(lightbox.isOpen(), false);
  article.remove();
});

test('lightbox: setup is idempotent across auto-reload (single listener)', () => {
  lightbox.close();
  const article = document.createElement('article');
  article.innerHTML = '<img src="https://example.com/pic.png" alt="pic">';
  document.body.append(article);
  setupLightbox(article);
  setupLightbox(article); // second call (simulating a reload) must be a no-op
  assert.equal(article.dataset.skimLightbox, '1');
  article.remove();
  lightbox.close();
});

// --- mermaid resilience (parse layer) ----------------------------------

test('mermaid: a fence between headings keeps both headings and its source', () => {
  const html = renderMarkdown('# One\n\n```mermaid\ngraph TD; A-->B;\n```\n\n## Two\n');
  const el = document.createElement('div');
  el.innerHTML = html;
  const heads = collectHeadings(el);
  assert.deepEqual(heads.map((h) => h.text), ['One', 'Two']);
  assert.match(html, /class="language-mermaid"/);
});
