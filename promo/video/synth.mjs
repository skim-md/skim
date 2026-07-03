// Software synth — renders the Skim promo soundtrack to soundtrack.wav (48k stereo).
// Energetic uplifting groove (120 BPM, Am–F–C–G) with kick/hats/bass/arp/lead,
// sidechain pump, light reverb, crashes synced to the video's cuts, resolve at ~19s.
// Deterministic (seeded noise) so the audio is reproducible.
//   node promo/video/synth.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, 'soundtrack.wav');

const SR = 48000, DUR = 20.0, N = Math.floor(SR * DUR);
const BPM = 120, beat = 60 / BPM, bar = beat * 4;   // 0.5s beat, 2s bar

// buses
const dL = new Float32Array(N), dR = new Float32Array(N);   // drums / fx (dry, no duck)
const mL = new Float32Array(N), mR = new Float32Array(N);   // musical (gets ducked)
const rev = new Float32Array(N);                            // mono reverb send
const duck = new Float32Array(N).fill(1);

// seeded PRNG (mulberry32) for reproducible noise
let _s = 0x9e3779b9 >>> 0;
const rnd = () => { _s |= 0; _s = _s + 0x6D2B79F5 | 0; let t = Math.imul(_s ^ _s >>> 15, 1 | _s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const noise = () => rnd() * 2 - 1;

// note name -> frequency
const SEMI = { C:0, 'C#':1, Db:1, D:2, 'D#':3, Eb:3, E:4, F:5, 'F#':6, Gb:6, G:7, 'G#':8, Ab:8, A:9, 'A#':10, Bb:10, B:11 };
function freq(name){
  const m = name.match(/^([A-G][#b]?)(-?\d)$/);
  const midi = SEMI[m[1]] + (parseInt(m[2],10) + 1) * 12;
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function wave(type, ph){                       // ph in [0,1)
  switch(type){
    case 'saw':  return 2*ph - 1;
    case 'square': return ph < 0.5 ? 1 : -1;
    case 'tri':  return 4*Math.abs(ph - 0.5) - 1;
    default:     return Math.sin(2*Math.PI*ph);
  }
}
const panGains = p => [Math.cos((p+1)*Math.PI/4), Math.sin((p+1)*Math.PI/4)];

// generic voice -> writes into a stereo bus, optional reverb send
function voice(busL, busR, t0, dur, f, o={}){
  const { type='sine', gain=0.2, a=0.005, d=0.06, s=0.7, r=0.12, pan=0,
          detune=0, lp=0, send=0, sub=0 } = o;
  const start = Math.floor(t0*SR), total = Math.floor((dur+r)*SR);
  const w = f/SR, w2 = f*Math.pow(2, detune/1200)/SR, wsub = f/2/SR;
  const [pl, pr] = panGains(pan);
  const lpc = lp ? 1 - Math.exp(-2*Math.PI*lp/SR) : 1;
  let ph=0, ph2=0, phs=0, lpst=0;
  for(let i=0;i<total;i++){
    const idx = start+i; if(idx>=N) break; if(idx<0) continue;
    const tt = i/SR;
    let env;
    if(tt < a) env = tt/a;
    else if(tt < a+d) env = 1 - (1-s)*((tt-a)/d);
    else if(tt < dur) env = s;
    else { env = s*(1-(tt-dur)/r); if(env<0) env=0; }
    let x = wave(type, ph);
    if(detune) x = 0.55*x + 0.55*wave(type, ph2);
    if(sub) x += sub*Math.sin(2*Math.PI*phs);
    x *= env*gain;
    if(lp){ lpst += lpc*(x - lpst); x = lpst; }
    busL[idx] += x*pl; busR[idx] += x*pr;
    if(send) rev[idx] += x*send;
    ph+=w;  if(ph>=1) ph-=1;
    ph2+=w2; if(ph2>=1) ph2-=1;
    phs+=wsub; if(phs>=1) phs-=1;
  }
}

// ---- drums ----
function duckAt(t0, depth=0.5, len=0.19){
  const s=Math.floor(t0*SR), L=Math.floor(len*SR);
  for(let i=0;i<L;i++){ const idx=s+i; if(idx>=N)break; const x=i/L;
    const g = depth + (1-depth)*(x*x); if(g<duck[idx]) duck[idx]=g; }
}
function kick(t0, gain=0.95, pump=true){
  const start=Math.floor(t0*SR), len=Math.floor(0.24*SR); let ph=0;
  for(let i=0;i<len;i++){ const idx=start+i; if(idx>=N)break; const tt=i/SR;
    const f = 46 + (135-46)*Math.exp(-tt*38); ph += f/SR; if(ph>=1) ph-=1;
    let s = Math.sin(2*Math.PI*ph)*Math.exp(-tt*20);
    if(tt<0.005) s += noise()*0.6*(1-tt/0.005);       // click
    s *= gain; dL[idx]+=s; dR[idx]+=s;
  }
  if(pump) duckAt(t0);
}
function hat(t0, gain=0.28, open=false){
  const dec = open?0.16:0.035;
  const start=Math.floor(t0*SR), len=Math.floor((dec+0.02)*SR); let hp=0, prev=0;
  for(let i=0;i<len;i++){ const idx=start+i; if(idx>=N)break; const tt=i/SR;
    let x=noise(); const y = x-prev; prev=x;                // crude highpass
    const env=Math.exp(-tt/(dec*0.5));
    const s=y*env*gain; dL[idx]+=s*0.9; dR[idx]+=s*1.0;
  }
}
function clap(t0, gain=0.5){
  const start=Math.floor(t0*SR), len=Math.floor(0.18*SR); let prev=0;
  for(let i=0;i<len;i++){ const idx=start+i; if(idx>=N)break; const tt=i/SR;
    let x=noise(); const bp=(x-prev); prev=x;               // bright noise
    // three quick bursts then tail
    let e = (tt<0.008?tt/0.008 : Math.exp(-(tt-0.008)*26));
    if(tt<0.03) e *= (Math.floor(tt*400)%2? 0.6:1);
    const s=bp*e*gain; dL[idx]+=s; dR[idx]+=s;
  }
}
// clean cinematic sub-boom impact (tonal, no noise gravel) — accents section changes
function impact(t0, gain=0.55, pan=0){
  const start=Math.floor(t0*SR), len=Math.floor(0.6*SR); let ph=0, ph2=0;
  const [pl,pr]=panGains(pan);
  for(let i=0;i<len;i++){ const idx=start+i; if(idx>=N)break; const tt=i/SR;
    const f = 40 + (92-40)*Math.exp(-tt*9);       // pitch drop 92 -> 40 Hz
    ph += f/SR;   if(ph>=1)  ph-=1;
    ph2 += 2*f/SR; if(ph2>=1) ph2-=1;
    const env = Math.exp(-tt*6);
    const s = (Math.sin(2*Math.PI*ph)*0.9 + Math.sin(2*Math.PI*ph2)*0.18) * env * gain;
    dL[idx]+=s*pl; dR[idx]+=s*pr; rev[idx]+=s*0.05;
  }
}
// gentle low-passed swell into the drop (airy, not gravelly)
function riser(t0, dur, gain=0.14){
  const start=Math.floor(t0*SR), len=Math.floor(dur*SR); let lp=0;
  for(let i=0;i<len;i++){ const idx=start+i; if(idx>=N)break; const x=i/len;
    const fc = 300 + 1300*x;                       // stays soft (max ~1.6kHz)
    const c = 1-Math.exp(-2*Math.PI*fc/SR);
    let n=noise(); lp += c*(n-lp);
    const env = x*x*x*gain;                        // slow, smooth build
    const s=lp*env; dL[idx]+=s; dR[idx]+=s;         // use the lowpassed (dark) part
  }
}

// ---- chord progression (10 bars) ----
const T = i => (m,b)=> (m*bar + b*beat);   // not used; keep explicit below
const chords = [
  { triad:['A3','C4','E4'], bass:'A1', pad:['A2','E3'] }, // 0  Am
  { triad:['F3','A3','C4'], bass:'F1', pad:['F2','C3'] }, // 1  F
  { triad:['C4','E4','G4'], bass:'C2', pad:['C3','G3'] }, // 2  C
  { triad:['G3','B3','D4'], bass:'G1', pad:['G2','D3'] }, // 3  G
  { triad:['A3','C4','E4'], bass:'A1', pad:['A2','E3'] }, // 4  Am
  { triad:['F3','A3','C4'], bass:'F1', pad:['F2','C3'] }, // 5  F
  { triad:['C4','E4','G4'], bass:'C2', pad:['C3','G3'] }, // 6  C
  { triad:['G3','B3','D4'], bass:'G1', pad:['G2','D3'] }, // 7  G
  { triad:['G3','B3','D4'], bass:'G1', pad:['G2','D3'] }, // 8  G  (pre-cadence)
  { triad:['C4','E4','G4'], bass:'C2', pad:['C3','G3'] }, // 9  C  (resolve)
];

// energy gates per bar: [drums, bass, arp16, lead]
// intro build (0-2), rising (2-4), pre-drop (4-6), DROP full groove from bar3
const arrange = [
  { pad:0.9, arp:0.25, drums:0,   bass:0,   sixteen:false, lead:false }, // 0
  { pad:0.9, arp:0.4,  drums:0.5, bass:0.5, sixteen:false, lead:false }, // 1
  { pad:0.8, arp:0.5,  drums:0.7, bass:0.7, sixteen:false, lead:false }, // 2  (riser at end)
  { pad:0.7, arp:0.9,  drums:1,   bass:1,   sixteen:true,  lead:false }, // 3  DROP
  { pad:0.7, arp:0.9,  drums:1,   bass:1,   sixteen:true,  lead:false }, // 4
  { pad:0.7, arp:0.9,  drums:1,   bass:1,   sixteen:true,  lead:false }, // 5
  { pad:0.7, arp:0.9,  drums:1,   bass:1,   sixteen:true,  lead:true  }, // 6
  { pad:0.7, arp:0.95, drums:1,   bass:1,   sixteen:true,  lead:true  }, // 7
  { pad:0.8, arp:0.95, drums:1,   bass:1,   sixteen:true,  lead:true  }, // 8  peak
  { pad:1.0, arp:0.0,  drums:0.4, bass:0.6, sixteen:false, lead:false }, // 9  resolve
];

for(let m=0;m<10;m++){
  const c = chords[m], A = arrange[m], t0 = m*bar;

  // pad (sustained chord, warm, ducked, reverb send)
  for(const n of c.pad)
    voice(mL, mR, t0, bar*0.98, freq(n), { type:'tri', gain:0.11*A.pad, a:0.04, d:0.3, s:0.8, r:0.4, lp:1400, send:0.10, detune:8, pan:0 });
  // chord stabs on beats 1 & 3 (energy), brighter
  if(A.drums>0 && m<9){
    for(const n of c.triad){
      voice(mL, mR, t0, 0.28, freq(n), { type:'saw', gain:0.05, a:0.004, d:0.1, s:0.3, r:0.16, lp:2600, send:0.12, pan:0.12 });
      voice(mL, mR, t0+2*beat, 0.28, freq(n), { type:'saw', gain:0.05, a:0.004, d:0.1, s:0.3, r:0.16, lp:2600, send:0.12, pan:-0.12 });
    }
  }
  // final resolve chord (bar 9) — big sustained + shimmer
  if(m===9){
    for(const n of [...c.triad, 'C5', 'G4'])
      voice(mL, mR, t0, 1.9, freq(n), { type:'tri', gain:0.09, a:0.01, d:0.5, s:0.75, r:0.6, lp:3200, send:0.2, detune:6, pan:(rnd()-0.5)*0.4 });
  }

  // bass — root, syncopated with kick (root, root, fifth-oct, root)
  if(A.bass>0){
    const bpat = m===9 ? [0,2] : [0,1.5,2,3];  // beats
    for(const b of bpat){
      const bn = (b===2 && m<9) ? c.bass.replace(/(\d)/, (d)=>String(+d)) : c.bass;
      voice(mL, mR, t0+b*beat, beat*0.9, freq(c.bass), { type:'saw', gain:0.16*A.bass, a:0.006, d:0.08, s:0.6, r:0.1, lp:800, sub:0.5, pan:0 });
    }
  }

  // arp — chord tones, 8ths (or 16ths in drop), bright, panned ping-pong, delay via reverb send
  if(A.arp>0){
    const steps = A.sixteen ? 16 : 8;
    const step = bar/steps;
    const seq = [...c.triad, freq(c.triad[2])? c.triad[1]:c.triad[0]]; // arp shape
    const shape = [c.triad[0], c.triad[1], c.triad[2], c.triad[1]];
    for(let k=0;k<steps;k++){
      const nn = shape[k % shape.length];
      const oct = (k % 8) >= 4 ? 1 : 0;              // jump up an octave second half
      const f = freq(nn)*(oct?2:1);
      voice(mL, mR, t0 + k*step, step*0.9, f,
        { type:'tri', gain:0.055*A.arp, a:0.003, d:0.05, s:0.25, r:0.09, lp:5000, send:0.22, pan:(k%2?0.5:-0.5) });
    }
  }

  // lead melody (peak bars) — simple singable motif on top
  if(A.lead){
    const motif = [ ['E5',0,1],['D5',1,1],['C5',2,1.5],['E5',3.5,0.5] ]; // (note, beatOffset, beats)
    for(const [n,bo,bl] of motif)
      voice(mL, mR, t0 + bo*beat, bl*beat, freq(n),
        { type:'tri', gain:0.075, a:0.01, d:0.08, s:0.6, r:0.14, lp:6000, send:0.18, detune:5, pan:0 });
  }

  // ---- drums ----
  if(A.drums>0){
    const full = A.drums>=1;
    for(let b=0;b<4;b++){
      const bt = t0 + b*beat;
      if(full || b===0 || b===2) kick(bt, 0.95*(full?1:0.8));          // 4-floor when full
      // hats: 8ths
      if(A.drums>=0.7){ hat(bt, 0.22); hat(bt+beat/2, 0.26, (b===3)); }
      // claps on 2 & 4 when full and past the drop
      if(full && (b===1 || b===3) && m>=4 && m<9) clap(bt, 0.32);
    }
  }
  // resolve bar: a short fill then stop
  if(m===9){ kick(t0, 0.9); kick(t0+beat*0.5, 0.5); hat(t0,0.2); }
}

// section accents synced to the video cuts — clean tonal booms, no noise crashes
riser(4.05, 0.95, 0.13);       // soft dark swell into the drop
impact(5.0, 0.62);             // THE DROP (~5.1 cut) — punchy sub-boom
impact(9.6, 0.34, -0.05);      // cut to math beat (subtle)
impact(14.4, 0.36, 0.05);      // cut to free beat (subtle)

// ---- quiet UI SFX (accents, well under the music) ----
function tick(t0, g=0.10){ voice(dL, dR, t0, 0.03, 2600, { type:'sine', gain:g, a:0.001, d:0.02, s:0, r:0.02 }); }
function pop(t0, f, g=0.09){ voice(dL, dR, t0, 0.12, f, { type:'sine', gain:g, a:0.002, d:0.1, s:0, r:0.08, send:0.1 }); }
tick(3.40,0.09); tick(3.66,0.09);                    // hero checkboxes
pop(8.0, 659.25, 0.10);                              // task added
[[11.55,523.25],[11.9,659.25],[12.26,783.99],[12.6,880]].forEach(([t,f])=>pop(t,f,0.06)); // mermaid
pop(13.0, 880, 0.09);                                // no-internet pill
[[15.55,523.25],[15.85,659.25],[16.15,783.99],[16.3,987.77]].forEach(([t,f])=>pop(t,f,0.07)); // chips
// bright end bell arpeggio at resolve
[['A4',19.08],['C5',19.18],['E5',19.28],['A5',19.38]].forEach(([n,t])=>
  voice(mL, mR, t, 1.2, freq(n), { type:'sine', gain:0.10, a:0.005, d:0.3, s:0.5, r:0.7, send:0.3, pan:(rnd()-0.5)*0.5 }));

// ---- reverb (Freeverb-lite: 4 combs + 2 allpass, per channel with stereo offset) ----
function reverbChannel(input, offset){
  const combTun = [1116,1188,1277,1356].map(x=>x+offset);
  const apTun = [556,441];
  const fb = 0.82, damp = 0.28, apg = 0.5;
  const combs = combTun.map(D=>({ buf:new Float32Array(D), p:0, filt:0 }));
  const aps = apTun.map(D=>({ buf:new Float32Array(D), p:0 }));
  const out = new Float32Array(N);
  for(let i=0;i<N;i++){
    let x = input[i]*0.18, acc=0;
    for(const c of combs){
      const y=c.buf[c.p];
      c.filt = y*(1-damp) + c.filt*damp;
      c.buf[c.p] = x + c.filt*fb;
      c.p = (c.p+1)%c.buf.length;
      acc += y;
    }
    let y = acc;
    for(const ap of aps){
      const bufout = ap.buf[ap.p];
      const inp = y;
      ap.buf[ap.p] = inp + bufout*apg;
      y = -inp + bufout;
      ap.p = (ap.p+1)%ap.buf.length;
    }
    out[i]=y;
  }
  return out;
}
const wetL = reverbChannel(rev, 0), wetR = reverbChannel(rev, 23);

// ---- master mix ----
const out = new Float32Array(N*2);
let peak=0;
for(let i=0;i<N;i++){
  let l = dL[i] + mL[i]*duck[i] + wetL[i]*0.9;
  let r = dR[i] + mR[i]*duck[i] + wetR[i]*0.9;
  // global fades
  const fin = Math.min(1, i/(SR*0.15));
  const fout = Math.min(1, (N-i)/(SR*0.5));
  l*=fin*fout; r*=fin*fout;
  // soft saturation
  l = Math.tanh(l*1.1); r = Math.tanh(r*1.1);
  out[2*i]=l; out[2*i+1]=r;
  const pk=Math.max(Math.abs(l),Math.abs(r)); if(pk>peak) peak=pk;
}
// normalize to -1.2 dBFS
const norm = (peak>0) ? Math.pow(10,-1.2/20)/peak : 1;
for(let i=0;i<out.length;i++) out[i]*=norm;

// ---- write 16-bit stereo WAV ----
const buf = Buffer.alloc(44 + N*4);
buf.write('RIFF',0); buf.writeUInt32LE(36+N*4,4); buf.write('WAVE',8);
buf.write('fmt ',12); buf.writeUInt32LE(16,16); buf.writeUInt16LE(1,20);
buf.writeUInt16LE(2,22); buf.writeUInt32LE(SR,24); buf.writeUInt32LE(SR*4,28);
buf.writeUInt16LE(4,32); buf.writeUInt16LE(16,34);
buf.write('data',36); buf.writeUInt32LE(N*4,40);
let o=44;
for(let i=0;i<N*2;i++){ let v=out[i]; v=v<-1?-1:v>1?1:v; buf.writeInt16LE((v*32767)|0,o); o+=2; }
writeFileSync(OUT, buf);
console.log('wrote', OUT, (buf.length/1048576).toFixed(2)+' MB', 'peak(pre-norm)=', peak.toFixed(3));
