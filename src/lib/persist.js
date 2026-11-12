import { isMediaFile } from './camera.js';
// Remembers which zips were loaded so a page refresh doesn't lose them.
// Chrome/Edge: stores a file *handle* (a pointer to the zip on disk, no copy) in IndexedDB.
// Other browsers: stores the zip itself in IndexedDB (browser storage on this device only).

const DB = 'snaprecap';
const STORE = 'zips';
const keyOf = (f) => `${f.name}:${f.size}`;

function openDb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'key' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((res, rej) => {
      const t = db.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => res(out?.result);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  } finally {
    db.close();
  }
}

/** items: [{ file, handle? }]. Failures (e.g. storage full) are ignored; the app still works. */
export async function rememberZips(items) {
  for (const { file, handle } of items) {
    const rec = { key: keyOf(file), name: file.name, size: file.size };
    if (handle) rec.handle = handle;
    else rec.blob = file;
    try {
      await tx('readwrite', (s) => s.put(rec));
    } catch (e) {
      console.warn("Couldn't remember", file.name, e);
    }
  }
}

export async function savedZips() {
  try {
    return (await tx('readonly', (s) => s.getAll())) || [];
  } catch {
    return [];
  }
}

export async function forgetZips() {
  try {
    await tx('readwrite', (s) => s.clear());
  } catch { /* ignore */ }
}

/**
 * Turns saved records back into Files. Handles may need the user's OK again after a reload;
 * that prompt is only allowed from a click, so pass interactive=true from a click handler.
 * Returns { files, needsPermission }.
 */
export async function restoreZips(records, interactive) {
  const files = [];
  let needsPermission = false;
  for (const r of records) {
    if (r.blob) {
      files.push(r.blob instanceof File ? r.blob : new File([r.blob], r.name));
      continue;
    }
    try {
      let p = await r.handle.queryPermission({ mode: 'read' });
      if (p !== 'granted' && interactive) p = await r.handle.requestPermission({ mode: 'read' });
      if (p !== 'granted') { needsPermission = true; continue; }
      files.push(await r.handle.getFile());
    } catch (e) {
      // File was moved or deleted: drop it from the list.
      console.warn('Saved zip is gone', r.name, e);
      tx('readwrite', (s) => s.delete(r.key)).catch(() => {});
    }
  }
  return { files, needsPermission };
}

// Zips only; skips the hidden "._name.zip" copies macOS leaves on USB drives and network shares.
const isZip = (f) => f.name.toLowerCase().endsWith('.zip') && !f.name.startsWith('._');
// What a folder pick or drop takes in: Snapchat zips, plus photos and videos (e.g. a camera roll
// copied to the computer). Works on Files, file handles and drop entries (the last two have no .type).
const wanted = (f) => isZip(f) || isMediaFile({ name: f.name, type: f.type || '' });
const MAX_DEPTH = 6; // how many folders deep to look (old Photos libraries nest by year/month/day/event)

// A Mac Photos library ("Photos Library.photoslibrary") is a folder full of thumbnails, caches and a
// database; the photos themselves are only in "originals" (or "Masters" in older libraries).
const isLibrary = (name) => /\.photoslibrary$/i.test(name);
const LIBRARY_PHOTOS = new Set(['originals', 'masters']);
function folderWanted(name, parentIsLibrary) {
  if (name.startsWith('.')) return false;
  return parentIsLibrary ? LIBRARY_PHOTOS.has(name.toLowerCase()) : true;
}
// A Live Photo is a photo plus a ~3 second clip with the same name; keep just the photo.
const stem = (name) => name.replace(/\.[^.]+$/, '').replace(/_\d+$/, '').toLowerCase();
function dropLiveClips(files) {
  const photos = new Set(files.filter((f) => !isMediaVideo(f.name)).map((f) => stem(f.name)));
  return files.filter((f) => !isMediaVideo(f.name) || !photos.has(stem(f.name)));
}
const isMediaVideo = (name) => /\.(mov|mp4|m4v)$/i.test(name);

/**
 * Every zip, photo and video in a folder (and its subfolders), with handles so they can be reopened later.
 * `lib`: 'in' for the top of a Photos library, 'photos' for inside its originals.
 */
async function zipsInHandle(dir, depth = 0, out = [], lib = isLibrary(dir.name) ? 'in' : '') {
  const here = [];
  for await (const h of dir.values()) {
    if (h.kind === 'file') {
      if (lib !== 'in' && wanted(h)) here.push(h);
    } else if (depth < MAX_DEPTH && folderWanted(h.name, lib === 'in')) {
      const sub = isLibrary(h.name) ? 'in' : lib === 'in' ? 'photos' : lib;
      // Inside a library, start counting depth again: its originals sit several folders down.
      await zipsInHandle(h, sub && sub !== lib ? 0 : depth + 1, out, sub);
    }
  }
  for (const h of lib === 'photos' ? dropLiveClips(here) : here) out.push({ file: await h.getFile(), handle: h });
  return out;
}

/** The same for browsers without handles (a dropped folder in Firefox/Safari). */
async function zipsInEntry(dir, depth = 0, out = [], lib = isLibrary(dir.name) ? 'in' : '') {
  const reader = dir.createReader();
  const here = [];
  for (;;) {
    // readEntries returns a batch at a time; an empty batch means done.
    const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
    if (!batch.length) break;
    for (const e of batch) {
      if (e.isFile) {
        if (lib !== 'in' && wanted(e)) here.push(e);
      } else if (e.isDirectory && depth < MAX_DEPTH && folderWanted(e.name, lib === 'in')) {
        const sub = isLibrary(e.name) ? 'in' : lib === 'in' ? 'photos' : lib;
        await zipsInEntry(e, sub && sub !== lib ? 0 : depth + 1, out, sub);
      }
    }
  }
  for (const e of lib === 'photos' ? dropLiveClips(here) : here) {
    out.push({ file: await new Promise((res, rej) => e.file(res, rej)) });
  }
  return out;
}

const byName = (list) => list.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true }));

/**
 * Collect zips (and handles where supported) from a drop of files and/or folders.
 * Must be called synchronously in the drop handler.
 */
export function fromDrop(e) {
  const items = [...(e.dataTransfer.items || [])].filter((i) => i.kind === 'file');
  // Everything has to be grabbed now; the browser clears the drop data once the handler returns.
  const pending = items.map((i) => ({
    file: i.getAsFile(),
    entry: i.webkitGetAsEntry?.(),
    handle: i.getAsFileSystemHandle?.(),
  }));
  return Promise.all(pending.map(async ({ file, entry, handle }) => {
    const h = (await handle?.catch(() => null)) || null;
    try {
      if (h?.kind === 'directory') return await zipsInHandle(h);
      if (entry?.isDirectory) return await zipsInEntry(entry);
    } catch (err) {
      console.warn("Couldn't read dropped folder", err);
      return [];
    }
    return file && wanted(file) ? [{ file, handle: h || undefined }] : [];
  })).then((lists) => byName(lists.flat()));
}

export const canPickWithHandles = typeof window !== 'undefined' && 'showOpenFilePicker' in window;

/** Native file picker that also gives handles (Chrome/Edge). Returns null if cancelled. */
export async function pickZips() {
  try {
    const handles = await window.showOpenFilePicker({
      multiple: true,
      types: [{ description: 'Snapchat export zips', accept: { 'application/zip': ['.zip'] } }],
    });
    return Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })));
  } catch {
    return null;
  }
}

/** Files from an <input type=file>, including one with webkitdirectory (a whole folder). */
export const fromInput = (fileList) => byName([...fileList].filter(wanted).map((file) => ({ file })));

export const canPickFolderWithHandle = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/**
 * Native folder picker (Chrome/Edge): every zip, photo and video inside, with handles so they reopen next time.
 * Returns null if cancelled.
 */
export async function pickFolder() {
  let dir;
  try {
    dir = await window.showDirectoryPicker({ id: 'snap-recap', mode: 'read' });
  } catch {
    return null;
  }
  return byName(await zipsInHandle(dir));
}
