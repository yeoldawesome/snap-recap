// Playback settings, kept separately for the slideshow (photo) and the video recap.

const SHARED = {
  transition: 'fade', // none | fade | black | slide | zoom
  fadeSec: 0.6,
  showDate: true,
  showWeekday: true,
  showProgress: true,
  fullDate: true, // in full screen: the date, small, along the bottom edge
  showOverlays: true, // Snapchat captions / stickers
  loop: false,
  // What to show (each of the slideshow and the video recap has its own).
  showSnap: true, // memories from a Snapchat export
  showOther: true, // camera roll and other photos/videos added directly
  captions: 'any', // any | with | without (Snapchat caption/sticker overlay)
  from: '', // first day included, 'YYYY-MM-DD' ('' = from the start)
  to: '', // last day included
  order: 'library', // library | oldest | newest | shuffle
};

export const ORDERS = [
  { value: 'library', label: 'Same as library' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'newest', label: 'Newest first' },
  { value: 'shuffle', label: 'Shuffle' },
];

export const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** A stable shuffle: each item's place depends only on its id and the seed. */
function hash(str, seed) {
  let h = 2166136261 ^ seed;
  for (let k = 0; k < str.length; k++) h = Math.imul(h ^ str.charCodeAt(k), 16777619);
  return h >>> 0;
}

/** Applies a mode's "what to show" settings to a list of memories. */
export function pickShown(items, s, seed = 1) {
  let l = items.filter((m) => (m.fromCameraRoll ? s.showOther : s.showSnap)
    && (s.captions === 'any' || (s.captions === 'with') === !!m.overlay)
    && (!s.from || dayKey(m.date) >= s.from)
    && (!s.to || dayKey(m.date) <= s.to));
  if (s.order === 'oldest') l = [...l].sort((a, b) => a.date - b.date);
  else if (s.order === 'newest') l = [...l].sort((a, b) => b.date - a.date);
  else if (s.order === 'shuffle') {
    const key = new Map(l.map((m) => [m.id, hash(m.id, seed)]));
    l = [...l].sort((a, b) => key.get(a.id) - key.get(b.id));
  }
  return l;
}

export const DEFAULT_SETTINGS = {
  newestFirst: false,
  excludedYears: [],
  photo: {
    ...SHARED,
    secPerPhoto: 3,
    slideTotalMin: 0, // 0 = use secPerPhoto
    kenBurns: true,
    blurBg: false,
  },
  video: {
    ...SHARED,
    maxClipSec: 10, // 0 = whole clip
    videoTotalMin: 0, // 0 = no limit
    volume: 1,
    muted: false,
    speed: 1,
  },
};

/** Fill in any settings added since the user's saved copy was written. */
export const withDefaults = (s = {}) => ({
  ...DEFAULT_SETTINGS,
  ...s,
  photo: { ...DEFAULT_SETTINGS.photo, ...s.photo },
  video: { ...DEFAULT_SETTINGS.video, ...s.video },
});

export const TRANSITIONS = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Crossfade' },
  { value: 'black', label: 'Fade to black' },
  { value: 'slide', label: 'Slide' },
  { value: 'zoom', label: 'Zoom' },
];

export const slideSecFor = (p, count) =>
  p.slideTotalMin > 0 && count ? Math.max(0.5, (p.slideTotalMin * 60) / count) : p.secPerPhoto;

export const clipCapFor = (v, count) =>
  Math.min(
    v.maxClipSec > 0 ? v.maxClipSec : Infinity,
    v.videoTotalMin > 0 && count ? (v.videoTotalMin * 60) / count : Infinity,
  );
