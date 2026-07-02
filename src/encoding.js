// Decode markdown bytes without trusting the transport's charset: BOM first,
// strict UTF-8 next, then a windows-1255 (Hebrew) vs windows-1252 heuristic.
export function decodeMarkdownBytes(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3));
  }
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { /* legacy encoding */ }
  // Distinguish windows-1255 (Hebrew) from windows-1252 (accented Latin)
  // among the high bytes (>= 0x80), using two signals:
  //  - "hebrewish": share of high bytes that fall in 0xE0-0xFA, the Hebrew
  //    letter block in windows-1255 (also happens to cover accented Latin
  //    like é/à/ï, so range alone is ambiguous — see below).
  //  - "adjacency": share of high bytes that sit directly next to another
  //    high byte. Hebrew words are runs of consecutive high bytes (every
  //    letter is non-ASCII), whereas windows-1252 accents are isolated,
  //    single high bytes surrounded by plain ASCII (e.g. "r\xE9sum\xE9").
  // A whole-document ratio of hebrewish bytes fails on realistic mixed
  // documents (mostly-ASCII markdown with a few Hebrew words), because the
  // Hebrew bytes are a tiny fraction of the whole file even though, locally,
  // they form unmistakable runs. Adjacency captures that local structure
  // instead of diluting it against the whole document.
  let high = 0;
  let hebrewish = 0;
  let adjacent = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b < 0x80) continue;
    high++;
    if (b >= 0xE0 && b <= 0xFA) hebrewish++;
    const prev = i > 0 ? bytes[i - 1] : 0;
    const next = i + 1 < bytes.length ? bytes[i + 1] : 0;
    if (prev >= 0x80 || next >= 0x80) adjacent++;
  }
  const adjacencyRatio = high > 0 ? adjacent / high : 0;
  const hebrewishRatio = high > 0 ? hebrewish / high : 0;
  const isHebrew = adjacencyRatio >= 0.5 && hebrewishRatio > 0.7;
  const label = isHebrew ? 'windows-1255' : 'windows-1252';
  return new TextDecoder(label).decode(bytes);
}
