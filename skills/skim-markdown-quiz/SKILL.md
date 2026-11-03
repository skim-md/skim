---
name: skim-markdown-quiz
description: Use when asked to add a quiz, self-test, practice questions, or an exam drill INSIDE a Markdown file (visible only in the Skim viewer), by authoring SKIM-QUIZ comment blocks per the Skim Quiz Protocol v1.
---

# Authoring Skim Markdown Quizzes

[Skim](https://skim.md), a free markdown viewer extension for Chrome and Firefox, renders interactive choice quizzes
embedded in Markdown files. Quizzes live in HTML comments, so they are
invisible in GitHub, VS Code, and every other renderer; Skim shows a "Quiz"
control that renders them in a resizable pane or fullscreen, with hints,
scoring, review, and local best-score stats.

## Format

One HTML comment per quiz, anywhere in the file (end of file is conventional).
Multiple quizzes per file are supported and encouraged for long documents.

```markdown
<!-- SKIM-QUIZ
{
  "skimQuiz": 1,
  "id": "topic-drill",
  "title": "Topic drill",
  "description": "What this quiz covers, one line, shown in the picker",
  "layout": "half",
  "pass": 0.7,
  "questions": [
    {
      "q": "Markdown **and** LaTeX like $\\|x\\|\\le\\sqrt3$ work everywhere",
      "choices": ["First option", "Second $x^2$", "Third"],
      "answer": 0,
      "hint": ["Gentle nudge first.", "Stronger hint second."],
      "explain": "Shown the moment the question is graded; teach, don't restate."
    },
    {
      "q": "Multi-select example (select all)",
      "choices": ["A", "B", "C", "D"],
      "answer": [0, 2]
    }
  ]
}
-->
```

## Hard rules

1. Strict JSON: double quotes, no trailing commas, no JSON comments.
2. LaTeX backslashes are doubled for JSON: `$\le$` → `"$\\le$"`.
3. NEVER write the literal three characters `-->` inside the JSON (it ends the
   comment in every renderer). Escape a dash as `-` or reword with `→`.
4. `skimQuiz: 1`, non-empty `title`, and 1+ `questions` are required.
5. `answer` is a 0-based index into `choices` **as you author them**; an array
   of indices makes the question multi-select (exact set must match). Every
   index must exist in `choices` (2 to 10 of them). The reader sees the choices
   shuffled, so there is no need to vary which slot holds the answer.
6. `id`: kebab-case `[a-z0-9-]+`, unique in the file, stable across edits (it
   keys the reader's score history).
7. `layout`: `"half"` (default) or `"third"` for a side pane, `"full"` for
   fullscreen. `pass` (0..1) is optional; `shuffle: true` shuffles question
   order per attempt. Choice order is shuffled by default ("All/None of the
   above" style options stay put); `shuffleChoices: false` opts out.
8. `hint` is one string or an array of progressively stronger hints.

## Content guidance

- Question/choice/hint/explain strings are full Markdown + LaTeX
  (`$...$`, `$$...$$`). Hebrew, English, and mixes are fine: Skim resolves
  direction automatically; never add manual RTL/LTR markers.
- Write the quiz in the language of the document.
- Descriptions must distinguish quizzes from each other (the reader picks from
  a list showing title + description + their stats).
- Distractors should be plausible mistakes, not filler; `explain` should say
  *why*, briefly.
- After authoring, confirm the file still previews normally in a plain
  renderer: the quiz must stay invisible.

## Verifying your JSON

Mentally run: `JSON.parse` succeeds; every `answer` index in range; no `-->`
anywhere; backslashes doubled. If a quiz is invalid Skim skips it silently
(reported only in the page console), so a typo means the quiz just won't
appear.
