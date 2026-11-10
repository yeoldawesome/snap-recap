// Finds faces in photos (in the browser, with MediaPipe's face landmark model) and draws photos
// moved, rotated and scaled so the chosen face sits in the same place in every frame.
import wasmLoaderPath from '../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.js?url';
import wasmBinaryPath from '../../node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_internal.wasm?url';
import { readBlob } from './importer.js';
import { load, save } from './storage.js';

const DETECT_MAX = 640; // detection runs on a downscaled copy; plenty for faces
const THUMB_MAX = 420; // also used as the quick frame while scrubbing
const MAX_FACES = 4;
// Face mesh landmark indices: eye corners (image-left eye, image-right eye) and inner lips.
const L_EYE = [33, 133];
const R_EYE = [362, 263];
const MOUTH = [13, 14];

let landmarkerP = null;
function getLandmarker() {
  landmarkerP ||= (async () => {
    const { FaceLandmarker } = await import('@mediapipe/tasks-vision');
    const modelAssetPath = new URL('models/face_landmarker.task', document.baseURI).href;
    const opts = (delegate) => ({ baseOptions: { modelAssetPath, delegate }, runningMode: 'IMAGE', numFaces: MAX_FACES });
    const fileset = { wasmLoaderPath, wasmBinaryPath };
    try {
      return await FaceLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch {
      return FaceLandmarker.createFromOptions(fileset, opts('CPU'));
    }
  })();
  landmarkerP.catch(() => { landmarkerP = null; });
  return landmarkerP;
}

// ---- per-photo results ----
// faces[id] = list of faces (largest first), each { l, r, m, box } in 0..1 image coords,
// plus d (a 128-number face description) once describeAll() has run on it.
// picks[id] = which face to align on: index, -1 to skip the photo, or a hand-marked face object.
// Both the faces and the thumbnails are kept in IndexedDB, so a refresh doesn't redo the work.
const faces = {};
let picks = load('facePicks', {});
const thumbs = new Map(); // id -> object URL of a small preview
const thumbBlobs = new Map(); // id -> the same preview as a Blob
const failed = new Set(); // photos that couldn't be read

const DB = 'snaprecap-faces';
const STORE = 'faces';
function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
let dbP = null;
const db = () => (dbP ||= openDb().catch((e) => { dbP = null; throw e; }));

function remember(rec) {
  if (rec.thumb) {
    thumbBlobs.set(rec.id, rec.thumb);
    if (!thumbs.has(rec.id)) thumbs.set(rec.id, URL.createObjectURL(rec.thumb));
  } else if (rec.failed) failed.add(rec.id);
  faces[rec.id] = rec.faces || [];
}

let hydrateP = null;
/** Loads everything saved from earlier visits. Safe to call many times. */
export function hydrate() {
  hydrateP ||= (async () => {
    try {
      const d = await db();
      const recs = await new Promise((res, rej) => {
        const r = d.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        r.onsuccess = () => res(r.result || []);
        r.onerror = () => rej(r.error);
      });
      recs.forEach(remember);
    } catch (e) {
      console.warn("Couldn't load saved faces", e);
    }
    // Older versions kept faces in localStorage; those still save the detection step.
    const old = load('faces', {});
    for (const id in old) if (faces[id] === undefined) faces[id] = old[id];
  })();
  return hydrateP;
}

// Writes are batched into one transaction every so often.
let queue = [];
let flushTimer = 0;
function flush() {
  clearTimeout(flushTimer);
  flushTimer = 0;
  const batch = queue;
  queue = [];
  if (!batch.length) return Promise.resolve();
  return db().then((d) => new Promise((res) => {
    const t = d.transaction(STORE, 'readwrite');
    const st = t.objectStore(STORE);
    batch.forEach((r) => st.put(r));
    t.oncomplete = () => {
      try { localStorage.removeItem('snaprecap.faces'); } catch { /* ignore */ }
      res();
    };
    t.onerror = t.onabort = () => { console.warn("Couldn't save faces", t.error); res(); };
  })).catch((e) => console.warn("Couldn't save faces", e));
}
function store(rec) {
  remember(rec);
  queue.push(rec);
  if (queue.length >= 25) flush();
  else if (!flushTimer) flushTimer = setTimeout(flush, 800);
}
if (typeof window !== 'undefined') window.addEventListener('pagehide', flush);

export const isAnalyzed = (m) => faces[m.id] !== undefined && (thumbs.has(m.id) || failed.has(m.id));
export const thumbOf = (m) => thumbs.get(m.id);
export const facesOf = (m) => faces[m.id] || [];
export const pickOf = (m) => picks[m.id];

// ---- following one person ----
// person.refs are faces the user said are them ({ id, i }: photo id and face index). In each photo
// the face that looks most like them is used, and photos where nobody is close enough are left out.
// Telling faces apart needs a face description (128 numbers per face, face.d), which is worked out
// separately by describeAll() only once this is switched on.
let person = load('facePerson', { on: false, refs: [], tolerance: 0.5 });
let matchCache = new Map(); // id -> { face, dist } | null, while person and descriptions are unchanged
const changed = () => { matchCache = new Map(); };

export const personOf = () => person;
export function setPerson(patch) {
  person = { ...person, ...patch };
  save('facePerson', person);
  changed();
}
export const isRef = (m, i) => person.refs.some((r) => r.id === m.id && r.i === i);
export function toggleRef(m, i) {
  setPerson({ refs: isRef(m, i) ? person.refs.filter((r) => !(r.id === m.id && r.i === i)) : [...person.refs, { id: m.id, i }] });
}

function refDescs() {
  const out = [];
  for (const r of person.refs) {
    const d = faces[r.id]?.[r.i]?.d;
    if (d) out.push(d);
  }
  return out;
}

function dist(a, b) {
  let s = 0;
  for (let k = 0; k < a.length; k++) { const v = a[k] - b[k]; s += v * v; }
  return Math.sqrt(s);
}

/** How close a face is to the chosen person (smaller is closer), or null if not described yet. */
export function distanceTo(f, refs = refDescs()) {
  if (!f?.d || !refs.length) return null;
  let best = Infinity;
  for (const r of refs) best = Math.min(best, dist(f.d, r));
  return best;
}

/** True when photos are being filtered to one person (switched on and at least one example ready). */
export const followingPerson = () => person.on && refDescs().length > 0;

/** For person mode: the best-matching face and its distance, or null if no face is described yet. */
function bestMatch(m) {
  let hit = matchCache.get(m.id);
  if (hit !== undefined) return hit;
  const refs = refDescs();
  hit = null;
  facesOf(m).forEach((f) => {
    const d = distanceTo(f, refs);
    if (d !== null && (!hit || d < hit.dist)) hit = { face: f, dist: d };
  });
  matchCache.set(m.id, hit);
  return hit;
}

/** In person mode, why a photo has no face: 'checking' (not described yet), 'other' (not them), or null. */
export function personStatus(m) {
  if (!followingPerson() || picks[m.id] !== undefined || !facesOf(m).length) return null;
  const hit = bestMatch(m);
  if (!hit) return 'checking';
  return hit.dist <= person.tolerance ? null : 'other';
}

/** The face this photo is aligned on, or null (no face found / skipped / not the chosen person). */
export function faceFor(m) {
  const p = picks[m.id];
  if (p === -1) return null;
  if (p && typeof p === 'object') return p;
  if (typeof p === 'number') return facesOf(m)[p] || null;
  if (followingPerson()) {
    const hit = bestMatch(m);
    return hit && hit.dist <= person.tolerance ? hit.face : null;
  }
  return facesOf(m)[0] || null;
}

export function setPick(m, value) {
  picks = { ...picks };
  if (value === undefined) delete picks[m.id];
  else picks[m.id] = value;
  save('facePicks', picks);
}

/** A face from two clicked eye points (image-left eye first), for photos the model missed. */
export function manualFace(l, r) {
  const mx = (l[0] + r[0]) / 2;
  const my = (l[1] + r[1]) / 2;
  const dx = r[0] - l[0];
  const dy = r[1] - l[1];
  // Mouth sits roughly 1.1 eye-distances below the eyes, perpendicular to the eye line.
  return { l, r, m: [mx - dy * 1.1, my + dx * 1.1], manual: true };
}

const r4 = (v) => Math.round(v * 10000) / 10000;
const avg = (pts, ids) => {
  let x = 0;
  let y = 0;
  for (const i of ids) { x += pts[i].x; y += pts[i].y; }
  return [r4(x / ids.length), r4(y / ids.length)];
};

function toFace(pts) {
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { l: avg(pts, L_EYE), r: avg(pts, R_EYE), m: avg(pts, MOUTH), box: [x0, y0, x1, y1].map(r4) };
}
const area = (f) => (f.box[2] - f.box[0]) * (f.box[3] - f.box[1]);

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function fit(w, h, max) {
  const k = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

/** Find faces in one photo (skipped if already known) and make its thumbnail. */
async function analyzeOne(m, landmarker) {
  const bmp = await createImageBitmap(await readBlob(m.main));
  try {
    let found = faces[m.id];
    if (found === undefined) {
      const c = canvas(...fit(bmp.width, bmp.height, DETECT_MAX));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const res = (await landmarker()).detect(c);
      found = (res.faceLandmarks || []).map(toFace).sort((a, b) => area(b) - area(a));
    }
    const t = canvas(...fit(bmp.width, bmp.height, THUMB_MAX));
    t.getContext('2d').drawImage(bmp, 0, 0, t.width, t.height);
    const thumb = await new Promise((res) => t.toBlob(res, 'image/jpeg', 0.75));
    store(thumb ? { id: m.id, faces: found, thumb } : { id: m.id, faces: found, failed: true });
  } finally {
    bmp.close();
  }
}

/**
 * Analyzes every photo not done yet. onProgress(done, total) is called as it goes.
 * Returns a cancel function. Photos that fail to decode are recorded as "no face".
 */
export function analyzeAll(list, onProgress, onError) {
  let stopped = false;
  (async () => {
    await hydrate();
    if (stopped) return;
    const todo = list.filter((m) => !isAnalyzed(m));
    let done = list.length - todo.length;
    onProgress(done, list.length);
    if (!todo.length) return;
    // The model only loads if there's a photo whose faces aren't known yet.
    let modelError = null;
    const landmarker = async () => {
      try {
        return await getLandmarker();
      } catch (e) {
        modelError = e;
        throw e;
      }
    };
    for (const m of todo) {
      if (stopped) break;
      try {
        await analyzeOne(m, landmarker);
      } catch (e) {
        if (modelError) {
          console.error(modelError);
          onError?.(modelError);
          break;
        }
        console.warn("Couldn't analyze", m.key, e);
        store({ id: m.id, faces: [], failed: true });
      }
      onProgress(++done, list.length);
    }
    flush();
  })();
  return () => { stopped = true; };
}

// ---- face descriptions (for telling people apart) ----
const CHIP = 150; // the recognition model looks at a 150x150 crop of the face
let recogP = null;
function getRecognizer() {
  recogP ||= (async () => {
    const api = await import('@vladmandic/face-api');
    // Use the graphics card when there is one; otherwise plain JavaScript, which is slower but works
    // everywhere. (face-api would otherwise try its WebAssembly engine, whose files aren't shipped.)
    for (const backend of ['webgl', 'cpu']) {
      try {
        if (await api.tf.setBackend(backend)) break;
      } catch { /* try the next one */ }
    }
    await api.tf.ready();
    await api.nets.faceRecognitionNet.loadFromUri(new URL('models', document.baseURI).href);
    return api;
  })();
  recogP.catch(() => { recogP = null; });
  return recogP;
}

const needsDesc = (m) => !failed.has(m.id) && (faces[m.id] || []).some((f) => !f.d);
const faceDist = (f, w, h) => Math.max(
  Math.hypot((f.r[0] - f.l[0]) * w, (f.r[1] - f.l[1]) * h),
  Math.hypot((f.m[0] - (f.l[0] + f.r[0]) / 2) * w, (f.m[1] - (f.l[1] + f.r[1]) / 2) * h) / 1.1,
);

/** Draws the face upright and centered into a CHIP-sized square, the way the model expects. */
function drawChip(c, img, f) {
  const w = img.width;
  const h = img.height;
  const lx = f.l[0] * w, ly = f.l[1] * h, rx = f.r[0] * w, ry = f.r[1] * h;
  const k = CHIP / (faceDist(f, w, h) * 2.4);
  const ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, CHIP, CHIP);
  ctx.translate(CHIP / 2, CHIP * 0.33);
  ctx.rotate(-Math.atan2(ry - ly, rx - lx));
  ctx.scale(k, k);
  ctx.translate(-(lx + rx) / 2, -(ly + ry) / 2);
  ctx.drawImage(img, 0, 0, w, h);
}

async function describeOne(m, api) {
  const list = faces[m.id];
  // The thumbnail is quick to decode and big enough for most faces; small faces use the full photo.
  let img = await createImageBitmap(thumbBlobs.get(m.id) || await readBlob(m.main));
  try {
    if (list.some((f) => faceDist(f, img.width, img.height) < 50)) {
      const full = await createImageBitmap(await readBlob(m.main));
      img.close();
      img = full;
    }
    const c = canvas(CHIP, CHIP);
    const next = [];
    for (const f of list) {
      if (f.d) { next.push(f); continue; }
      drawChip(c, img, f);
      const d = await api.computeFaceDescriptor(c);
      next.push({ ...f, d: Array.from(d, (v) => Math.round(v * 1000) / 1000) });
    }
    store({ id: m.id, faces: next, thumb: thumbBlobs.get(m.id) });
    changed();
  } finally {
    img.close();
  }
}

/** Works out face descriptions for every analyzed photo that lacks them. Returns a cancel function. */
export function describeAll(list, onProgress, onError) {
  let stopped = false;
  (async () => {
    await hydrate();
    if (stopped) return;
    const todo = list.filter(needsDesc);
    let done = 0;
    onProgress(done, todo.length);
    if (!todo.length) return;
    let api;
    try {
      api = await getRecognizer();
    } catch (e) {
      console.error(e);
      onError?.(e);
      return;
    }
    for (const m of todo) {
      if (stopped) break;
      try {
        await describeOne(m, api);
      } catch (e) {
        console.warn("Couldn't describe faces in", m.key, e);
      }
      onProgress(++done, todo.length);
    }
    flush();
  })();
  return () => { stopped = true; };
}

// ---- full-size frames for playback ----
// Loads are started nearest-first and only a few run at once, so the next photo is never stuck
// behind a pile of later ones. Caption overlays are only decoded when they're shown.
const FRAME_MAX = 2048;
const frames = new Map(); // id -> entry, least recently used first
const MAX_FRAMES = 36;
const MAX_INFLIGHT = 2;
let inflight = 0;

async function decode(entry) {
  const blob = await readBlob(entry);
  const full = await createImageBitmap(blob);
  if (Math.max(full.width, full.height) <= FRAME_MAX) return full;
  const [w, h] = fit(full.width, full.height, FRAME_MAX);
  const small = await createImageBitmap(full, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  full.close();
  return small;
}

function release(f) {
  f.dead = true;
  f.img?.close();
  f.ov?.close();
}

function startMain(m, f) {
  inflight++;
  f.started = true;
  decode(m.main)
    .then((img) => { if (f.dead) img.close(); else f.img = img; }, () => {})
    .finally(() => { f.done = true; inflight--; });
}

function startOverlay(m, f) {
  f.ovStarted = true;
  decode(m.overlay)
    .then((ov) => { if (f.dead) ov.close(); else f.ov = ov; }, () => {})
    .finally(() => { f.ovDone = true; });
}

function entry(m, create) {
  let f = frames.get(m.id);
  if (f) {
    frames.delete(m.id);
    frames.set(m.id, f);
  } else if (create) {
    f = {};
    frames.set(m.id, f);
    while (frames.size > MAX_FRAMES) {
      const [oldId, old] = frames.entries().next().value;
      frames.delete(oldId);
      release(old);
    }
  }
  return f;
}

function view(m, f, withOv) {
  if (!f?.done) return null;
  if (withOv && m.overlay) {
    if (!f.ovDone) return null;
    return { img: f.img || null, ov: f.ov || null };
  }
  return { img: f.img || null, ov: null };
}

/** The decoded frame if ready; otherwise starts loading it (right away) and returns null. */
export function frameNow(m, withOv = false) {
  const f = entry(m, true);
  if (!f.started) startMain(m, f);
  if (withOv && m.overlay && !f.ovStarted) startOverlay(m, f);
  return view(m, f, withOv);
}

/** The frame if it's already decoded; never starts loading. */
export function frameIfReady(m, withOv = false) {
  return view(m, frames.get(m.id), withOv);
}

/** Queue up the photos coming next, nearest first, without flooding the decoder. */
export function warmFrames(list, withOv) {
  for (const m of list) {
    const f = entry(m, true);
    if (!f.started) {
      if (inflight >= MAX_INFLIGHT) return;
      startMain(m, f);
    }
    if (withOv && m.overlay && !f.ovStarted) startOverlay(m, f);
  }
}

// ---- small frames for fast scrubbing (decoded from the thumbnails, so they're quick) ----
const previews = new Map(); // id -> { v }
const MAX_PREVIEWS = 160;

/** Like frameNow, but returns the low-res preview. Decoding one takes a couple of milliseconds. */
export function previewNow(m) {
  let f = previews.get(m.id);
  if (f) {
    previews.delete(m.id);
    previews.set(m.id, f);
    return f.v;
  }
  const blob = thumbBlobs.get(m.id);
  if (!blob) return null;
  f = { v: null };
  f.p = createImageBitmap(blob).then((img) => { f.v = { img, ov: null }; return f.v; }, () => null);
  previews.set(m.id, f);
  while (previews.size > MAX_PREVIEWS) {
    const [oldId, old] = previews.entries().next().value;
    previews.delete(oldId);
    old.p.then((v) => v?.img?.close());
  }
  return null;
}

// ---- drawing ----
export const ASPECTS = {
  '9:16': [1080, 1920],
  '4:5': [1080, 1350],
  '1:1': [1080, 1080],
  '16:9': [1920, 1080],
};

/**
 * Draws img so the face's eye midpoint lands at (W/2, H*eyeY), the eyes are level,
 * and the face is `size` of the frame width across.
 */
export function drawAligned(ctx, frame, face, { size, eyeY, overlays }, alpha = 1) {
  const { img, ov } = frame;
  if (!img || !face) return;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  const iw = img.width;
  const ih = img.height;
  const lx = face.l[0] * iw, ly = face.l[1] * ih;
  const rx = face.r[0] * iw, ry = face.r[1] * ih;
  const ex = (lx + rx) / 2, ey = (ly + ry) / 2;
  const mx = face.m[0] * iw, my = face.m[1] * ih;
  const eyeDist = Math.hypot(rx - lx, ry - ly);
  // A face turned sideways has its eyes close together; eye-to-mouth length keeps the scale steady.
  const d = Math.max(eyeDist, Math.hypot(mx - ex, my - ey) / 1.1, 1);
  const s = (W * size) / d;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(W / 2, H * eyeY);
  ctx.rotate(-Math.atan2(ry - ly, rx - lx));
  ctx.scale(s, s);
  ctx.translate(-ex, -ey);
  ctx.drawImage(img, 0, 0, iw, ih);
  if (overlays && ov) ctx.drawImage(ov, 0, 0, iw, ih);
  ctx.restore();
}
