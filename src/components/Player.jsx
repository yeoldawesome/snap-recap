import { useCallback, useEffect, useRef, useState } from 'react';
import { urlFor } from '../lib/importer.js';
import { fmtDate, fmtWeekday } from '../lib/storage.js';

export default function Player({ mode, items, slideSec = 3, clipCap = Infinity, onHide, onClose }) {
  const [list, setList] = useState(items);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [ended, setEnded] = useState(false);
  const [media, setMedia] = useState({ id: null, main: null, overlay: null });
  const [vProg, setVProg] = useState(0);
  const [idle, setIdle] = useState(false);
  const rootRef = useRef(null);
  const videoRef = useRef(null);

  const cur = list[i];
  const ready = media.id === cur?.id;

  const next = useCallback(() => {
    setVProg(0);
    if (i + 1 < list.length) setI(i + 1);
    else setEnded(true);
  }, [i, list.length]);
  const prev = useCallback(() => { setVProg(0); setEnded(false); setI((n) => Math.max(0, n - 1)); }, []);

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

  // Photo timer.
  useEffect(() => {
    if (mode !== 'photo' || !ready || paused || ended) return;
    const t = setTimeout(next, slideSec * 1000);
    return () => clearTimeout(t);
  }, [mode, ready, paused, ended, next, slideSec, i]);

  // Pause/resume video.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (paused || ended) v.pause();
    else v.play().catch(() => {});
  }, [paused, ended, media]);

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
      if (e.key === ' ') { e.preventDefault(); setPaused((p) => !p); }
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key.toLowerCase() === 'h') hide();
      else if (e.key.toLowerCase() === 'f') fullscreen();
      else if (e.key === 'Escape' && !document.fullscreenElement) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [next, prev, hide, onClose]);

  // Hide controls and cursor when the mouse is still.
  useEffect(() => {
    let t;
    const wake = () => { setIdle(false); clearTimeout(t); t = setTimeout(() => setIdle(true), 2500); };
    wake();
    window.addEventListener('mousemove', wake);
    return () => { clearTimeout(t); window.removeEventListener('mousemove', wake); };
  }, []);

  const onTime = (e) => {
    const v = e.currentTarget;
    const len = Math.min(v.duration || Infinity, clipCap);
    if (Number.isFinite(len)) setVProg(Math.min(1, v.currentTime / len));
    if (v.currentTime >= clipCap && !v.dataset.done) {
      v.dataset.done = '1'; // timeupdate can fire twice before React re-renders
      next();
    }
  };

  if (ended) {
    return (
      <div className="player" ref={rootRef}>
        <div className="the-end">
          <h2>That’s a wrap ✨</h2>
          <p className="muted">{list.length} {mode === 'photo' ? 'photos' : 'videos'} from {fmtDate(list[0].date)} to {fmtDate(list[list.length - 1].date)}</p>
          <div className="row center">
            <button className="btn primary" onClick={() => { setEnded(false); setI(0); }}>↺ Watch again</button>
            <button className="btn ghost" onClick={onClose}>Back</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`player ${idle ? 'idle' : ''}`} ref={rootRef}>
      <div className="stage">
        {ready && (
          <div className="frame fade-in" key={cur.id}>
            {mode === 'photo' ? (
              <div className="kb" style={{ animationDuration: `${slideSec + 1}s`, animationPlayState: paused ? 'paused' : 'running' }}>
                <img src={media.main} alt="" />
                {media.overlay && <img src={media.overlay} alt="" />}
              </div>
            ) : (
              <div className="kb still">
                <video
                  ref={videoRef}
                  src={media.main}
                  autoPlay
                  playsInline
                  onTimeUpdate={onTime}
                  onEnded={next}
                  onError={next}
                />
                {media.overlay && <img src={media.overlay} alt="" />}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="caption">
        <span className="weekday">{fmtWeekday(cur.date)}</span>
        <span className="date">{fmtDate(cur.date)}</span>
      </div>

      <div className="progress">
        {mode === 'photo' ? (
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

      <button className="close" onClick={onClose} title="Close (Esc)">✕</button>
    </div>
  );
}
