// Skim Quiz UI. Renders protocol quizzes (see SKIM-QUIZ-PROTOCOL.md and
// quiz.js) in a resizable side pane or fullscreen, with a question palette,
// hints, per-answer feedback, score/review, local attempt stats, and
// Back/Forward history integration. Grading is immediate: answering a question
// locks it and reveals right/wrong plus the explanation, so there is no submit
// step — the score appears once the last question is answered. All colors come
// from the theme tokens so every theme/scheme combination works untouched.
import { renderMarkdown } from './render.js';
import { applyBidi, textDirection } from './bidi.js';
import { decorateGlyphs } from './glyphs.js';
import { scoreQuiz } from './quiz.js';

const MIN_PANE = 300;        // px — resizer clamps here
const MIN_CONTENT = 360;     // px of article that must stay readable beside the pane
const CLOSE_OVERSHOOT = 120; // px past MIN before release means "close"
const FULL_AT = 0.92;        // fraction of container width that converts to fullscreen
const DOCK_AT = 0.85;        // dragging fullscreen edge below this fraction docks to pane

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of [].concat(children)) {
    if (c != null) node.append(c instanceof Node ? c : document.createTextNode(c));
  }
  return node;
}

// Markdown (with LaTeX, Hebrew/English mixes) -> decorated DOM, through the
// exact pipeline the article uses, so quiz content renders identically.
function mdBlock(md, className) {
  const div = el('div', { className: `skim-quiz-md${className ? ' ' + className : ''}` });
  div.innerHTML = renderMarkdown(String(md));
  applyBidi(div);
  decorateGlyphs(div);
  return div;
}

// --- local attempt stats ------------------------------------------------
function docKey() {
  return location.origin + location.pathname;
}

async function readStats() {
  try {
    const { skimQuizStats } = await chrome.storage.local.get('skimQuizStats');
    return skimQuizStats || {};
  } catch { return {}; }
}

async function recordAttempt(quizId, fraction) {
  try {
    const all = await readStats();
    const key = `${docKey()}::${quizId}`;
    const prev = all[key] || { attempts: 0, best: 0 };
    all[key] = {
      attempts: prev.attempts + 1,
      best: Math.max(prev.best, fraction),
      last: fraction,
      lastAt: Date.now(),
    };
    await chrome.storage.local.set({ skimQuizStats: all });
  } catch { /* storage unavailable (tests, private mode) */ }
}

const pct = (fraction) => `${Math.round(fraction * 100)}%`;

// "All of the above" and friends only make sense in their authored slot, so
// they stay put while everything else is shuffled around them.
const PINNED_CHOICE = /\b(all|none|both) of (the |these )?(above|below|these)\b|כל (התשובות|האפשרויות|הנ)|אף (אחת|אחד)/i;

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Display order for one question's choices: a permutation of the original
// indices. Answers are always stored as original indices, so scoring and the
// authored `answer` field are untouched by this.
function choiceOrderFor(quiz, q) {
  const identity = q.choices.map((_, i) => i);
  if (!quiz.shuffleChoices) return identity;
  const free = shuffleInPlace(identity.filter((i) => !PINNED_CHOICE.test(q.choices[i])));
  let k = 0;
  return identity.map((i) => (PINNED_CHOICE.test(q.choices[i]) ? i : free[k++]));
}

// --- session ------------------------------------------------------------
// One buildQuizControl call owns at most one open quiz at a time.
export function buildQuizControl({ quizzes, container, article }) {
  let list = quizzes;
  let session = null;   // open-quiz state
  let closing = false;  // unwinding history entries toward the below-marker
  // Closed-quiz state, revived on reopen (Forward after Back, accidental ✕,
  // or switching between quizzes) so the reader's answers survive.
  const stash = new Map();

  const button = el('button', {
    className: 'skim-quiz-button',
    type: 'button',
    title: 'Render a quiz embedded in this document',
  });
  const syncButton = () => {
    button.textContent = list.length > 1 ? `🎓 Quiz (${list.length})` : '🎓 Quiz';
    button.style.display = list.length ? '' : 'none';
  };
  syncButton();

  button.addEventListener('click', () => {
    if (session) { focusQuiz(); return; }
    if (list.length === 1) openQuiz(list[0]);
    else showPicker();
  });

  // Auto-reload hands us a re-parsed quiz list.
  button.skimQuizUpdate = (fresh) => {
    list = fresh;
    syncButton();
    if (session && !fresh.some((q) => q.id === session.quiz.id)) requestClose(true);
  };

  // ---- picker ----------------------------------------------------------
  async function showPicker() {
    const stats = await readStats();
    const overlay = el('div', { className: 'skim-quiz-overlay' });
    const card = el('div', { className: 'skim-quiz-picker' });
    card.append(el('h2', { className: 'skim-quiz-picker-title', textContent: 'Quizzes in this document' }));
    list.forEach((quiz) => {
      const s = stats[`${docKey()}::${quiz.id}`];
      const meta = [
        `${quiz.questions.length} questions`,
        quiz.layout === 'full' ? 'fullscreen' : 'side pane',
        s ? `best ${pct(s.best)} · ${s.attempts} attempt${s.attempts === 1 ? '' : 's'}` : 'not attempted',
      ].join(' · ');
      const row = el('button', { className: 'skim-quiz-picker-row', type: 'button' }, [
        el('span', { className: 'skim-quiz-picker-name', textContent: quiz.title }),
        quiz.description ? el('span', { className: 'skim-quiz-picker-desc', textContent: quiz.description }) : null,
        el('span', { className: 'skim-quiz-picker-meta', textContent: meta }),
      ]);
      row.querySelector('.skim-quiz-picker-name').setAttribute('dir', 'auto');
      row.querySelector('.skim-quiz-picker-desc')?.setAttribute('dir', 'auto');
      row.addEventListener('click', () => { dismiss(); openQuiz(quiz); });
      card.append(row);
    });
    const dismiss = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); dismiss(); } };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); });
    document.addEventListener('keydown', onKey, true);
    overlay.append(card);
    document.body.append(overlay);
    card.querySelector('.skim-quiz-picker-row')?.focus();
  }

  // ---- open/close ------------------------------------------------------
  function openQuiz(quiz, opts = {}) {
    if (session) teardown();
    const order = quiz.questions.map((_, i) => i);
    if (quiz.shuffle) shuffleInPlace(order);
    session = {
      quiz,
      order,
      choiceOrder: quiz.questions.map((q) => choiceOrderFor(quiz, q)),
      answers: quiz.questions.map(() => null),
      checked: quiz.questions.map(() => false),
      hintsShown: quiz.questions.map(() => 0),
      current: 0,
      submitted: false,
      result: null,
      reviewing: false,
      mode: quiz.layout === 'full' ? 'full' : 'pane',
      paneWidth: 0, // computed on mount
      dom: {},
    };
    const saved = stash.get(quiz.id);
    if (saved && saved.answers.length === quiz.questions.length) {
      Object.assign(session, saved);
    }
    mount(quiz.layout);
    if (!opts.noHistory) {
      try {
        history.replaceState({ ...(history.state || {}), skimQuizBelow: true }, '');
        history.pushState({ skimQuiz: { id: quiz.id, q: 0 } }, '');
      } catch { /* file: edge cases */ }
    }
    if (opts.restore != null) session.current = Math.min(opts.restore, order.length - 1);
    renderAll();
    focusQuiz();
  }

  function teardown() {
    if (!session) return;
    const { quiz, answers, checked, hintsShown, submitted, result, order, choiceOrder, current, reviewing } = session;
    stash.set(quiz.id, { answers, checked, hintsShown, submitted, result, order, choiceOrder, current, reviewing });
    session.dom.pane.remove();
    container.classList.remove('skim-quiz-open');
    document.removeEventListener('keydown', onQuizKey, true);
    window.removeEventListener('resize', onWinResize);
    session = null;
  }

  // Close by unwinding our history entries down to the below-marker, so the
  // history stack ends exactly where it was before the quiz opened.
  function requestClose(force = false) {
    if (!session) return;
    const dirty = !session.submitted && session.answers.some((a) => a != null);
    const message = 'Close the quiz? You have not finished it.';
    const go = () => {
      closing = true;
      try { history.go(-1); } catch { closing = false; teardown(); }
    };
    if (dirty && !force) confirmBox(message, 'Close', go);
    else go();
  }

  function onPop(e) {
    const st = e.state || {};
    if (closing) {
      if (st.skimQuizBelow || !st.skimQuiz) { closing = false; teardown(); }
      else { try { history.go(-1); } catch { closing = false; teardown(); } }
      return;
    }
    if (st.skimQuiz) {
      if (session) {
        session.current = Math.min(st.skimQuiz.q ?? 0, session.order.length - 1);
        renderAll();
      } else {
        const quiz = list.find((q) => q.id === st.skimQuiz.id);
        if (quiz) openQuiz(quiz, { noHistory: true, restore: st.skimQuiz.q ?? 0 });
      }
    } else if (st.skimQuizBelow && session) {
      teardown();
    }
  }
  window.addEventListener('popstate', onPop);

  // Session restore: reload with a quiz state on top of the stack.
  try {
    const st = history.state;
    if (st?.skimQuiz) {
      const quiz = list.find((q) => q.id === st.skimQuiz.id);
      if (quiz) openQuiz(quiz, { noHistory: true, restore: st.skimQuiz.q ?? 0 });
    }
  } catch (e) {
    // A restore must never leave a half-mounted pane behind (it renders as an
    // empty panel with the article squeezed beside it).
    try { console.info('Skim quiz restore failed:', e); } catch { /* no console */ }
    try { teardown(); } catch { /* nothing mounted */ }
  }

  // ---- geometry --------------------------------------------------------
  // A side pane only exists when both it and the article keep a usable width;
  // otherwise the quiz lives fullscreen. All clamps run through here so a
  // narrow window can never produce an inverted range or a squeezed article.
  function containerWidth() {
    return container.getBoundingClientRect().width || window.innerWidth;
  }
  function maxPaneWidth() {
    return Math.max(MIN_PANE, containerWidth() - MIN_CONTENT);
  }
  function paneFits() {
    return containerWidth() >= MIN_PANE + MIN_CONTENT + 40;
  }
  function clampPane(px) {
    return Math.min(Math.max(MIN_PANE, Math.round(px)), maxPaneWidth());
  }
  function onWinResize() {
    if (!session) return;
    if (session.mode === 'pane') {
      if (!paneFits()) { applyMode('full'); return; }
      session.paneWidth = clampPane(session.paneWidth);
      session.dom.pane.style.setProperty('--skim-quiz-w', `${session.paneWidth}px`);
    }
  }

  // ---- mounting --------------------------------------------------------
  function mount(layout) {
    const s = session;
    const articleDir = article.getAttribute('dir') === 'rtl' ? 'rtl' : 'ltr';
    const quizDir = textDirection(s.quiz.title + ' ' + s.quiz.questions[0].q) || articleDir;

    const resizer = el('div', { className: 'skim-quiz-resizer', title: 'Drag to resize · double-click to cycle' });
    resizer.setAttribute('role', 'separator');
    resizer.setAttribute('aria-orientation', 'vertical');
    resizer.tabIndex = 0;

    const quizEl = el('section', { className: 'skim skim-quiz' });
    quizEl.setAttribute('dir', quizDir);
    quizEl.tabIndex = -1;

    const pane = el('aside', { className: 'skim-quiz-pane' }, [resizer, quizEl]);
    pane.dataset.side = articleDir === 'rtl' ? 'left' : 'right';

    s.dom = { pane, resizer, quizEl };
    if (pane.dataset.side === 'left') container.prepend(pane); else container.append(pane);
    container.classList.add('skim-quiz-open');

    s.paneWidth = clampPane(containerWidth() * (layout === 'third' ? 1 / 3 : 0.46));
    applyMode(layout === 'full' ? 'full' : 'pane', false);
    requestAnimationFrame(() => pane.classList.add('skim-quiz-in'));

    setupResizer();
    document.addEventListener('keydown', onQuizKey, true);
    window.addEventListener('resize', onWinResize);
  }

  function applyMode(mode, animate = true) {
    const s = session;
    if (mode === 'pane' && !paneFits()) mode = 'full';   // narrow window: pane unavailable
    s.mode = mode;
    const { pane } = s.dom;
    if (animate) {
      pane.classList.add('skim-quiz-switching');
      setTimeout(() => pane.classList.remove('skim-quiz-switching'), 260);
    }
    pane.classList.toggle('skim-quiz-fullscreen', mode === 'full');
    if (mode === 'pane') pane.style.setProperty('--skim-quiz-w', `${s.paneWidth}px`);
    renderHeadActions();
  }

  function focusQuiz() { session?.dom.quizEl.focus({ preventScroll: true }); }

  // ---- resizing --------------------------------------------------------
  function setupResizer() {
    const s = session;
    const { resizer } = s.dom;
    let overshoot = 0;

    const widthFromPointer = (clientX) => {
      const rect = container.getBoundingClientRect();
      return s.dom.pane.dataset.side === 'left' ? clientX - rect.left : rect.right - clientX;
    };

    resizer.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      resizer.setPointerCapture(e.pointerId);
      resizer.classList.add('active');
      overshoot = 0;
    });
    resizer.addEventListener('pointermove', (e) => {
      if (!resizer.hasPointerCapture?.(e.pointerId)) return;
      const cw = containerWidth();
      const raw = widthFromPointer(e.clientX);
      if (s.mode === 'full') {
        // On a window too narrow for a pane, dragging inward reads as intent
        // to leave — offer to close instead of docking into a broken layout.
        if (raw <= cw * DOCK_AT) {
          if (!paneFits()) {
            resizer.releasePointerCapture?.(e.pointerId);
            confirmBox('Close the quiz?', 'Close', () => requestClose(true));
            return;
          }
          s.paneWidth = clampPane(raw);
          applyMode('pane');
        }
        return;
      }
      if (raw >= cw * FULL_AT) {
        applyMode('full');
        return;
      }
      overshoot = Math.max(0, MIN_PANE - raw);
      s.paneWidth = clampPane(raw);
      s.dom.pane.style.setProperty('--skim-quiz-w', `${s.paneWidth}px`);
    });
    resizer.addEventListener('pointerup', (e) => {
      resizer.releasePointerCapture?.(e.pointerId);
      resizer.classList.remove('active');
      if (s.mode === 'pane' && overshoot > CLOSE_OVERSHOOT) {
        confirmBox('Close the quiz?', 'Close', () => requestClose(true));
      }
      overshoot = 0;
    });
    resizer.addEventListener('dblclick', () => {
      if (s.mode === 'full') { applyMode('pane'); return; }
      const cw = containerWidth();
      const third = clampPane(cw / 3);
      const half = clampPane(cw * 0.46);
      s.paneWidth = Math.abs(s.paneWidth - third) < Math.abs(s.paneWidth - half) ? half : third;
      s.dom.pane.style.setProperty('--skim-quiz-w', `${s.paneWidth}px`);
    });
    resizer.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const grow = (s.dom.pane.dataset.side === 'left') === (e.key === 'ArrowRight');
      s.paneWidth = clampPane(s.paneWidth + (grow ? 40 : -40));
      s.dom.pane.style.setProperty('--skim-quiz-w', `${s.paneWidth}px`);
    });
  }

  // ---- keyboard --------------------------------------------------------
  function onQuizKey(e) {
    if (!session) return;
    if (e.key === 'Escape') {
      // The lightbox owns Escape while an image is zoomed.
      if (document.querySelector('.skim-lightbox:not([hidden])')) return;
      e.stopPropagation();
      requestClose();
      return;
    }
    if (!session.dom.pane.contains(document.activeElement)) return;
    const s = session;
    const qi = s.order[s.current];
    if (!s.checked[qi] && /^[1-9]$/.test(e.key)) {
      const pos = Number(e.key) - 1;
      if (pos < s.choiceOrder[qi].length) { toggleChoice(s.choiceOrder[qi][pos]); e.preventDefault(); }
    } else if (e.key === 'Enter' && !isScoreView() && !e.target.closest('button')) {
      // Enter is the "continue" key: grade a multi-select, else move on.
      if (!s.checked[qi]) { if (s.answers[qi] != null) { checkCurrent(); e.preventDefault(); } }
      else { advance(); e.preventDefault(); }
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const dir = session.dom.quizEl.getAttribute('dir') === 'rtl' ? -1 : 1;
      const delta = e.key === 'ArrowRight' ? dir : -dir;
      const next = s.current + delta;
      if (next >= 0 && next < s.order.length) { gotoQuestion(next); e.preventDefault(); }
    }
  }

  // ---- state transitions ----------------------------------------------
  function gotoQuestion(pos, push = true) {
    const s = session;
    if (pos === s.current) return;
    s.dom.quizEl.dataset.anim = pos > s.current ? 'next' : 'prev';
    s.current = pos;
    if (push) {
      try { history.pushState({ skimQuiz: { id: s.quiz.id, q: pos } }, ''); } catch { /* ignore */ }
    }
    renderAll();
  }

  // Was this (already-graded) question answered correctly? Mirrors scoreQuiz's
  // set comparison so the per-question badge and the final score never differ.
  function isCorrect(qi) {
    const want = session.quiz.questions[qi].answers;
    const a = session.answers[qi];
    const got = (Array.isArray(a) ? [...new Set(a)] : a != null ? [a] : []).sort((x, y) => x - y);
    return got.length === want.length && got.every((v, j) => v === want[j]);
  }

  function toggleChoice(idx) {
    const s = session;
    const qi = s.order[s.current];
    if (s.checked[qi]) return;   // graded questions are locked
    const q = s.quiz.questions[qi];
    if (q.multi) {
      // Multi-select needs an explicit "Check" — a click can't mean "done".
      const cur = new Set(Array.isArray(s.answers[qi]) ? s.answers[qi] : []);
      cur.has(idx) ? cur.delete(idx) : cur.add(idx);
      s.answers[qi] = cur.size ? [...cur].sort((a, b) => a - b) : null;
      renderAll();
      focusQuiz();   // renderAll replaced the focused button; keep keys working
    } else {
      s.answers[qi] = idx;
      checkCurrent();
    }
  }

  // Grade the current question in place and reveal the verdict. The last
  // question also closes the attempt (score recorded once, here).
  function checkCurrent() {
    const s = session;
    const qi = s.order[s.current];
    if (s.checked[qi] || s.answers[qi] == null) return;
    s.checked[qi] = true;
    s.freshVerdict = qi;
    if (s.checked.every(Boolean) && !s.submitted) {
      s.result = scoreQuiz(s.quiz, s.answers);
      s.submitted = true;
      s.reviewing = true;   // linger on the last verdict; "See results" leaves
      recordAttempt(s.quiz.id, s.result.fraction);
    }
    renderAll();
    focusQuiz();
  }

  // Next thing to do after a verdict: the next unanswered question, else the
  // score.
  function advance() {
    const s = session;
    if (s.checked.every(Boolean)) { s.reviewing = false; renderAll(); return; }
    const after = s.order.findIndex((qi, pos) => pos > s.current && !s.checked[qi]);
    const target = after !== -1 ? after : s.order.findIndex((qi) => !s.checked[qi]);
    gotoQuestion(target);
  }

  function retry() {
    const s = session;
    s.answers = s.quiz.questions.map(() => null);
    s.checked = s.quiz.questions.map(() => false);
    s.hintsShown = s.quiz.questions.map(() => 0);
    s.submitted = false;
    s.result = null;
    s.reviewing = false;
    if (s.quiz.shuffle) shuffleInPlace(s.order);
    s.choiceOrder = s.quiz.questions.map((q) => choiceOrderFor(s.quiz, q));
    s.current = 0;
    try { history.replaceState({ skimQuiz: { id: s.quiz.id, q: 0 } }, ''); } catch { /* ignore */ }
    renderAll();
  }

  // ---- confirm dialog --------------------------------------------------
  function confirmBox(message, actionLabel, onConfirm) {
    const { quizEl } = session.dom;
    quizEl.querySelector('.skim-quiz-confirm-wrap')?.remove();
    const cancel = el('button', { type: 'button', className: 'skim-quiz-ghost', textContent: 'Cancel' });
    const ok = el('button', { type: 'button', className: 'skim-quiz-primary', textContent: actionLabel });
    const wrap = el('div', { className: 'skim-quiz-confirm-wrap' },
      el('div', { className: 'skim-quiz-confirm' }, [
        el('p', { textContent: message }),
        el('div', { className: 'skim-quiz-confirm-actions' }, [cancel, ok]),
      ]));
    cancel.addEventListener('click', () => wrap.remove());
    ok.addEventListener('click', () => { wrap.remove(); onConfirm(); });
    wrap.addEventListener('click', (e) => { if (e.target === wrap) wrap.remove(); });
    quizEl.append(wrap);
    ok.focus();
  }

  // ---- rendering -------------------------------------------------------
  function renderHeadActions() {
    session?.dom.quizEl.querySelector('.skim-quiz-head')?.replaceWith(buildHead());
  }

  function buildHead() {
    const s = session;
    const modeBtn = el('button', {
      type: 'button',
      className: 'skim-quiz-icon',
      title: s.mode === 'full' ? 'Dock to side pane' : 'Fullscreen',
      textContent: s.mode === 'full' ? '⇱' : '⛶',
    });
    modeBtn.addEventListener('click', () => applyMode(s.mode === 'full' ? 'pane' : 'full'));
    const closeBtn = el('button', { type: 'button', className: 'skim-quiz-icon', title: 'Close quiz (Esc)', textContent: '✕' });
    closeBtn.addEventListener('click', () => requestClose());

    const graded = s.checked.filter(Boolean).length;
    const right = s.checked.reduce((n, done, qi) => n + (done && isCorrect(qi) ? 1 : 0), 0);
    return el('header', { className: 'skim-quiz-head' }, [
      el('div', { className: 'skim-quiz-titles' }, [
        el('h2', { className: 'skim-quiz-title', textContent: s.quiz.title }),
        el('span', {
          className: 'skim-quiz-progress',
          textContent: s.submitted && s.result
            ? `${s.result.correct}/${s.result.total} correct`
            : graded
              ? `${graded}/${s.order.length} answered · ${right} correct`
              : `0/${s.order.length} answered`,
        }),
      ]),
      el('div', { className: 'skim-quiz-actions' }, [modeBtn, closeBtn]),
    ]);
  }

  function buildPalette() {
    const s = session;
    const nav = el('nav', { className: 'skim-quiz-palette' });
    s.order.forEach((qi, pos) => {
      const chip = el('button', { type: 'button', className: 'skim-quiz-chip', textContent: String(pos + 1) });
      if (pos === s.current && !isScoreView()) chip.classList.add('is-current');
      if (s.checked[qi]) chip.classList.add(isCorrect(qi) ? 'is-correct' : 'is-wrong');
      else if (s.answers[qi] != null) chip.classList.add('is-answered');
      chip.setAttribute('aria-label', `Question ${pos + 1}`);
      chip.addEventListener('click', () => {
        s.reviewing = s.submitted;
        if (pos === s.current) renderAll();   // e.g. score view -> review current
        else gotoQuestion(pos);
      });
      nav.append(chip);
    });
    return nav;
  }

  // A declaration, not a `const` arrow: the session-restore path at the bottom
  // of buildQuizControl renders before this point, and a const would still be
  // in its temporal dead zone — that threw and left an empty pane on reload.
  function isScoreView() {
    return session.submitted && !session.reviewing;
  }

  function buildQuestion() {
    const s = session;
    const qi = s.order[s.current];
    const q = s.quiz.questions[qi];
    const checked = s.checked[qi];
    const body = el('div', { className: 'skim-quiz-body' });
    if (s.dom.quizEl.dataset.anim) {
      body.classList.add(`skim-anim-${s.dom.quizEl.dataset.anim}`);
      delete s.dom.quizEl.dataset.anim;
    }

    body.append(el('div', {
      className: 'skim-quiz-qnum',
      textContent: `Question ${s.current + 1} of ${s.order.length}${q.multi ? ' · select all that apply' : ''}`,
    }));
    body.append(mdBlock(q.q, 'skim-quiz-question'));

    const chosen = new Set(Array.isArray(s.answers[qi]) ? s.answers[qi] : s.answers[qi] != null ? [s.answers[qi]] : []);
    const choices = el('div', { className: 'skim-quiz-choices', role: 'group' });
    // `pos` is what the reader sees and types; `idx` is the authored index.
    s.choiceOrder[qi].forEach((idx, pos) => {
      const card = el('button', { type: 'button', className: 'skim-quiz-choice' }, [
        el('span', { className: 'skim-quiz-choice-key', textContent: String(pos + 1) }),
        mdBlock(q.choices[idx], 'skim-quiz-choice-md'),
      ]);
      if (chosen.has(idx)) card.classList.add('is-selected');
      if (checked) {
        card.disabled = true;
        if (q.answers.includes(idx)) card.classList.add('is-right');
        else if (chosen.has(idx)) card.classList.add('is-missed');
      }
      card.setAttribute('aria-pressed', chosen.has(idx) ? 'true' : 'false');
      card.addEventListener('click', () => toggleChoice(idx));
      choices.append(card);
    });
    body.append(choices);

    if (checked) {
      const right = isCorrect(qi);
      const verdict = el('div', {
        className: `skim-quiz-verdict ${right ? 'is-correct' : 'is-wrong'}`,
        textContent: right
          ? '✓ Correct'
          : `✗ Not quite — the correct answer${q.answers.length > 1 ? 's are' : ' is'} highlighted`,
      });
      verdict.setAttribute('role', 'status');
      if (s.freshVerdict === qi) verdict.classList.add('is-fresh');
      s.freshVerdict = null;
      body.append(verdict);
    }

    if (!checked && q.hints.length) {
      const shown = s.hintsShown[qi];
      const hintWrap = el('div', { className: 'skim-quiz-hints' });
      q.hints.slice(0, shown).forEach((h, hi) => {
        const hint = mdBlock(h, 'skim-quiz-hint');
        if (s.freshHint === `${qi}:${hi}`) hint.classList.add('is-fresh');
        hintWrap.append(hint);
      });
      s.freshHint = null;
      if (shown < q.hints.length) {
        const hb = el('button', {
          type: 'button',
          className: 'skim-quiz-ghost',
          textContent: shown === 0 ? '💡 Hint' : '💡 Another hint',
        });
        hb.addEventListener('click', () => {
          s.freshHint = `${qi}:${s.hintsShown[qi]}`;
          s.hintsShown[qi]++;
          renderAll();
          focusQuiz();
        });
        hintWrap.append(hb);
      }
      body.append(hintWrap);
    }

    if (checked && q.explain) {
      const ex = el('div', { className: 'skim-quiz-explain' });
      ex.append(el('span', { className: 'skim-quiz-explain-tag', textContent: 'Why' }));
      ex.append(mdBlock(q.explain));
      body.append(ex);
    }
    return body;
  }

  function buildScore() {
    const s = session;
    const { result, quiz } = s;
    const body = el('div', { className: 'skim-quiz-body skim-quiz-scorecard' });
    const big = el('div', { className: 'skim-quiz-score-big', textContent: '0%' });
    const target = Math.round(result.fraction * 100);
    try { document.dispatchEvent(new document.defaultView.Event('skim:success')); } catch { /* no DOM events here */ }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) big.textContent = `${target}%`;
    else {
      // Snap fallback: if animation frames starve (hidden tab, headless),
      // the number must still land on the real score.
      const snap = setTimeout(() => { big.textContent = `${target}%`; }, 800);
      const t0 = performance.now();
      const tick = (t) => {
        const p = Math.min(1, (t - t0) / 550);
        big.textContent = `${Math.round(target * (1 - (1 - p) ** 3))}%`;
        if (p < 1) requestAnimationFrame(tick);
        else clearTimeout(snap);
      };
      requestAnimationFrame(tick);
    }
    body.append(big);
    body.append(el('div', { className: 'skim-quiz-score-frac', textContent: `${result.correct} of ${result.total} correct` }));
    if (quiz.pass != null) {
      const passed = result.fraction >= quiz.pass;
      body.append(el('div', {
        className: `skim-quiz-score-badge ${passed ? 'is-pass' : 'is-fail'}`,
        textContent: passed ? `Passed · bar ${pct(quiz.pass)}` : `Below the ${pct(quiz.pass)} bar`,
      }));
    }
    const actions = el('div', { className: 'skim-quiz-score-actions' });
    const missed = result.per.filter((p) => !p.correct).length;
    if (missed) {
      const rb = el('button', { type: 'button', className: 'skim-quiz-primary', textContent: `Review ${missed} missed` });
      rb.addEventListener('click', () => {
        s.reviewing = true;
        const firstMiss = s.order.findIndex((qi) => !result.per[qi].correct);
        s.current = firstMiss === -1 ? 0 : firstMiss;
        renderAll();
      });
      actions.append(rb);
    }
    const again = el('button', { type: 'button', className: 'skim-quiz-ghost', textContent: '↺ Try again' });
    again.addEventListener('click', retry);
    actions.append(again);
    if (list.length > 1) {
      const other = el('button', { type: 'button', className: 'skim-quiz-ghost', textContent: 'All quizzes' });
      // Picking another quiz swaps the session; canceling keeps this one.
      other.addEventListener('click', () => showPicker());
      actions.append(other);
    }
    body.append(actions);
    return body;
  }

  function buildFoot() {
    const s = session;
    const foot = el('footer', { className: 'skim-quiz-foot' });
    if (isScoreView()) return foot;
    const prev = el('button', { type: 'button', className: 'skim-quiz-ghost', textContent: '‹ Prev', disabled: s.current === 0 });
    prev.addEventListener('click', () => gotoQuestion(s.current - 1));
    const next = el('button', { type: 'button', className: 'skim-quiz-ghost', textContent: 'Next ›', disabled: s.current === s.order.length - 1 });
    next.addEventListener('click', () => gotoQuestion(s.current + 1));
    foot.append(el('div', { className: 'skim-quiz-foot-nav' }, [prev, next]));

    const qi = s.order[s.current];
    const q = s.quiz.questions[qi];
    if (!s.checked[qi]) {
      if (q.multi) {
        // Only multi-select has a grade button; a single choice grades on click.
        const check = el('button', {
          type: 'button',
          className: 'skim-quiz-primary',
          textContent: 'Check',
          disabled: s.answers[qi] == null,
        });
        check.addEventListener('click', checkCurrent);
        foot.append(check);
      } else {
        foot.append(el('span', { className: 'skim-quiz-foot-hint', textContent: 'Pick an answer' }));
      }
    } else if (s.submitted) {
      const back = el('button', { type: 'button', className: 'skim-quiz-primary', textContent: 'Score' });
      back.addEventListener('click', () => { s.reviewing = false; renderAll(); });
      foot.append(back);
    } else {
      const go = el('button', { type: 'button', className: 'skim-quiz-primary', textContent: 'Next question ›' });
      go.addEventListener('click', advance);
      foot.append(go);
    }
    return foot;
  }

  function renderAll() {
    if (!session) return;
    const { quizEl } = session.dom;
    const view = isScoreView() ? buildScore() : buildQuestion();
    quizEl.replaceChildren(buildHead(), buildPalette(), view, buildFoot());
    quizEl.querySelector('.skim-quiz-body').scrollTop = 0;
  }

  return button;
}
