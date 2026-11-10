// In-browser port of NudeNet's detector (MIT, github.com/notAI-tech/NudeNet).
// Returns a 0..1 score for "shirtless": the strongest BELLY_EXPOSED / MALE_BREAST_EXPOSED detection.
import * as ort from 'onnxruntime-web';
import { readBlob } from './importer.js';

ort.env.wasm.numThreads = 1; // GitHub Pages can't enable multi-threaded wasm

const SIZE = 320;
const TARGET_CLASSES = new Set([5 /* MALE_BREAST_EXPOSED */, 13 /* BELLY_EXPOSED */]);
const VIDEO_FRAMES = 5;

let session;
const getSession = () =>
  (session ??= ort.InferenceSession.create(`${import.meta.env.BASE_URL}models/nudenet-320n.onnx`, {
    executionProviders: ['wasm'],
  }));

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

/**
 * Same preprocessing as NudeNet: pad right/bottom with black to a square, resize to 320x320
 * with OpenCV-style bilinear sampling (done by hand so results match the original model), 0..1.
 * Channel order is BGR: NudeNet swaps channels twice (cvtColor RGBA2BGR on a BGR image, then
 * swapRB), so the model was effectively fed BGR.
 */
function toTensorData(src, w, h) {
  const M = Math.max(w, h);
  canvas.width = canvas.height = M; // resizing also clears to transparent black
  ctx.drawImage(src, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, M, M).data;
  const plane = SIZE * SIZE;
  const out = new Float32Array(3 * plane);
  const scale = M / SIZE;
  const axis = (d) => {
    const s = Math.max(0, (d + 0.5) * scale - 0.5);
    const i0 = Math.min(Math.floor(s), M - 1);
    return [i0, Math.min(i0 + 1, M - 1), s - i0];
  };
  const xs = Array.from({ length: SIZE }, (_, x) => axis(x));
  for (let y = 0; y < SIZE; y++) {
    const [y0, y1, fy] = axis(y);
    const r0 = y0 * M;
    const r1 = y1 * M;
    for (let x = 0; x < SIZE; x++) {
      const [x0, x1, fx] = xs[x];
      const a = (r0 + x0) * 4, b = (r0 + x1) * 4, c = (r1 + x0) * 4, d = (r1 + x1) * 4;
      const o = y * SIZE + x;
      for (let ch = 0; ch < 3; ch++) {
        const top = px[a + ch] + (px[b + ch] - px[a + ch]) * fx;
        const bot = px[c + ch] + (px[d + ch] - px[c + ch]) * fx;
        out[(2 - ch) * plane + o] = (top + (bot - top) * fy) / 255; // BGR planes, see note above
      }
    }
  }
  return out;
}

/** Highest score per class (index = NudeNet label id). */
export async function classMaxima(src, w, h) {
  const s = await getSession();
  const input = toTensorData(src, w, h);
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) });
  const t = out[s.outputNames[0]]; // [1, 4 + classes, boxes]
  const [, C, N] = t.dims;
  const d = t.data;
  const maxima = new Array(C - 4).fill(0);
  for (let n = 0; n < N; n++) {
    let max = 0;
    let arg = -1;
    for (let c = 4; c < C; c++) {
      const v = d[c * N + n];
      if (v > max) { max = v; arg = c - 4; }
    }
    if (arg >= 0 && max > maxima[arg]) maxima[arg] = max;
  }
  return maxima;
}

async function scoreSource(src, w, h) {
  const m = await classMaxima(src, w, h);
  return Math.max(...[...TARGET_CLASSES].map((c) => m[c]));
}

const waitFor = (el, ev, ms = 8000) =>
  new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout')), ms);
    el.addEventListener(ev, () => { clearTimeout(t); res(); }, { once: true });
    el.addEventListener('error', () => { clearTimeout(t); rej(new Error('media error')); }, { once: true });
  });

async function scorePhoto(blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  try {
    return await scoreSource(bmp, bmp.width, bmp.height);
  } finally {
    bmp.close();
  }
}

async function scoreVideo(blob) {
  const url = URL.createObjectURL(blob);
  const v = document.createElement('video');
  v.muted = true;
  v.preload = 'auto';
  v.src = url;
  try {
    await waitFor(v, 'loadeddata');
    let best = 0;
    for (let i = 0; i < VIDEO_FRAMES; i++) {
      v.currentTime = (v.duration || 1) * ((i + 0.5) / VIDEO_FRAMES);
      await waitFor(v, 'seeked');
      best = Math.max(best, await scoreSource(v, v.videoWidth, v.videoHeight));
    }
    return best;
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}

/** Score for a memory, or -1 if the file couldn't be decoded. */
export async function scoreMemory(m) {
  try {
    const blob = await readBlob(m.main);
    return m.kind === 'video' ? await scoreVideo(blob) : await scorePhoto(blob);
  } catch {
    return -1;
  }
}

export const warmUp = () => getSession();
