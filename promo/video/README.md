# Promo video

A ~20-second animated tour of Skim, mastered at **1920×1080 / 30fps** with a
synthesized soundtrack. Built to match the `promo/png/*` marquee art.

| File | Purpose |
| --- | --- |
| `skim-promo.mp4` | Primary deliverable — Chrome Web Store promo video (upload to YouTube, paste the link) and the README GIF's "watch with sound" target. H.264 + AAC, ~1.9 MB. |
| `skim-promo.gif` | Compact 960px/15fps loop for inline README embedding (~4 MB). |
| `scene.html` | The animation. A deterministic virtual-clock timeline — every frame is a pure function of time `t`, so headless capture is perfectly reproducible. Open it in a browser to preview the loop live. |
| `capture.mjs` | Drives system Chrome (via `puppeteer-core`) frame-by-frame off `window.__setTime(t)`, writing 600 PNGs to `frames/`. Optional args: `node capture.mjs [scene.html] [outDir]`. |
| `synth.mjs` | A small software synth (oscillators, drums, chord progression, sidechain pump, light reverb). Renders the energetic soundtrack to `soundtrack.wav`. Deterministic (seeded noise). |
| `soundtrack.wav` | Rendered audio bed (120 BPM Am–F–C–G groove, ~-15.7 LUFS). Committed so the video can be re-muxed without re-synthesizing. |
| `mux.mjs` | Encodes a frame sequence + an audio track into MP4, then builds the GIF. `node mux.mjs <framesDir> <audio.wav> <out.mp4> [fps] [gifWidth]`. |

## Beats

1. **Read what your AI wrote. Instantly.** — raw markdown renders into a clean doc; TOC slides in.
2. **Live-reloads while your agent writes.** — a terminal writes the file; a task appears and ticks, "Updated on save".
3. **LaTeX math. Mermaid diagrams. Offline.** — KaTeX integral + a mermaid pipeline draws in; "No internet needed".
4. **Free. Open source. Private.** — folder tree + feature chips, closing on the Skim lockup.

## Rebuild

```sh
npm i -D puppeteer-core                       # once; uses system google-chrome, no Chromium download
node promo/video/synth.mjs                     # -> soundtrack.wav      (instant; only if you change the music)
node promo/video/capture.mjs                   # 600 frames -> frames/  (~85s)
node promo/video/mux.mjs frames soundtrack.wav skim-promo.mp4 30 960   # -> mp4 + gif (~10s)
```

`frames/`, `preview/`, and `*.palette.png` are intermediate and git-ignored.
Requires `ffmpeg` and a system `google-chrome` (override with `CHROME_BIN`).
