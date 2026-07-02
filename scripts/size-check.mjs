// Sum the bytes that actually ship in the store package and enforce budgets.
import { readdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHIPPED = ['manifest.json', 'src', 'dist', 'vendor', 'assets', '_locales', 'examples'];
const TOTAL_BUDGET = 6 * 1024 * 1024;
const CORE_BUDGET = 3 * 1024 * 1024;

async function dirSize(p) {
  const s = await stat(p);
  if (!s.isDirectory()) return s.size;
  const entries = await readdir(p);
  let sum = 0;
  for (const e of entries) sum += await dirSize(resolve(p, e));
  return sum;
}

let total = 0;
for (const p of SHIPPED) {
  try { total += await dirSize(resolve(root, p)); } catch { /* absent is fine */ }
}
let mermaid = 0;
try { mermaid = await dirSize(resolve(root, 'dist/mermaid.bundle.js')); } catch { /* absent is fine */ }
const core = total - mermaid;
const mb = (n) => (n / 1024 / 1024).toFixed(2) + ' MB';
console.log(`shipped total: ${mb(total)} (core ${mb(core)}, mermaid ${mb(mermaid)})`);
if (total > TOTAL_BUDGET || core > CORE_BUDGET) {
  console.error(`OVER BUDGET (total<${mb(TOTAL_BUDGET)}, core<${mb(CORE_BUDGET)})`);
  process.exit(1);
}
