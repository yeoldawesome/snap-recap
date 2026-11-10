import { useRef, useState } from 'react';
import { canPickFolderWithHandle, canPickWithHandles, fromDrop, fromInput, pickFolder, pickZips } from '../lib/persist.js';

// ---- the step-by-step guide's pictures ----
// Each step shows public/guide/step-N.png if it exists (a real screenshot), and a drawn phone otherwise.

function Phone({ children, label }) {
  return (
    <div className="phone" role="img" aria-label={label}>
      <div className="phone-notch" />
      <div className="phone-screen">{children}</div>
    </div>
  );
}

const Row = ({ icon, text, hot, toggle, on }) => (
  <div className={`ph-row ${hot ? 'hot' : ''}`}>
    {icon && <span className="ph-ico">{icon}</span>}
    <span className="ph-text">{text}</span>
    {toggle ? <span className={`ph-toggle ${on ? 'on' : ''}`}><i /></span> : <span className="ph-chev">›</span>}
  </div>
);

const MOCKS = {
  1: (
    <Phone label="Snapchat profile screen with the settings gear in the top right corner">
      <div className="ph-top"><span className="ph-avatar sm" /><span className="ph-spacer" /><span className="ph-gear hot">⚙</span></div>
      <div className="ph-profile"><span className="ph-avatar" /><b>Your name</b><small>your_username</small></div>
      <div className="ph-card" /><div className="ph-card short" />
      <span className="ph-tap" style={{ right: '9%', top: '7%' }} />
    </Phone>
  ),
  2: (
    <Phone label="Settings list scrolled down to Privacy Controls, with My Data highlighted">
      <div className="ph-title">Settings</div>
      <small className="ph-section">PRIVACY CONTROLS</small>
      <Row icon="👁" text="Clear Data" />
      <Row icon="🔒" text="Blocked" />
      <Row icon="📦" text="My Data" hot />
      <Row icon="📄" text="Privacy Policy" />
    </Phone>
  ),
  3: (
    <Phone label="My Data screen with Export your Memories switched on">
      <div className="ph-title">My Data</div>
      <small className="ph-section">SELECT DATA TO INCLUDE</small>
      <Row text="Export your Memories" toggle on hot />
      <Row text="Export JSON files" toggle />
      <Row text="Chat media" toggle />
      <div className="ph-btn">Next</div>
    </Phone>
  ),
  4: (
    <Phone label="Date range set to All time, with the Submit button">
      <div className="ph-title">Date range</div>
      <div className="ph-choice">○ Last 30 days</div>
      <div className="ph-choice on hot">● All time</div>
      <small className="ph-section">SEND TO</small>
      <div className="ph-field">you@email.com</div>
      <div className="ph-btn hot">Submit</div>
    </Phone>
  ),
  5: (
    <Phone label="An email saying your Snapchat data is ready, with a link to download it">
      <div className="ph-title">Inbox</div>
      <div className="ph-mail hot">
        <b>Your data is ready</b>
        <small>Your requested data is ready to download. Click here to…</small>
      </div>
      <div className="ph-mail dim"><b>Newsletter</b><small>…</small></div>
      <div className="ph-mail dim"><b>Receipt</b><small>…</small></div>
    </Phone>
  ),
  6: (
    <Phone label="Download page listing several zip files, all of which should be downloaded">
      <div className="ph-title">Your exports</div>
      {['mydata~1.zip', 'mydata~2.zip', 'mydata~3.zip'].map((z) => (
        <div key={z} className="ph-file hot"><span>🗜 {z}</span><span className="ph-dl">⬇</span></div>
      ))}
      <small className="ph-section center">Download every part</small>
    </Phone>
  ),
};

function Shot({ n }) {
  const [real, setReal] = useState(null); // null = checking, true = screenshot found, false = use the drawing
  return (
    <div className="shot">
      {real !== false && (
        <img src={`guide/step-${n}.png`} alt="" style={real ? undefined : { display: 'none' }}
          onLoad={() => setReal(true)} onError={() => setReal(false)} />
      )}
      {!real && MOCKS[n]}
    </div>
  );
}

const GUIDE = [
  {
    title: 'Open Settings',
    body: <>Open Snapchat, tap your <em>profile picture</em> in the top-left corner, then the <em>⚙ gear</em> in the top-right.</>,
  },
  {
    title: 'Go to My Data',
    body: <>Scroll down to <em>Privacy Controls</em> and tap <em>My Data</em>. You may be asked to log in again.</>,
  },
  {
    title: 'Choose your Memories',
    body: <>Switch on <em>Export your Memories</em> (that's the part Snap Recap uses). Everything else is optional. Tap <em>Next</em>.</>,
  },
  {
    title: 'Pick “All time” and submit',
    body: <>Set the date range to <em>All time</em> so you get every memory, check your email address, and tap <em>Submit</em>.</>,
  },
  {
    title: 'Wait for the email',
    body: <>Snapchat emails you when your files are ready. That can take from a few minutes to a couple of days if you have lots of memories.</>,
  },
  {
    title: 'Download every zip',
    body: <>Open the link, ideally on a computer, and download <em>all</em> the zip files. Big exports are split into several parts and you need every one. Don't unzip them. Putting them together in one folder makes them easy to add in one go.</>,
  },
];

const FAQ = [
  ['Are my photos uploaded anywhere?', "No. Snap Recap runs entirely in your browser. Your zips are read on your own device and nothing is sent to a server, not even the face matching."],
  ['Do I need to unzip the files?', 'No, add the .zip files as they are. If Snapchat split your export into several parts, select them all at once, or put them in one folder and choose that folder.'],
  ['Will I have to re-upload next time?', 'In Chrome and Edge, Snap Recap remembers which zips you used, so you can reopen them with one click. In other browsers you just choose them again.'],
  ["Snapchat's menus look different.", 'Snapchat moves things around now and then. You can also request your data from a computer at accounts.snapchat.com: log in, open My Data, and follow the same steps.'],
  ['Some of my videos are missing.', "A few iPhone videos (HEVC) can't play in every browser. Those clips are skipped automatically. Chrome, Edge or Safari usually play the most."],
];

export default function Welcome({ importing, importInfo, error, onFiles, saved = [], onRestore, onForget }) {
  const input = useRef(null);
  const folderInput = useRef(null);
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

  const chooseFolder = async (e) => {
    e?.stopPropagation();
    if (importing) return;
    if (!canPickFolderWithHandle) return folderInput.current.click();
    const items = await pickFolder();
    if (items) onFiles(items);
  };

  const toTop = () => document.getElementById('upload')?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  return (
    <main className="land"
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => { if (!e.relatedTarget) setOver(false); }}
      onDrop={drop}>
      <div className="glow" aria-hidden />
      <nav className="land-nav">
        <span className="brand"><span className="logo">🎞️</span> Snap Recap</span>
        <span className="land-links">
          <a href="#how" onClick={(e) => { e.preventDefault(); document.getElementById('how').scrollIntoView({ behavior: 'smooth' }); }}>How it works</a>
          <a href="#guide" onClick={(e) => { e.preventDefault(); document.getElementById('guide').scrollIntoView({ behavior: 'smooth' }); }}>Get your zips</a>
        </span>
      </nav>

      <section className="hero">
        <h1>
          Your Snapchat Memories,
          <br />
          <span className="grad">played back by date.</span>
        </h1>
        <p className="lead">
          Turn years of snaps into a slideshow, one long video recap, or a face-aligned flipbook of you growing up,
          right in your browser.
        </p>

        {saved.length > 0 && !importing && (
          <div className="restore">
            <span>You have <b>{saved.length} zip{saved.length > 1 ? 's' : ''}</b> from last time.</span>
            <button className="btn primary" onClick={onRestore}>Reopen my memories</button>
            <button className="btn ghost small" onClick={onForget}>Forget them</button>
          </div>
        )}

        <div id="upload"
          className={`drop hero-drop ${over ? 'over' : ''} ${importing ? 'busy' : ''}`}
          onClick={choose}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && choose()}
        >
          <input ref={input} type="file" accept=".zip,application/zip" multiple hidden
            onChange={(e) => { onFiles(fromInput(e.target.files)); e.target.value = ''; }} />
          <input ref={folderInput} type="file" webkitdirectory="" multiple hidden
            onChange={(e) => { onFiles(fromInput(e.target.files)); e.target.value = ''; }} />
          {importing ? (
            <>
              <div className="spinner" />
              <strong>Reading zip {Math.min(importInfo.done + 1, importInfo.total)} of {importInfo.total}…</strong>
              <span className="muted small">{importInfo.name}</span>
            </>
          ) : (
            <>
              <div className="upload-choices">
                <span className="btn primary big"><span aria-hidden>⬆</span> Upload your zips</span>
                <button className="btn ghost big" onClick={chooseFolder}><span aria-hidden>📁</span> Choose a folder</button>
              </div>
              <span className="muted">
                Select all the zip parts at once, or pick the folder they're in. You can also drag the zips or the folder onto this page.
              </span>
            </>
          )}
        </div>
        {error && <p className="error">{error}</p>}
        <p className="privacy">🔒 Everything runs on your device. Your photos are never uploaded anywhere.</p>
        <p className="muted small">
          Don't have your zips yet? <a href="#guide" onClick={(e) => { e.preventDefault(); document.getElementById('guide').scrollIntoView({ behavior: 'smooth' }); }}>Here's how to get them ↓</a>
        </p>
      </section>

      <section className="land-section">
        <h2>What you can make</h2>
        <div className="features">
          <article className="feature">
            <div className="feature-art a">🖼️</div>
            <h3>Slideshow</h3>
            <p>Every photo in order with the date underneath. Choose the transition, the timing, slow zoom and more.</p>
          </article>
          <article className="feature">
            <div className="feature-art b">🎬</div>
            <h3>Video recap</h3>
            <p>All your saved videos back to back as one long recap, with the length of each clip and the total run time up to you.</p>
          </article>
          <article className="feature">
            <div className="feature-art c">🙂</div>
            <h3>Face align</h3>
            <p>Lines up a face across every photo so it stays in one spot, then plays them as a flipbook. Follow one person and save it as a video.</p>
          </article>
        </div>
      </section>

      <section className="land-section" id="how">
        <h2>How it works</h2>
        <ol className="how">
          <li><b>1</b><h3>Ask Snapchat for your data</h3><p>It takes a minute in the app. Snapchat then emails you a download link.</p></li>
          <li><b>2</b><h3>Drop the zips in here</h3><p>Snap Recap reads them in your browser. Nothing is uploaded and you don't need to unzip anything.</p></li>
          <li><b>3</b><h3>Watch and save</h3><p>Play your memories by date, hide the ones you don't want, and save a video to share.</p></li>
        </ol>
      </section>

      <section className="land-section" id="guide">
        <h2>How to download your Snapchat Memories</h2>
        <p className="muted center">Do this in the Snapchat app on your phone. It only needs doing once.</p>
        <ol className="guide">
          {GUIDE.map((g, i) => (
            <li key={g.title} className="guide-step">
              <Shot n={i + 1} />
              <div className="guide-text">
                <span className="guide-num">Step {i + 1}</span>
                <h3>{g.title}</h3>
                <p>{g.body}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="guide-end">
          <h3>Got your zips?</h3>
          <div className="upload-choices">
            <button className="btn primary big" onClick={() => { toTop(); choose(); }} disabled={importing}>
              <span aria-hidden>⬆</span> Upload them
            </button>
            <button className="btn ghost big" onClick={() => { toTop(); chooseFolder(); }} disabled={importing}>
              <span aria-hidden>📁</span> Choose their folder
            </button>
          </div>
        </div>
      </section>

      <section className="land-section">
        <h2>Questions</h2>
        <div className="faq">
          {FAQ.map(([q, a]) => (
            <details key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="land-foot muted small">
        Snap Recap isn't made by or affiliated with Snap Inc. It just reads the export Snapchat gives you.
      </footer>

      {over && !importing && <div className="drop-overlay" aria-hidden><span>Drop your zips to start</span></div>}
    </main>
  );
}
