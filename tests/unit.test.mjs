import { dom } from './setup-dom.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { protectMath, bareTextToProse, b64decode, renderMarkdown, filterInlineStyle, isAllowedClass } = await import('../src/render.js');
const { hasMarkdownExtension, findPlaintextPre, detectMarkdown, isHugeSource } = await import('../src/detect.js');
const { textDirection, applyBidi } = await import('../src/bidi.js');

// --- bidirectional prose ----------------------------------------------
test('bidi ignores a leading exercise label and uses the opening prose direction', () => {
  assert.equal(
    textDirection('(a) נתונים עם אותו מפתח חייבים להימצא באותה מחיצה כדי לבצע shuffle'),
    'rtl'
  );
});

test('bidi keeps a genuinely English explanation LTR', () => {
  assert.equal(
    textDirection('(b) broadcast the small side and materialize it; הטבלה הגדולה never moves'),
    'ltr'
  );
});

test('bidi reads a Hebrew sentence that opens with an English term as RTL', () => {
  assert.equal(
    textDirection('softmax לוקחת וקטור logits שרירותי ומחזירה התפלגות: כל הערכים חיוביים וסכומם 1.'),
    'rtl'
  );
  assert.equal(textDirection('gradient descent מעדכן את המשקולות בכיוון ההפוך לגרדיאנט.'), 'rtl');
});

test('bidi does not flip English prose that quotes a Hebrew term or two', () => {
  assert.equal(textDirection('The loss is called אנטרופיה צולבת in the lecture notes.'), 'ltr');
  assert.equal(textDirection('An English paragraph with מילה אחת.'), 'ltr');
});

test('bidi decides on the opening sentence, not the whole block', () => {
  assert.equal(
    textDirection([
      'הרשת מחשבת את הגרדיאנט בשכבה האחרונה.',
      'Gloss: the last layer computes the gradient of the loss with respect to the logits,',
      'and the chain rule propagates it backwards through every hidden layer in turn.',
    ].join(' ')),
    'rtl'
  );
});

test('bidi is not decided by a bare term used as the opening sentence', () => {
  assert.equal(textDirection('BatchNorm. בזמן אימון, לכל feature מחשבים ממוצע ושונות על ה-mini-batch.'), 'rtl');
  assert.equal(textDirection('LoRA (Low-Rank Adaptation). מקפיאים את המשקולות ומוסיפים שתי מטריצות דקות.'), 'rtl');
});

test('bidi counts a hyphenated term once, not once per fragment', () => {
  assert.equal(
    textDirection('decoder masked self-attention: Q, K, V כולם מגיעים מהקלט של הדקודר.'),
    'rtl'
  );
});

test('applyBidi gives a Latin-opening Hebrew paragraph an RTL base direction', () => {
  const article = document.createElement('article');
  article.innerHTML = renderMarkdown(
    '*softmax לוקחת וקטור logits שרירותי ומחזירה התפלגות: כל הערכים חיוביים וסכומם 1.*'
  );

  applyBidi(article);

  assert.equal(article.querySelector('p').getAttribute('dir'), 'rtl');
  assert.equal(article.querySelector('p').querySelector('bdi.skim-bidi-segment'), null);
});

test('applyBidi keeps table columns LTR inside Hebrew prose but not the cells', () => {
  const article = document.createElement('article');
  article.innerHTML = [
    '<p>טבלה מסכמת של התוצאות בעברית בלבד.</p>',
    '<table><thead><tr><th>שם</th><th>ערך</th></tr></thead>',
    '<tbody><tr><td>דיוק</td><td>1</td></tr></tbody></table>',
  ].join('');

  applyBidi(article);

  const table = article.querySelector('table');
  assert.equal(table.getAttribute('dir'), 'ltr', 'column order stays left-to-right');
  assert.equal(article.querySelector('th').getAttribute('dir'), 'rtl', 'Hebrew cell text is RTL');
});

test('applyBidi respects an authored dir on a table', () => {
  const article = document.createElement('article');
  article.innerHTML = '<table dir="rtl"><tbody><tr><td>א</td><td>ב</td></tr></tbody></table>';

  applyBidi(article);

  assert.equal(article.querySelector('table').getAttribute('dir'), 'rtl');
});

test('applyBidi isolates code and does not let it determine prose direction', () => {
  const article = document.createElement('article');
  article.innerHTML = '<p>(a) <code>sites_df = broadcast(sites_df)</code> הסבר ארוך בעברית בלבד</p>';

  applyBidi(article);

  assert.equal(article.querySelector('p').getAttribute('dir'), 'rtl');
  assert.equal(article.querySelector('code').getAttribute('dir'), 'ltr');
});

test('applyBidi handles Hebrew summary text with inline LaTeX as an isolated LTR run', () => {
  const article = document.createElement('article');
  article.innerHTML = renderMarkdown([
    '<details>',
    '<summary>(a) עבור כל איבר מחשבים $x_i = y_i + 1$ ואז ממשיכים בעברית</summary>',
    '',
    'תוכן נוסף.',
    '</details>',
  ].join('\n'));

  applyBidi(article);

  const summary = article.querySelector('summary');
  const math = summary.querySelector('.skim-math');
  assert.ok(math, 'inline LaTeX rendered inside the summary');
  assert.equal(summary.getAttribute('dir'), 'rtl');
  assert.equal(math.getAttribute('dir'), 'ltr');
});

test('applyBidi keeps Hebrew explanation RTL when a long English Gloss follows', () => {
  const article = document.createElement('article');
  article.innerHTML = [
    '<details open>',
    '<summary>Drill 3. English question with <code>events_df.join(sites_df)</code></summary>',
    '<p>(a) נתונים עם אותו מפתח חייבים להימצא באותה מחיצה, וברירת המחדל היא join.',
    ' Gloss: (a) a shuffle, executed at the action, not at the join line.',
    ' (b) broadcast the small side and materialize it with a count; the big table never moves.</p>',
    '</details>',
  ].join('');

  applyBidi(article);

  assert.equal(article.querySelector('summary').getAttribute('dir'), 'ltr');
  assert.equal(article.querySelector('p').getAttribute('dir'), 'rtl');
  assert.equal(article.querySelector('code').getAttribute('dir'), 'ltr');
  const gloss = article.querySelector('p > bdi.skim-bidi-segment');
  assert.ok(gloss, 'the sustained English suffix gets its own bidi paragraph');
  assert.equal(gloss.getAttribute('dir'), 'ltr');
  assert.match(gloss.textContent.trim(), /^Gloss: \(a\) a shuffle/);
  assert.match(gloss.textContent.trim(), /the big table never moves\.$/);
});

test('applyBidi isolates sentence-level direction changes without relying on a Gloss label', () => {
  const article = document.createElement('article');
  article.innerHTML = [
    '<p>זהו משפט פתיחה בעברית.',
    ' This is an independently wrapped English sentence.',
    ' This continuation remains in the same isolate.</p>',
  ].join('');

  applyBidi(article);

  const paragraph = article.querySelector('p');
  const isolate = paragraph.querySelector('bdi.skim-bidi-segment');
  assert.equal(paragraph.getAttribute('dir'), 'rtl');
  assert.equal(isolate.getAttribute('dir'), 'ltr');
  assert.match(isolate.textContent, /independently wrapped/);
  assert.match(isolate.textContent, /continuation remains/);
});

test('applyBidi handles bilingual blocks independently and preserves authored dir', () => {
  const article = document.createElement('article');
  article.innerHTML = [
    '<p>(a) משפט ארוך בעברית עם English term</p>',
    '<p>An English paragraph with מילה אחת.</p>',
    '<p dir="rtl">This explicit author direction wins.</p>',
    '<p>123 — …</p>',
  ].join('');

  applyBidi(article);

  const paragraphs = [...article.querySelectorAll('p')];
  assert.equal(paragraphs[0].getAttribute('dir'), 'rtl');
  assert.equal(paragraphs[1].getAttribute('dir'), 'ltr');
  assert.equal(paragraphs[2].getAttribute('dir'), 'rtl');
  assert.equal(paragraphs[3].hasAttribute('dir'), false, 'neutral text inherits');
});
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
const { stripTrailingId, applyTheme, applyScheme, applyDensity, buildThemeToggle, buildPaddingControl, applyZen, buildZenControl } = await import('../src/ui.js');
const { setupPrintExport } = await import('../src/print.js');
const { applyPrintMargin } = await import('../src/ui.js');

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
  let popstateCalls = 0;
  const origWindowAdd = window.addEventListener.bind(window);
  window.addEventListener = (type, fn, opts) => {
    if (type === 'resize') return origWindowAdd(type, (...args) => { resizeCalls++; fn(...args); }, opts);
    if (type === 'popstate') return origWindowAdd(type, (...args) => { popstateCalls++; fn(...args); }, opts);
    return origWindowAdd(type, fn, opts);
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
    window.dispatchEvent(new window.Event('popstate'));
    article.querySelector('a[href^="#"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(resizeCalls, 1, 'only the current pass\'s resize listener should fire — no accumulation across reloads');
    assert.equal(clickCalls, 1, 'only the current pass\'s click listener should fire — no accumulation across reloads');
    assert.equal(popstateCalls, 1, 'only the current pass\'s popstate listener should fire — no accumulation across reloads');
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

test('applyScheme sets data-scheme for colored vibes, clearing it for none/unknown', () => {
  applyScheme('grape');
  assert.equal(document.documentElement.getAttribute('data-scheme'), 'grape');
  applyScheme('ocean');
  assert.equal(document.documentElement.getAttribute('data-scheme'), 'ocean');
  applyScheme('none');
  assert.equal(document.documentElement.getAttribute('data-scheme'), null);
  applyScheme('grape');
  applyScheme('nonsense');
  assert.equal(document.documentElement.getAttribute('data-scheme'), null);
});

test('mono is a selectable scheme and every scheme has both a dark and a light palette', async () => {
  const { SCHEMES } = await import('../src/ui.js');
  const css = await readFile(new URL('../src/skim.css', import.meta.url), 'utf8');
  assert.ok(SCHEMES.some((s) => s.id === 'mono'), 'mono offered in the palette picker');
  applyScheme('mono');
  assert.equal(document.documentElement.getAttribute('data-scheme'), 'mono');
  for (const { id } of SCHEMES.filter((s) => s.id !== 'none')) {
    for (const theme of ['dark', 'light']) {
      assert.ok(css.includes(`[data-theme="${theme}"][data-scheme="${id}"] {`), `${id} has a ${theme} palette`);
    }
  }
  // The whole point of mono: a tint would halftone the entire printed sheet.
  const monoLight = css.slice(css.indexOf('[data-theme="light"][data-scheme="mono"] {'));
  assert.match(monoLight.slice(0, 400), /--skim-bg:\s*#ffffff/);
});

test('printMargin: a setting, applied to <html>, with a tier per value in the print CSS', async () => {
  const { DEFAULTS } = await import('../src/settings.js');
  const css = await readFile(new URL('../src/skim.css', import.meta.url), 'utf8');
  assert.equal(DEFAULTS.printMargin, 'narrow');
  applyPrintMargin('narrow');
  assert.equal(document.documentElement.getAttribute('data-skim-print-margin'), 'narrow');
  for (const value of ['none', 'narrow', 'wide']) {
    assert.match(css, new RegExp(`\\[data-skim-print-margin="${value}"\\][^{]*\\{\\s*--skim-print-margin:`),
      `${value} sizes the gutter`);
  }
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

// Run `fn` as if the document were a local file: legacy localStorage settings
// are only migrated from the file:// origin (see migrateLocalSettings). jsdom
// gives file: URLs an opaque origin with no localStorage, so a Map-backed stand-in
// is installed for the duration.
async function asLocalFile(fn) {
  const origUrl = dom.window.location.href;
  const origStorage = global.localStorage;
  const mem = new Map();
  dom.reconfigure({ url: 'file:///home/reader/notes.md' });
  global.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => { mem.set(k, String(v)); },
    removeItem: (k) => { mem.delete(k); },
  };
  try { return await fn(); } finally {
    dom.reconfigure({ url: origUrl });
    global.localStorage = origStorage;
  }
}

test('settings: migrateLocalSettings moves the beta\'s real legacy keys (glow-md-*) once', async () => {
  await asLocalFile(async () => {
    const data = installFakeChromeStorage();
    localStorage.setItem('glow-md-theme', 'light');
    localStorage.setItem('glow-md-density', 'big');
    await migrateLocalSettings();
    assert.equal(data.theme, 'light');
    assert.equal(data.density, 'big');
    assert.equal(localStorage.getItem('glow-md-theme'), null);
    assert.equal(localStorage.getItem('glow-md-density'), null);
  });
});

test('settings: migrateLocalSettings also moves skim-md-* localStorage once', async () => {
  await asLocalFile(async () => {
    const data = installFakeChromeStorage();
    localStorage.setItem('skim-md-theme', 'light');
    localStorage.setItem('skim-md-density', 'big');
    await migrateLocalSettings();
    assert.equal(data.theme, 'light');
    assert.equal(data.density, 'big');
    assert.equal(localStorage.getItem('skim-md-theme'), null);
    assert.equal(localStorage.getItem('skim-md-density'), null);
  });
});

test('settings: migrateLocalSettings prefers glow-md-* over skim-md-* when both are present', async () => {
  await asLocalFile(async () => {
    const data = installFakeChromeStorage();
    localStorage.setItem('glow-md-theme', 'light');
    localStorage.setItem('skim-md-theme', 'dark');
    await migrateLocalSettings();
    assert.equal(data.theme, 'light', 'the true legacy (glow-md-*) key should win');
    assert.equal(localStorage.getItem('glow-md-theme'), null);
    assert.equal(localStorage.getItem('skim-md-theme'), null);
  });
});

test('settings: migration never clobbers existing sync values', async () => {
  await asLocalFile(async () => {
    const data = installFakeChromeStorage({ theme: 'dark' });
    localStorage.setItem('glow-md-theme', 'light');
    await migrateLocalSettings();
    assert.equal(data.theme, 'dark');
    localStorage.removeItem('glow-md-theme');
  });
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

test('applyZen reflects on/off on <html data-skim-zen>', () => {
  applyZen(true);
  assert.equal(document.documentElement.getAttribute('data-skim-zen'), 'on');
  applyZen(false);
  assert.equal(document.documentElement.getAttribute('data-skim-zen'), 'off');
});

test('buildZenControl reflects settings.zen and toggles + persists on click', async () => {
  const data = installFakeChromeStorage();
  const btn = buildZenControl({ zen: false });
  assert.equal(document.documentElement.getAttribute('data-skim-zen'), 'off');
  assert.ok(!btn.classList.contains('active'));
  assert.match(btn.textContent, /Zen/);
  btn.click();
  assert.equal(document.documentElement.getAttribute('data-skim-zen'), 'on');
  assert.ok(btn.classList.contains('active'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(data.zen, true);
  btn.click();
  assert.equal(document.documentElement.getAttribute('data-skim-zen'), 'off');
  assert.ok(!btn.classList.contains('active'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(data.zen, false);
});

test('buildZenControl starting on renders the active on-state', () => {
  installFakeChromeStorage();
  const btn = buildZenControl({ zen: true });
  assert.equal(document.documentElement.getAttribute('data-skim-zen'), 'on');
  assert.ok(btn.classList.contains('active'));
  assert.match(btn.textContent, /On/);
});

test('print export expands collapsed <details> then restores each to its prior state', () => {
  const article = document.createElement('article');
  article.className = 'skim markdown-body';
  const main = document.createElement('main');
  main.className = 'skim-main';
  main.append(article);
  document.body.append(main);
  article.innerHTML = [
    '<h2 id="a">A</h2>',
    '<details><summary>closed</summary><p>body 1</p></details>',
    '<details open><summary>open</summary><p>body 2</p></details>',
  ].join('');
  const detailsEls = [...article.querySelectorAll('details')];
  assert.deepEqual(detailsEls.map((d) => d.open), [false, true]);

  // Capture the open-state at the moment print() fires (Chromium runs print
  // synchronously and afterprint has already fired by the time it returns).
  let during = null;
  const origPrint = window.print;
  window.print = () => {
    during = detailsEls.map((d) => d.open);
    window.dispatchEvent(new window.Event('afterprint'));
  };
  try {
    setupPrintExport(article, [{ level: 2, text: 'A', id: 'a', html: 'A' }])
      .querySelector('.skim-export-toggle').click();
  } finally {
    window.print = origPrint;
  }

  assert.deepEqual(during, [true, true], 'both details open during print');
  assert.deepEqual(detailsEls.map((d) => d.open), [false, true], 'restored: closed re-closes, open stays open');
  main.remove();
});

// Runs the export flow and reports what numbering it produced.
function printNumbering(headingTexts) {
  const article = document.createElement('article');
  article.className = 'skim markdown-body';
  article.innerHTML = headingTexts.map((t, i) => `<h2 id="h${i}">${t}</h2><p>x</p>`).join('');
  const main = document.createElement('main');
  main.className = 'skim-main';
  main.append(article);
  document.body.append(main);

  let during = null;
  const origPrint = window.print;
  window.print = () => {
    during = {
      stamps: [...article.querySelectorAll('.skim-print-num')].map((s) => s.textContent.trim()),
      tocNums: [...main.querySelectorAll('.skim-print-toc-num')].map((s) => s.textContent),
      headings: [...article.querySelectorAll('h2')].map((h) => h.textContent),
    };
    window.dispatchEvent(new window.Event('afterprint'));
  };
  try {
    setupPrintExport(article, headingTexts.map((t, i) => ({ level: 2, text: t, id: `h${i}`, html: t })))
      .querySelector('.skim-export-toggle').click();
  } finally {
    window.print = origPrint;
    main.remove();
  }
  return during;
}

test('print export numbers unnumbered sections', () => {
  const r = printNumbering(['The probabilistic model', 'Retrieval', '2024 in review']);
  assert.deepEqual(r.stamps, ['1', '2', '3']);
  assert.deepEqual(r.tocNums, ['1', '2', '3'], 'cover TOC matches the body');
});

test('print export leaves a self-numbered document alone (no "1.5 5. Model")', () => {
  for (const style of [
    ['5. The probabilistic model', '6. Evaluation'],
    ['5) The probabilistic model', '6) Evaluation'],
    ['5.1 The probabilistic model', '5.2 Evaluation'],
    ['5.1. The probabilistic model', '5.2. Evaluation'],
    ['01-02. Term weighting and VSM', '06. Language models'],   // a ranged section number
  ]) {
    const r = printNumbering(style);
    assert.deepEqual(r.stamps, [], `no stamps for ${style[0]}`);
    assert.deepEqual(r.tocNums, [], `no TOC number column for ${style[0]}`);
    assert.deepEqual(r.headings, style, 'heading text untouched');
  }
});

test('HTML export carries the whole look, not just dark/light', async () => {
  const { buildStandaloneHtml } = await import('../src/export-html.js');
  globalThis.chrome = { runtime: { getURL: (p) => `chrome-extension://fake/${p}` } };
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, text: async () => '/* css */' });

  const root = document.documentElement;
  root.setAttribute('data-theme', 'light');
  root.setAttribute('data-scheme', 'mono');
  root.setAttribute('data-skim-density', 'big');
  const article = document.createElement('article');
  article.className = 'skim markdown-body';
  const main = document.createElement('main');
  main.className = 'skim-main';
  main.append(article);
  document.body.append(main);

  try {
    const html = await buildStandaloneHtml(article);
    assert.match(html, /data-theme="light"/);
    assert.match(html, /data-scheme="mono"/, 'the colour scheme travels with the export');
    assert.match(html, /data-skim-density="big"/);
  } finally {
    globalThis.fetch = origFetch;
    main.remove();
    root.removeAttribute('data-scheme');
    root.removeAttribute('data-skim-density');
  }
});

test('the export control carries a margin picker that writes the setting', () => {
  const stored = installFakeChromeStorage();
  const article = document.createElement('article');
  article.className = 'skim markdown-body';
  const control = setupPrintExport(article, []);

  const opts = [...control.querySelectorAll('.skim-export-margin-opt')].map((b) => b.dataset.value);
  assert.deepEqual(opts, ['none', 'narrow', 'normal', 'wide']);
  assert.ok(control.querySelector('.skim-export-toggle'), 'the export button is still there');

  control.querySelector('[data-value="none"]').click();
  assert.equal(document.documentElement.getAttribute('data-skim-print-margin'), 'none');
  assert.equal(stored.printMargin, 'none', 'persisted, so the popup agrees');
  assert.ok(control.querySelector('[data-value="none"]').classList.contains('active'));

  // An external change (popup, other tab) resyncs the marks without a rebind.
  applyPrintMargin('wide');
  control.skimSync();
  assert.ok(control.querySelector('[data-value="wide"]').classList.contains('active'));
  assert.ok(!control.querySelector('[data-value="none"]').classList.contains('active'));
});

test('print export wraps the body in gutter rows + a zero page margin, then unwraps', () => {
  const article = document.createElement('article');
  article.className = 'skim markdown-body';
  article.innerHTML = '<h2 id="a">A</h2><p>body</p><h2 id="b">B</h2>';
  document.title = 'Doc';                     // gives the cover page content
  const main = document.createElement('main');
  main.className = 'skim-main';
  const raw = document.createElement('pre');
  raw.className = 'skim-raw';
  main.append(article, raw);
  document.body.append(main);

  let during = null;
  const origPrint = window.print;
  window.print = () => {
    const table = main.querySelector('table.skim-print-page');
    during = {
      // Cover outside the table (own page), everything else inside the cell.
      coverOutside: main.firstElementChild.className === 'skim-print-cover',
      gutters: table.querySelectorAll(':scope > thead td.skim-print-gutter, :scope > tfoot td.skim-print-gutter').length,
      cellChildren: [...table.querySelector('td.skim-print-cell').children].map((n) => n.className),
      pageRule: document.querySelector('style.skim-print-page-style')?.textContent,
    };
    window.dispatchEvent(new window.Event('afterprint'));
  };
  try {
    setupPrintExport(article, [
      { level: 2, text: 'A', id: 'a', html: 'A' },
      { level: 2, text: 'B', id: 'b', html: 'B' },
    ]).querySelector('.skim-export-toggle').click();
  } finally {
    window.print = origPrint;
  }

  assert.equal(during.coverOutside, true);
  assert.equal(during.gutters, 2, 'a repeating top and bottom gutter row');
  assert.deepEqual(during.cellChildren, ['skim markdown-body', 'skim-raw']);
  assert.match(during.pageRule, /@page\s*\{\s*margin:\s*0;\s*\}/);

  assert.equal(main.querySelector('table.skim-print-page'), null, 'wrapper removed');
  assert.equal(document.querySelector('style.skim-print-page-style'), null, '@page override removed');
  assert.deepEqual([...main.children].map((n) => n.className), ['skim markdown-body', 'skim-raw'],
    'original children restored in order');
  main.remove();
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

  // The scroller is injected so the keys can be checked without a real layout.
  const moves = [];
  const scroller = { by: (d) => moves.push(['by', d]), to: (y) => moves.push(['to', y]) };
  const nav = setupBlockNavigation(article, { scroller });
  const staleBlocks = Array.from(article.children);

  const press = (key, init = {}) => document.dispatchEvent(
    new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
  );

  press('j');
  press('k');
  assert.equal(moves.length, 2);
  assert.ok(moves[0][1] > 0, 'j scrolls one rendered line down');
  assert.ok(moves[1][1] < 0, 'k scrolls one rendered line up');
  assert.equal(moves[0][1], -moves[1][1], 'j/k steps are symmetric');
  assert.deepEqual(moves.map((m) => m[0]), ['by', 'by'], 'j/k ease rather than jump');

  press('j', { ctrlKey: true });
  const input = doc.createElement('input');
  doc.body.append(input);
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'k', bubbles: true, cancelable: true }));
  assert.equal(moves.length, 2, 'modifiers and typing targets are not hijacked');
  input.remove();

  // G jumps to the end, gg to the start, and a lone g does nothing on its own.
  moves.length = 0;
  press('G', { shiftKey: true });
  assert.deepEqual(moves.map((m) => m[0]), ['to'], 'G scrolls to the end');
  moves.length = 0;
  press('g');
  assert.equal(moves.length, 0, 'a single g waits for its partner');
  press('g');
  assert.deepEqual(moves, [['to', 0]], 'gg scrolls to the top');
  moves.length = 0;
  press('g');
  press('j');
  press('g');
  assert.deepEqual(moves.map((m) => m[0]), ['by'], 'j between the two g keys cancels the pair');
  moves.length = 0;

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

// --- file access detection ---------------------------------------------

const { isFileAccessAllowed } = await import('../src/file-access-check.js');

test('file access: the API saying yes is taken at its word, no probe needed', async () => {
  let probed = false;
  const allowed = await isFileAccessAllowed({
    api: async () => true,
    probe: async () => { probed = true; return false; },
  });
  assert.equal(allowed, true);
  assert.equal(probed, false);
});

test('file access: a readable file:// URL overrules an API that says no', async () => {
  // The bug this guards: chrome.extension is missing (service worker) or
  // answers false, and the reader gets nagged to flip a switch already on.
  assert.equal(await isFileAccessAllowed({ api: async () => false, probe: async () => true }), true);
  assert.equal(await isFileAccessAllowed({ api: null, probe: async () => true }), true);
  assert.equal(
    await isFileAccessAllowed({ api: async () => { throw new Error('not a function'); }, probe: async () => true }),
    true
  );
});

test('file access: only nags when both the API and the probe say no', async () => {
  assert.equal(await isFileAccessAllowed({ api: async () => false, probe: async () => false }), false);
});

// --- orphaned inline content (display math splits its paragraph) --------

const { wrapOrphanInlines } = await import('../src/normalize.js');

test('normalize: inline leftovers after a display-math div become a paragraph', () => {
  const article = document.createElement('article');
  // Exactly what the parser produces for "text $$D$$ more $R^2$ text": the div
  // closes the <p>, and everything after it lands straight on the article.
  article.innerHTML = '<p>before</p><div class="skim-math skim-math-display">D</div>'
    + 'the use of <span class="skim-math skim-math-inline">R^2</span> for selection';
  wrapOrphanInlines(article);
  const kinds = Array.from(article.children).map((c) => c.tagName);
  assert.deepEqual(kinds, ['P', 'DIV', 'P']);
  assert.equal(article.children[2].textContent, 'the use of R^2 for selection');
});

test('normalize: whitespace between blocks does not become an empty paragraph', () => {
  const article = document.createElement('article');
  article.innerHTML = '<p>one</p>\n  \n<p>two</p>\n';
  wrapOrphanInlines(article);
  assert.equal(article.children.length, 2);
});

test('normalize: a document of well-formed blocks is left untouched', () => {
  const article = document.createElement('article');
  const html = '<h1>Title</h1><p>body</p><ul><li>item</li></ul>';
  article.innerHTML = html;
  wrapOrphanInlines(article);
  assert.equal(article.innerHTML, html);
});

test('nav: inline leftovers are never navigable blocks', async () => {
  const { getBlocks } = await import('../src/nav.js');
  const article = document.createElement('article');
  article.innerHTML = '<p>para</p><span class="skim-math skim-math-inline">R^2</span>'
    + '<div class="skim-math skim-math-display">D</div>';
  const tags = getBlocks(article).map((b) => b.tagName);
  assert.deepEqual(tags, ['P', 'DIV']);
});

// --- smooth scrolling (j/k, G, gg) --------------------------------------

const { createSmoothScroller } = await import('../src/smooth-scroll.js');

// Drive the scroller with a fake clock and rAF so the easing is deterministic.
function fakeScroller({ height = 10000, viewport = 800 } = {}) {
  let y = 0;
  let t = 0;
  const queue = [];
  const s = createSmoothScroller({
    getY: () => Math.round(y),
    setY: (next) => { y = next; },
    maxY: () => height - viewport,
    raf: (cb) => queue.push(cb),
    now: () => t,
  });
  return {
    scroller: s,
    y: () => y,
    // Run frames at 60Hz until the animation settles (or we give up).
    run(frames = 200) {
      for (let i = 0; i < frames && queue.length; i++) {
        const cb = queue.shift();
        t += 16.7;
        cb(t);
      }
    },
  };
}

test('smooth scroll: a step eases to exactly the requested distance', () => {
  const f = fakeScroller();
  f.scroller.by(120);
  assert.equal(f.y(), 0, 'nothing moves until the first frame');
  f.run();
  assert.equal(f.y(), 120);
  assert.equal(f.scroller.animating, false);
});

test('smooth scroll: presses while gliding accumulate instead of restarting', () => {
  const f = fakeScroller();
  f.scroller.by(100);
  f.run(2);
  const mid = f.y();
  assert.ok(mid > 0 && mid < 100, 'partway through the first step');
  f.scroller.by(100); // key repeat lands mid-flight
  f.run();
  assert.equal(f.y(), 200);
});

test('smooth scroll: G and gg targets clamp to the document', () => {
  const f = fakeScroller({ height: 10000, viewport: 800 });
  f.scroller.to(1e9);
  f.run();
  assert.equal(f.y(), 9200);
  f.scroller.to(-1e9);
  f.run();
  assert.equal(f.y(), 0);
});

test('smooth scroll: scrolling by other means mid-glide carries the remainder over', () => {
  const f = fakeScroller();
  f.scroller.by(1000);
  f.run(1);
  const afterFirst = f.y();
  const remaining = 1000 - afterFirst;
  f.scroller.by(0); // no-op press, keeps the target where it is
  // The reader flicks the wheel: jump the page somewhere else entirely.
  const jumped = 5000;
  f.scroller.to(jumped + remaining); // what the resync should converge on
  f.run();
  assert.equal(Math.round(f.y()), jumped + Math.round(remaining));
});

// --- Hebrew/English/math mixed rendering (bidi phrase isolation) --------
const { normalizeInlineMath } = await import('../src/render.js');
const { ltrIslandRanges } = await import('../src/bidi.js');

test('normalizeInlineMath collapses double-escaped commands in inline math', () => {
  assert.equal(normalizeInlineMath('\\|x\\\\|\\le\\sqrt3'), '\\|x\\|\\le\\sqrt3');
  assert.equal(normalizeInlineMath('x\\\\le 1'), 'x\\le 1');
});

test('normalizeInlineMath keeps sources where collapsing breaks parsing', () => {
  assert.equal(normalizeInlineMath('a\\\\b'), 'a\\\\b');
});

test('normalizeInlineMath leaves environment math alone', () => {
  const src = '\\begin{cases}a\\\\b\\end{cases}';
  assert.equal(normalizeInlineMath(src), src);
});

test('renderMarkdown renders double-escaped inline math without a line break', () => {
  const html = renderMarkdown('כל האיברים אי-שליליים, לכן $\\|x\\\\|\\le\\sqrt3$.');
  assert.ok(html.includes('skim-math-inline'), 'inline math rendered');
  assert.ok(!html.includes('newline'), 'no hard line break inside the formula');
});

test('ltrIslandRanges isolates quoted English phrases with their punctuation', () => {
  const text = 'סגורה — שורת "Closed?": בדיקה';
  const ranges = ltrIslandRanges(text);
  assert.equal(ranges.length, 1);
  assert.equal(text.slice(ranges[0].start, ranges[0].end), '"Closed?"');
});

test('ltrIslandRanges isolates Latin-digit runs so separators stay put', () => {
  const text = 'הקבוצה של 2024-B Q3, ושם';
  const r = ltrIslandRanges(text);
  assert.equal(r.length, 1);
  assert.equal(text.slice(r[0].start, r[0].end), '2024-B Q3');
});

test('ltrIslandRanges leaves gershayim acronyms and lone Latin words alone', () => {
  assert.equal(ltrIslandRanges('צה"ל פרסם הודעה').length, 0);
  assert.equal(ltrIslandRanges('שורות סמוכות ב-CLASSIFY, אחת').length, 0);
});

test('ltrIslandRanges keeps trailing sentence punctuation outside the island', () => {
  const text = 'ראה GPT-4, בהמשך';
  const r = ltrIslandRanges(text);
  assert.equal(r.length, 1);
  assert.equal(text.slice(r[0].start, r[0].end), 'GPT-4');
});

test('ltrIslandRanges absorbs balanced trailing brackets and ++ suffixes', () => {
  const t1 = 'קרא kernel(x) עכשיו';
  const r1 = ltrIslandRanges(t1);
  assert.equal(t1.slice(r1[0].start, r1[0].end), 'kernel(x)');
  const t2 = 'שפת C++ היא';
  const r2 = ltrIslandRanges(t2);
  assert.equal(t2.slice(r2[0].start, r2[0].end), 'C++');
});

test('applyBidi wraps LTR phrases inside RTL paragraphs in ltr isolates', () => {
  const article = document.createElement('article');
  article.innerHTML = '<p>חסומה — שורת "SET bounded?", הסעיף של 2024-B Q3 בהמשך</p>';
  applyBidi(article);
  const isolates = [...article.querySelectorAll('p bdi[dir="ltr"]')];
  assert.deepEqual(isolates.map((b) => b.textContent), ['"SET bounded?"', '2024-B Q3']);
});

test('applyBidi adds no phrase isolates to LTR paragraphs', () => {
  const article = document.createElement('article');
  article.innerHTML = '<p>see "Closed?" and GPT-4 here</p>';
  applyBidi(article);
  assert.equal(article.querySelectorAll('bdi').length, 0);
});

test('decorateSymbols mirrors implication arrows in RTL flow', () => {
  const a = tableArticle('<p>רציפה ⇒ סגורה תמיד</p>');
  applyBidi(a);
  decorateSymbols(a);
  const sym = a.querySelector('.skim-sym');
  assert.equal(sym.dataset.sym, '⇒');
  assert.ok(sym.innerHTML.includes('⇐'), 'rendered glyph points with the RTL flow');
});

test('decorateSymbols keeps arrows between Latin operands unmirrored in RTL paragraphs', () => {
  const a = tableArticle('<p>נגדיר A ⇒ B ולכן נמשיך בעברית</p>');
  applyBidi(a);
  decorateSymbols(a);
  const sym = a.querySelector('.skim-sym');
  assert.ok(sym.innerHTML.includes('⇒'), 'stays a rightward arrow');
});

test('KaTeX character-metrics warnings never reach the console', () => {
  const seen = [];
  const orig = console.warn;
  console.warn = (...a) => seen.push(a[0]);
  try {
    renderMarkdown('שלום $\\text{עברית}$ עולם $x^2$');
  } finally {
    console.warn = orig;
  }
  assert.ok(
    !seen.some((m) => typeof m === 'string' && m.startsWith('No character metrics for')),
    'metrics warnings are filtered'
  );
});

// --- Skim quiz protocol -------------------------------------------------
const { parseQuizzes, scoreQuiz } = await import('../src/quiz.js');

const QUIZ_DOC = [
  '# פתרון מלא',
  '',
  'תוכן רגיל עם $x^2$ ועברית.',
  '',
  '<!-- SKIM-QUIZ',
  JSON.stringify({
    skimQuiz: 1,
    id: 'compact-drill',
    title: 'קומפקטיות',
    description: 'סגורה, חסומה, ויירשטראס',
    layout: 'third',
    pass: 0.7,
    shuffleChoices: false,   // keep authored order so the flow tests can click by index
    questions: [
      { q: 'מתי $\\{g\\le c\\}$ **סגורה**?', choices: ['רציפות ואי-שוויון לא חד', 'חסימות'], answer: 0, hint: 'תמונה הפוכה', explain: 'קרן סגורה נמשכת לאחור.' },
      { q: 'Which are norms on $\\mathbb{R}^2$?', choices: ['$\\|x\\|_1$', '$x_1^2$', '$\\|x\\|_\\infty$'], answer: [0, 2], hint: ['Think homogeneity.', 'Squares are not homogeneous.'] },
    ],
  }),
  '-->',
  '',
  'עוד תוכן.',
  '',
  '<!-- SKIM-QUIZ',
  JSON.stringify({ skimQuiz: 1, title: 'Second quiz', shuffleChoices: false, questions: [{ q: 'One?', choices: ['a', 'b'], answer: 1 }] }),
  '-->',
].join('\n');

test('parseQuizzes extracts and normalizes multiple quizzes', () => {
  const quizzes = parseQuizzes(QUIZ_DOC);
  assert.equal(quizzes.length, 2);
  const [q1, q2] = quizzes;
  assert.equal(q1.id, 'compact-drill');
  assert.equal(q1.title, 'קומפקטיות');
  assert.equal(q1.layout, 'third');
  assert.equal(q1.pass, 0.7);
  assert.equal(q1.questions[0].multi, false);
  assert.deepEqual(q1.questions[0].answers, [0]);
  assert.deepEqual(q1.questions[0].hints, ['תמונה הפוכה']);
  assert.equal(q1.questions[0].explain, 'קרן סגורה נמשכת לאחור.');
  assert.equal(q1.questions[1].multi, true);
  assert.deepEqual(q1.questions[1].answers, [0, 2]);
  assert.deepEqual(q1.questions[1].hints, ['Think homogeneity.', 'Squares are not homogeneous.']);
  assert.equal(q2.id, 'quiz-2');       // defaulted, position-based
  assert.equal(q2.layout, 'half');     // default layout
  assert.equal(q2.pass, null);
});

test('parseQuizzes skips invalid quizzes and non-quiz comments', () => {
  const doc = [
    '<!-- ordinary comment -->',
    '<!-- SKIM-QUIZ { not json } -->',
    '<!-- SKIM-QUIZ ' + JSON.stringify({ skimQuiz: 1, title: 'bad answer', questions: [{ q: 'x', choices: ['a', 'b'], answer: 5 }] }) + ' -->',
    '<!-- SKIM-QUIZ ' + JSON.stringify({ skimQuiz: 1, title: 'ok', questions: [{ q: 'x', choices: ['a', 'b'], answer: 1 }] }) + ' -->',
  ].join('\n');
  const quizzes = parseQuizzes(doc);
  assert.equal(quizzes.length, 1);
  assert.equal(quizzes[0].title, 'ok');
});

test('parseQuizzes ignores quiz examples inside code fences', () => {
  const doc = [
    '```markdown',
    '<!-- SKIM-QUIZ ' + JSON.stringify({ skimQuiz: 1, title: 'example', questions: [{ q: 'x', choices: ['a', 'b'], answer: 0 }] }) + ' -->',
    '```',
  ].join('\n');
  assert.equal(parseQuizzes(doc).length, 0);
});

test('the protocol document itself exposes no quizzes', async () => {
  const src = await readFile(new URL('../SKIM-QUIZ-PROTOCOL.md', import.meta.url), 'utf8');
  assert.equal(parseQuizzes(src).length, 0);
});

test('escaped dashes keep --> sequences from breaking the comment', () => {
  const doc = '<!-- SKIM-QUIZ {"skimQuiz":1,"title":"t","questions":[{"q":"a \\u002D\\u002D> b?","choices":["x","y"],"answer":0}]} -->';
  const quizzes = parseQuizzes(doc);
  assert.equal(quizzes.length, 1);
  assert.equal(quizzes[0].questions[0].q, 'a --> b?');
});

test('scoreQuiz scores single, multi, and skipped answers', () => {
  const quiz = parseQuizzes(QUIZ_DOC)[0];
  const full = scoreQuiz(quiz, [0, [0, 2]]);
  assert.deepEqual({ correct: full.correct, total: full.total }, { correct: 2, total: 2 });
  const partial = scoreQuiz(quiz, [1, [2, 0]]);   // wrong single; multi order-insensitive
  assert.equal(partial.correct, 1);
  assert.equal(partial.per[0].correct, false);
  const skipped = scoreQuiz(quiz, [null, null]);
  assert.equal(skipped.correct, 0);
  assert.equal(skipped.per[0].answered, false);
  const wrongSubset = scoreQuiz(quiz, [0, [0]]);  // multi must match exactly
  assert.equal(wrongSubset.correct, 1);
});

// --- quiz UI (jsdom smoke; full interaction is covered by browser e2e) --
const { buildQuizControl } = await import('../src/quiz-ui.js');

function mountQuizFixture(quizList, articleDir) {
  const container = document.createElement('div');
  container.className = 'skim-container';
  const article = document.createElement('article');
  if (articleDir) article.setAttribute('dir', articleDir);
  container.append(article);
  document.body.append(container);
  const button = buildQuizControl({ quizzes: quizList, container, article });
  document.body.append(button);
  return { container, button };
}

test('quiz UI: open, answer, instant verdict, score, review', () => {
  const realMatch = window.matchMedia;
  window.matchMedia = () => ({ matches: true });   // skip score count-up animation
  try {
    const quizzes = parseQuizzes(QUIZ_DOC);
    const { container, button } = mountQuizFixture([quizzes[0]], 'rtl');
    button.click();

    const pane = container.querySelector('.skim-quiz-pane');
    assert.ok(pane, 'pane mounted on open');
    assert.equal(pane.dataset.side, 'left', 'RTL article gets the pane at its inline-end');
    assert.equal(container.querySelectorAll('.skim-quiz-chip').length, 2);
    assert.ok(container.querySelector('.skim-quiz .skim-math'), 'LaTeX rendered inside the question');

    const hintBtn = [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Hint'));
    hintBtn.click();
    assert.ok(container.querySelector('.skim-quiz-hint'), 'hint revealed');

    container.querySelectorAll('.skim-quiz-choice')[0].click();    // single-select grades on click
    assert.ok(container.querySelector('.skim-quiz-verdict.is-correct'), 'verdict shown immediately');
    assert.ok(container.querySelector('.skim-quiz-chip.is-correct'), 'palette marks the graded answer');
    assert.ok(container.querySelector('.skim-quiz-explain'), 'explanation revealed with the verdict');
    assert.equal(container.querySelector('.skim-quiz-hints'), null, 'hints retire once graded');
    assert.ok([...container.querySelectorAll('.skim-quiz-choice')].every((c) => c.disabled), 'graded question locks');

    container.querySelectorAll('.skim-quiz-chip')[1].click();      // go to Q2 (multi)
    const c2 = container.querySelectorAll('.skim-quiz-choice');
    c2[0].click();
    assert.equal(container.querySelector('.skim-quiz-verdict'), null, 'multi-select waits for Check');
    container.querySelectorAll('.skim-quiz-choice')[2].click();    // re-query: renderAll rebuilt

    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Check').click();
    assert.ok(container.querySelector('.skim-quiz-verdict.is-correct'), 'multi-select verdict shown');

    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Score').click();
    assert.ok(container.querySelector('.skim-quiz-scorecard'), 'score view shown after the last answer');
    assert.match(container.querySelector('.skim-quiz-score-big').textContent, /100%/);
    assert.equal(container.querySelectorAll('.skim-quiz-chip.is-correct').length, 2);

    container.querySelectorAll('.skim-quiz-chip')[0].click();      // review Q1 from score
    assert.ok(container.querySelector('.skim-quiz-choice.is-right'), 'correct choice highlighted in review');
    assert.ok(container.querySelector('.skim-quiz-explain'), 'explanation shown in review');

    pane.remove();
    container.remove();
  } finally {
    window.matchMedia = realMatch;
  }
});

test('quiz UI: a wrong answer is called out and shows the right one', () => {
  const realMatch = window.matchMedia;
  window.matchMedia = () => ({ matches: true });
  try {
    const quiz = parseQuizzes(QUIZ_DOC)[1];   // one question, answer index 1
    const { container, button } = mountQuizFixture([quiz], 'ltr');
    button.click();

    container.querySelectorAll('.skim-quiz-choice')[0].click();
    assert.ok(container.querySelector('.skim-quiz-verdict.is-wrong'), 'wrong answer called out');
    assert.ok(container.querySelectorAll('.skim-quiz-choice')[0].classList.contains('is-missed'));
    assert.ok(container.querySelectorAll('.skim-quiz-choice')[1].classList.contains('is-right'));
    assert.ok(container.querySelector('.skim-quiz-chip.is-wrong'), 'palette marks it wrong');

    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Score').click();
    assert.match(container.querySelector('.skim-quiz-score-big').textContent, /0%/);

    container.querySelector('.skim-quiz-pane').remove();
    container.remove();
  } finally {
    window.matchMedia = realMatch;
  }
});

// Reloading a page with an open quiz re-enters through history.state. jsdom
// leaves `history` off the global (src reads it bare), so expose it here — the
// restore path is exactly where an empty pane regressed.
test('quiz UI: a page reload restores the open quiz instead of an empty pane', () => {
  const hadHistory = 'history' in globalThis;
  globalThis.history = window.history;
  try {
    const quiz = parseQuizzes(QUIZ_DOC)[1];
    const first = mountQuizFixture([quiz], 'ltr');
    first.button.click();
    assert.deepEqual(window.history.state?.skimQuiz?.id, quiz.id, 'open pushes a restorable state');
    first.container.querySelector('.skim-quiz-pane').remove();
    first.container.remove();

    const reloaded = mountQuizFixture([quiz], 'ltr');   // fresh control, same history entry
    const quizEl = reloaded.container.querySelector('.skim-quiz');
    assert.ok(quizEl, 'pane remounted on reload');
    assert.ok(quizEl.querySelector('.skim-quiz-choice'), 'the question renders, not an empty panel');
    reloaded.container.querySelector('.skim-quiz-pane').remove();
    reloaded.container.remove();
  } finally {
    window.history.replaceState(null, '');
    if (!hadHistory) delete globalThis.history;
  }
});

test('quiz UI: choices are shuffled, scored by their authored index', () => {
  const realRandom = Math.random;
  let n = 0;
  Math.random = () => ((n = (n * 7 + 3) % 11) / 11);   // deterministic, non-identity
  try {
    const doc = '<!-- SKIM-QUIZ ' + JSON.stringify({
      skimQuiz: 1, id: 'shuf', title: 'S',
      questions: [{ q: 'pick c', choices: ['a', 'b', 'c', 'd', 'e'], answer: 2 }],
    }) + ' -->';
    const quiz = parseQuizzes(doc)[0];
    assert.equal(quiz.shuffleChoices, true, 'shuffling is the default');
    const { container, button } = mountQuizFixture([quiz], 'ltr');
    button.click();

    const texts = () => [...container.querySelectorAll('.skim-quiz-choice-md')].map((c) => c.textContent.trim());
    assert.notDeepEqual(texts(), ['a', 'b', 'c', 'd', 'e'], 'display order differs from the authored order');
    assert.deepEqual([...texts()].sort(), ['a', 'b', 'c', 'd', 'e'], 'every choice is still shown once');

    // The authored answer travels with its text, not with position 3.
    const cards = [...container.querySelectorAll('.skim-quiz-choice')];
    cards[texts().indexOf('c')].click();
    assert.ok(container.querySelector('.skim-quiz-verdict.is-correct'), 'the right text grades correct wherever it landed');

    container.querySelector('.skim-quiz-pane').remove();
    container.remove();
  } finally {
    Math.random = realRandom;
  }
});

test('quiz UI: "all of the above" stays in its authored slot', () => {
  const realRandom = Math.random;
  Math.random = () => 0.42;
  try {
    const doc = '<!-- SKIM-QUIZ ' + JSON.stringify({
      skimQuiz: 1, id: 'pin', title: 'P',
      questions: [{ q: 'x', choices: ['a', 'b', 'c', 'All of the above'], answer: 3 }],
    }) + ' -->';
    const { container, button } = mountQuizFixture([parseQuizzes(doc)[0]], 'ltr');
    button.click();
    const texts = [...container.querySelectorAll('.skim-quiz-choice-md')].map((c) => c.textContent.trim());
    assert.equal(texts[3], 'All of the above');
    container.querySelector('.skim-quiz-pane').remove();
    container.remove();
  } finally {
    Math.random = realRandom;
  }
});

test('quiz UI: LTR article docks the pane on the right', () => {
  const quizzes = parseQuizzes(QUIZ_DOC);
  const { container, button } = mountQuizFixture([quizzes[1]], 'ltr');
  button.click();
  const pane = container.querySelector('.skim-quiz-pane');
  assert.equal(pane.dataset.side, 'right');
  pane.remove();
  container.remove();
});

test('applyBidi isolates a mixed-language parenthetical as one unit', () => {
  const article = document.createElement('article');
  article.innerHTML = '<p>כשמופיע knob (temperature, smoothing, שיעור dropout), הניתוח הוא תמיד לגזור.</p>';

  applyBidi(article);

  const paragraph = article.querySelector('p');
  assert.equal(paragraph.getAttribute('dir'), 'rtl');
  const isolate = paragraph.querySelector('bdi.skim-ltr-phrase');
  assert.ok(isolate, 'the parenthetical is isolated');
  assert.equal(isolate.getAttribute('dir'), 'ltr');
  assert.equal(isolate.textContent, '(temperature, smoothing, שיעור dropout)');
});

test('applyBidi leaves a Hebrew parenthetical in Hebrew prose alone', () => {
  const article = document.createElement('article');
  article.innerHTML = '<p>הסבר בעברית (כולל הערה בעברית עם term אחד) וסיום.</p>';

  applyBidi(article);

  assert.equal(article.querySelector('p bdi.skim-ltr-phrase'), null);
});

test('applyBidi isolates a Hebrew parenthetical inside English prose', () => {
  const article = document.createElement('article');
  article.innerHTML = '<p>The lecturer called this (הטיה של האומד) in the notes.</p>';

  applyBidi(article);

  const isolate = article.querySelector('p bdi.skim-ltr-phrase');
  assert.ok(isolate);
  assert.equal(isolate.getAttribute('dir'), 'rtl');
  assert.equal(isolate.textContent, '(הטיה של האומד)');
});

// --- review nudge --------------------------------------------------------
const nudge = await import('../src/review-nudge.js');
const DAY = 24 * 3600 * 1000;

test('review nudge: silent until a dozen renders spread over several days', () => {
  const t0 = 1_000_000;
  let s = { ...nudge.EMPTY_STATE };
  for (let i = 0; i < 30; i++) s = nudge.recordRender(s, t0 + i);
  assert.equal(s.renders, 30);
  assert.equal(s.firstRender, t0);
  // Plenty of renders, but all today: still too early.
  assert.equal(nudge.shouldOffer(s, t0 + DAY), false);
  assert.equal(nudge.shouldOffer(s, t0 + 6 * DAY), true);
  // Old install, too few renders: also no.
  let few = { ...nudge.EMPTY_STATE };
  for (let i = 0; i < 5; i++) few = nudge.recordRender(few, t0);
  assert.equal(nudge.shouldOffer(few, t0 + 30 * DAY), false);
});

test('review nudge: "later" snoozes by both time and renders; done is forever; 3 showings max', () => {
  const t0 = 1_000_000;
  let s = { ...nudge.EMPTY_STATE };
  for (let i = 0; i < 12; i++) s = nudge.recordRender(s, t0);
  const t1 = t0 + 10 * DAY;
  assert.equal(nudge.shouldOffer(s, t1), true);
  s = nudge.markSnoozed(nudge.markShown(s, t1), t1);
  assert.equal(s.shown, 1);
  // 45 days later but only a handful more renders: still snoozed.
  for (let i = 0; i < 5; i++) s = nudge.recordRender(s, t1);
  assert.equal(nudge.shouldOffer(s, t1 + 50 * DAY), false);
  // Enough renders but not enough time: still snoozed.
  for (let i = 0; i < 40; i++) s = nudge.recordRender(s, t1);
  assert.equal(nudge.shouldOffer(s, t1 + 10 * DAY), false);
  assert.equal(nudge.shouldOffer(s, t1 + 50 * DAY), true);
  // Lifetime cap.
  s = nudge.markShown(nudge.markShown(s, t1), t1);
  assert.equal(nudge.shouldOffer(s, t1 + 50 * DAY), false);
  // Done wins over everything.
  assert.equal(nudge.shouldOffer(nudge.markDone({ ...nudge.EMPTY_STATE, renders: 99, firstRender: 1 }), t1 + 999 * DAY), false);
});

test('review nudge: card answers exactly once and links to the store reviews page', () => {
  const answers = [];
  const card = nudge.buildReviewCard(14, (k) => answers.push(k));
  document.body.append(card);
  assert.match(card.querySelector('.skim-review-rate').href, /chromewebstore\.google\.com\/.*\/reviews$/);
  assert.match(card.textContent, /14 documents/);
  card.querySelector('.skim-review-later').click();
  card.querySelector('.skim-review-close').click();
  card.skimAnswer('rate');
  assert.deepEqual(answers, ['later']);
  card.remove();
});

// --- security hardening -----------------------------------------------

test('renderMarkdown drops author <style> blocks, including ones smuggled inside inline <svg>', () => {
  // DOMPurify already drops an HTML-namespace <style>; the SVG-namespace one
  // survived the svg profile, and an inline-SVG stylesheet applies to the whole
  // document — enough to hide or restyle Skim's own toolbar.
  const html = renderMarkdown('<svg><style>.skim-toolbar{display:none}</style></svg>\n\nvisible text');
  assert.ok(!/<style/i.test(html), 'author <style> must not reach the article');
  assert.match(html, /visible text/);
});

test('renderMarkdown strips positioning/url() from inline styles but keeps harmless declarations', () => {
  const html = renderMarkdown(
    '<div style="position:fixed;top:0;left:0;z-index:99999;color:red;background:url(https://evil.example/p.gif)">x</div>'
  );
  assert.ok(!/position\s*:/i.test(html), 'position must be removed');
  assert.ok(!/z-index/i.test(html), 'z-index must be removed');
  assert.ok(!/url\(/i.test(html), 'url() must be removed');
  assert.match(html, /color:\s*red/, 'harmless declarations survive');
});

test('renderMarkdown keeps the inline layout styles KaTeX needs', () => {
  const html = renderMarkdown('$\\frac{a}{b}$ and $\\sqrt{x}$');
  assert.match(html, /style="[^"]*height:/, 'KaTeX height styles must survive the style filter');
  assert.match(html, /style="[^"]*top:/, 'KaTeX vlist top offsets must survive the style filter');
});

test('renderMarkdown removes Skim chrome classes from author markup but keeps renderer classes', () => {
  const html = renderMarkdown([
    '<div class="skim-toolbar skim-toc skim-lightbox note">x</div>',
    '',
    '```js',
    'let a = 1',
    '```',
    '',
    '> [!NOTE]',
    '> hi',
  ].join('\n'));
  assert.ok(!/skim-toolbar|skim-toc|skim-lightbox/.test(html), 'chrome classes must be dropped');
  assert.match(html, /class="note"/, 'ordinary author classes survive');
  assert.match(html, /skim-code/, 'renderer code class survives');
  assert.match(html, /skim-alert skim-alert-note/, 'renderer alert classes survive');
});

test('KaTeX \\gdef macros do not leak from one rendered document into the next', () => {
  renderMarkdown('$\\gdef\\leakyMacro{42}$');
  const html = renderMarkdown('$\\leakyMacro$');
  assert.ok(!/mord">42</.test(html), 'a macro defined by a previous document must be unknown');
});

test('KaTeX \\gdef macros still persist within a single document', () => {
  const html = renderMarkdown('$\\gdef\\sameDocMacro{42}$ then $\\sameDocMacro$');
  assert.match(html, /mord">42</);
});

test('settings: migrateLocalSettings ignores legacy keys on web origins (page-controlled localStorage)', async () => {
  // setup-dom runs the document at https://example.com/doc.md — a web origin whose
  // localStorage the page author controls. Migration must not read it.
  const data = installFakeChromeStorage();
  localStorage.setItem('glow-md-theme', 'light');
  localStorage.setItem('glow-md-density', 'big');
  try {
    await migrateLocalSettings();
    assert.equal(data.theme, undefined, 'theme must not be migrated from a web origin');
    assert.equal(data.density, undefined, 'density must not be migrated from a web origin');
    // Positive control: the legacy keys are left untouched, proving the early
    // return happened (an exception before the storage read would also leave
    // `data` empty).
    assert.equal(localStorage.getItem('glow-md-theme'), 'light');
    assert.equal(localStorage.getItem('glow-md-density'), 'big');
  } finally {
    localStorage.removeItem('glow-md-theme');
    localStorage.removeItem('glow-md-density');
  }
});

test('HTML export carries a CSP that blocks scripts and sends no referrer', async () => {
  const { buildStandaloneHtml } = await import('../src/export-html.js');
  globalThis.chrome = { runtime: { getURL: (p) => `chrome-extension://fake/${p}` } };
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, text: async () => '/* css */' });
  const article = document.createElement('article');
  article.className = 'skim markdown-body';
  const main = document.createElement('main');
  main.className = 'skim-main';
  main.append(article);
  document.body.append(main);
  try {
    const html = await buildStandaloneHtml(article);
    const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
    assert.ok(csp, 'export must declare a CSP');
    assert.match(csp[1], /default-src 'none'/, 'everything not listed (scripts, frames, connect) is blocked');
    assert.ok(!/script-src/.test(csp[1]), 'no script-src carve-out');
    assert.match(csp[1], /img-src [^;]*(\*|https:)/, 'remote images stay viewable by design');
    assert.match(csp[1], /img-src [^;]*file:/, 'images next to the exported file work when opened from disk');
    assert.match(html, /<meta name="referrer" content="no-referrer">/);
  } finally {
    globalThis.fetch = origFetch;
    main.remove();
  }
});

test('class filter is case-insensitive about the skim- prefix', () => {
  const html = renderMarkdown('<div class="SKIM-toolbar Skim-Toolbar skim-Toolbar note">x</div>');
  assert.ok(!/toolbar/i.test(html), 'chrome classes must be dropped regardless of case');
  assert.match(html, /class="note"/);
});

test('filterInlineStyle never re-emits a declaration whose property is not a plain identifier', () => {
  assert.equal(filterInlineStyle('/*;*/position:fixed'), '');
  assert.equal(filterInlineStyle('*/position:fixed'), '');
  assert.equal(filterInlineStyle('1x:y'), '');
  assert.equal(filterInlineStyle('--brand:red;color:blue'), '--brand:red;color:blue', 'custom properties are identifiers too');
});

test('filterInlineStyle anchors legacy-IE probes to the property, not the whole declaration', () => {
  const out = filterInlineStyle('scroll-behavior:smooth;overscroll-behavior:none;behavior:foo;-moz-binding:bar;color:blue');
  assert.match(out, /scroll-behavior:smooth/);
  assert.match(out, /overscroll-behavior:none/);
  assert.match(out, /color:blue/);
  assert.ok(!/(^|;)behavior:/.test(out), 'behavior: itself is still dropped');
  assert.ok(!/-moz-binding/.test(out));
});

test('the class allowlist covers every skim-* class render.js emits', async () => {
  const src = (await readFile(new URL('../src/render.js', import.meta.url), 'utf8'))
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/^\s*\/\/.*$/gm, '');        // line comments (prose may name chrome classes)
  const emitted = new Set(src.match(/skim-[a-z]+(?:-[a-z]+)*/g));
  emitted.delete('skim-'); // never a class on its own
  const missing = [...emitted].filter((c) => !isAllowedClass(c));
  assert.deepEqual(missing, [], 'add these to RENDERER_CLASSES or the filter will strip renderer output');
});

test('the article is its own stacking context and the TOC sits above it', async () => {
  // Author content can only be pulled out of the article's flow via KaTeX-style
  // relative offsets (top/left are allowed for math); a stacking context on the
  // article keeps such boxes under every sibling with a z-index, and the TOC
  // needs one to be such a sibling.
  const css = await readFile(new URL('../src/skim.css', import.meta.url), 'utf8');
  const rule = (sel) => [...css.matchAll(new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'g'))].map((m) => m[2]).join(';');
  assert.match(rule('.skim-main'), /isolation:\s*isolate/, '.skim-main must be a stacking context');
  assert.match(rule('.skim-toc'), /z-index:\s*[1-9]/, '.skim-toc must carry a positive z-index');
});
