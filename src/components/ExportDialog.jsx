import { useEffect, useMemo, useRef, useState } from 'react';
import {
  FORMATS, GIF_MAX_FPS, QUALITIES, RATES, SIZES, estimateBytes, findCodec, msPerPhoto, outSize, paintAt, plan, render,
} from '../lib/export.js';
import { fmtDuration, load, save } from '../lib/storage.js';

const DEFAULTS = { format: 'mp4', short: 1080, fps: 30, quality: 'high', name: 'face-align' };

const fmtBytes = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${(b / 1e6).toFixed(b >= 1e8 ? 0 : 1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const safeName = (n) => (n || 'face-align').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'face-align';

function Seg({ label, value, options, onChange, disabled }) {
  return (
    <div className="row">
      <span className="label">{label}</span>
      <div className="seg">
        {options.map((o) => (
          <button key={o.value} className={value === o.value ? 'on' : ''} disabled={disabled || o.disabled}
            title={o.title || ''} onClick={() => onChange(o.value)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

/**
 * Settings for saving the flipbook (format, size, frame rate, quality, file name), a preview of the
 * exact output frame, live progress while it renders, and a player for the finished file.
 */
export default function ExportDialog({ list, opts, startAt, onBusy, onClose }) {
  const [s, setS] = useState(() => ({ ...DEFAULTS, ...load('export', DEFAULTS) }));
  const [status, setStatus] = useState('setup'); // setup | rendering | done
  const [progress, setProgress] = useState({ done: 0, total: 0, t0: 0 });
  const [result, setResult] = useState(null); // { url, ext, size, w, h, ms }
  const [error, setError] = useState('');
  const [support, setSupport] = useState({}); // `${format}:${short}:${fps}` -> bool
  const canvasRef = useRef(null);
  const abortRef = useRef(null);

  const set = (patch) => setS((v) => ({ ...v, ...patch }));
  useEffect(() => save('export', s), [s]);

  const gif = s.format === 'gif';
  const fps = gif ? Math.min(s.fps, GIF_MAX_FPS) : s.fps;
  const [W, H] = outSize(opts.aspect, s.short);
  const p = plan(list.length, opts, fps);
  const bytes = estimateBytes(s, W, H, list.length, opts);
  const supportKey = `${s.format}:${s.short}:${fps}:${s.quality}`;
  const supported = support[supportKey];

  // Check the browser can encode this combination before offering to save.
  useEffect(() => {
    if (support[supportKey] !== undefined) return;
    let alive = true;
    findCodec(s.format, W, H, fps, 1).then((c) => { if (alive) setSupport((m) => ({ ...m, [supportKey]: !!c })); });
    return () => { alive = false; };
  }, [supportKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preview: the frame at the current position, drawn exactly as it will be saved.
  const previewT = useMemo(() => Math.min(startAt, Math.max(0, list.length - 1)) * msPerPhoto(opts) + opts.fadeMs,
    [startAt, list.length, opts]);
  useEffect(() => {
    if (status !== 'setup' || !list.length) return undefined;
    const c = canvasRef.current;
    c.width = W;
    c.height = H;
    const ac = new AbortController();
    paintAt(c.getContext('2d'), list, previewT, opts, ac.signal).catch(() => {});
    return () => ac.abort();
  }, [W, H, previewT, list, opts, status]);

  useEffect(() => () => {
    abortRef.current?.abort();
    onBusy(false);
  }, [onBusy]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);

  const start = async () => {
    setError('');
    setResult(null);
    const ac = new AbortController();
    abortRef.current = ac;
    setStatus('rendering');
    onBusy(true);
    const t0 = performance.now();
    setProgress({ done: 0, total: p.frames, t0 });
    try {
      const out = await render({
        list, o: opts, s, canvas: canvasRef.current, signal: ac.signal,
        onProgress: (done, total) => setProgress({ done, total, t0 }),
      });
      setResult({ url: URL.createObjectURL(out.blob), ext: out.ext, size: out.blob.size, w: W, h: H, ms: performance.now() - t0 });
      setStatus('done');
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error(e);
        setError(e.message || String(e));
      }
      setStatus('setup');
    } finally {
      abortRef.current = null;
      onBusy(false);
    }
  };

  const cancel = () => abortRef.current?.abort();
  const close = () => { if (status !== 'rendering') onClose(); };

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); if (status === 'rendering') cancel(); else onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [status, onClose]);

  const rendering = status === 'rendering';
  const elapsed = rendering ? performance.now() - progress.t0 : 0;
  const eta = rendering && progress.done > 3 ? (elapsed / progress.done) * (progress.total - progress.done) : null;
  const fileName = `${safeName(s.name)}.${result?.ext || s.format}`;

  return (
    <div className="modal" onClick={close}>
      <div className="modal-card wide export-dialog" onClick={(e) => e.stopPropagation()}>
        <header>
          <h3>{status === 'done' ? 'Your video is ready' : 'Save as video'}</h3>
          <button className="icon-btn" onClick={close} disabled={rendering} aria-label="Close">✕</button>
        </header>

        <div className="export-body">
          <div className="export-preview">
            {status === 'done' && result ? (
              result.ext === 'gif'
                ? <img src={result.url} alt="Saved GIF" style={{ aspectRatio: `${result.w} / ${result.h}` }} />
                : <video src={result.url} controls autoPlay loop playsInline style={{ aspectRatio: `${result.w} / ${result.h}` }} />
            ) : (
              <canvas ref={canvasRef} width={W} height={H} style={{ aspectRatio: `${W} / ${H}` }} />
            )}
            <small className="muted">
              {status === 'done' ? 'Preview of the saved file' : rendering ? 'Rendering…' : `Preview · ${W} × ${H}`}
            </small>
          </div>

          <div className="export-options">
            {status === 'setup' && (
              <>
                <Seg label="Format" value={s.format} onChange={(v) => set({ format: v })}
                  options={Object.entries(FORMATS).map(([value, f]) => ({ value, label: f.label }))} />
                <p className="muted small note">{FORMATS[s.format].note}</p>
                <Seg label="Size" value={s.short} onChange={(v) => set({ short: v })}
                  options={SIZES.map((z) => ({ value: z.short, label: z.label, title: outSize(opts.aspect, z.short).join(' × ') }))} />
                <Seg label="Frame rate" value={fps} onChange={(v) => set({ fps: v })}
                  options={RATES.map((r) => ({ value: r, label: `${r}`, disabled: gif && r > GIF_MAX_FPS, title: `${r} frames per second` }))} />
                {!gif && (
                  <Seg label="Quality" value={s.quality} onChange={(v) => set({ quality: v })}
                    options={Object.entries(QUALITIES).map(([value, q]) => ({ value, label: q.label }))} />
                )}
                <label className="field name-field">
                  <span className="label">File name</span>
                  <span className="name-input">
                    <input value={s.name} onChange={(e) => set({ name: e.target.value })} spellCheck={false} />
                    <small className="muted">.{s.format}</small>
                  </span>
                </label>
              </>
            )}

            <dl className="export-summary">
              <div><dt>Size</dt><dd>{W} × {H}</dd></div>
              <div><dt>Length</dt><dd>{fmtDuration(p.totalMs / 1000)}{p.totalMs < 10000 ? ` (${(p.totalMs / 1000).toFixed(1)} s)` : ''}</dd></div>
              <div><dt>Photos</dt><dd>{list.length}</dd></div>
              <div><dt>Frames</dt><dd>{p.frames} at {fps} fps</dd></div>
              <div>
                <dt>File</dt>
                <dd>{result ? fmtBytes(result.size) : `about ${fmtBytes(bytes)}`}</dd>
              </div>
            </dl>

            {status === 'setup' && p.skipped > 0 && (
              <p className="warn small">
                Each photo is on screen for {msPerPhoto(opts)} ms, shorter than one frame at {fps} fps, so about {p.skipped} photos
                won't appear. Use a higher frame rate or hold each photo longer.
              </p>
            )}
            {status === 'setup' && gif && bytes > 60e6 && (
              <p className="warn small">That's a big GIF. A smaller size or MP4 will be much lighter.</p>
            )}
            {status === 'setup' && supported === false && (
              <p className="warn small">
                {typeof VideoEncoder === 'undefined'
                  ? "This browser can't make video files. Try Chrome, Edge or a recent Safari or Firefox, or save as GIF."
                  : `This browser can't make ${FORMATS[s.format].label} at ${W} × ${H}. Try a smaller size or another format.`}
              </p>
            )}
            {error && <p className="error small">{error}</p>}

            {rendering && (
              <div className="analyze">
                <span className="small">
                  <span className="pulse" />Frame {progress.done} / {progress.total}
                  {eta !== null && ` · about ${fmtDuration(Math.max(1, eta / 1000))} left`}
                </span>
                <div className="bar"><i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div>
                <p className="muted small">Keep this tab open. It's fine if it's in the background.</p>
              </div>
            )}

            {status === 'done' && result && (
              <p className="muted small">Made in {fmtDuration(Math.max(1, result.ms / 1000))}.</p>
            )}

            <div className="row export-actions">
              {status === 'setup' && (
                <>
                  <button className="btn ghost small" onClick={onClose}>Cancel</button>
                  <button className="btn primary" disabled={!list.length || supported === false} onClick={start}>
                    ⬇ Make {FORMATS[s.format].label}
                  </button>
                </>
              )}
              {rendering && <button className="btn ghost small" onClick={cancel}>Cancel</button>}
              {status === 'done' && result && (
                <>
                  <button className="btn ghost small" onClick={() => setStatus('setup')}>Change settings</button>
                  <a className="btn primary" href={result.url} download={fileName}>⬇ Download {fileName}</a>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
