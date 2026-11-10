import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { urlFor } from '../lib/importer.js';
import { fmtDate, fmtWeekday } from '../lib/storage.js';
import { clipCapFor, pickShown, slideSecFor } from '../lib/settings.js';
import PlayerSettings from './PlayerSettings.jsx';
import { drawContain, prepareCast } from '../lib/cast.js';

const isTyping = (t) => t?.closest?.('.settings') || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t?.tagName);
const fmtMonth = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

/**
 * A timeline of the shown memories along the bottom: drag to any date to jump there.
 * Years (or months, for a short span) are marked, and a faint bar graph shows how busy each stretch is.
 */
function DateScrubber({ list, i, onSeek }) {
  const [drag, setDrag] = useState(null); // the date being dragged to, in ms
  // Positions by date, whatever order the list plays in.
  const sorted = useMemo(() => list.map((m, idx) => [m.date, idx]).sort((a, b) => a[0] - b[0]), [list]);
  const min = sorted[0][0];
  const max = sorted[sorted.length - 1][0];
  const span = Math.max(1, max - min);
  const pct = (t) => ((t - min) / span) * 100;

  const nearest = useCallback((t) => {
    let lo = 0;
    let hi = sorted.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid][0] < t) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0 && t - sorted[lo - 1][0] < sorted[lo][0] - t) lo -= 1;
    return sorted[lo][1];
  }, [sorted]);

  const bins = useMemo(() => {
    const n = 90;
    const counts = new Array(n).fill(0);
    for (const [t] of sorted) counts[Math.min(n - 1, Math.floor(((t - min) / span) * n))]++;
    const top = Math.max(...counts);
    return counts.map((c) => (c ? 0.15 + 0.85 * (c / top) : 0));
  }, [sorted, min, span]);

  const ticks = useMemo(() => {
    const out = [];
    const a = new Date(min);
    const b = new Date(max);
    const years = b.getFullYear() - a.getFullYear();
    if (years >= 2) {
      const every = years > 14 ? 2 : 1;
      for (let y = a.getFullYear() + 1; y <= b.getFullYear(); y += every) out.push({ t: new Date(y, 0, 1).getTime(), label: String(y) });
    } else {
      const months = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth();
      const every = months > 12 ? 3 : months > 6 ? 2 : 1;
      for (let d = new Date(a.getFullYear(), a.getMonth() + 1, 1); d <= b; d = new Date(d.getFullYear(), d.getMonth() + every, 1)) {
        out.push({ t: d.getTime(), label: d.toLocaleDateString(undefined, { month: 'short' }) + (d.getMonth() === 0 ? ` ${d.getFullYear()}` : '') });
      }
    }
    return out;
  }, [min, max]);

  const cur = list[i];
  const shownAt = drag ?? cur.date;
  const target = list[drag === null ? i : nearest(drag)];
  const commit = (e) => {
    if (drag === null) return;
    onSeek(nearest(drag));
    setDrag(null);
    e?.currentTarget?.blur?.(); // hand the arrow keys back to the player
  };

  if (sorted.length < 2) return null;
  return (
    <div className={`scrubber ${drag !== null ? 'dragging' : ''}`}>
      <span className="scrub-end">{fmtMonth(min)}</span>
      <div className="scrub-track">
        <div className="scrub-bins" aria-hidden>
          {bins.map((h, k) => <i key={k} style={{ height: `${h * 100}%` }} />)}
        </div>
        {ticks.map((tk) => (
          <button key={tk.t} className="scrub-tick" style={{ left: `${pct(tk.t)}%` }} tabIndex={-1}
            onClick={() => onSeek(nearest(tk.t))} title={`Jump to ${tk.label}`}>
            <span>{tk.label}</span>
          </button>
        ))}
        <div className="scrub-fill" style={{ width: `${pct(cur.date)}%` }} />
        <span className="scrub-bubble" style={{ left: `clamp(48px, ${pct(shownAt)}%, calc(100% - 48px))` }}>{fmtDate(target.date)}</span>
        <input type="range" min={min} max={max} step="any" value={shownAt} aria-label="Jump to a date"
          aria-valuetext={fmtDate(target.date)}
          onChange={(e) => setDrag(Number(e.target.value))}
          onPointerUp={commit} onTouchEnd={commit} onKeyUp={commit} onBlur={commit} />
      </div>
      <span className="scrub-end">{fmtMonth(max)}</span>
    </div>
  );
}

export default function Player({ mode, items, settings: s, update, onHide, onClose }) {
  const [seed] = useState(() => (Math.random() * 2 ** 31) | 0); // shuffle order for this viewing
  const list = useMemo(() => pickShown(items, s, seed),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, s.showSnap, s.showOther, s.captions, s.from, s.to, s.order, seed]);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [ended, setEnded] = useState(false);
  const [media, setMedia] = useState({ id: null, main: null, overlay: null });
  const [layers, setLayers] = useState([]); // on-screen frames; the last one is current, earlier ones are fading out
  const [vProg, setVProg] = useState(0);
  const [idle, setIdle] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  // Full screen: the browser's own where it has one (computers, Android, iPad); on iPhone, where Safari
  // only allows that for its own video player, the player fills the page itself instead.
  const [full, setFull] = useState(false);
  const [nativeFull, setNativeFull] = useState(false);
  const [casting, setCasting] = useState(false); // iPhone: showing in Safari's full-screen video player
  const rootRef = useRef(null);
  const videoRef = useRef(null);
  const dirRef = useRef(1);
  const curIdRef = useRef(null);
  const castRef = useRef(null); // iPhone: real full screen through Safari's video player
  const live = useRef({});

  const isPhoto = mode === 'photo';
  const slideSec = slideSecFor(s, list.length);
  const clipCap = clipCapFor(s, list.length);
  const cur = list[i];
  const ready = !!cur && media.id === cur.id;
  live.current = { s, cur };

  // iPhone full screen: copy what the player shows (the frames in the stage, fading as they do) onto
  // the canvas that feeds Safari's full-screen video, with the small date along the bottom.
  useEffect(() => {
    const seen = new WeakMap(); // frame element -> when it first appeared, for its fade-in
    const draw = (ctx, w, h) => {
      const { s: o, cur: c } = live.current;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      const now = performance.now();
      const frames = rootRef.current ? [...rootRef.current.querySelectorAll('.stage .frame')] : [];
      frames.forEach((f, k) => {
        if (!seen.has(f)) seen.set(f, now);
        const top = k === frames.length - 1;
        const fade = o.transition === 'none' || !top ? 1 : Math.min(1, (now - seen.get(f)) / (o.fadeSec * 1000));
        const main = f.querySelector('.kb video, .kb img');
        if (main) drawContain(ctx, main, w, h, fade);
        const over = f.querySelector('.kb video + img, .kb img + img');
        if (over) drawContain(ctx, over, w, h, fade);
      });
      if (o.fullDate && c) {
        const fs = Math.max(14, Math.round(Math.min(w, h) * 0.032));
        ctx.font = `700 ${fs}px -apple-system, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        const text = `${o.showWeekday ? `${fmtWeekday(c.date)} · ` : ''}${fmtDate(c.date)}`;
        ctx.lineWidth = fs * 0.3;
        ctx.lineJoin = 'round';
        ctx.strokeStyle = 'rgba(0,0,0,.6)';
        ctx.strokeText(text, w / 2, h - fs * 1.1);
        ctx.fillStyle = '#fff';
        ctx.fillText(text, w / 2, h - fs * 1.1);
      }
    };
    castRef.current = prepareCast(draw, {
      onEnd: () => setCasting(false),
      onPause: () => setPaused(true),
      onPlay: () => setPaused(false),
    });
    return () => { castRef.current?.stop(); castRef.current = null; };
  }, []);

  // When the list changes (settings, or a photo hidden), stay on the same memory if it's still there.
  useEffect(() => {
    const n = list.findIndex((m) => m.id === curIdRef.current);
    if (n >= 0) setI(n);
    else setI((x) => Math.min(x, Math.max(0, list.length - 1)));
  }, [list]);
  useEffect(() => { curIdRef.current = cur?.id ?? null; }, [cur]);

  const next = useCallback(() => {
    setVProg(0);
    dirRef.current = 1;
    if (i + 1 < list.length) setI(i + 1);
    else if (s.loop) setI(0);
    else setEnded(true);
  }, [i, list.length, s.loop]);
  const prev = useCallback(() => {
    setVProg(0);
    dirRef.current = -1;
    setEnded(false);
    setI((n) => Math.max(0, n - 1));
  }, []);
  const seek = useCallback((n) => {
    setVProg(0);
    setEnded(false);
    setI((old) => { dirRef.current = n >= old ? 1 : -1; return n; });
  }, []);

  // Load the current item; preload the next one.
  useEffect(() => {
    if (!cur) return undefined;
    let alive = true;
    Promise.all([urlFor(cur.main), urlFor(cur.overlay)]).then(([main, overlay]) => {
      if (alive) setMedia({ id: cur.id, main, overlay });
    });
    const nx = list[i + 1];
    if (nx) { urlFor(nx.main); urlFor(nx.overlay); }
    return () => { alive = false; };
  }, [cur, i, list]);

  // When the new item is ready, put it on top and let the old one fade out underneath.
  useEffect(() => {
    if (!ready) return;
    setLayers((ls) => {
      const top = ls[ls.length - 1];
      if (top && top.id === media.id && !top.leaving) return ls;
      const leaving = s.transition === 'none'
        ? []
        : ls.filter((l) => l.id !== media.id).slice(-1).map((l) => ({ ...l, leaving: true }));
      return [...leaving, { id: media.id, media, dir: dirRef.current }];
    });
  }, [ready, media, s.transition]);

  useEffect(() => {
    if (!layers.some((l) => l.leaving)) return undefined;
    const t = setTimeout(() => setLayers((ls) => ls.filter((l) => !l.leaving)), s.fadeSec * 1000 + 80);
    return () => clearTimeout(t);
  }, [layers, s.fadeSec]);

  // Photo timer.
  useEffect(() => {
    if (!isPhoto || !ready || paused || ended) return undefined;
    const t = setTimeout(next, slideSec * 1000);
    return () => clearTimeout(t);
  }, [isPhoto, ready, paused, ended, next, slideSec, i]);

  // Pause/resume and sound/speed for the current video.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (paused || ended) v.pause();
    else v.play().catch(() => {});
  }, [paused, ended, layers]);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = s.muted;
    v.volume = s.volume;
    v.playbackRate = s.speed;
  }, [s.muted, s.volume, s.speed, layers]);

  const hide = useCallback(() => {
    if (!cur) return;
    if (list.length <= 1) onClose();
    onHide(cur.id); // the list updates from the app, and playback stays at this spot
  }, [cur, list.length, onHide, onClose]);

  useEffect(() => {
    const sync = () => {
      const on = !!(document.fullscreenElement || document.webkitFullscreenElement);
      setNativeFull(on);
      setFull(on);
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, []);

  const fullscreen = () => {
    // iPhone: real full screen through Safari's video player (falls back to filling the page).
    if (castRef.current && !full) {
      if (castRef.current.enter()) { setCasting(true); return; }
    }
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
      return;
    }
    if (full) { setFull(false); return; } // leaving the fill-the-page version
    const el = rootRef.current;
    const req = el?.requestFullscreen || el?.webkitRequestFullscreen;
    // iPhone Safari reports full screen as unavailable (or has the method but ignores it).
    if (!req || !(document.fullscreenEnabled || document.webkitFullscreenEnabled)) { setFull(true); return; }
    const inFull = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
    try {
      Promise.resolve(req.call(el)).catch(() => setFull(true));
    } catch {
      setFull(true);
    }
    // If the browser quietly refused, fill the page instead.
    setTimeout(() => { if (!inFull()) setFull(true); }, 500);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (showSettings) return setShowSettings(false);
        if (full && !nativeFull) return setFull(false);
        if (!document.fullscreenElement) onClose();
        return;
      }
      if (isTyping(e.target)) return;
      if (e.key === ' ') { e.preventDefault(); setPaused((p) => !p); }
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key.toLowerCase() === 'h') hide();
      else if (e.key.toLowerCase() === 'f') fullscreen();
      else if (e.key.toLowerCase() === 's') setShowSettings((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, hide, onClose, showSettings, full, nativeFull]);

  // Hide controls and cursor when nothing moves (not while settings are open). A tap also wakes them.
  useEffect(() => {
    if (showSettings) { setIdle(false); return undefined; }
    let t;
    const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), 3000); };
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('pointerdown', wake);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('pointerdown', wake);
    };
  }, [showSettings]);

  const onTime = (e) => {
    const v = e.currentTarget;
    const len = Math.min(v.duration || Infinity, clipCap);
    if (Number.isFinite(len)) setVProg(Math.min(1, v.currentTime / len));
    if (v.currentTime >= clipCap && !v.dataset.done) {
      v.dataset.done = '1'; // timeupdate can fire twice before React re-renders
      next();
    }
  };

  const settingsPanel = showSettings && (
    <PlayerSettings mode={mode} s={s} update={update} slideSec={slideSec} clipCap={clipCap}
      items={items} shown={list.length} onClose={() => setShowSettings(false)} />
  );
  const gearBtn = (
    <button className={`gear-btn ${showSettings ? 'on' : ''}`} onClick={() => setShowSettings((v) => !v)}
      title="Settings (S)" aria-label="Settings">⚙</button>
  );

  // Nothing matches the "what to show" settings.
  if (!cur) {
    return (
      <div className="player" ref={rootRef}>
        <div className="the-end">
          <h2>Nothing to show</h2>
          <p className="muted">No {isPhoto ? 'photos' : 'videos'} match the “What to show” settings.</p>
          <div className="row center">
            <button className="btn primary" onClick={() => setShowSettings(true)}>⚙ Open settings</button>
            <button className="btn ghost" onClick={onClose}>Back</button>
          </div>
        </div>
        <button className="close" onClick={onClose} title="Close (Esc)">✕</button>
        {settingsPanel}
      </div>
    );
  }

  if (ended) {
    return (
      <div className="player" ref={rootRef}>
        <div className="the-end">
          <h2>That’s a wrap ✨</h2>
          <p className="muted">{list.length} {isPhoto ? 'photos' : 'videos'} from {fmtDate(Math.min(...list.map((m) => m.date)))} to {fmtDate(Math.max(...list.map((m) => m.date)))}</p>
          <div className="row center">
            <button className="btn primary" onClick={() => { setEnded(false); setI(0); }}>↺ Watch again</button>
            <button className="btn ghost" onClick={() => setShowSettings(true)}>⚙ Settings</button>
            <button className="btn ghost" onClick={onClose}>Back</button>
          </div>
        </div>
        <button className="close" onClick={onClose} title="Close (Esc)">✕</button>
        {settingsPanel}
      </div>
    );
  }

  const showCaption = s.showDate || s.showWeekday;

  return (
    <div className={`player ${idle ? 'idle' : ''} ${full ? 'full' : ''}`} ref={rootRef}>
      <div className="stage">
        {layers.map((l) => {
          const top = !l.leaving;
          return (
            <div
              key={l.id}
              className={`frame t-${s.transition} ${top ? 'enter' : 'leave'} ${l.dir < 0 ? 'back' : ''}`}
              style={{ '--d': `${s.fadeSec}s` }}
            >
              {isPhoto && s.blurBg && <img className="bg-blur" src={l.media.main} alt="" />}
              {isPhoto ? (
                <div className={`kb ${s.kenBurns ? '' : 'still'}`}
                  style={{ animationDuration: `${slideSec + 1}s`, animationPlayState: paused ? 'paused' : 'running' }}>
                  <img src={l.media.main} alt="" />
                  {s.showOverlays && l.media.overlay && <img src={l.media.overlay} alt="" />}
                </div>
              ) : (
                <div className="kb still">
                  <video
                    ref={top ? videoRef : (el) => { if (el) el.muted = true; }}
                    src={l.media.main}
                    autoPlay
                    playsInline
                    onTimeUpdate={top ? onTime : undefined}
                    onEnded={top ? next : undefined}
                    onError={top ? next : undefined}
                  />
                  {s.showOverlays && l.media.overlay && <img src={l.media.overlay} alt="" />}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {full && s.fullDate && (
        <div className="full-date">
          {s.showWeekday && `${fmtWeekday(cur.date)} · `}{fmtDate(cur.date)}
        </div>
      )}

      {showCaption && !full && (
        <div className="caption">
          {s.showWeekday && <span className="weekday">{fmtWeekday(cur.date)}</span>}
          {s.showDate && <span className="date">{fmtDate(cur.date)}</span>}
        </div>
      )}

      <div className="progress" style={{ visibility: s.showProgress ? 'visible' : 'hidden' }}>
        {isPhoto ? (
          <i key={`${cur.id}-${paused}`} className={ready && !paused ? 'run' : ''}
            style={{ animationDuration: `${slideSec}s` }} />
        ) : (
          <i style={{ width: `${vProg * 100}%` }} />
        )}
      </div>

      <div className="bottom-bar">
        <div className="controls">
          <button onClick={prev} title="Previous (←)">⏮</button>
          <button className="big" onClick={() => setPaused((p) => !p)} title="Pause (space)">{paused ? '▶' : '❚❚'}</button>
          <button onClick={next} title="Next (→)">⏭</button>
          <span className="count">{i + 1} / {list.length}</span>
          <button onClick={hide} title="Hide this forever (H)">🙈 Hide</button>
          <button onClick={fullscreen} className={full ? 'on' : ''} title={full ? 'Exit full screen (F)' : 'Full screen (F)'}
            aria-label={full ? 'Exit full screen' : 'Full screen'}>{full ? '🗗' : '⛶'}</button>
          {gearBtn}
        </div>
        <DateScrubber list={list} i={i} onSeek={seek} />
      </div>

      <button className="close" onClick={onClose} title="Close (Esc)">✕</button>
      {settingsPanel}
    </div>
  );
}
