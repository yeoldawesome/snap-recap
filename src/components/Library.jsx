import { useEffect, useMemo, useRef, useState } from 'react';
import { urlFor } from '../lib/importer.js';
import { clipCapFor, slideSecFor } from '../lib/settings.js';
import { canPickFolderWithHandle, canPickWithHandles, fromInput, pickFolder, pickZips } from '../lib/persist.js';
import { fmtDate, fmtDuration } from '../lib/storage.js';

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
  memories, visible, hidden, durations, isFiltered, settings, update, updateMode, error, onAddZips, onUnhideAll, onStartOver, onPlay, onFaceAlign,
}) {
  const input = useRef(null);
  const folderInput = useRef(null);
  const photos = useMemo(() => visible.filter((m) => m.kind === 'photo'), [visible]);
  const videos = useMemo(() => visible.filter((m) => m.kind === 'video'), [visible]);

  const manualHidden = useMemo(() => memories.filter((m) => hidden[m.id]).length, [memories, hidden]);

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

  const videoTime = useMemo(() => {
    let sec = 0;
    let known = 0;
    for (const m of videos) {
      const d = durations[m.id];
      if (d !== undefined) { sec += d; known++; }
    }
    return { sec, known, total: videos.length };
  }, [videos, durations]);

  const ps = settings.photo;
  const vs = settings.video;
  const slideSec = slideSecFor(ps, photos.length);
  const clipCap = clipCapFor(vs, videos.length);

  const first = memories[0]?.date;
  const last = memories[memories.length - 1]?.date;

  return (
    <main className="library">
      <header className="topbar">
        <div className="brand"><span className="logo">🎞️</span> Snap Recap</div>
        <button className="btn ghost" onClick={async () => {
          if (!canPickWithHandles) return input.current.click();
          const items = await pickZips();
          if (items) onAddZips(items);
        }}>+ Add more zips</button>
        <button className="btn ghost" title="Add every zip in a folder" onClick={async () => {
          if (!canPickFolderWithHandle) return folderInput.current.click();
          const items = await pickFolder();
          if (items) onAddZips(items);
        }}>+ Add a folder</button>
        <button className="btn ghost" onClick={() => {
          if (confirm('Close these memories and forget the saved zips? Your zip files on disk are not touched.')) onStartOver();
        }}>Start over</button>
        <input ref={input} type="file" accept=".zip" multiple hidden
          onChange={(e) => { onAddZips(fromInput(e.target.files)); e.target.value = ''; }} />
        <input ref={folderInput} type="file" webkitdirectory="" multiple hidden
          onChange={(e) => { onAddZips(fromInput(e.target.files)); e.target.value = ''; }} />
      </header>

      {error && <p className="error">{error}</p>}

      <section className="stats">
        <div className="stat"><b>{memories.filter((m) => m.kind === 'photo').length}</b><span>photos</span></div>
        <div className="stat">
          <b>{memories.filter((m) => m.kind === 'video').length}</b><span>videos</span>
          {videos.length > 0 && (
            <span className="total-time">
              <b>{fmtDuration(videoTime.sec)}</b> total
              {videoTime.known < videoTime.total && ` · measuring ${videoTime.known}/${videoTime.total}…`}
            </span>
          )}
        </div>
        <div className="stat wide">
          <b className="range">{first ? `${fmtDate(first)} → ${fmtDate(last)}` : '—'}</b><span>date range</span>
        </div>
      </section>

      <section className="modes">
        <article className="mode">
          <Mosaic photos={photos} />
          <div className="mode-body">
            <h2>Slideshow</h2>
            <p className="muted">{photos.length} photos · {fmtDuration(slideSec * photos.length)}</p>
            <Num label="Seconds per photo" min={1} max={15} step={0.5} value={ps.secPerPhoto}
              suffix="s" onChange={(v) => updateMode('photo', { secPerPhoto: v, slideTotalMin: 0 })} />
            <Num label="Or fit into a total time" min={0} max={60} value={ps.slideTotalMin}
              hint={ps.slideTotalMin ? `${ps.slideTotalMin} min` : 'off'}
              onChange={(v) => updateMode('photo', { slideTotalMin: v })} />
            <button className="btn primary" disabled={!photos.length}
              onClick={() => onPlay({ mode: 'photo', items: photos })}>▶ Play slideshow</button>
          </div>
        </article>

        <article className="mode video">
          <div className="mode-art" aria-hidden><span>▶</span></div>
          <div className="mode-body">
            <h2>Video recap</h2>
            <p className="muted">
              {videos.length} videos{Number.isFinite(clipCap) ? ` · up to ${fmtDuration(clipCap * videos.length)}` : ''}
            </p>
            <Num label="Max length per clip" min={0} max={60} value={vs.maxClipSec}
              hint={vs.maxClipSec ? `${vs.maxClipSec}s` : 'whole clip'}
              onChange={(v) => updateMode('video', { maxClipSec: v })} />
            <Num label="Total run time" min={0} max={60} value={vs.videoTotalMin}
              hint={vs.videoTotalMin ? `${vs.videoTotalMin} min` : 'no limit'}
              onChange={(v) => updateMode('video', { videoTotalMin: v })} />
            <button className="btn primary" disabled={!videos.length}
              onClick={() => onPlay({ mode: 'video', items: videos })}>▶ Play video recap</button>
          </div>
        </article>
      </section>

      <section className="tool">
        <div className="tool-icon" aria-hidden>🙂</div>
        <div className="tool-body">
          <h2>Face align</h2>
          <p className="muted">Lines up the faces in all {photos.length} photos, moving and turning each one so the eyes match, then plays them as a flipbook you can save as a video.</p>
        </div>
        <button className="btn primary" disabled={!photos.length} onClick={onFaceAlign}>Open face align →</button>
      </section>

      <section className="panel">
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

        {manualHidden > 0 && (
          <div className="row">
            <span className="muted">{manualHidden} hidden by you with the H key</span>
            <button className="btn ghost small" onClick={onUnhideAll}>Unhide all</button>
          </div>
        )}
      </section>

      <p className="privacy">🔒 Your photos stay on this device. Tip: press <kbd>H</kbd> while playing to hide something from your recaps.</p>
    </main>
  );
}
