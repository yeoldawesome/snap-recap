// Renders the face-align flipbook to a file, frame by frame (not by recording the screen), so every
// frame is sharp, nothing is dropped, and it usually finishes faster than real time.
// MP4 and WebM use the browser's own video encoder (WebCodecs); GIF is encoded in JavaScript.
import { ASPECTS, drawAligned, faceFor, frameNow, warmFrames } from './faces.js';
import { fmtDate } from './storage.js';

export const FORMATS = {
  mp4: { label: 'MP4', mime: 'video/mp4', note: 'Plays everywhere: phones, Instagram, TikTok, WhatsApp.' },
  webm: { label: 'WebM', mime: 'video/webm', note: 'Smaller files at the same quality. Not every phone plays it.' },
  gif: { label: 'GIF', mime: 'image/gif', note: 'Loops anywhere, but files are big and colors are limited. Best for short, small clips.' },
};
// Output size by the short side of the frame.
export const SIZES = [
  { short: 480, label: '480p' },
  { short: 720, label: '720p' },
  { short: 1080, label: '1080p' },
  { short: 1440, label: '1440p' },
  { short: 2160, label: '4K' },
];
export const RATES = [24, 25, 30, 50, 60];
export const GIF_MAX_FPS = 50; // browsers slow down GIF frames shorter than 20 ms
// Bits per pixel per frame; a flipbook changes a lot between frames, so this is on the generous side.
export const QUALITIES = {
  low: { label: 'Small file', bpp: 0.05 },
  medium: { label: 'Balanced', bpp: 0.1 },
  high: { label: 'High', bpp: 0.17 },
  max: { label: 'Best', bpp: 0.28 },
};

const even = (v) => Math.max(2, Math.round(v / 2) * 2);
export function outSize(aspect, short) {
  const [w, h] = ASPECTS[aspect] || ASPECTS['9:16'];
  const k = short / Math.min(w, h);
  return [even(w * k), even(h * k)];
}

export const msPerPhoto = (o) => Math.max(1, o.holdMs + o.fadeMs);

/** Frame count, length, and how many photos are too short to get a frame of their own. */
export function plan(count, o, fps) {
  const dur = msPerPhoto(o);
  const totalMs = count * dur;
  const frames = Math.max(1, Math.round((totalMs * fps) / 1000));
  const frameMs = 1000 / fps;
  const skipped = dur >= frameMs ? 0 : Math.max(0, count - frames);
  return { dur, totalMs, frames, skipped };
}

export const bitrate = (w, h, fps, quality) => Math.round(w * h * fps * (QUALITIES[quality] || QUALITIES.medium).bpp);

/** A rough file size in bytes, for showing before saving. */
export function estimateBytes(s, w, h, count, o) {
  const fps = s.format === 'gif' ? Math.min(s.fps, GIF_MAX_FPS) : s.fps;
  const p = plan(count, o, fps);
  if (s.format === 'gif') {
    // Holds are stored once; crossfades need every frame. About half a byte per pixel per stored frame.
    const fadeFrames = o.fadeMs > 0 ? Math.min(p.frames, count * Math.ceil((o.fadeMs * fps) / 1000)) : 0;
    const stored = Math.min(p.frames, count - p.skipped + fadeFrames);
    return stored * w * h * 0.5;
  }
  return (bitrate(w, h, fps, s.quality) * p.totalMs) / 1000 / 8;
}

const CODECS = {
  mp4: [['avc1.640034', 'avc'], ['avc1.4d0034', 'avc'], ['avc1.42003e', 'avc']],
  webm: [['vp09.00.50.08', 'V_VP9'], ['vp8', 'V_VP8']],
};

/** The first codec this browser can encode at this size, or null. */
export async function findCodec(format, width, height, fps, rate) {
  if (format === 'gif') return { gif: true };
  if (typeof VideoEncoder === 'undefined') return null;
  for (const [codec, muxCodec] of CODECS[format]) {
    const config = { codec, width, height, bitrate: rate, framerate: fps };
    if (format === 'mp4') config.avc = { format: 'avc' };
    try {
      const r = await VideoEncoder.isConfigSupported(config);
      if (r.supported) return { config, muxCodec };
    } catch { /* try the next one */ }
  }
  return null;
}

/** Draws one frame: the current photo, the previous one fading out, and the date. */
export function paint(ctx, cur, frame, prev, prevFrame, fade, o) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  try {
    if (prev && prevFrame && fade < 1) drawAligned(ctx, prevFrame, faceFor(prev), o);
    if (frame) drawAligned(ctx, frame, faceFor(cur), o, fade);
  } catch { /* a frame was released mid-draw; the caller redraws */ }
  if (o.showDate && cur) {
    const fs = Math.round(W * 0.045);
    ctx.font = `800 ${fs}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = fs * 0.18;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.fillStyle = '#fff';
    const text = fmtDate(cur.date);
    ctx.strokeText(text, W / 2, H - fs * 1.6);
    ctx.fillText(text, W / 2, H - fs * 1.6);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFrame(m, ov, signal) {
  for (;;) {
    const f = frameNow(m, ov);
    if (f) return f;
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    await sleep(4);
  }
}

/** Which photo is on screen at time t (ms), and how far its fade-in has got (0..1, eased). */
export function at(t, count, o) {
  const dur = msPerPhoto(o);
  const i = Math.min(count - 1, Math.floor(t / dur));
  const local = t - i * dur;
  const raw = o.fadeMs > 0 && i > 0 && local < o.fadeMs ? local / o.fadeMs : 1;
  return { i, raw, fade: raw * raw * (3 - 2 * raw) };
}

/** Draws the frame at time t into the canvas (waiting for the photos to load). */
export async function paintAt(ctx, list, t, o, signal) {
  const { i, raw, fade } = at(t, list.length, o);
  const cur = list[i];
  const prev = raw < 1 ? list[i - 1] : null;
  const prevFrame = prev ? await waitFrame(prev, o.overlays, signal) : null;
  const frame = await waitFrame(cur, o.overlays, signal);
  paint(ctx, cur, frame, prev, prevFrame, fade, o);
  return { i, raw };
}

/**
 * Renders the whole list. s = { format, short, fps, quality }; o = the face-align options.
 * The canvas doubles as a live preview. Returns { blob, ext }.
 */
export async function render({ list, o, s, canvas, onProgress, signal }) {
  const gif = s.format === 'gif';
  const fps = gif ? Math.min(s.fps, GIF_MAX_FPS) : s.fps;
  const [W, H] = outSize(o.aspect, s.short);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: gif });
  const { frames } = plan(list.length, o, fps);
  const frameUs = 1e6 / fps;

  let encoder = null;
  let muxer = null;
  let target = null;
  let encodeError = null;
  let gifEnc = null;
  let gifLib = null;
  let pending = null; // GIF: the last frame, held until we know how long it stays on screen

  if (gif) {
    gifLib = await import('gifenc');
    gifEnc = gifLib.GIFEncoder();
  } else {
    const found = await findCodec(s.format, W, H, fps, bitrate(W, H, fps, s.quality));
    if (!found) throw new Error(`This browser can't make ${FORMATS[s.format].label} at ${W}×${H}. Try a smaller size or another format.`);
    const lib = s.format === 'mp4' ? await import('mp4-muxer') : await import('webm-muxer');
    target = new lib.ArrayBufferTarget();
    muxer = s.format === 'mp4'
      ? new lib.Muxer({ target, video: { codec: found.muxCodec, width: W, height: H, frameRate: fps }, fastStart: 'in-memory' })
      : new lib.Muxer({ target, video: { codec: found.muxCodec, width: W, height: H, frameRate: fps } });
    encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => { encodeError = e; },
    });
    encoder.configure(found.config);
  }

  const writePending = () => {
    if (!pending) return;
    gifEnc.writeFrame(pending.index, W, H, { palette: pending.palette, delay: Math.max(20, pending.delay) });
    pending = null;
  };

  let lastKey = null;
  let lastReport = 0;
  try {
    for (let n = 0; n < frames; n++) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (encodeError) throw encodeError;
      const t = n * (1000 / fps);
      const { i, raw } = at(t, list.length, o);
      warmFrames(list.slice(i + 1, i + 9), o.overlays);
      if (gif) {
        // While a photo is just being held, the frame doesn't change: lengthen the last one instead.
        const key = raw < 1 ? `${i}:${n}` : `${i}`;
        if (key === lastKey && pending) {
          pending.delay += 1000 / fps;
        } else {
          await paintAt(ctx, list, t, o, signal);
          writePending();
          const { data } = ctx.getImageData(0, 0, W, H);
          const palette = gifLib.quantize(data, 256);
          pending = { index: gifLib.applyPalette(data, palette), palette, delay: 1000 / fps };
          lastKey = key;
        }
      } else {
        await paintAt(ctx, list, t, o, signal);
        const vf = new VideoFrame(canvas, { timestamp: Math.round(n * frameUs), duration: Math.round(frameUs) });
        encoder.encode(vf, { keyFrame: n % (fps * 2) === 0 });
        vf.close();
        // Don't let the encoder fall far behind (memory).
        while (encoder.encodeQueueSize > 6) {
          await Promise.race([new Promise((r) => encoder.addEventListener('dequeue', r, { once: true })), sleep(20)]);
        }
      }
      const now = performance.now();
      if (now - lastReport > 100 || n === frames - 1) {
        lastReport = now;
        onProgress?.(n + 1, frames);
        await sleep(0); // let the page repaint the preview
      }
    }
    if (gif) {
      writePending();
      gifEnc.finish();
      return { blob: new Blob([gifEnc.bytes()], { type: 'image/gif' }), ext: 'gif' };
    }
    await encoder.flush();
    if (encodeError) throw encodeError;
    muxer.finalize();
    return { blob: new Blob([target.buffer], { type: FORMATS[s.format].mime }), ext: s.format };
  } finally {
    if (encoder && encoder.state !== 'closed') encoder.close();
  }
}
