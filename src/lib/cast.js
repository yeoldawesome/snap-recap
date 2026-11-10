// Real full screen on iPhone. iPhone Safari only lets a <video> element go full screen (its own player,
// covering everything). So the player is drawn, frame by frame, onto a canvas whose picture is fed into
// a video element as a live stream, and that video is shown in Safari's full-screen player. Whatever is
// on screen (photos, clips, fades, the date) appears there. Clip sound keeps playing from the page.

const MAX_SIDE = 1920; // canvas size limit (long side), in pixels

/** True where element full screen isn't available but video full screen is (iPhone). */
export function canCast() {
  if (typeof document === 'undefined') return false;
  if (document.fullscreenEnabled || document.webkitFullscreenEnabled) return false;
  const v = document.createElement('video');
  return typeof v.webkitEnterFullscreen === 'function' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

function screenSize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  let w = Math.round(window.innerWidth * dpr);
  let h = Math.round(window.innerHeight * dpr);
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  w = Math.round((w * k) / 2) * 2;
  h = Math.round((h * k) / 2) * 2;
  return [Math.max(2, w), Math.max(2, h)];
}

/**
 * Sets up the canvas and stream ahead of time, so the full-screen request can happen straight away
 * inside the tap (iPhone only allows it during a tap, and only on a video that already has a picture).
 * draw(ctx, width, height) paints one frame. Returns { enter, stop } or null if it can't be set up.
 */
export function prepareCast(draw, { onEnd, onPause, onPlay } = {}) {
  if (!canCast()) return null;
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = screenSize();
  const ctx = canvas.getContext('2d');
  draw(ctx, canvas.width, canvas.height);
  let stream;
  try {
    stream = canvas.captureStream(30);
  } catch {
    return null;
  }
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video.srcObject = stream;
  // It has to be in the page, but stays out of sight until it goes full screen.
  Object.assign(video.style, { position: 'fixed', left: '0', top: '0', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none' });
  document.body.appendChild(video);
  video.play().catch(() => {});

  let timer = 0;
  let active = false;
  const tick = () => {
    const [w, h] = screenSize();
    // Follow the phone's rotation: a turned phone gets a turned picture.
    if ((w > h) !== (canvas.width > canvas.height)) { canvas.width = w; canvas.height = h; }
    draw(ctx, canvas.width, canvas.height);
  };
  const stopLoop = () => { clearInterval(timer); timer = 0; active = false; };
  const ended = () => { stopLoop(); onEnd?.(); };
  video.addEventListener('webkitendfullscreen', ended);
  // The full-screen player's own play/pause button pauses the slideshow too.
  video.addEventListener('pause', () => { if (active) onPause?.(); });
  video.addEventListener('play', () => { if (active) onPlay?.(); });

  return {
    /** Call directly from the tap. Returns false if the phone refused. */
    enter() {
      try {
        tick();
        // A timer rather than animation frames: those stop while the full-screen player covers the page.
        if (!timer) timer = setInterval(tick, 1000 / 30);
        video.play().catch(() => {});
        video.webkitEnterFullscreen();
        active = true;
        return true;
      } catch {
        stopLoop();
        return false;
      }
    },
    exit() {
      try { video.webkitExitFullscreen?.(); } catch { /* already out */ }
      stopLoop();
    },
    stop() {
      stopLoop();
      video.removeEventListener('webkitendfullscreen', ended);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      video.remove();
    },
  };
}

/** Draws an image or video frame into (0,0,w,h), as big as fits without cropping or stretching. */
export function drawContain(ctx, el, w, h, alpha = 1) {
  const iw = el.videoWidth || el.naturalWidth || el.width;
  const ih = el.videoHeight || el.naturalHeight || el.height;
  if (!iw || !ih) return;
  const k = Math.min(w / iw, h / ih);
  const dw = iw * k;
  const dh = ih * k;
  ctx.globalAlpha = alpha;
  try {
    ctx.drawImage(el, (w - dw) / 2, (h - dh) / 2, dw, dh);
  } catch { /* not decoded yet */ }
  ctx.globalAlpha = 1;
}
