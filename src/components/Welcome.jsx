import { useRef, useState } from 'react';

export default function Welcome({ importing, importInfo, error, onFiles }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);

  const drop = (e) => {
    e.preventDefault();
    setOver(false);
    if (!importing) onFiles(e.dataTransfer.files);
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
        moment. Shirtless shots are filtered out automatically.
      </p>

      <div
        className={`drop ${over ? 'over' : ''} ${importing ? 'busy' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        onClick={() => !importing && input.current.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !importing && input.current.click()}
      >
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          multiple
          hidden
          onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }}
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
          <p>Drop them above. Big exports take a few minutes to check the first time.</p>
        </div>
      </section>

      <p className="privacy">🔒 Everything runs on your device. Your photos are never uploaded anywhere.</p>
    </main>
  );
}
