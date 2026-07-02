# Skim — Markdown Viewer & Reader

Read markdown beautifully, right in your browser. Skim renders `.md` files —
local files, URLs, and the plans/reports your AI coding agents keep writing —
with themes, KaTeX math, mermaid diagrams, smart tables, and live reload.

**[Install for Chrome]** (Chrome Web Store submission pending) · MIT licensed · no data collected

## Why Skim

**Built for the AI era.** Agents write markdown constantly — plans, reports,
`AGENTS.md`, scratch notes — and rewrite it while you're reading it. Skim
watches the file and re-renders in place the moment it changes, shows YAML
frontmatter as a readable header card instead of raw text, and has a one-click
**Copy for AI** button that turns the whole rendered document back into clean
markdown source, ready to paste into your next prompt.

**Genuinely free.** Folder browsing, math, diagrams, themes, auto-reload —
every feature is available to everyone. There's no Pro tier, no paywall, no
account. Some markdown viewers charge for folder browsing or diagram
rendering; Skim doesn't.

**Light and private.** The whole extension ships at 5.56 MB (2.27 MB without
the optional mermaid renderer), and nothing ever leaves your machine — no
telemetry, no analytics, no network calls Skim makes on your behalf. Your
files stay yours.

## Features

- **GitHub-flavored Markdown** — tables, task lists, strikethrough, autolinks.
- **KaTeX math** — `$inline$` and `$$block$$` delimiters, plus bare LaTeX
  environments (`\begin{align}…`), all rendered offline. Double-click any
  formula to copy its LaTeX source.
- **Syntax-highlighted code** with a copy button on every block.
- **Mermaid diagrams** — ` ```mermaid ` fences render as diagrams, lazy-loaded
  so pages without diagrams don't pay the cost.
- **YAML frontmatter** rendered as a clean header card instead of raw `---`
  text.
- **Auto-reload** — re-renders in place when the file changes on disk, with
  several fallback transports and a silent failure mode so it never breaks
  the page.
- **Table of contents** sidebar with scrollspy (highlights the section you're
  reading as you scroll).
- **Light and dark themes**, plus a density setting, synced across your
  devices via `chrome.storage.sync`.
- **Reading zoom** (opt-in).
- **Hebrew/English bidi** — each block picks its own text direction, so mixed
  RTL/LTR documents render correctly.
- **Raw source view**, and **copy-selection-as-markdown** (copy any selection
  and get markdown, not HTML).
- **Print / export to PDF** with print-friendly styling.
- **Tab / Shift+Tab** to step through the document block by block (and through
  table rows, not just the whole table).
- **Folder view** — enhances `file://` directory listings, plus a Folder
  button to jump to a file's containing folder.
- **Force-render from the popup** — turn any page into a rendered markdown
  view on demand, via `activeTab`, without needing a `.md` URL.
- **First-install onboarding** with live detection of whether Chrome's
  "Allow access to file URLs" switch is on.
- **Robust encoding handling** — UTF-8/UTF-16 BOM detection, windows-1252/1255
  heuristics for undeclared legacy encodings.
- **Large-file guard** so huge documents don't lock up the tab.

Supported extensions: `.md`, `.markdown`, `.mdown`, `.mkd`, `.mkdn`, `.mdx` —
from `file://` and from `http(s)://` when the server sends the file as plain
text (most static hosts, including GitHub raw and CDNs, do).

## Install (unpacked, for development)

1. Build the bundles and assets (only needed if you've changed `src/`):
   ```bash
   npm install
   npm run icons   # generate PNG icons from assets/icon.svg
   npm run build   # bundle content scripts + vendor KaTeX/mermaid assets
   ```
   The repo already ships a built `dist/` and `vendor/`, so you can skip this
   step to just try it.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select this folder.
5. Click the Skim icon in the toolbar. If you want to read local `.md` files,
   the popup walks you through the one Chrome switch it needs
   ("Allow access to file URLs") and shows live whether it's already on.

## How it works

Skim only acts when Chrome is showing a markdown file as plain text (both
`file://` and most static hosts serve `.md` as `text/plain` or
`text/markdown`). A content script:

1. Detects the plaintext markdown page and its encoding (`src/detect.js`,
   `src/encoding.js`).
2. Extracts the raw source, pulls out YAML frontmatter (`src/frontmatter.js`),
   parses with `marked`, renders math with KaTeX, highlights code with
   highlight.js, and sanitizes the result with DOMPurify (`src/render.js`,
   `src/table.js`).
3. Replaces the page with a styled article and mounts the UI chrome — TOC,
   toolbar, theme/zoom, copy buttons, print, Copy-for-AI
   (`src/ui.js`, `src/main.js`, `src/nav.js`, `src/print.js`,
   `src/copy-markdown.js`, `src/skim.css`).
4. Watches the file for changes and re-renders in place (`src/reload.js`).

Markdown served as `text/html` or as a forced download
(`application/octet-stream`) is **not** intercepted — Skim only runs when
Chrome renders the file as text. Mermaid diagrams are rendered by a separate,
lazily-loaded bundle (`src/mermaid.js`, `src/mermaid-entry.js`) so the cost is
only paid on documents that use them. A separate content script
(`src/folder.js`, `src/folder.css`) enhances `file://` directory listings. The
action popup (`src/popup/`), options page (`src/options/`), and first-install
onboarding page (`src/onboarding/`) share a settings module
(`src/settings.js`) backed by `chrome.storage.sync`.

## Development

```bash
npm install
npm run build            # rebuild dist/ + vendor/ after editing src/
npm test                 # run the unit tests (node --test)
npm run size              # check the shipped package against its size budget
node scripts/preview.mjs examples/sample.md   # write preview.html to eyeball
```

Source: https://github.com/skim-md/skim

## License

MIT
