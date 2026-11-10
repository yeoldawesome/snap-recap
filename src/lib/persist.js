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

const isZip = (f) => f.name.toLowerCase().endsWith('.zip');

/** Collect files (and handles where supported) from a drop event. Must be called synchronously in the handler. */
export function fromDrop(e) {
  const items = [...(e.dataTransfer.items || [])].filter((i) => i.kind === 'file');
  const pending = items.map((i) => ({ file: i.getAsFile(), handle: i.getAsFileSystemHandle?.() }));
  return Promise.all(
    pending.map(async ({ file, handle }) => ({ file, handle: (await handle?.catch(() => null)) || undefined })),
  ).then((list) => list.filter((x) => x.file && isZip(x.file) && (!x.handle || x.handle.kind === 'file')));
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

export const fromInput = (fileList) => [...fileList].filter(isZip).map((file) => ({ file }));
