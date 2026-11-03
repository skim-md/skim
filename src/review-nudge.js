// Review nudge: a quiet, one-line ask to rate Skim on its store (Chrome Web
// Store or addons.mozilla.org, whichever this browser installs from).
//
// Etiquette, so it never reads as nagging:
//   * Earned, not scheduled. Nothing shows until the reader has rendered a dozen
//     documents across at least a few days: proof they actually use Skim.
//   * Asked at a good moment. Right after something worked (a PDF or HTML
//     export, a finished quiz: the page fires 'skim:success'), or else after
//     ~25 s of the tab being visible. Never on arrival.
//   * Never modal, never focus-stealing. A corner card; reading continues.
//   * Every answer is final or long-lived. "Rate" and the close mark done for
//     good (synced across devices). "Later" (or ignoring it) snoozes for weeks
//     AND dozens more renders. At most 3 showings per install, ever.
//   * Auto-reload re-renders do not count as uses; one page load = one render.
import { STORE_REVIEW_URL, ISSUES_URL } from './store.js';

export const NUDGE = {
  minRenders: 8,                        // documents rendered before the first ask
  minAgeMs: 3 * 24 * 3600 * 1000,       // ... and at least 3 days since the first render
  delayMs: 25 * 1000,                   // visible reading time before the card appears
  successDelayMs: 1500,                 // ... or this long after a 'skim:success'
  autoHideMs: 30 * 1000,                // ignored card folds itself away (= "Later")
  snoozeMs: 45 * 24 * 3600 * 1000,      // "Later": no ask for 45 days ...
  snoozeRenders: 40,                    // ... and 40 more renders, whichever is later
  maxShown: 3,                          // lifetime cap on showings
};

const KEY = 'reviewNudge';      // chrome.storage.local (per device: counters)
const DONE_KEY = 'reviewDone';  // chrome.storage.sync (across devices: never again)

export const EMPTY_STATE = Object.freeze({
  renders: 0, firstRender: 0, shown: 0, lastShown: 0,
  snoozeUntil: 0, snoozeRenders: 0, done: false,
});

// --- pure logic (unit-tested) -------------------------------------------

export function recordRender(state, now) {
  const s = { ...EMPTY_STATE, ...state };
  return { ...s, renders: s.renders + 1, firstRender: s.firstRender || now };
}

// Should the card be offered on this page load? (Timing is the caller's job.)
export function shouldOffer(state, now) {
  const s = { ...EMPTY_STATE, ...state };
  if (s.done) return false;
  if (s.shown >= NUDGE.maxShown) return false;
  if (s.renders < NUDGE.minRenders) return false;
  if (!s.firstRender || now - s.firstRender < NUDGE.minAgeMs) return false;
  if (s.snoozeUntil && now < s.snoozeUntil) return false;
  if (s.snoozeRenders && s.renders < s.snoozeRenders) return false;
  return true;
}

export function markShown(state, now) {
  const s = { ...EMPTY_STATE, ...state };
  return { ...s, shown: s.shown + 1, lastShown: now };
}

export function markSnoozed(state, now) {
  const s = { ...EMPTY_STATE, ...state };
  return { ...s, snoozeUntil: now + NUDGE.snoozeMs, snoozeRenders: s.renders + NUDGE.snoozeRenders };
}

export function markDone(state) {
  return { ...EMPTY_STATE, ...state, done: true };
}

// --- storage -------------------------------------------------------------

const hasLocal = () => typeof chrome !== 'undefined' && chrome.storage?.local;
const hasSync = () => typeof chrome !== 'undefined' && chrome.storage?.sync;

async function loadState() {
  if (!hasLocal()) return { ...EMPTY_STATE };
  const [{ [KEY]: local }, sync] = await Promise.all([
    chrome.storage.local.get(KEY),
    hasSync() ? chrome.storage.sync.get(DONE_KEY).catch(() => ({})) : {},
  ]);
  const s = { ...EMPTY_STATE, ...(local || {}) };
  if (sync?.[DONE_KEY]) s.done = true;
  return s;
}

async function saveState(s) {
  if (!hasLocal()) return;
  await chrome.storage.local.set({ [KEY]: s });
  if (s.done && hasSync()) chrome.storage.sync.set({ [DONE_KEY]: true }).catch(() => {});
}

// --- UI ------------------------------------------------------------------

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of [].concat(children)) node.append(c instanceof Node ? c : document.createTextNode(c));
  return node;
}

// Build the card. `onAnswer(kind)` is called once with 'rate' | 'later' | 'never'.
// "Something wrong?" opens a new GitHub issue and counts as 'later': the reader
// may well want to rate once it is fixed. It sits beside Rate, never instead of
// it, so nobody is steered away from the store.
export function buildReviewCard(renders, onAnswer) {
  const card = el('aside', { className: 'skim-review', role: 'status' });
  card.setAttribute('aria-label', 'Rate Skim');
  let answered = false;
  const answer = (kind) => {
    if (answered) return;
    answered = true;
    card.classList.remove('show');
    setTimeout(() => card.remove(), 400);
    onAnswer(kind);
  };

  const close = el('button', { className: 'skim-review-close', type: 'button', title: "Don't ask again", textContent: '×' });
  close.setAttribute('aria-label', "Don't ask again");
  close.addEventListener('click', () => answer('never'));

  const text = el('p', { className: 'skim-review-text' }, [
    el('strong', { textContent: `${renders} documents` }),
    ' read with Skim. If it has been useful, a rating takes ten seconds and helps others find it.',
  ]);

  const rate = el('a', {
    className: 'skim-review-rate', href: STORE_REVIEW_URL, target: '_blank', rel: 'noopener noreferrer',
  }, [el('span', { className: 'skim-review-star', textContent: '★' }), 'Rate Skim']);
  rate.addEventListener('click', () => answer('rate'));

  const later = el('button', { className: 'skim-review-later', type: 'button', textContent: 'Later' });
  later.addEventListener('click', () => answer('later'));

  const issue = el('a', {
    className: 'skim-review-issue', href: ISSUES_URL, target: '_blank', rel: 'noopener noreferrer',
    textContent: 'Something wrong?',
  });
  issue.addEventListener('click', () => answer('later'));

  card.append(close, text, el('div', { className: 'skim-review-actions' }, [rate, later, issue]));
  card.skimAnswer = answer;
  return card;
}

// Wait until the tab has accumulated `ms` of *visible* time, then resolve.
// A backgrounded tab pauses the clock, so a document opened and parked never
// pops the card into an empty room.
function afterVisible(ms) {
  return new Promise((resolve) => {
    let remaining = ms;
    let startedAt = 0;
    let timer = null;
    const stop = () => { if (timer) { clearTimeout(timer); timer = null; remaining -= Date.now() - startedAt; } };
    const start = () => {
      if (document.visibilityState !== 'visible' || timer) return;
      startedAt = Date.now();
      timer = setTimeout(() => { document.removeEventListener('visibilitychange', onVis); resolve(); }, Math.max(0, remaining));
    };
    const onVis = () => (document.visibilityState === 'visible' ? start() : stop());
    document.addEventListener('visibilitychange', onVis);
    start();
  });
}

// Resolve after 'skim:success' fires on this page, plus a beat so the card
// never lands on top of the thing that just finished.
function afterSuccess(ms) {
  return new Promise((resolve) => {
    document.addEventListener('skim:success', () => setTimeout(resolve, ms), { once: true });
  });
}

// Entry point, called once per page load after the document has rendered.
// Never throws: a storage hiccup must never affect the reader.
export async function setupReviewNudge() {
  try {
    let state = recordRender(await loadState(), Date.now());
    await saveState(state);
    if (!shouldOffer(state, Date.now())) return;

    await Promise.race([afterVisible(NUDGE.delayMs), afterSuccess(NUDGE.successDelayMs)]);
    // Re-read: another tab may have answered while we waited.
    state = await loadState();
    if (!shouldOffer(state, Date.now())) return;

    state = markShown(state, Date.now());
    await saveState(state);

    const card = buildReviewCard(state.renders, async (kind) => {
      clearTimeout(autoHide);
      const fresh = await loadState();
      await saveState(kind === 'later' ? markSnoozed(fresh, Date.now()) : markDone(fresh));
    });
    document.body.append(card);
    requestAnimationFrame(() => card.classList.add('show'));
    const autoHide = setTimeout(() => card.skimAnswer('later'), NUDGE.autoHideMs);
  } catch (e) {
    console.warn('Skim: review nudge skipped', e);
  }
}
