// Build step: copy KaTeX assets into vendor/ and bundle the content script.
import { build } from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const r = (...p) => resolve(root, ...p);

async function vendorKatex() {
  await mkdir(r('vendor'), { recursive: true });
  // KaTeX stylesheet + the fonts it references (relative url(fonts/...)).
  await cp(r('node_modules/katex/dist/katex.min.css'), r('vendor/katex.min.css'));
  await rm(r('vendor/fonts'), { recursive: true, force: true });
  await cp(r('node_modules/katex/dist/fonts'), r('vendor/fonts'), { recursive: true });
  console.log('vendored: katex css + fonts');
}

async function vendorFonts() {
  // Bundle the UI webfonts and emit a @font-face sheet with extension-relative
  // URLs. It is injected at runtime (chrome.runtime.getURL) so url() resolves
  // against the extension, not the page.
  const dst = r('vendor/webfonts');
  await rm(dst, { recursive: true, force: true });
  await mkdir(dst, { recursive: true });
  const HEBREW_RANGE = 'U+0590-05FF, U+200F, U+FB1D-FB4F';
  const fonts = [
    // Prose: Source Serif 4 (Latin) + Frank Ruhl Libre (Hebrew) — reads well and
    // pairs with KaTeX's serif math.
    { src: 'node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-400-normal.woff2', file: 'source-serif-400.woff2', family: 'Skim Serif', weight: 400, range: null },
    { src: 'node_modules/@fontsource/source-serif-4/files/source-serif-4-latin-700-normal.woff2', file: 'source-serif-700.woff2', family: 'Skim Serif', weight: 700, range: null },
    { src: 'node_modules/@fontsource/frank-ruhl-libre/files/frank-ruhl-libre-hebrew-400-normal.woff2', file: 'frank-ruhl-400.woff2', family: 'Skim Hebrew', weight: 400, range: HEBREW_RANGE },
    { src: 'node_modules/@fontsource/frank-ruhl-libre/files/frank-ruhl-libre-hebrew-700-normal.woff2', file: 'frank-ruhl-700.woff2', family: 'Skim Hebrew', weight: 700, range: HEBREW_RANGE },
    // Code: JetBrains Mono (Latin).
    { src: 'node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2', file: 'jetbrains-mono-400.woff2', family: 'Skim Mono', weight: 400, range: null },
    { src: 'node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-700-normal.woff2', file: 'jetbrains-mono-700.woff2', family: 'Skim Mono', weight: 700, range: null },
  ];
  const faces = [];
  for (const f of fonts) {
    await cp(r(f.src), resolve(dst, f.file));
    faces.push(
      `@font-face {\n  font-family: "${f.family}";\n  font-style: normal;\n  font-weight: ${f.weight};\n  font-display: swap;\n  src: url("webfonts/${f.file}") format("woff2");${f.range ? `\n  unicode-range: ${f.range};` : ''}\n}`
    );
  }
  await writeFile(r('vendor/fonts.css'), faces.join('\n\n') + '\n');
  console.log('vendored: ui webfonts + fonts.css');
}

async function bundle() {
  await mkdir(r('dist'), { recursive: true });
  const entries = [
    { entry: 'src/main.js', out: 'dist/content.bundle.js', format: 'iife' },
    { entry: 'src/onboarding/onboarding.js', out: 'dist/onboarding.bundle.js', format: 'iife' },
    { entry: 'src/mermaid-entry.js', out: 'dist/mermaid.bundle.js', format: 'esm' },
    { entry: 'src/folder.js', out: 'dist/folder.bundle.js', format: 'iife' },
  ];
  for (const e of entries) {
    await build({
      entryPoints: [r(e.entry)], bundle: true, format: e.format, platform: 'browser',
      target: ['chrome110'], outfile: r(e.out), legalComments: 'none', minify: e.minify ?? true, logLevel: 'info',
    });
    console.log(`bundled: ${e.out}`);
  }
}

await vendorKatex();
await vendorFonts();
await bundle();
