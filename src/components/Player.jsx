import { useCallback, useEffect, useRef, useState } from 'react';
import { urlFor } from '../lib/importer.js';
import { fmtDate, fmtWeekday } from '../lib/storage.js';
import { clipCapFor, slideSecFor } from '../lib/settings.js';
import PlayerSettings from './PlayerSettings.jsx';

const isTyping = (t) => t?.closest?.('.settings') || ['INPUT', 'SELECT', 'TEXTAREA'].includes(t?.tagName);

export default function Player({ mode, items, settings: s, update, onHide, onClose }) {
  const [list, setList] = useState(items);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [ended, setEnded] = useState(false);
  const [media, setMedia] = useState({ id: null, main: null, overlay: null });
  const [layers, setLayers] = useState([]); // on-screen frames; the last one is current, earlier ones are fading out
  const [vProg, setVProg] = useState(0);
  const [idle, setIdle] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const rootRef = useRef(null);
  const videoRef = useRef(null);
  const dirRef = useRef(1);

  const isPhoto = mode === 'photo';
  const slideSec = slideSecFor(s, list.length);
  const clipCap = clipCapFor(s, list.length);
  const cur = list[i];
  const ready = media.id === cur?.id;

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

  // Load the current item; preload the next one.
  useEffect(() => {
    if (!cur) return;
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
    if (!layers.some((l) => l.leaving)) return;
    const t = setTimeout(() => setLayers((ls) => ls.filter((l) => !l.leaving)), s.fadeSec * 1000 + 80);
    return () => clearTimeout(t);
  }, [layers, s.fadeSec]);

  // Photo timer.
  useEffect(() => {
    if (!isPhoto || !ready || paused || ended) return;
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
    onHide(cur.id);
    const nl = list.filter((m) => m.id !== cur.id);
    if (!nl.length) return onClose();
    setList(nl);
    setI((n) => Math.min(n, nl.length - 1));
  }, [cur, list, onHide, onClose]);

  const fullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else rootRef.current?.requestFullscreen?.();
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (showSettings) return setShowSettings(false);
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
  }, [next, prev, hide, onClose, showSettings]);

  // Hide controls and cursor when the mouse is still (not while settings are open).
  useEffect(() => {
    if (showSettings) { setIdle(false); return; }
    let t;
    const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), 2500); };
    wake();
    window.addEventListener('mousemove', wake);
    return () => { clearTimeout(t); window.removeEventListener('mousemove', wake); };
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
      onClose={() => setShowSettings(false)} />
  );
  const gear = (
    <button className={`gear ${showSettings ? 'on' : ''}`} onClick={() => setShowSettings((v) => !v)}
      title="Settings (S)" aria-label="Settings">⚙</button>
  );

  if (ended) {
    return (
      <div className="player" ref={rootRef}>
        <div className="the-end">
          <h2>That’s a wrap ✨</h2>
          <p className="muted">{list.length} {isPhoto ? 'photos' : 'videos'} from {fmtDate(list[0].date)} to {fmtDate(list[list.length - 1].date)}</p>
          <div className="row center">
            <button className="btn primary" onClick={() => { setEnded(false); setI(0); }}>↺ Watch again</button>
            <button className="btn ghost" onClick={onClose}>Back</button>
          </div>
        </div>
        {gear}
        {settingsPanel}
      </div>
    );
  }

  const showCaption = s.showDate || s.showWeekday;

  return (
    <div className={`player ${idle ? 'idle' : ''}`} ref={rootRef}>
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

      {showCaption && (
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

      <div className="controls">
        <button onClick={prev} title="Previous (←)">⏮</button>
        <button className="big" onClick={() => setPaused((p) => !p)} title="Pause (space)">{paused ? '▶' : '❚❚'}</button>
        <button onClick={next} title="Next (→)">⏭</button>
        <span className="count">{i + 1} / {list.length}</span>
        <button onClick={hide} title="Hide this forever (H)">🙈 Hide</button>
        <button onClick={fullscreen} title="Fullscreen (F)">⛶</button>
      </div>

      {gear}
      <button className="close" onClick={onClose} title="Close (Esc)">✕</button>
      {settingsPanel}
    </div>
  );
}
