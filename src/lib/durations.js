// Measures video lengths (the export doesn't list them). Each video is read once; results are cached.
import { readBlob } from './importer.js';

export async function measureDuration(entry) {
  const url = URL.createObjectURL(await readBlob(entry));
  const v = document.createElement('video');
  v.preload = 'metadata';
  v.muted = true;
  try {
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('timeout')), 10000);
      v.onloadedmetadata = () => { clearTimeout(t); res(); };
      v.onerror = () => { clearTimeout(t); rej(new Error('media error')); };
      v.src = url;
    });
    return Number.isFinite(v.duration) ? v.duration : 0;
  } catch {
    return 0; // can't play in this browser; the player skips these too
  } finally {
    v.removeAttribute('src');
    v.load();
    URL.revokeObjectURL(url);
  }
}
