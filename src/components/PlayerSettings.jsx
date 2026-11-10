import { useMemo } from 'react';
import { DEFAULT_SETTINGS, ORDERS, TRANSITIONS, dayKey } from '../lib/settings.js';
import { fmtDuration } from '../lib/storage.js';

function Slider({ label, value, onChange, min, max, step = 1, show }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="num">
        <input type="range" min={min} max={max} step={step} value={value}
          onChange={(e) => onChange(Number(e.target.value))} />
        <output>{show(value)}</output>
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

/** "What to show": where memories came from, captions, a date range and the order. */
function WhatToShow({ mode, s, update, items, shown }) {
  const isPhoto = mode === 'photo';
  const noun = isPhoto ? 'photos' : 'videos';
  const stats = useMemo(() => {
    let snap = 0, other = 0, withCap = 0, lo = Infinity, hi = -Infinity;
    for (const m of items) {
      if (m.fromCameraRoll) other++; else snap++;
      if (m.overlay) withCap++;
      if (m.date < lo) lo = m.date;
      if (m.date > hi) hi = m.date;
    }
    return { snap, other, withCap, first: items.length ? dayKey(lo) : '', last: items.length ? dayKey(hi) : '' };
  }, [items]);
  const n = (v) => v.toLocaleString();
  const filtered = s.from || s.to || !s.showSnap || !s.showOther || s.captions !== 'any';
  // Keep the range valid, and treat an end at the edge of the memories as "no limit".
  const setRange = (from, to) => {
    let f = from ?? s.from;
    let t = to ?? s.to;
    if (f && t && f > t) { if (from != null) t = f; else f = t; }
    update({ from: f === stats.first ? '' : f, to: t === stats.last ? '' : t });
  };

  return (
    <section>
      <h4>What to show</h4>
      <p className="muted small shown-count">
        Showing <b>{n(shown)}</b> of {n(items.length)} {noun}
        {filtered && (
          <>{' · '}<button className="link" onClick={() => update({ showSnap: true, showOther: true, captions: 'any', from: '', to: '' })}>show all</button></>
        )}
      </p>
      {stats.other > 0 && (
        <>
          <Toggle label={`From Snapchat (${n(stats.snap)})`} checked={s.showSnap} onChange={(v) => update({ showSnap: v })} />
          <Toggle label={`Camera roll & other (${n(stats.other)})`} checked={s.showOther} onChange={(v) => update({ showOther: v })} />
        </>
      )}
      {stats.withCap > 0 && (
        <div className="field">
          <span>Snapchat captions & stickers</span>
          <div className="seg wrap">
            {[['any', 'All'], ['with', `With (${n(stats.withCap)})`], ['without', 'Without']].map(([v, label]) => (
              <button key={v} className={s.captions === v ? 'on' : ''} onClick={() => update({ captions: v })}>{label}</button>
            ))}
          </div>
        </div>
      )}
      <div className="field">
        <span>Dates</span>
        <div className="dates">
          <label>
            <small className="muted">From</small>
            <input type="date" value={s.from || stats.first} min={stats.first} max={s.to || stats.last}
              onChange={(e) => setRange(e.target.value || '', null)} />
          </label>
          <label>
            <small className="muted">To</small>
            <input type="date" value={s.to || stats.last} min={s.from || stats.first} max={stats.last}
              onChange={(e) => setRange(null, e.target.value || '')} />
          </label>
        </div>
        <div className="seg wrap quick-years">
          {[...new Set(items.map((m) => new Date(m.date).getFullYear()))].sort().map((y) => {
            const on = s.from === `${y}-01-01` && s.to === `${y}-12-31`;
            return (
              <button key={y} className={on ? 'on' : ''} title={`Only ${y}`}
                onClick={() => (on ? update({ from: '', to: '' }) : update({ from: `${y}-01-01`, to: `${y}-12-31` }))}>{y}</button>
            );
          })}
        </div>
      </div>
      <div className="field">
        <span>Order</span>
        <div className="seg wrap">
          {ORDERS.map((o) => (
            <button key={o.value} className={s.order === o.value ? 'on' : ''} onClick={() => update({ order: o.value })}>{o.label}</button>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function PlayerSettings({ mode, s, update, slideSec, clipCap, items, shown, onClose }) {
  const isPhoto = mode === 'photo';
  const set = (k) => (v) => update({ [k]: v });

  return (
    <aside className="settings" onClick={(e) => e.stopPropagation()} aria-label="Playback settings">
      <header>
        <h3>{isPhoto ? 'Slideshow settings' : 'Video recap settings'}</h3>
        <button className="icon-btn" onClick={onClose} title="Close settings">✕</button>
      </header>

      <WhatToShow mode={mode} s={s} update={update} items={items} shown={shown} />

      <section>
        <h4>Transition</h4>
        <div className="seg wrap">
          {TRANSITIONS.map((t) => (
            <button key={t.value} className={s.transition === t.value ? 'on' : ''}
              onClick={() => update({ transition: t.value })}>{t.label}</button>
          ))}
        </div>
        {s.transition !== 'none' && (
          <Slider label="Transition length" min={0.1} max={3} step={0.1} value={s.fadeSec}
            show={(v) => `${v.toFixed(1)}s`} onChange={set('fadeSec')} />
        )}
      </section>

      {isPhoto ? (
        <section>
          <h4>Timing</h4>
          <Slider label="On screen for" min={0.5} max={30} step={0.5} value={s.secPerPhoto}
            show={(v) => `${v}s each`} onChange={(v) => update({ secPerPhoto: v, slideTotalMin: 0 })} />
          <Slider label="Or fit everything into" min={0} max={120} value={s.slideTotalMin}
            show={(v) => (v ? `${v} min` : 'off')} onChange={set('slideTotalMin')} />
          <p className="muted small">
            {s.slideTotalMin > 0 ? `That's ${slideSec.toFixed(1)}s per photo. ` : ''}
            {shown.toLocaleString()} photos take about {fmtDuration(shown * slideSec)}.
          </p>
        </section>
      ) : (
        <section>
          <h4>Timing</h4>
          <Slider label="Play each clip for up to" min={0} max={60} value={s.maxClipSec}
            show={(v) => (v ? `${v}s` : 'whole clip')} onChange={set('maxClipSec')} />
          <Slider label="Total run time" min={0} max={120} value={s.videoTotalMin}
            show={(v) => (v ? `${v} min` : 'no limit')} onChange={set('videoTotalMin')} />
          {s.videoTotalMin > 0 && Number.isFinite(clipCap) && (
            <p className="muted small">Each clip plays for up to {clipCap.toFixed(1)}s.</p>
          )}
          <Slider label="Playback speed" min={0.5} max={2} step={0.25} value={s.speed}
            show={(v) => `${v}×`} onChange={set('speed')} />
        </section>
      )}

      {!isPhoto && (
        <section>
          <h4>Sound</h4>
          <Toggle label="Mute" checked={s.muted} onChange={set('muted')} />
          {!s.muted && (
            <Slider label="Volume" min={0} max={1} step={0.05} value={s.volume}
              show={(v) => `${Math.round(v * 100)}%`} onChange={set('volume')} />
          )}
        </section>
      )}

      <section>
        <h4>Look</h4>
        {isPhoto && <Toggle label="Slow zoom (Ken Burns)" checked={s.kenBurns} onChange={set('kenBurns')} />}
        {isPhoto && <Toggle label="Blurred photo background" checked={s.blurBg} onChange={set('blurBg')} />}
        <Toggle label="Show Snapchat captions & stickers" checked={s.showOverlays} onChange={set('showOverlays')} />
        <Toggle label="Show date" checked={s.showDate} onChange={set('showDate')} />
        <Toggle label="Show day of the week" checked={s.showWeekday} onChange={set('showWeekday')} />
        <Toggle label="Show progress bar" checked={s.showProgress} onChange={set('showProgress')} />
      </section>

      <section>
        <h4>When it ends</h4>
        <Toggle label="Loop from the start" checked={s.loop} onChange={set('loop')} />
      </section>

      <button className="btn ghost small reset" onClick={() => update(DEFAULT_SETTINGS[mode])}>
        Reset to defaults
      </button>
    </aside>
  );
}
