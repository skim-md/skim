import { fetchSourceBytes } from './source.js';
import { decodeMarkdownBytes } from './encoding.js';

// Poll the document's source and call onChange(newText) when it differs.
// Slows 4x while the tab is hidden. Returns {stop} or null when the source
// can't be re-read (feature silently unavailable).
export async function watchSource({ intervalMs = 1500, fetchBytes = fetchSourceBytes, onChange }) {
  const first = await fetchBytes();
  if (first === null) return null;
  let lastText = decodeMarkdownBytes(first);
  let timer = null;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    const hidden = typeof document !== 'undefined' && document.hidden;
    if (!hidden) {
      const buf = await fetchBytes();
      if (buf !== null) {
        const text = decodeMarkdownBytes(buf);
        if (text !== lastText) { lastText = text; onChange(text); }
      }
    }
    if (!stopped) timer = setTimeout(tick, hidden ? intervalMs * 4 : intervalMs);
  };
  timer = setTimeout(tick, intervalMs);
  return { stop() { stopped = true; clearTimeout(timer); } };
}
