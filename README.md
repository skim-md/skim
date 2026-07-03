<div align="center">

# Skim

### Read what your AI wrote. Instantly.

<img width="860" src="promo/png/01-hero.png" alt="Skim rendering a markdown plan with a table-of-contents sidebar and scrollspy">

[![MIT](https://img.shields.io/badge/License-MIT-8b7cff.svg)](#license)
[![Chrome extension](https://img.shields.io/badge/Chrome-extension-4285F4?logo=googlechrome&logoColor=white)](#install)
[![Version 2.1.0](https://img.shields.io/badge/version-2.1.0-informational)](#)
[![No data collected](https://img.shields.io/badge/data%20collected-none-brightgreen)](#)

Beautiful Markdown in your browser. Local files, URLs, and everything your AI agents keep writing.

</div>

---

<div align="center">

### Writes while you read.

<img width="820" src="promo/png/02-autoreload.png" alt="Terminal writing plan.md on the left, Skim live-reloading the rendered view on the right">

Skim watches the file and re-renders in place the moment it changes.

<br>

### Math and diagrams. Offline.

<img width="820" src="promo/png/04-math-mermaid.png" alt="KaTeX math and a mermaid pipeline diagram rendered offline">

KaTeX and Mermaid, rendered locally. Nothing leaves your machine.

<br>

### Every feature. Free.

<img width="820" src="promo/png/05-free.png" alt="Skim's features, all free — no Pro tier, no paywall, no account">

No Pro tier, no paywall, no account.

</div>

---

## Install

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. **Load unpacked** → select this folder

<div align="center">

<img width="640" src="promo/png/03-file-access.png" alt="Onboarding that walks you through enabling Allow access to file URLs">

</div>

To read local `.md` files, the popup walks you through the one Chrome switch it needs.

<details>
<summary><b>Everything Skim does</b></summary>

<br>

- **GitHub-flavored Markdown** — tables, task lists, strikethrough, autolinks.
- **KaTeX math** — `$inline$` and `$$block$$`, plus bare LaTeX environments (`\begin{align}…`), rendered offline. Double-click any formula to copy its LaTeX.
- **Syntax-highlighted code** with a copy button on every block.
- **Mermaid diagrams** — ` ```mermaid ` fences render as diagrams, lazy-loaded so pages without them pay nothing.
- **YAML frontmatter** rendered as a clean header card instead of raw `---` text.
- **Auto-reload** — re-renders in place when the file changes on disk, with fallback transports and a silent failure mode so it never breaks the page.
- **Copy for AI** — turn the whole rendered document back into clean markdown, ready to paste into your next prompt.
- **Table of contents** sidebar with scrollspy.
- **Light and dark themes**, plus a density setting, synced across devices via `chrome.storage.sync`.
- **Reading zoom** (opt-in).
- **Hebrew/English bidi** — each block picks its own text direction for mixed RTL/LTR documents.
- **Raw source view** and **copy-selection-as-markdown**.
- **Print / export to PDF** with print-friendly styling.
- **Tab / Shift+Tab** to step through the document block by block (and through table rows).
- **Folder view** — enhances `file://` directory listings, plus a Folder button to jump to a file's containing folder.
- **Force-render from the popup** — turn any page into a rendered markdown view on demand.
- **Robust encoding handling** — UTF-8/UTF-16 BOM detection, windows-1252/1255 heuristics for undeclared legacy encodings.
- **Large-file guard** so huge documents don't lock up the tab.

Supported: `.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn`, `.mdx`, from `file://` and from `http(s)://` when the server sends the file as plain text (most static hosts, including GitHub raw and CDNs, do).

</details>

<details>
<summary><b>How it works</b></summary>

<br>

Skim only acts when Chrome is showing a markdown file as plain text (both `file://` and most static hosts serve `.md` as `text/plain` or `text/markdown`). A content script:

1. Detects the plaintext markdown page and its encoding (`src/detect.js`, `src/encoding.js`).
2. Extracts the raw source, pulls out YAML frontmatter (`src/frontmatter.js`), parses with `marked`, renders math with KaTeX, highlights code with highlight.js, and sanitizes the result with DOMPurify (`src/render.js`, `src/table.js`).
3. Replaces the page with a styled article and mounts the UI: TOC, toolbar, theme/zoom, copy buttons, print, Copy-for-AI (`src/ui.js`, `src/main.js`, `src/nav.js`, `src/print.js`, `src/copy-markdown.js`, `src/skim.css`).
4. Watches the file for changes and re-renders in place (`src/reload.js`).

Markdown served as `text/html` or as a forced download is **not** intercepted. Mermaid renders from a separate, lazily-loaded bundle (`src/mermaid.js`, `src/mermaid-entry.js`). A separate content script (`src/folder.js`) enhances `file://` directory listings. The popup, options, and onboarding pages share a settings module (`src/settings.js`) backed by `chrome.storage.sync`.

</details>

<details>
<summary><b>Build &amp; develop</b></summary>

<br>

The repo ships a built `dist/` and `vendor/`, so installing unpacked needs no build. To rebuild after editing `src/`:

```bash
npm install
npm run build            # bundle content scripts + vendor KaTeX/mermaid assets
npm test                 # run the unit tests (node --test)
npm run size             # check the shipped package against its size budget
node scripts/preview.mjs examples/sample.md   # write preview.html to eyeball
```

</details>

---

<div align="center">

**MIT** · No data collected · [github.com/skim-md/skim](https://github.com/skim-md/skim)

</div>
