// Playback settings, kept separately for the slideshow (photo) and the video recap.

const SHARED = {
  transition: 'fade', // none | fade | black | slide | zoom
  fadeSec: 0.6,
  showDate: true,
  showWeekday: true,
  showProgress: true,
  showOverlays: true, // Snapchat captions / stickers
  loop: false,
};

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
