// Photos and videos picked straight from a phone's camera roll (or any folder of pictures),
// as an alternative to a Snapchat export. Each file is wrapped to look like a zip entry, so the
// rest of the app reads it the same way. Dates come from inside the file where possible, because
// phones often set a picked file's "modified" time to the moment it was picked.

const VIDEO_EXT = new Set(['mp4', 'mov', 'm4v', 'webm', '3gp']);
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'avif']);
const ext = (name) => (name.split('.').pop() || '').toLowerCase();

export const isVideoFile = (f) => f.type.startsWith('video/') || VIDEO_EXT.has(ext(f.name));
export const isMediaFile = (f) => !f.name.startsWith('._')
  && (f.type.startsWith('image/') || f.type.startsWith('video/') || IMAGE_EXT.has(ext(f.name)) || VIDEO_EXT.has(ext(f.name)));

const MIN_DATE = Date.UTC(1990, 0, 1);
const sane = (t) => (Number.isFinite(t) && t > MIN_DATE && t < Date.now() + 86_400_000 ? t : null);

/** "2023:06:01 14:22:05" (camera local time) -> ms. */
function exifTime(s) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(s);
  return m ? sane(new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime()) : null;
}

/** When a JPEG was taken, from its EXIF (DateTimeOriginal, else DateTime), or null. */
export async function photoDate(file) {
  try {
    const dv = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (dv.byteLength < 4 || dv.getUint16(0) !== 0xffd8) return null;
    let o = 2;
    while (o + 4 <= dv.byteLength) {
      const marker = dv.getUint16(o);
      if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) break; // start of image data: no EXIF
      const len = dv.getUint16(o + 2);
      if (marker === 0xffe1 && o + 10 <= dv.byteLength && dv.getUint32(o + 4) === 0x45786966) {
        return readTiff(dv, o + 10, Math.min(dv.byteLength, o + 2 + len));
      }
      o += 2 + len;
    }
  } catch { /* not a readable JPEG */ }
  return null;
}

function readTiff(dv, t, end) {
  const le = dv.getUint16(t) === 0x4949;
  const u16 = (p) => dv.getUint16(p, le);
  const u32 = (p) => dv.getUint32(p, le);
  const str = (p, n) => {
    let s = '';
    for (let i = 0; i < n && p + i < end; i++) {
      const c = dv.getUint8(p + i);
      if (!c) break;
      s += String.fromCharCode(c);
    }
    return s;
  };
  // Reads the listed tags from one IFD: { tag: value or offset }.
  const ifd = (p) => {
    const out = {};
    if (p + 2 > end) return out;
    const n = u16(p);
    for (let i = 0; i < n; i++) {
      const e = p + 2 + i * 12;
      if (e + 12 > end) break;
      const tag = u16(e);
      const count = u32(e + 4);
      out[tag] = tag === 0x8769 ? t + u32(e + 8) : str(count > 4 ? t + u32(e + 8) : e + 8, count);
    }
    return out;
  };
  const ifd0 = ifd(t + u32(t + 4));
  const exif = ifd0[0x8769] ? ifd(ifd0[0x8769]) : {};
  return exifTime(exif[0x9003] || '') || exifTime(exif[0x9004] || '') || exifTime(ifd0[0x0132] || '');
}

/** When an MP4/MOV was recorded, from its movie header (mvhd), or null. */
export async function videoDate(file) {
  try {
    let pos = 0;
    // Walk the top-level boxes until "moov" (it can be at the start or the end of the file).
    for (let guard = 0; pos + 8 <= file.size && guard < 64; guard++) {
      const h = new DataView(await file.slice(pos, pos + 16).arrayBuffer());
      let len = h.getUint32(0);
      const type = h.getUint32(4);
      let hdr = 8;
      if (len === 1) { len = Number(h.getBigUint64(8)); hdr = 16; } else if (len === 0) len = file.size - pos;
      if (len < hdr) break;
      if (type === 0x6d6f6f76 /* moov */) {
        const moov = new DataView(await file.slice(pos + hdr, pos + Math.min(len, 16 * 1024 * 1024)).arrayBuffer());
        for (let o = 0; o + 8 <= moov.byteLength;) {
          const clen = moov.getUint32(o);
          if (moov.getUint32(o + 4) === 0x6d766864 /* mvhd */) {
            const v = moov.getUint8(o + 8);
            const secs = v === 1 ? Number(moov.getBigUint64(o + 12)) : moov.getUint32(o + 12);
            return secs ? sane((secs - 2082844800) * 1000) : null; // seconds since 1904, UTC
          }
          if (clen < 8) break;
          o += clen;
        }
        return null;
      }
      pos += len;
    }
  } catch { /* not an MP4/MOV we can read */ }
  return null;
}

// ---- HEIC (iPhone photos copied to a computer) ----
export const isHeic = (f) => /^(heic|heif)$/.test(ext(f.name)) || /image\/hei[cf]/i.test(f.type);

let exifrP = null;
const exifr = () => (exifrP ||= import('exifr').then((m) => m.default || m));

/** Date taken for any photo: the quick JPEG reader first, then exifr (HEIC, PNG, WebP, odd JPEGs). */
async function anyPhotoDate(f) {
  const quick = await photoDate(f);
  if (quick) return quick;
  try {
    const r = await (await exifr()).parse(f, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'] });
    const t = r?.DateTimeOriginal || r?.CreateDate || r?.ModifyDate;
    return t instanceof Date ? sane(t.getTime()) : null;
  } catch {
    return null;
  }
}

let heicOk = null;
/** Whether this browser can display HEIC photos (Safari can; Chrome, Edge and Firefox can't). */
export async function canShowHeic(sample) {
  if (heicOk !== null) return heicOk;
  try {
    const bmp = await createImageBitmap(sample);
    bmp.close();
    heicOk = true;
  } catch {
    heicOk = false;
  }
  return heicOk;
}

/** Looks enough like a zip entry for readBlob/urlFor. */
const asEntry = (file) => ({
  filename: file.name,
  uncompressedSize: file.size,
  lastModDate: new Date(file.lastModified),
  getData: () => Promise.resolve(file),
});

/** Adds the files to the same map the zip importer uses. Returns everything, oldest first. */
export async function importMedia(files, onProgress, map = new Map()) {
  const list = files.filter(isMediaFile);
  let done = 0;
  let next = 0;
  // A few at a time: each only reads a small piece of its file.
  const worker = async () => {
    while (next < list.length) {
      const f = list[next++];
      const kind = isVideoFile(f) ? 'video' : 'photo';
      const date = (kind === 'video' ? await videoDate(f) : await anyPhotoDate(f)) || f.lastModified || Date.now();
      const key = `cam:${f.name}:${f.size}`;
      map.set(key, { key, id: key, kind, date, main: asEntry(f), fromCameraRoll: true });
      if (++done % 25 === 0 || done === list.length) onProgress?.(done, list.length, f.name);
    }
  };
  onProgress?.(0, list.length, '');
  await Promise.all([worker(), worker(), worker(), worker()]);
  // iPhone photos copied straight to a computer are HEIC, which most browsers can't show:
  // leave those out (rather than showing blank slides) and report how many.
  const heic = list.filter(isHeic);
  const heicBlocked = heic.length && !(await canShowHeic(heic[0])) ? heic.length : 0;
  if (heicBlocked) heic.forEach((f) => map.delete(`cam:${f.name}:${f.size}`));
  const all = [...map.values()].filter((m) => m.main);
  all.sort((a, b) => a.date - b.date);
  return { list: all, map, heicBlocked };
}
