import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readBlob } from '../lib/importer.js';
import {
  ASPECTS, analyzeAll, describeAll, distanceTo, faceFor, facesOf, followingPerson, frameNow, isAnalyzed, isRef,
  manualFace, personOf, personStatus, pickOf, frameIfReady, previewNow, warmFrames, setPerson, setPick, thumbOf, toggleRef,
} from '../lib/faces.js';
import { fmtDate, fmtDuration, load, save } from '../lib/storage.js';
import { paint } from '../lib/export.js';
import ExportDialog from './ExportDialog.jsx';

const DEFAULTS = {
  aspect: '9:16',
  size: 0.3, // eye distance as a share of the frame width
  eyeY: 0.42, // where the eyes sit, from the top
  holdMs: 150, // how long each photo stays fully shown
  fadeMs: 100, // how long the crossfade into each photo takes
  showDate: true,
  overlays: false,
  loop: true,
  from: '', // first day included, 'YYYY-MM-DD' ('' = from the start)
  to: '', // last day included
};

const dayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const inRange = (m, from, to) => {
  const k = dayKey(m.date);
  return (!from || k >= from) && (!to || k <= to);
};
const LOOKAHEAD_MS = 3000; // during playback, keep this much upcoming time decoded
const MAX_LOOKAHEAD = 30;
const GRACE_MS = 150; // if a photo is still loading this long after its turn, show the quick preview instead
const SCRUB_AHEAD = 40; // previews decoded ahead in the scrub direction
// Holding an arrow key: one step, a short pause, then faster and faster.
const SCRUB_DELAY = 220; // ms
const scrubRate = (heldMs) => Math.min(90, 12 + ((heldMs - SCRUB_DELAY) / 1000) * 70); // photos per second
const FAST_PLAY_MS = 40; // below this per photo, playback uses the quick previews

/**
 * A time setting in whole milliseconds. The slider is on a curve so the low end (1, 2, 5 ms…)
 * is as easy to hit as the high end; the box takes an exact number.
 */
function MsField({ label, ms, max, onChange, zeroLabel }) {
  const STEPS = 1000;
  const toPos = (v) => (v <= 0 ? 0 : Math.round(1 + (Math.log(v) / Math.log(max)) * (STEPS - 1)));
  const fromPos = (p) => (p <= 0 ? 0 : Math.round(Math.exp(((p - 1) / (STEPS - 1)) * Math.log(max))));
  return (
    <label className="field">
      <span>{label}</span>
      <div className="num">
        <input type="range" min={0} max={STEPS} step={1} value={toPos(ms)}
          onChange={(e) => onChange(Math.max(0, fromPos(Number(e.target.value))))} />
        <span className="ms-box">
          <input type="number" min={0} max={max} step={1} value={ms} aria-label={`${label} in milliseconds`}
            onChange={(e) => {
              const v = Math.round(Number(e.target.value));
              if (Number.isFinite(v)) onChange(Math.min(max, Math.max(0, v)));
            }} />
          <small>{ms === 0 && zeroLabel ? zeroLabel : 'ms'}</small>
        </span>
      </div>
    </label>
  );
}

function Num({ label, value, onChange, min, max, step = 1, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="num">
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))} />
        <output>{hint}</output>
      </div>
    </label>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="switch toggle-row">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <i />
    </label>
  );
}

/** Lets the user choose which face to line up, mark the eyes by hand, or skip the photo. */
function FacePicker({ m, onClose, onChange }) {
  const person = personOf();
  const [url, setUrl] = useState(thumbOf(m));
  const [marking, setMarking] = useState(null); // null | [] | [[x,y]]
  const found = facesOf(m);
  const pick = pickOf(m);
  const chosen = faceFor(m);

  useEffect(() => {
    let u;
    let alive = true;
    // Show a sharper copy than the thumbnail.
    readBlob(m.main).then((b) => {
      if (!alive) return;
      u = URL.createObjectURL(b);
      setUrl(u);
    });
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [m]);

  const choose = (v) => { setPick(m, v); onChange(); };
  const chosenIdx = found.indexOf(chosen);

  const onImgClick = (e) => {
    if (!marking) return;
    const r = e.currentTarget.getBoundingClientRect();
    const pt = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
    if (!marking.length) return setMarking([pt]);
    const [a] = marking;
    const [l, rr] = a[0] <= pt[0] ? [a, pt] : [pt, a];
    choose(manualFace(l, rr));
    setMarking(null);
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>{fmtDate(m.date)}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <p className="muted small">
          {marking
            ? marking.length ? 'Now click the other eye.' : 'Click the center of one eye.'
            : found.length > 1 ? `Click the face to line up.${followingPerson() && pick === undefined && !chosen ? ' None of these looked like the chosen person.' : ''}`
              : found.length ? 'This face is used for lining up.' : 'No face found. You can mark the eyes yourself.'}
        </p>
        <div className={`picker ${marking ? 'marking' : ''}`}>
          <img src={url} alt="" onClick={onImgClick} />
          {!marking && found.map((f, idx) => {
            const on = chosen === f;
            return (
              <button key={idx} className={`face-box ${on ? 'on' : ''}`}
                style={{
                  left: `${f.box[0] * 100}%`, top: `${f.box[1] * 100}%`,
                  width: `${(f.box[2] - f.box[0]) * 100}%`, height: `${(f.box[3] - f.box[1]) * 100}%`,
                }}
                // In person mode the matching face is picked automatically, so a click is always a manual choice.
                onClick={() => choose(idx === 0 && !followingPerson() ? undefined : idx)}
                aria-label={`Face ${idx + 1}`} />
            );
          })}
          {!marking && chosen?.manual && [chosen.l, chosen.r].map((p, k) => (
            <i key={k} className="eye-dot" style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` }} />
          ))}
          {marking?.map((p, k) => (
            <i key={k} className="eye-dot" style={{ left: `${p[0] * 100}%`, top: `${p[1] * 100}%` }} />
          ))}
        </div>
        <div className="row center">
          {marking
            ? <button className="btn ghost small" onClick={() => setMarking(null)}>Cancel</button>
            : <button className="btn ghost small" onClick={() => setMarking([])}>👁 Mark eyes by hand</button>}
          {pick === -1
            ? <button className="btn ghost small" onClick={() => choose(undefined)}>Use this photo again</button>
            : <button className="btn ghost small" onClick={() => choose(-1)}>Leave this photo out</button>}
          {person.on && chosenIdx >= 0 && (
            <button className="btn ghost small" onClick={() => { toggleRef(m, chosenIdx); onChange(); }}>
              {isRef(m, chosenIdx) ? '★ Remove as an example of them' : '☆ Use as an example of them'}
            </button>
          )}
          {pick !== undefined && pick !== -1 && (
            <button className="btn ghost small" onClick={() => choose(undefined)}>Reset</button>
          )}
        </div>
      </div>
    </div>
  );
}

/** A thumbnail cropped to one face. */
function FaceCrop({ m, f }) {
  const [ar, setAr] = useState(0); // photo width / height, known once the thumbnail loads
  let style = { opacity: 0 };
  if (ar) {
    const [x0, y0, x1, y1] = f.box;
    const side = Math.max((x1 - x0) * ar, y1 - y0) * 1.3;
    const cx = ((x0 + x1) / 2) * ar;
    const cy = (y0 + y1) / 2;
    style = {
      width: `${(ar / side) * 100}%`, height: `${(1 / side) * 100}%`,
      left: `${(-(cx - side / 2) / side) * 100}%`, top: `${(-(cy - side / 2) / side) * 100}%`,
    };
  }
  return <img src={thumbOf(m)} alt="" loading="lazy" style={style}
    onLoad={(e) => setAr(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight)} />;
}

/**
 * Pick a few faces of the person to follow. Once there's an example, the faces that look most
 * like them are listed first, so adding more is quick.
 */
function PersonPicker({ photos, rev, describing, onClose, onChange }) {
  const PAGE = 120;
  const [limit, setLimit] = useState(PAGE);
  const person = personOf();
  const all = useMemo(() => {
    const out = [];
    for (const m of photos) {
      if (!isAnalyzed(m)) continue;
      facesOf(m).forEach((f, i) => out.push({ m, f, i, key: `${m.id}:${i}` }));
    }
    return out;
  }, [photos, rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = all.filter((x) => isRef(x.m, x.i));
  const rest = useMemo(() => {
    const others = all.filter((x) => !isRef(x.m, x.i));
    if (followingPerson()) {
      // Most alike first; faces not described yet go last.
      const d = new Map(others.map((x) => [x.key, distanceTo(x.f) ?? Infinity]));
      return others.sort((a, b) => d.get(a.key) - d.get(b.key));
    }
    // No example yet: the biggest faces first, since they're the easiest to recognize.
    const size = (f) => (f.box[2] - f.box[0]) * (f.box[3] - f.box[1]);
    return others.sort((a, b) => size(b.f) - size(a.f));
  }, [all, rev, person.refs]); // eslint-disable-line react-hooks/exhaustive-deps

  const tile = (x, on) => (
    <button key={x.key} className={`face-tile ${on ? 'on' : ''}`} title={fmtDate(x.m.date)}
      onClick={() => { toggleRef(x.m, x.i); onChange(); }}>
      <FaceCrop m={x.m} f={x.f} />
    </button>
  );

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>Who should it follow?</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </header>
        <p className="muted small">
          Click 3 to 5 faces of the person, ideally from different times and angles. Only photos with them in it are kept,
          and their face is the one lined up.
          {describing && ' Still learning faces, so the suggestions get better as it goes.'}
        </p>
        <div className="face-scroll">
          {chosen.length > 0 && (
            <>
              <h4 className="small">Chosen ({chosen.length})</h4>
              <div className="face-grid">{chosen.map((x) => tile(x, true))}</div>
              <h4 className="small">{followingPerson() ? 'Most alike' : 'Other faces'}</h4>
            </>
          )}
          <div className="face-grid">{rest.slice(0, limit).map((x) => tile(x, false))}</div>
          {rest.length > limit && (
            <div className="row center">
              <button className="btn ghost small" onClick={() => setLimit((l) => l + PAGE)}>Show more</button>
            </div>
          )}
        </div>
        <div className="row center">
          <button className="btn primary small" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

const Grid = memo(function Grid({ items, onPick }) {
  return (
    <div className="align-grid">
      {items.map((m) => {
        const f = faceFor(m);
        const n = facesOf(m).length;
        return (
          <button key={m.id} className={`thumb ${f ? '' : 'off'}`} onClick={() => onPick(m)} title={fmtDate(m.date)}>
            {thumbOf(m) && <img src={thumbOf(m)} alt="" loading="lazy" />}
            {!f && <span className="badge">{pickOf(m) === -1 ? 'left out' : ({ other: 'not them', checking: 'checking…' }[personStatus(m)] || 'no face')}</span>}
            {f && !f.manual && n > 1 && <span className="badge">{n} faces</span>}
            {f?.manual && <span className="badge">by hand</span>}
          </button>
        );
      })}
    </div>
  );
});

export default function FaceAlign({ photos, onClose }) {
  const [opts, setOpts] = useState(() => {
    const o = { ...DEFAULTS, ...load('align', DEFAULTS) };
    // Earlier versions stored seconds.
    if (o.holdSec !== undefined) { o.holdMs = Math.round(o.holdSec * 1000); delete o.holdSec; }
    if (o.fadeSec !== undefined) { o.fadeMs = Math.round(o.fadeSec * 1000); delete o.fadeSec; }
    return o;
  });
  const [progress, setProgress] = useState({ done: 0, total: photos.length });
  const [error, setError] = useState('');
  const [rev, setRev] = useState(0); // bumps when faces or picks change
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [exporting, setExporting] = useState(false); // the save dialog is open
  const [picking, setPicking] = useState(null);
  const [person, setPersonState] = useState(personOf);
  const [choosingPerson, setChoosingPerson] = useState(false);
  const [describe, setDescribe] = useState({ done: 0, total: 0 });
  const updatePerson = (patch) => { setPerson(patch); setPersonState(personOf()); setRev((r) => r + 1); };
  const refsChanged = useCallback(() => { setPersonState(personOf()); setRev((r) => r + 1); }, []);
  const canvasRef = useRef(null);

  const set = (patch) => setOpts((o) => ({ ...o, ...patch }));
  // Change one end of the date range (null leaves it alone); an end at the edge of the photos means "no limit".
  const setRange = (from, to) => setOpts((o) => {
    let f = from === null ? o.from : from || '';
    let t = to === null ? o.to : to || '';
    if (f && t && f > t) { if (from !== null) t = f; else f = t; }
    return { ...o, from: f === span[0] ? '' : f, to: t === span[1] ? '' : t };
  });
  useEffect(() => save('align', opts), [opts]);

  // Find faces in every photo (results are remembered, so a second visit is quick).
  useEffect(() => {
    let last = 0;
    return analyzeAll(photos, (done, total) => {
      setProgress({ done, total });
      const now = performance.now();
      if (done === total || now - last > 400) { last = now; setRev((r) => r + 1); }
    }, (e) => setError(`Couldn't load the face finder: ${e.message || e}`));
  }, [photos]);

  const analyzing = progress.done < progress.total;

  // Following one person needs face descriptions; work them out once all faces are found.
  useEffect(() => {
    if (!person.on || analyzing) return undefined;
    let last = 0;
    return describeAll(photos, (done, total) => {
      setDescribe({ done, total });
      const now = performance.now();
      if (done === total || now - last > 500) { last = now; setRev((r) => r + 1); }
    }, (e) => setError(`Couldn't load the face recognizer: ${e.message || e}`));
  }, [photos, person.on, analyzing]);
  const describing = person.on && describe.done < describe.total;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const analyzed = useMemo(() => photos.filter((m) => isAnalyzed(m) && inRange(m, opts.from, opts.to)), [photos, rev, opts.from, opts.to]);
  const list = useMemo(() => analyzed.filter(faceFor), [analyzed, rev]);
  // The full span of the photos, for the date pickers' limits.
  const span = useMemo(() => {
    if (!photos.length) return ['', ''];
    let lo = Infinity, hi = -Infinity;
    for (const m of photos) { if (m.date < lo) lo = m.date; if (m.date > hi) hi = m.date; }
    return [dayKey(lo), dayKey(hi)];
  }, [photos]);
  const outside = useMemo(() => (opts.from || opts.to ? photos.filter((m) => !inRange(m, opts.from, opts.to)).length : 0),
    [photos, opts.from, opts.to]);
  const noFace = analyzed.length - list.length;

  // Playback state lives in a ref so the draw loop doesn't restart on every change.
  const st = useRef({ i: 0, prev: null, t0: 0, dirty: true, playing: false, rendering: false });
  const live = useRef({ list, opts });
  live.current = { list, opts };
  useEffect(() => { st.current.dirty = true; }, [opts, list]);
  useEffect(() => { st.current.playing = playing; st.current.t0 = performance.now(); }, [playing]);
  useEffect(() => {
    const s = st.current;
    if (s.i >= list.length) { s.i = Math.max(0, list.length - 1); s.prev = null; setIdx(s.i); }
  }, [list]);

  const seek = useCallback((n) => {
    const s = st.current;
    const len = live.current.list.length;
    if (!len) return;
    s.i = (n + len) % len;
    s.prev = null;
    s.t0 = performance.now();
    s.dirty = true;
    setIdx(s.i);
  }, []);

  // While a video is being saved, the on-screen player stands still so it doesn't compete for photos.
  const setRendering = useCallback((on) => { st.current.rendering = on; st.current.dirty = true; }, []);

  // Draw loop.
  useEffect(() => {
    const c = canvasRef.current;
    const ctx = c.getContext('2d');
    let raf;
    const tick = (now) => {
      raf = requestAnimationFrame(tick);
      const s = st.current;
      if (s.rendering) return;
      const { list: fl, opts: o } = live.current;
      const [W, H] = ASPECTS[o.aspect] || ASPECTS['9:16'];
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; s.dirty = true; }
      if (!fl.length) {
        if (s.dirty) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); s.dirty = false; }
        return;
      }
      // Holding an arrow key scrubs; steps are counted with an accumulator so speed isn't tied to frame rate.
      if (s.scrub) {
        const held = now - s.scrub.start;
        if (held > SCRUB_DELAY) {
          s.scrub.acc += (scrubRate(held) * (now - s.scrub.last)) / 1000;
          const steps = Math.floor(s.scrub.acc);
          if (steps) {
            s.scrub.acc -= steps;
            s.i = (((s.i + steps * s.scrub.dir) % fl.length) + fl.length) % fl.length;
            s.prev = null;
            s.dirty = true;
            setIdx(s.i);
          }
        }
        s.scrub.last = now;
      }
      const fadeMs = o.fadeMs;
      const dur = Math.max(1, o.holdMs + o.fadeMs); // ms per photo
      const fastPlay = s.playing && dur < FAST_PLAY_MS;
      const dir = s.scrubDir || 1;
      if (s.scrub || s.dragging || fastPlay) {
        const ahead = fastPlay ? 150 : SCRUB_AHEAD;
        for (let k = 1; k <= ahead; k++) previewNow(fl[(((s.i + k * dir) % fl.length) + fl.length) % fl.length]);
      } else {
        const ahead = Math.min(MAX_LOOKAHEAD, fl.length - 1, Math.max(4, Math.ceil(LOOKAHEAD_MS / dur)));
        const next = [];
        for (let k = 1; k <= ahead; k++) next.push(fl[(s.i + k) % fl.length]);
        frameNow(fl[s.i], o.overlays); // the photo on screen always comes first
        warmFrames(next, o.overlays);
        // Quick previews too, so a slow photo never freezes playback.
        for (let k = 1; k <= Math.min(ahead, 8); k++) previewNow(next[k - 1]);
      }

      if (s.playing && now - s.t0 >= dur) {
        // Faster than the screen refreshes: skip ahead by however many photos' time has passed.
        let steps = Math.max(1, Math.floor((now - s.t0) / dur));
        if (!o.loop && s.i + steps >= fl.length) steps = fl.length - 1 - s.i;
        const n = (s.i + steps) % fl.length;
        // Normally wait for the sharp photo; if it's late, carry on with the preview (it sharpens once loaded).
        const late = now - s.t0 >= dur + GRACE_MS;
        const ready = fastPlay
          ? (frameIfReady(fl[n], o.overlays) || previewNow(fl[n]))
          : (frameNow(fl[n], o.overlays) || (late && previewNow(fl[n])));
        if (steps <= 0) {
          s.playing = false;
          setPlaying(false);
        } else if (ready) {
          // Only move on once the next photo is decoded, so playback never shows a gap.
          s.prev = fl[s.i];
          s.i = n;
          // Keep the beat exact, but don't try to catch up after waiting on a slow photo.
          s.t0 = Math.max(s.t0 + steps * dur, now - dur);
          s.dirty = true;
          setIdx(s.i);
        }
      }

      const cur = fl[s.i];
      // While scrubbing, use the full frame only if it's already decoded; otherwise the quick preview.
      // Once scrubbing stops, the full frame loads and replaces the preview.
      const fast = s.scrub || s.dragging || fastPlay;
      const full = fast ? frameIfReady(cur, o.overlays) : frameNow(cur, o.overlays);
      const frame = full || previewNow(cur);
      if (!frame) return;
      if (s.lowRes && full) s.dirty = true; // swap the preview for the sharp copy
      s.lowRes = !full;
      const t = fadeMs > 0 && s.prev ? Math.min(1, (now - s.t0) / fadeMs) : 1;
      const fade = t * t * (3 - 2 * t); // ease in and out
      if (!s.dirty && t >= 1 && !s.fading) return;
      s.fading = t < 1;
      s.dirty = false;

      const prev = t < 1 ? s.prev : null;
      paint(ctx, cur, frame, prev, prev && (frameIfReady(prev, o.overlays) || previewNow(prev)), fade, o);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      const onSlider = tag === 'INPUT' && e.target.type === 'range';
      if (e.key !== 'Escape' && !(onSlider && e.key.startsWith('Arrow')) && ['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
      if (e.key === 'Escape') {
        if (picking) setPicking(null);
        else if (choosingPerson) setChoosingPerson(false);
        else if (!exporting) onClose();
        return;
      }
      if (picking || choosingPerson || exporting) return;
      if (e.key === ' ') { e.preventDefault(); togglePlayRef.current(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (e.repeat) return; // the draw loop handles holding the key
        const dir = e.key === 'ArrowRight' ? 1 : -1;
        const s = st.current;
        setPlaying(false);
        seek(s.i + dir);
        const now = performance.now();
        s.scrub = { dir, start: now, last: now, acc: 0 };
        s.scrubDir = dir;
      }
    };
    const stopScrub = (e) => {
      const s = st.current;
      if (!e || e.type === 'blur' || (s.scrub && e.key === (s.scrub.dir > 0 ? 'ArrowRight' : 'ArrowLeft'))) {
        if (s.scrub) s.dirty = true;
        s.scrub = null;
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', stopScrub);
    window.addEventListener('blur', stopScrub);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', stopScrub);
      window.removeEventListener('blur', stopScrub);
    };
  }, [picking, choosingPerson, exporting, onClose, seek]);
  const togglePlayRef = useRef(null);

  const cur = list[idx];
  const busy = exporting;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const pickPhoto = useCallback((m) => { if (!busyRef.current) setPicking(m); }, []);
  const togglePlay = () => {
    if (!playing && !opts.loop && idx >= list.length - 1) seek(0);
    setPlaying(!playing);
  };
  togglePlayRef.current = togglePlay;
  const [W, H] = ASPECTS[opts.aspect] || ASPECTS['9:16'];

  return (
    <main className="library align">
      <header className="topbar">
        <button className="btn ghost small" onClick={onClose} disabled={busy}>← Back</button>
        <div className="brand"><span className="logo">🙂</span> Face align</div>
      </header>

      <p className="muted lead-sm">
        Every photo is moved, turned and resized so the faces line up in the same spot, then played like a flipbook.
        Click a photo below to pick a different face, mark the eyes yourself, or leave it out.
        Set <b>Who</b> to <b>One person</b> to keep only the photos of someone you choose.
      </p>

      {error && <p className="error">{error}</p>}

      {analyzing && (
        <div className="analyze">
          <span><span className="pulse" />Finding faces… {progress.done} / {progress.total}</span>
          <div className="bar"><i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div>
        </div>
      )}

      <section className="align-main">
        <div className="align-stage">
          <div className="canvas-wrap" style={{ aspectRatio: `${W} / ${H}` }}>
            <canvas ref={canvasRef} width={W} height={H} />
            {!list.length && (
              <div className="canvas-empty muted">
                {analyzing || !progress.total ? 'Looking for faces…'
                  : describing ? 'Looking for them…'
                    : followingPerson() ? 'No photos matched. Try a looser match or more examples.' : 'No faces found in these photos.'}
              </div>
            )}
          </div>
          <div className="align-controls">
            <button className="icon-btn" disabled={busy || !list.length} title="Previous (←)"
              onClick={() => { setPlaying(false); seek(idx - 1); }}>⏮</button>
            <button className="icon-btn play" disabled={busy || !list.length} title="Play / pause (space)"
              onClick={togglePlay}>{playing ? '❚❚' : '▶'}</button>
            <button className="icon-btn" disabled={busy || !list.length} title="Next (→)"
              onClick={() => { setPlaying(false); seek(idx + 1); }}>⏭</button>
            <input type="range" min={0} max={Math.max(0, list.length - 1)} value={Math.min(idx, Math.max(0, list.length - 1))}
              disabled={busy || !list.length} aria-label="Frame"
              onPointerDown={() => { st.current.dragging = true; }}
              onPointerUp={() => { st.current.dragging = false; st.current.dirty = true; }}
              onPointerCancel={() => { st.current.dragging = false; st.current.dirty = true; }}
              onChange={(e) => {
                setPlaying(false);
                const n = Number(e.target.value);
                st.current.scrubDir = n >= st.current.i ? 1 : -1;
                seek(n);
              }} />
            <span className="count">{list.length ? idx + 1 : 0} / {list.length}</span>
          </div>
          {cur && (
            <p className="muted small center">
              {fmtDate(cur.date)} · <button className="link" disabled={busy} onClick={() => setPicking(cur)}>adjust this photo</button>
              {' · '}<button className="link" disabled={busy} onClick={() => setRange(dayKey(cur.date), null)}>start here</button>
              {' · '}<button className="link" disabled={busy} onClick={() => setRange(null, dayKey(cur.date))}>end here</button>
            </p>
          )}
          <p className="muted small center">Hold <kbd>←</kbd> <kbd>→</kbd> to scrub fast · <kbd>Space</kbd> play / pause</p>
        </div>

        <aside className="panel align-settings">
          <div className="stack">
            <div className="row">
              <span className="label">Who</span>
              <div className="seg">
                <button className={person.on ? '' : 'on'} disabled={busy} onClick={() => updatePerson({ on: false })}>Everyone</button>
                <button className={person.on ? 'on' : ''} disabled={busy} onClick={() => {
                  updatePerson({ on: true });
                  if (!person.refs.length) setChoosingPerson(true);
                }}>One person</button>
              </div>
            </div>
            {person.on && (
              <>
                <p className="muted small note">
                  {person.refs.length
                    ? `Following the person in your ${person.refs.length} example${person.refs.length === 1 ? '' : 's'}. `
                    : 'Pick a few photos of the person to follow. '}
                  <button className="link" disabled={busy} onClick={() => setChoosingPerson(true)}>
                    {person.refs.length ? 'change' : 'choose them'}
                  </button>
                </p>
                {describing && (
                  <div className="analyze">
                    <span className="small"><span className="pulse" />Learning faces… {describe.done} / {describe.total}</span>
                    <div className="bar"><i style={{ width: `${(describe.done / Math.max(1, describe.total)) * 100}%` }} /></div>
                  </div>
                )}
                <Num label="Match" min={0.35} max={0.7} step={0.01} value={person.tolerance}
                  hint={person.tolerance < 0.45 ? 'strict' : person.tolerance < 0.56 ? 'normal' : 'loose'}
                  onChange={(v) => updatePerson({ tolerance: v })} />
              </>
            )}
          </div>
          <div className="row">
            <span className="label">Shape</span>
            <div className="seg">
              {Object.keys(ASPECTS).map((a) => (
                <button key={a} className={opts.aspect === a ? 'on' : ''} disabled={busy} onClick={() => set({ aspect: a })}>{a}</button>
              ))}
            </div>
          </div>
          <div className="stack range">
            <span className="label">Dates</span>
            <div className="dates">
              <label>
                <small className="muted">From</small>
                <input type="date" value={opts.from || span[0]} min={span[0]} max={opts.to || span[1]} disabled={busy}
                  onChange={(e) => setRange(e.target.value, null)} />
              </label>
              <label>
                <small className="muted">To</small>
                <input type="date" value={opts.to || span[1]} min={opts.from || span[0]} max={span[1]} disabled={busy}
                  onChange={(e) => setRange(null, e.target.value)} />
              </label>
            </div>
            {(opts.from || opts.to) && (
              <p className="muted small note">
                {outside} photo{outside === 1 ? '' : 's'} outside these dates left out ·{' '}
                <button className="link" disabled={busy} onClick={() => set({ from: '', to: '' })}>use all dates</button>
              </p>
            )}
          </div>
          <div className="stack">
            <Num label="Face size" min={0.1} max={0.6} step={0.01} value={opts.size}
              hint={`${Math.round(opts.size * 100)}%`} onChange={(v) => set({ size: v })} />
            <Num label="Eye height" min={0.2} max={0.7} step={0.01} value={opts.eyeY}
              hint={`${Math.round(opts.eyeY * 100)}%`} onChange={(v) => set({ eyeY: v })} />
            <MsField label="Hold each photo" ms={opts.holdMs} max={5000} onChange={(v) => set({ holdMs: v })} />
            <MsField label="Transition length" ms={opts.fadeMs} max={3000} zeroLabel="cut"
              onChange={(v) => set({ fadeMs: v })} />
            {opts.holdMs + opts.fadeMs < 33 && (
              <p className="muted small note">
                Under about 33 ms per photo, your screen and saved videos can't show every photo, so some are skipped.
              </p>
            )}
            <Toggle label="Show date" checked={opts.showDate} onChange={(v) => set({ showDate: v })} />
            <Toggle label="Snapchat captions" checked={opts.overlays} onChange={(v) => set({ overlays: v })} />
            <Toggle label="Loop" checked={opts.loop} onChange={(v) => set({ loop: v })} />
          </div>
          <div className="row export">
            <button className="btn primary" disabled={!list.length || analyzing || describing}
              title={analyzing || describing ? 'Wait until all faces are found' : ''}
              onClick={() => { setPlaying(false); setExporting(true); }}>⬇ Save as video…</button>
            {list.length > 0 && (
              <span className="muted small">
                about {fmtDuration((list.length * Math.max(1, opts.holdMs + opts.fadeMs)) / 1000)}
              </span>
            )}
          </div>
        </aside>
      </section>

      <section className="align-grid-head">
        <h3>Photos</h3>
        <span className="muted small">
          {list.length} lined up{noFace > 0 ? ` · ${noFace} ${followingPerson() ? 'without them' : 'without a face'} or left out` : ''}
        </span>
      </section>
      <Grid items={analyzed} rev={rev} onPick={pickPhoto} />

      <p className="privacy">🔒 Faces are found on this device. Your photos are never uploaded.</p>

      {exporting && (
        <ExportDialog list={list} opts={opts} startAt={idx} onBusy={setRendering} onClose={() => setExporting(false)} />
      )}

      {choosingPerson && (
        <PersonPicker photos={photos} rev={rev} describing={describing}
          onClose={() => setChoosingPerson(false)} onChange={refsChanged} />
      )}

      {picking && (
        <FacePicker m={picking} onClose={() => setPicking(null)} onChange={() => setRev((r) => r + 1)} />
      )}
    </main>
  );
}
