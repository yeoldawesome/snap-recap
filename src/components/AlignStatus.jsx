import { useEffect, useRef, useState } from 'react';

/**
 * Time left for a running job, from how fast it has gone since it started (or since `total` changed).
 * Returns null until there's enough to go on, or once it's finished.
 */
export function useEta(done, total) {
  const r = useRef(null);
  const now = performance.now();
  if (!r.current || r.current.total !== total || done < r.current.d0) r.current = { t0: now, d0: done, total };
  const { t0, d0 } = r.current;
  const n = done - d0;
  const ms = now - t0;
  if (done >= total || n < 3 || ms < 1500) return null;
  const perMs = n / ms;
  return { leftMs: (total - done) / perMs, perSec: perMs * 1000, started: n > 0 };
}

/** Whether any work has been done since the job (re)started: false while a model is still loading. */
export function useStarted(done, total) {
  const r = useRef(null);
  if (!r.current || r.current.total !== total || done < r.current.d0) r.current = { d0: done, total };
  return done > r.current.d0;
}

export function fmtLeft(ms) {
  const s = Math.round(ms / 1000);
  if (s < 10) return 'a few seconds left';
  if (s < 50) return `about ${Math.ceil(s / 10) * 10} seconds left`;
  if (s < 90) return 'about a minute left';
  const m = Math.round(s / 60);
  if (m < 60) return `about ${m} minutes left`;
  const h = Math.floor(m / 60);
  return `about ${h} h ${m % 60} min left`;
}

const pct = (d, t) => (t ? Math.floor((d / t) * 100) : 0);
const plural = (n, one, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// ---- desktop notifications (only when the tab is in the background) ----
const canNotify = typeof window !== 'undefined' && 'Notification' in window;
export function notify(title, body) {
  if (!canNotify || Notification.permission !== 'granted' || !document.hidden) return;
  try {
    const n = new Notification(title, { body, tag: 'snap-recap-faces' });
    n.onclick = () => { window.focus(); n.close(); };
  } catch { /* some browsers only allow notifications from a service worker */ }
}

function NotifyButton() {
  const [perm, setPerm] = useState(canNotify ? Notification.permission : 'unsupported');
  if (perm === 'unsupported' || perm === 'denied') return null;
  if (perm === 'granted') return <span className="muted small">🔔 You'll get a notification when it's done.</span>;
  return (
    <button className="link small" onClick={() => Notification.requestPermission().then(setPerm, () => {})}>
      🔔 Notify me when it's done
    </button>
  );
}

function Stage({ state, title, detail, done, total }) {
  const icon = { done: '✓', running: '', waiting: '…', error: '!' }[state];
  return (
    <li className={`stage ${state}`}>
      <span className="stage-icon" aria-hidden>{state === 'running' ? <span className="pulse" /> : icon}</span>
      <div className="stage-body">
        <div className="stage-head">
          <b>{title}</b>
          {state === 'running' && total > 0 && <span className="muted small">{pct(done, total)}%</span>}
        </div>
        {detail && <div className="muted small">{detail}</div>}
        {state === 'running' && total > 0 && (
          <div className="bar"><i style={{ width: `${(done / total) * 100}%` }} /></div>
        )}
      </div>
    </li>
  );
}

/**
 * What face align is doing right now: finding faces, then (for "One person") learning them,
 * then ready, with progress, time left, and what can already be done meanwhile.
 */
export function AlignStatus({
  progress, describe, analyzing, describing, personOn, refCount, withFaces, matched, error, onChoosePerson,
}) {
  const findEta = useEta(progress.done, progress.total);
  const findStarted = useStarted(progress.done, progress.total);
  const learnEta = useEta(describe.done, describe.total);
  const learnStarted = useStarted(describe.done, describe.total);
  const busy = analyzing || describing;

  // All done: one compact line.
  if (!busy && !error) {
    let text;
    if (!personOn) text = `Ready: ${plural(matched, 'photo')} lined up. Press play, or save it as a video.`;
    else if (!refCount) text = 'Face recognition is ready. Choose a few photos of the person to follow.';
    else text = `Ready: found them in ${plural(matched, 'photo')}.`;
    return (
      <div className="status-ready">
        <span className="stage-icon done" aria-hidden>✓</span>
        <span>{text}</span>
        {personOn && !refCount && <button className="btn primary small" onClick={onChoosePerson}>Choose them</button>}
      </div>
    );
  }

  const findDetail = analyzing
    ? (!findStarted
      ? 'Loading the face finder. The first time, this downloads about 13 MB.'
      : `${progress.done.toLocaleString()} of ${plural(progress.total, 'photo')}${findEta ? ` · ${fmtLeft(findEta.leftMs)}` : ''}`)
    : `Found faces in ${withFaces.toLocaleString()} of ${plural(progress.total, 'photo')}.`;

  let learn = null;
  if (personOn) {
    if (analyzing) {
      learn = { state: 'waiting', detail: `Starts when finding faces is done${findEta ? ` (${fmtLeft(findEta.leftMs).replace(' left', '')})` : ''}.` };
    } else if (describing) {
      learn = {
        state: 'running',
        detail: describe.total === 0 || !learnStarted
          ? 'Loading face recognition. The first time, this downloads about 8 MB.'
          : `${describe.done.toLocaleString()} of ${plural(describe.total, 'photo')}${learnEta ? ` · ${fmtLeft(learnEta.leftMs)}` : ''}`,
      };
    } else {
      learn = { state: 'done', detail: 'Done.' };
    }
  }

  let now;
  if (analyzing) {
    now = personOn
      ? 'You can already pick examples of the person from the faces found so far. Matching starts once all faces are found.'
      : 'You can already play and adjust the photos that are done. Saving a video unlocks when every photo is checked.';
  } else if (describing) {
    now = refCount
      ? 'Photos of them show up as each one is checked. Saving a video unlocks when it finishes.'
      : 'Choose a few photos of the person meanwhile. Suggestions get better as it goes.';
  }

  return (
    <section className="status-panel" aria-live="polite">
      <ol className="stages">
        <Stage state={error && analyzing ? 'error' : analyzing ? 'running' : 'done'} title="1. Finding faces"
          detail={findDetail} done={progress.done} total={progress.total} />
        {learn && (
          <Stage state={error && describing ? 'error' : learn.state} title="2. Learning faces (for One person)"
            detail={learn.detail} done={describe.done} total={describe.total} />
        )}
      </ol>
      {now && <p className="small status-now">{now}</p>}
      <div className="status-foot">
        <span className="muted small">It keeps working if you switch tabs, as long as this one stays open. Results are saved, so next time is quick.</span>
        <NotifyButton />
      </div>
    </section>
  );
}

/** Short messages in the corner that go away on their own. */
export function Toasts({ items, onDismiss }) {
  useEffect(() => {
    if (!items.length) return undefined;
    const t = setTimeout(() => onDismiss(items[0].id), 7000);
    return () => clearTimeout(t);
  }, [items, onDismiss]);
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast" role="status">
          <span className="stage-icon done" aria-hidden>✓</span>
          <div><b>{t.title}</b>{t.body && <div className="muted small">{t.body}</div>}</div>
          <button className="icon-btn" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>✕</button>
        </div>
      ))}
    </div>
  );
}
