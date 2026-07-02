// Decide whether the current document is Chrome's plaintext rendering of a
// markdown file that we should take over.

const MD_EXT = /\.(md|markdown|mdown|mkd|mkdn|mdx)(?:[?#].*)?$/i;
const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/x-markdown', 'text/x-web-markdown']);

export function hasMarkdownExtension(url) {
  try {
    const path = new URL(url).pathname;
    return MD_EXT.test(path);
  } catch {
    return MD_EXT.test(String(url));
  }
}

// Chrome's text viewer renders the file as a document whose <body> contains a
// single <pre> with the raw content. Detect that shape.
export function findPlaintextPre(doc) {
  const body = doc.body;
  if (!body) return null;
  const elements = Array.from(body.children).filter((n) => n.nodeType === 1);
  if (elements.length === 1 && elements[0].tagName === 'PRE') return elements[0];
  // Some viewers wrap differently; accept a lone <pre> anywhere if body has no
  // other meaningful element content.
  const pres = body.querySelectorAll('pre');
  if (pres.length === 1 && body.querySelectorAll('div, p, table, h1, h2, article, section').length === 0) {
    return pres[0];
  }
  return null;
}

// Returns { source } when we should render, or null to leave the page alone.
export function detectMarkdown(doc, url, contentType) {
  if (!hasMarkdownExtension(url)) return null;
  const type = (contentType || doc.contentType || '').split(';')[0].trim().toLowerCase();
  const looksTextual = !type || TEXT_TYPES.has(type);
  const pre = findPlaintextPre(doc);
  if (pre && looksTextual) {
    return { source: pre.textContent };
  }
  return null;
}

// Documents past this size skip cosmetic decoration passes so the tab stays
// responsive (glyphs/tables walk every text node).
export const HUGE_SOURCE_CHARS = 1_500_000;
export function isHugeSource(source) {
  return String(source).length > HUGE_SOURCE_CHARS;
}
