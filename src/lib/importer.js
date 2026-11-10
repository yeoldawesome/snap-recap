// Reads Snapchat Memories export zips straight from the user's disk (nothing is uploaded).
import { BlobReader, BlobWriter, ZipReader } from '@zip.js/zip.js';

const MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  mp4: 'video/mp4', mov: 'video/quicktime',
};
const VIDEO = new Set(['mp4', 'mov']);
const DATE_RE = /(\d{4})-(\d{2})-(\d{2})/;
const DAY = 86_400_000;

const ext = (name) => (name.split('.').pop() || '').toLowerCase();
export const mimeOf = (entry) => MIME[ext(entry.filename)] || 'application/octet-stream';

/** Snapchat names files like 2023-06-01_<id>-main.jpg; the zip timestamp carries the time of day. */
function entryDate(name, modDate, hint) {
  const mod = modDate instanceof Date && !isNaN(modDate) ? modDate.getTime() : 0;
  const m = DATE_RE.exec(name) || DATE_RE.exec(hint);
  if (!m) return mod;
  const day = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  if (Math.abs(mod - day) <= 1.5 * DAY) return mod;
  const t = new Date(mod);
  return day + ((t.getHours() * 60 + t.getMinutes()) * 60 + t.getSeconds()) * 1000;
}

async function addEntries(entries, map, hint) {
  for (const e of entries) {
    if (e.directory) continue;
    const name = e.filename.split('/').pop();
    const x = ext(name);

    // Older exports wrap each memory (main + caption overlay) in its own zip.
    if (x === 'zip') {
      const blob = await e.getData(new BlobWriter());
      const inner = await new ZipReader(new BlobReader(blob)).getEntries();
      await addEntries(inner, map, name);
      continue;
    }
    if (!MIME[x]) continue;

    const stem = name.slice(0, -(x.length + 1));
    const isOverlay = /-overlay$/i.test(stem);
    let key = stem.replace(/-(main|overlay)$/i, '');
    if (hint && !DATE_RE.test(key)) key = hint.replace(/\.zip$/i, '');

    const m = map.get(key) || { key };
    map.set(key, m);
    if (isOverlay) {
      if (!VIDEO.has(x)) m.overlay = e;
    } else {
      m.main = e;
      m.kind = VIDEO.has(x) ? 'video' : 'photo';
      m.date = entryDate(name, e.lastModDate, hint);
      m.id = `${key}:${e.uncompressedSize}`; // stable id for remembering hidden items
    }
  }
}

/** Returns memories sorted oldest first. Zip readers stay open so files can be read later on demand. */
export async function importZips(files, onProgress, map = new Map()) {
  for (let i = 0; i < files.length; i++) {
    onProgress?.(i, files.length, files[i].name);
    const reader = new ZipReader(new BlobReader(files[i]));
    await addEntries(await reader.getEntries(), map, '');
  }
  onProgress?.(files.length, files.length, '');
  const list = [...map.values()].filter((m) => m.main);
  list.sort((a, b) => a.date - b.date);
  return { list, map };
}

export const readBlob = (entry) => entry.getData(new BlobWriter(mimeOf(entry)));

// Small LRU cache of object URLs, so we don't hold every photo in memory at once.
const urls = new Map();
const MAX_URLS = 16;
export function urlFor(entry) {
  if (!entry) return Promise.resolve(null);
  if (urls.has(entry)) {
    const p = urls.get(entry);
    urls.delete(entry);
    urls.set(entry, p);
    return p;
  }
  const p = readBlob(entry).then((b) => URL.createObjectURL(b));
  urls.set(entry, p);
  while (urls.size > MAX_URLS) {
    const [oldEntry, oldP] = urls.entries().next().value;
    urls.delete(oldEntry);
    oldP.then((u) => setTimeout(() => URL.revokeObjectURL(u), 5000));
  }
  return p;
}
