// Writes /tmp/skim-large.md (~5MB) for manual perf testing.
import { writeFile } from 'node:fs/promises';
let out = '# Large document\n\n';
for (let i = 0; i < 20000; i++) {
  out += `## Section ${i}\n\nSome **bold** text with \`code\` and a [link](https://example.com/${i}).\n\n- item a\n- item b\n\n`;
}
await writeFile('/tmp/skim-large.md', out);
console.log('wrote /tmp/skim-large.md', (out.length / 1024 / 1024).toFixed(1), 'MB');
