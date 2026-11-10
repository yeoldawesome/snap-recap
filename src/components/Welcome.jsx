import { useRef, useState } from 'react';
import { canPickWithHandles, fromDrop, fromInput, pickZips } from '../lib/persist.js';

export default function Welcome({ importing, importInfo, error, onFiles, saved = [], onRestore, onForget }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);

  const drop = (e) => {
    e.preventDefault();
    setOver(false);
    if (!importing) fromDrop(e).then(onFiles);
  };

  const choose = async () => {
    if (importing) return;
    if (!canPickWithHandles) return input.current.click();
    const items = await pickZips();
    if (items) onFiles(items);
  };

  return (
    <main className="welcome">
      <div className="glow" aria-hidden />
      <header className="brand">
        <span className="logo">🎞️</span> Snap Recap
      </header>

      <h1>
        Your Snapchat Memories,
        <br />
        <span className="grad">played back by date.</span>
      </h1>
      <p className="lead">
        Drop in your Memories export and watch it as a slideshow or one long video recap, with the date under every
        moment.
      </p>

      {saved.length > 0 && !importing && (
        <div className="restore">
          <span>
            You have <b>{saved.length} zip{saved.length > 1 ? 's' : ''}</b> from last time.
          </span>
          <button className="btn primary" onClick={onRestore}>Reopen my memories</button>
          <button className="btn ghost small" onClick={onForget}>Forget them</button>
        </div>
      )}

      <div
        className={`drop ${over ? 'over' : ''} ${importing ? 'busy' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        onClick={choose}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && choose()}
      >
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          multiple
          hidden
          onChange={(e) => { onFiles(fromInput(e.target.files)); e.target.value = ''; }}
        />
        {importing ? (
          <>
            <div className="spinner" />
            <strong>Reading zip {Math.min(importInfo.done + 1, importInfo.total)} of {importInfo.total}…</strong>
            <span className="muted small">{importInfo.name}</span>
          </>
        ) : (
          <>
            <div className="drop-icon">⬇</div>
            <strong>Drop your Snapchat zip files here</strong>
            <span className="muted">or click to choose them. Select all the parts at once.</span>
          </>
        )}
      </div>
      {error && <p className="error">{error}</p>}

      <section className="steps">
        <div className="step">
          <b>1</b>
          <p>In Snapchat, go to <em>Settings → My Data</em>, select <em>Memories</em>, and submit the request.</p>
        </div>
        <div className="step">
          <b>2</b>
          <p>When the email arrives, download <em>all</em> the zip files.</p>
        </div>
        <div className="step">
          <b>3</b>
          <p>Drop them above. They'll still be here next time you open Snap Recap.</p>
        </div>
      </section>

      <p className="privacy">🔒 Everything runs on your device. Your photos are never uploaded anywhere.</p>
    </main>
  );
}
