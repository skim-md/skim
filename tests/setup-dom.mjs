// Install a jsdom-backed global environment so browser-oriented modules
// (DOMPurify, our DOM helpers) work under `node --test`.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
  url: 'https://example.com/doc.md',
  // Without this, jsdom reports document.hidden === true (no "visible" tab),
  // which would make the reload watcher always treat the page as backgrounded.
  pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;
global.Node = dom.window.Node;
global.NodeFilter = dom.window.NodeFilter;
global.localStorage = dom.window.localStorage;
// Node's built-in AbortController/AbortSignal are a different realm than
// jsdom's — window.addEventListener(..., { signal }) rejects a signal that
// isn't a same-realm AbortSignal. Alias to jsdom's so src code that does
// `new AbortController()` and passes the signal to a window listener works
// here the same way it does in a real browser (where they're one realm).
global.AbortController = dom.window.AbortController;
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
// jsdom doesn't implement scrollIntoView; several src modules call it
// unconditionally (nav.js, anchors.js, ui.js, main.js). No-op it so those
// code paths run cleanly under test instead of throwing inside listeners.
if (!dom.window.Element.prototype.scrollIntoView) {
  dom.window.Element.prototype.scrollIntoView = function scrollIntoView() {};
}

export { dom };
