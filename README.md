<div align="center">

# Skim

### Read what your AI wrote. Instantly.

A Chrome extension that renders Markdown beautifully, right in your browser — local files, URLs, and the plans and reports your AI coding agents keep writing.

<img width="820" src="promo/png/01-hero.png" alt="Skim rendering a markdown plan with a table-of-contents sidebar and scrollspy">

[![License: MIT](https://img.shields.io/badge/License-MIT-8b7cff.svg)](#license)
[![Chrome extension](https://img.shields.io/badge/Chrome-extension-4285F4?logo=googlechrome&logoColor=white)](#install-unpacked)
[![Version 2.0.1](https://img.shields.io/badge/version-2.0.1-informational)](#)
[![No data collected](https://img.shields.io/badge/data%20collected-none-brightgreen)](#)
[![GitHub stars](https://img.shields.io/github/stars/skim-md/skim?style=social)](https://github.com/skim-md/skim)

</div>

---

Open any `.md` file and Skim turns it into a clean, readable article: themes, KaTeX math, mermaid diagrams, smart tables, a table-of-contents sidebar, and live reload. No paywall, no account, nothing leaves your machine.

## Why Skim

|  |  |
| --- | --- |
| **Built for the AI era** | Agents write markdown constantly and rewrite it while you read. Skim watches the file and re-renders in place the moment it changes, shows YAML frontmatter as a readable header card, and has a one-click **Copy for AI** button that turns the rendered doc back into clean markdown source for your next prompt. |
| **Genuinely free** | Folder browsing, math, diagrams, themes, auto-reload — every feature is available to everyone. No Pro tier, no paywall, no account. Some viewers charge for folder browsing or diagrams. Skim doesn't. |
| **Light and private** | The whole extension ships at 5.56 MB (2.27 MB without the optional mermaid renderer). No telemetry, no analytics, no network calls on your behalf. Your files stay yours. |

<div align="center">
<img width="720" src="promo/png/02-autoreload.png" alt="Terminal writing plan.md on the left, Skim live-reloading the rendered view on the right">
</div>

## Highlights

- **Live reload** — re-renders in place the moment the file changes on disk, with fallback transports and a silent failure mode so it never breaks the page.
- **KaTeX math** — `$inline$`, `$$block$$`, and bare LaTeX environments (`\begin{align}…`), rendered offline. Double-click a formula to copy its LaTeX.
- **Mermaid diagrams** — ` ```mermaid ` fences render as diagrams, lazy-loaded so pages without them pay nothing.
- **Copy for AI** — turn the whole rendered document back into clean markdown, ready to paste.
- **Folder view** — enhances `file://` directory listings, plus a Folder button to jump to a file's containing folder.
- **Light & dark themes** with a density setting, synced across devices via `chrome.storage.sync`.

<div align="center">
<img width="720" src="promo/png/04-math-mermaid.png" alt="KaTeX math and a mermaid pipeline diagram rendered offline">
</div>

<details>
<summary><b>Full feature list</b></summary>

- **GitHub-flavored Markdown** — tables, task lists, strikethrough, autolinks.
- **KaTeX math** — `$inline$` and `$$block$$` delimiters, plus bare LaTeX environments (`\begin{align}…`), all rendered offline. Double-click any formula to copy its LaTeX source.
- **Syntax-highlighted code** with a copy button on every block.
- **Mermaid diagrams** — ` ```mermaid ` fences render as diagrams, lazy-loaded so pages without diagrams don't pay the cost.
- **YAML frontmatter** rendered as a clean header card instead of raw `---` text.
- **Auto-reload** — re-renders in place when the file changes on disk, with several fallback transports and a silent failure mode so it never breaks the page.
- **Table of contents** sidebar with scrollspy (highlights the section you're reading as you scroll).
- **Light and dark themes**, plus a density setting, synced across your devices via `chrome.storage.sync`.
- **Reading zoom** (opt-in).
- **Hebrew/English bidi** — each block picks its own text direction, so mixed RTL/LTR documents render correctly.
- **Raw source view**, and **copy-selection-as-markdown** (copy any selection and get markdown, not HTML).
- **Print / export to PDF** with print-friendly styling.
- **Tab / Shift+Tab** to step through the document block by block (and through table rows, not just the whole table).
- **Folder view** — enhances `file://` directory listings, plus a Folder button to jump to a file's containing folder.
- **Force-render from the popup** — turn any page into a rendered markdown view on demand, via `activeTab`, without needing a `.md` URL.
- **First-install onboarding** with live detection of whether Chrome's "Allow access to file URLs" switch is on.
- **Robust encoding handling** — UTF-8/UTF-16 BOM detection, windows-1252/1255 heuristics for undeclared legacy encodings.
- **Large-file guard** so huge documents don't lock up the tab.

Supported extensions: `.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn`, `.mdx`, opened from `file://` and from `http(s)://` when the server sends the file as plain text (most static hosts, including GitHub raw and CDNs, do).

</details>

## Install (unpacked)

The repo ships a built `dist/` and `vendor/`, so you can skip the build and just try it.

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Click the Skim icon in the toolbar. To read local `.md` files, the popup walks you through the one Chrome switch it needs ("Allow access to file URLs") and shows live whether it's already on.

<div align="center">
<img width="640" src="promo/png/03-file-access.png" alt="Onboarding that walks you through enabling Allow access to file URLs">
</div>

Building from source (only needed if you've changed `src/`):

```bash
npm install
npm run icons   # generate PNG icons from assets/icon.svg
npm run build   # bundle content scripts + vendor KaTeX/mermaid assets
```

<details>
<summary><b>How it works</b></summary>

Skim only acts when Chrome is showing a markdown file as plain text (both `file://` and most static hosts serve `.md` as `text/plain` or `text/markdown`). A content script:

1. Detects the plaintext markdown page and its encoding (`src/detect.js`, `src/encoding.js`).
2. Extracts the raw source, pulls out YAML frontmatter (`src/frontmatter.js`), parses with `marked`, renders math with KaTeX, highlights code with highlight.js, and sanitizes the result with DOMPurify (`src/render.js`, `src/table.js`).
3. Replaces the page with a styled article and mounts the UI chrome: TOC, toolbar, theme/zoom, copy buttons, print, Copy-for-AI (`src/ui.js`, `src/main.js`, `src/nav.js`, `src/print.js`, `src/copy-markdown.js`, `src/skim.css`).
4. Watches the file for changes and re-renders in place (`src/reload.js`).

Markdown served as `text/html` or as a forced download (`application/octet-stream`) is **not** intercepted. Mermaid diagrams render from a separate, lazily-loaded bundle (`src/mermaid.js`, `src/mermaid-entry.js`). A separate content script (`src/folder.js`, `src/folder.css`) enhances `file://` directory listings. The popup (`src/popup/`), options page (`src/options/`), and onboarding page (`src/onboarding/`) share a settings module (`src/settings.js`) backed by `chrome.storage.sync`.

</details>

## Development

```bash
npm install
npm run build            # rebuild dist/ + vendor/ after editing src/
npm test                 # run the unit tests (node --test)
npm run size             # check the shipped package against its size budget
node scripts/preview.mjs examples/sample.md   # write preview.html to eyeball
```

## License

[MIT](#license) · Source: [github.com/skim-md/skim](https://github.com/skim-md/skim) · No data collected.
