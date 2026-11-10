import { useEffect, useMemo, useRef, useState } from 'react';
import { urlFor } from '../lib/importer.js';
import { fmtDate, fmtDuration } from '../lib/storage.js';

const STRICTNESS = [
  { label: 'Strict', value: 0.25 },
  { label: 'Balanced', value: 0.4 },
  { label: 'Relaxed', value: 0.6 },
];

function Mosaic({ photos }) {
  const [urls, setUrls] = useState([]);
  useEffect(() => {
    let alive = true;
    const pick = photos.length <= 4 ? photos : [0.15, 0.4, 0.65, 0.9].map((f) => photos[Math.floor(f * photos.length)]);
    Promise.all(pick.map((m) => urlFor(m.main))).then((u) => alive && setUrls(u.filter(Boolean)));
    return () => { alive = false; };
  }, [photos]);
  return (
    <div className="mosaic" aria-hidden style={{ gridTemplateColumns: `repeat(${Math.max(urls.length, 1)}, 1fr)` }}>
      {urls.map((u) => <img key={u} src={u} alt="" />)}
    </div>
  );
}

function Num({ label, value, onChange, min, max, step = 1, suffix, hint }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="num">
        <input
          type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <output>{hint ?? `${value}${suffix}`}</output>
      </div>
    </label>
  );
}

export default function Library({
  memories, visible, scores, hidden, isFiltered, settings, update, scan, error, onAddZips, onUnhideAll, onPlay,
}) {
  const input = useRef(null);
  const photos = useMemo(() => visible.filter((m) => m.kind === 'photo'), [visible]);
  const videos = useMemo(() => visible.filter((m) => m.kind === 'video'), [visible]);

  const counts = useMemo(() => {
    let shirtless = 0;
    let manual = 0;
    for (const m of memories) {
      if (hidden[m.id]) manual++;
      else if (scores[m.id] >= settings.threshold) shirtless++;
    }
    return { shirtless, manual, total: memories.length };
  }, [memories, hidden, scores, settings.threshold]);

  const years = useMemo(() => {
    const y = new Map();
    for (const m of memories) {
      if (isFiltered(m)) continue;
      const yr = new Date(m.date).getFullYear();
      y.set(yr, (y.get(yr) || 0) + 1);
    }
    return [...y.entries()].sort((a, b) => a[0] - b[0]);
  }, [memories, isFiltered]);

  const toggleYear = (yr) => {
    const ex = new Set(settings.excludedYears);
    ex.has(yr) ? ex.delete(yr) : ex.add(yr);
    update({ excludedYears: [...ex] });
  };

  const slideSec = settings.slideTotalMin > 0 && photos.length
    ? Math.max(0.5, (settings.slideTotalMin * 60) / photos.length)
    : settings.secPerPhoto;
  const clipCap = Math.min(
    settings.maxClipSec > 0 ? settings.maxClipSec : Infinity,
    settings.videoTotalMin > 0 && videos.length ? (settings.videoTotalMin * 60) / videos.length : Infinity,
  );

  const scanning = scan.total > 0 && scan.done < scan.total;
  const first = memories[0]?.date;
  const last = memories[memories.length - 1]?.date;

  return (
    <main className="library">
      <header className="topbar">
        <div className="brand"><span className="logo">🎞️</span> Snap Recap</div>
        <button className="btn ghost" onClick={() => input.current.click()}>+ Add more zips</button>
        <input ref={input} type="file" accept=".zip" multiple hidden
          onChange={(e) => { onAddZips(e.target.files); e.target.value = ''; }} />
      </header>

      {error && <p className="error">{error}</p>}

      <section className="stats">
        <div className="stat"><b>{memories.filter((m) => m.kind === 'photo').length}</b><span>photos</span></div>
        <div className="stat"><b>{memories.filter((m) => m.kind === 'video').length}</b><span>videos</span></div>
        <div className="stat"><b>{settings.hideShirtless ? counts.shirtless : 0}</b><span>hidden as shirtless</span></div>
        <div className="stat wide">
          <b className="range">{first ? `${fmtDate(first)} → ${fmtDate(last)}` : '—'}</b><span>date range</span>
        </div>
      </section>

      {scanning && (
        <div className="scanbar">
          <div className="scanbar-text">
            <span className="pulse" /> Checking for shirtless shots… {scan.done} / {scan.total}
            <span className="muted small"> Anything not checked yet stays hidden until it is.</span>
          </div>
          <div className="bar"><i style={{ width: `${(100 * scan.done) / scan.total}%` }} /></div>
        </div>
      )}

      <section className="modes">
        <article className="mode">
          <Mosaic photos={photos} />
          <div className="mode-body">
            <h2>Slideshow</h2>
            <p className="muted">{photos.length} photos · {fmtDuration(slideSec * photos.length)}</p>
            <Num label="Seconds per photo" min={1} max={15} step={0.5} value={settings.secPerPhoto}
              suffix="s" onChange={(v) => update({ secPerPhoto: v, slideTotalMin: 0 })} />
            <Num label="Or fit into a total time" min={0} max={60} value={settings.slideTotalMin}
              hint={settings.slideTotalMin ? `${settings.slideTotalMin} min` : 'off'}
              onChange={(v) => update({ slideTotalMin: v })} />
            <button className="btn primary" disabled={!photos.length}
              onClick={() => onPlay({ mode: 'photo', items: photos, slideSec })}>▶ Play slideshow</button>
          </div>
        </article>

        <article className="mode video">
          <div className="mode-art" aria-hidden><span>▶</span></div>
          <div className="mode-body">
            <h2>Video recap</h2>
            <p className="muted">
              {videos.length} videos{Number.isFinite(clipCap) ? ` · up to ${fmtDuration(clipCap * videos.length)}` : ''}
            </p>
            <Num label="Max length per clip" min={0} max={60} value={settings.maxClipSec}
              hint={settings.maxClipSec ? `${settings.maxClipSec}s` : 'whole clip'}
              onChange={(v) => update({ maxClipSec: v })} />
            <Num label="Total run time" min={0} max={60} value={settings.videoTotalMin}
              hint={settings.videoTotalMin ? `${settings.videoTotalMin} min` : 'no limit'}
              onChange={(v) => update({ videoTotalMin: v })} />
            <button className="btn primary" disabled={!videos.length}
              onClick={() => onPlay({ mode: 'video', items: videos, clipCap })}>▶ Play video recap</button>
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="row">
          <label className="switch">
            <input type="checkbox" checked={settings.hideShirtless}
              onChange={(e) => update({ hideShirtless: e.target.checked })} />
            <i />
            <span>Hide shirtless photos & videos <span className="muted">(abs / bare chest visible)</span></span>
          </label>
          {settings.hideShirtless && (
            <div className="seg" role="radiogroup" aria-label="Filter strictness">
              {STRICTNESS.map((s) => (
                <button key={s.label} className={settings.threshold === s.value ? 'on' : ''}
                  onClick={() => update({ threshold: s.value })}>{s.label}</button>
              ))}
            </div>
          )}
        </div>

        <div className="row">
          <span className="label">Order</span>
          <div className="seg">
            <button className={!settings.newestFirst ? 'on' : ''} onClick={() => update({ newestFirst: false })}>Oldest first</button>
            <button className={settings.newestFirst ? 'on' : ''} onClick={() => update({ newestFirst: true })}>Newest first</button>
          </div>
        </div>

        {years.length > 1 && (
          <div className="row wrap">
            <span className="label">Years</span>
            <div className="chips">
              {years.map(([yr, n]) => (
                <button key={yr} className={`chip ${settings.excludedYears.includes(yr) ? '' : 'on'}`}
                  onClick={() => toggleYear(yr)}>{yr} <span>{n}</span></button>
              ))}
            </div>
          </div>
        )}

        {counts.manual > 0 && (
          <div className="row">
            <span className="muted">{counts.manual} hidden by you with the H key</span>
            <button className="btn ghost small" onClick={onUnhideAll}>Unhide all</button>
          </div>
        )}
      </section>

      <p className="privacy">🔒 Your photos stay on this device. Tip: press <kbd>H</kbd> while playing to hide anything the filter missed.</p>
    </main>
  );
}
