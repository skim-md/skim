// Deterministic frame capture for the Skim promo scene.
// Drives system Chrome via puppeteer-core, sets a virtual clock per frame,
// screenshots each frame to promo/video/frames/.
//
//   node promo/video/capture.mjs            # full 20s @30fps
//   node promo/video/capture.mjs --preview  # a handful of keyframes only
import puppeteer from 'puppeteer-core';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdir, rm, readdir } from 'node:fs/promises';

const here = dirname(fileURLToPath(import.meta.url));
const W = 1920, H = 1080, FPS = 30, DUR = 20;

// Optional args:  node capture.mjs [scene.html] [framesDir] [--preview]
const argv = process.argv.slice(2).filter(a => a !== '--preview');
const preview = process.argv.includes('--preview');
const sceneFile = argv[0] ? (argv[0].startsWith('/') ? argv[0] : join(here, argv[0])) : join(here, 'scene.html');
const sceneUrl = 'file://' + sceneFile + '?capture=1';
const outDir = argv[1] ? (argv[1].startsWith('/') ? argv[1] : join(here, argv[1]))
                       : join(here, preview ? 'preview' : 'frames');

const CHROME = process.env.CHROME_BIN || '/usr/bin/google-chrome';

async function main(){
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'shell',
    args: [
      '--no-sandbox','--disable-gpu','--hide-scrollbars',
      '--force-device-scale-factor=1','--disable-lcd-text',
      `--window-size=${W},${H}`,
    ],
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  });
  const page = await browser.newPage();
  await page.goto(sceneUrl, { waitUntil: 'networkidle0' });
  // make sure webfonts are ready so text metrics are stable
  await page.evaluate(async () => { if (document.fonts && document.fonts.ready) await document.fonts.ready; });
  await new Promise(r => setTimeout(r, 200));

  const times = preview
    ? [0.4, 1.0, 2.0, 2.7, 3.8, 6.5, 8.2, 11.0, 12.6, 13.5, 16.2, 17.8, 19.5]
    : Array.from({ length: FPS * DUR }, (_, i) => i / FPS);

  let n = 0;
  for (const t of times){
    await page.evaluate((tt) => window.__setTime(tt), t);
    const name = preview
      ? `t${t.toFixed(2)}.png`
      : `f${String(n).padStart(4,'0')}.png`;
    await page.screenshot({ path: join(outDir, name), captureBeyondViewport: false, clip: {x:0,y:0,width:W,height:H} });
    n++;
    if (!preview && n % 60 === 0) console.log(`  ${n}/${times.length} frames`);
  }
  await browser.close();
  const files = (await readdir(outDir)).length;
  console.log(`Captured ${files} frames -> ${outDir}`);
}
main().catch(e => { console.error(e); process.exit(1); });
