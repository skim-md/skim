// Mux a captured frame sequence with an audio track into MP4 + a README GIF.
//   node promo/video/mux.mjs <framesDir> <audio.wav> <out.mp4> [fps] [gifWidth]
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { statSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const abs = p => p.startsWith('/') ? p : join(here, p);

const [framesArg, audioArg, outArg, fpsArg, gifWArg] = process.argv.slice(2);
if(!framesArg || !audioArg || !outArg){
  console.error('usage: node mux.mjs <framesDir> <audio.wav> <out.mp4> [fps] [gifWidth]');
  process.exit(1);
}
const frames = abs(framesArg), audio = abs(audioArg), outMp4 = abs(outArg);
const FPS = +(fpsArg || 30), GIFW = +(gifWArg || 960);
const outGif = outMp4.replace(/\.mp4$/, '.gif');

const ff = (args) => execFileSync('ffmpeg', ['-y','-hide_banner','-loglevel','error', ...args], { stdio: 'inherit' });

console.log('encoding', outMp4, '…');
ff(['-framerate', String(FPS), '-i', join(frames,'f%04d.png'), '-i', audio,
    '-c:v','libx264','-preset','slow','-crf','18','-pix_fmt','yuv420p',
    '-profile:v','high','-movflags','+faststart',
    '-c:a','aac','-b:a','192k','-shortest','-r', String(FPS), outMp4]);

console.log('building', outGif, '…');
const pal = outMp4.replace(/\.mp4$/, '.palette.png');
ff(['-i', outMp4, '-vf',`fps=15,scale=${GIFW}:-1:flags=lanczos,palettegen=max_colors=200:stats_mode=diff`, pal]);
ff(['-i', outMp4, '-i', pal,
    '-lavfi',`fps=15,scale=${GIFW}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=sierra2_4a`, outGif]);

const mb = p => (statSync(p).size/1048576).toFixed(1)+' MB';
console.log('done:', outMp4, mb(outMp4), '|', outGif, mb(outGif));
