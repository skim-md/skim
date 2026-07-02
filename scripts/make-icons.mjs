// Rasterize the Markdown-mark SVG into PNG icons at the sizes the manifest needs.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(resolve(root, 'assets'), { recursive: true });
const svg = readFileSync(resolve(root, 'assets/icon.svg'), 'utf8');

for (const size of [16, 48, 128]) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  const png = resvg.render().asPng();
  writeFileSync(resolve(root, `assets/icon${size}.png`), png);
  console.log(`wrote assets/icon${size}.png (${png.length} bytes)`);
}
