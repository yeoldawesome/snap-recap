import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { importZips } from './lib/importer.js';
import { scoreMemory, warmUp } from './lib/detector.js';
import { load, save } from './lib/storage.js';
import Welcome from './components/Welcome.jsx';
import Library from './components/Library.jsx';
import Player from './components/Player.jsx';

const DEFAULT_SETTINGS = {
  hideShirtless: true,
  threshold: 0.4, // detector confidence needed to hide something (lower = stricter)
  newestFirst: false,
  secPerPhoto: 3,
  slideTotalMin: 0, // 0 = use secPerPhoto
  maxClipSec: 10, // 0 = whole clip
  videoTotalMin: 0, // 0 = no limit
  excludedYears: [],
};

export default function App() {
  const [phase, setPhase] = useState('welcome'); // welcome | importing | library
  const [memories, setMemories] = useState([]);
  const [importInfo, setImportInfo] = useState({ done: 0, total: 0, name: '' });
  const [error, setError] = useState('');
  const [scores, setScores] = useState(() => load('scores', {}));
  const [hidden, setHidden] = useState(() => load('hidden', {}));
  const [settings, setSettings] = useState(() => load('settings', DEFAULT_SETTINGS));
  const [scan, setScan] = useState({ done: 0, total: 0 });
  const [player, setPlayer] = useState(null);

  const mapRef = useRef(new Map());
  const scoresRef = useRef(scores);
  const scanGen = useRef(0);

  useEffect(() => save('settings', settings), [settings]);
  useEffect(() => save('hidden', hidden), [hidden]);

  const update = useCallback((patch) => setSettings((s) => ({ ...s, ...patch })), []);

  const runScan = useCallback(async (list) => {
    const gen = ++scanGen.current;
    const todo = list.filter((m) => scoresRef.current[m.id] === undefined);
    setScan({ done: 0, total: todo.length });
    if (!todo.length) return;
    await warmUp();
    for (let n = 0; n < todo.length; n++) {
      if (gen !== scanGen.current) return; // a newer import restarted the scan
      scoresRef.current = { ...scoresRef.current, [todo[n].id]: await scoreMemory(todo[n]) };
      if (n % 8 === 7 || n === todo.length - 1) {
        setScores(scoresRef.current);
        save('scores', scoresRef.current);
        setScan({ done: n + 1, total: todo.length });
      }
    }
  }, []);

  const addZips = useCallback(async (files) => {
    files = [...files].filter((f) => f.name.toLowerCase().endsWith('.zip'));
    if (!files.length) return setError('Please choose the .zip files from your Snapchat data download.');
    setError('');
    const prevPhase = phase;
    setPhase('importing');
    try {
      const { list } = await importZips(files, (done, total, name) => setImportInfo({ done, total, name }), mapRef.current);
      if (!list.length) {
        setError("Couldn't find any photos or videos in those zips. Make sure you picked the Memories download.");
        setPhase(prevPhase === 'library' ? 'library' : 'welcome');
        return;
      }
      setMemories(list);
      setPhase('library');
      runScan(list);
    } catch (e) {
      console.error(e);
      setError(`Couldn't read that zip: ${e.message}`);
      setPhase(prevPhase === 'library' ? 'library' : 'welcome');
    }
  }, [phase, runScan]);

  // Unchecked items count as hidden, so nothing slips through before it's been checked.
  const isFiltered = useCallback((m) => {
    if (hidden[m.id]) return true;
    if (!settings.hideShirtless) return false;
    const s = scores[m.id];
    return s === undefined || s >= settings.threshold;
  }, [hidden, scores, settings.hideShirtless, settings.threshold]);

  const visible = useMemo(() => {
    const ex = new Set(settings.excludedYears);
    const list = memories.filter((m) => !isFiltered(m) && !ex.has(new Date(m.date).getFullYear()));
    return settings.newestFirst ? [...list].reverse() : list;
  }, [memories, isFiltered, settings.excludedYears, settings.newestFirst]);

  const hideOne = useCallback((id) => setHidden((h) => ({ ...h, [id]: true })), []);

  if (player) {
    return <Player {...player} onHide={hideOne} onClose={() => setPlayer(null)} />;
  }
  if (phase === 'library') {
    return (
      <Library
        memories={memories}
        visible={visible}
        scores={scores}
        hidden={hidden}
        isFiltered={isFiltered}
        settings={settings}
        update={update}
        scan={scan}
        error={error}
        onAddZips={addZips}
        onUnhideAll={() => setHidden({})}
        onPlay={setPlayer}
      />
    );
  }
  return <Welcome importing={phase === 'importing'} importInfo={importInfo} error={error} onFiles={addZips} />;
}
