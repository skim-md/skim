// Zoom/pan overlay shared by images and mermaid diagrams. One clean overlay,
// no gallery or rotate extras. Esc, the close button, or a backdrop click
// dismisses it. Click (or scroll) to zoom; drag to pan when zoomed in.
//
// The overlay holds a single "content" node that receives the pan/zoom
// transform. `openImage` fills it with an <img>; `openNode` accepts any element
// (e.g. a cloned mermaid <svg>). Images that are themselves links are left
// alone so the link still works.

const MIN_SCALE = 1;
const MAX_SCALE = 8;

let overlay = null;      // the singleton overlay element
let contentEl = null;    // the transformed wrapper holding the img/svg
let state = null;        // { scale, tx, ty, dragging, startX, startY, moved }

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function applyTransform() {
  contentEl.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;
  overlay.classList.toggle('is-zoomed', state.scale > 1.01);
}

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'skim-lightbox';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Image viewer');
  overlay.hidden = true;

  const stage = document.createElement('div');
  stage.className = 'skim-lightbox-stage';

  contentEl = document.createElement('div');
  contentEl.className = 'skim-lightbox-content';
  stage.append(contentEl);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'skim-lightbox-close';
  closeBtn.setAttribute('aria-label', 'Close viewer');
  closeBtn.textContent = '×'; // ×

  overlay.append(stage, closeBtn);
  document.body.append(overlay);

  // --- interactions ---
  closeBtn.addEventListener('click', close);
  // Backdrop click (but not the tail of a drag) closes.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target === stage) { if (!state.moved) close(); }
  });

  // Click the content: toggle between fit and 2x centered on the click point.
  contentEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (state.moved) return;
    if (state.scale > 1.01) resetZoom();
    else zoomTo(2, e.clientX, e.clientY);
  });

  // Wheel to zoom around the pointer.
  overlay.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    zoomTo(clamp(state.scale * factor, MIN_SCALE, MAX_SCALE), e.clientX, e.clientY);
  }, { passive: false });

  // Drag to pan while zoomed.
  contentEl.addEventListener('pointerdown', (e) => {
    if (state.scale <= 1.01) return;
    state.dragging = true; state.moved = false;
    state.startX = e.clientX - state.tx;
    state.startY = e.clientY - state.ty;
    try { contentEl.setPointerCapture(e.pointerId); } catch { /* no capture */ }
  });
  contentEl.addEventListener('pointermove', (e) => {
    if (!state.dragging) return;
    state.tx = e.clientX - state.startX;
    state.ty = e.clientY - state.startY;
    if (Math.abs(state.tx) + Math.abs(state.ty) > 3) state.moved = true;
    applyTransform();
  });
  const endDrag = (e) => {
    if (!state.dragging) return;
    state.dragging = false;
    try { contentEl.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    // Let the click handler see `moved`, then clear it next tick.
    setTimeout(() => { if (state) state.moved = false; }, 0);
  };
  contentEl.addEventListener('pointerup', endDrag);
  contentEl.addEventListener('pointercancel', endDrag);

  return overlay;
}

// Zoom to `scale`, keeping the point (cx, cy) in viewport coords roughly fixed.
function zoomTo(scale, cx, cy) {
  const rect = contentEl.getBoundingClientRect();
  const originX = rect.left + rect.width / 2;
  const originY = rect.top + rect.height / 2;
  const ratio = scale / state.scale;
  state.tx = cx - (cx - state.tx - originX) * ratio - originX;
  state.ty = cy - (cy - state.ty - originY) * ratio - originY;
  state.scale = scale;
  if (scale <= 1.01) { state.tx = 0; state.ty = 0; }
  applyTransform();
}

function resetZoom() {
  state.scale = 1; state.tx = 0; state.ty = 0;
  applyTransform();
}

function show() {
  state = { scale: 1, tx: 0, ty: 0, dragging: false, startX: 0, startY: 0, moved: false };
  applyTransform();
  overlay.hidden = false;
  document.documentElement.classList.add('skim-lightbox-open');
  document.addEventListener('keydown', onKeydown, true);
}

// Open an image by URL.
export function openImage(src, alt) {
  ensureOverlay();
  const img = document.createElement('img');
  img.className = 'skim-lightbox-img';
  img.alt = alt || '';
  img.draggable = false;
  img.src = src;
  contentEl.replaceChildren(img);
  show();
}

// Open an arbitrary element (caller passes a clone, e.g. a mermaid <svg>).
export function openNode(node) {
  ensureOverlay();
  contentEl.replaceChildren(node);
  show();
}

function close() {
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  document.documentElement.classList.remove('skim-lightbox-open');
  document.removeEventListener('keydown', onKeydown, true);
  contentEl.replaceChildren();
  state = null;
}

function onKeydown(e) {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
}

// Attach a delegated click handler to the article. Images inside links are
// skipped (the link wins). Called once per article node (survives auto-reload).
export function setupLightbox(article) {
  if (article.dataset.skimLightbox === '1') return;
  article.dataset.skimLightbox = '1';
  article.addEventListener('click', (e) => {
    const img = e.target.closest && e.target.closest('img');
    if (!img || !article.contains(img)) return;
    if (img.closest('a')) return;              // linked image: let the link work
    if (img.closest('.skim-mermaid')) return;  // diagrams open via their own control
    const src = img.currentSrc || img.src;
    if (!src) return;
    e.preventDefault();
    openImage(src, img.alt);
  });
}

// Exposed for tests.
export const _test = { openImage, openNode, close, isOpen: () => !!(overlay && !overlay.hidden) };
