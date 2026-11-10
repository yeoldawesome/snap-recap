import { DEFAULT_SETTINGS, TRANSITIONS } from '../lib/settings.js';

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

export default function PlayerSettings({ mode, s, update, slideSec, clipCap, onClose }) {
  const isPhoto = mode === 'photo';
  const set = (k) => (v) => update({ [k]: v });

  return (
    <aside className="settings" onClick={(e) => e.stopPropagation()} aria-label="Playback settings">
      <header>
        <h3>{isPhoto ? 'Slideshow settings' : 'Video recap settings'}</h3>
        <button className="icon-btn" onClick={onClose} title="Close settings">✕</button>
      </header>

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
          <Slider label="Seconds per photo" min={1} max={15} step={0.5} value={s.secPerPhoto}
            show={(v) => `${v}s`} onChange={(v) => update({ secPerPhoto: v, slideTotalMin: 0 })} />
          <Slider label="Or fit everything into" min={0} max={60} value={s.slideTotalMin}
            show={(v) => (v ? `${v} min` : 'off')} onChange={set('slideTotalMin')} />
          {s.slideTotalMin > 0 && <p className="muted small">That's {slideSec.toFixed(1)}s per photo.</p>}
        </section>
      ) : (
        <section>
          <h4>Timing</h4>
          <Slider label="Max length per clip" min={0} max={60} value={s.maxClipSec}
            show={(v) => (v ? `${v}s` : 'whole clip')} onChange={set('maxClipSec')} />
          <Slider label="Total run time" min={0} max={60} value={s.videoTotalMin}
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
