import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { importZips } from './lib/importer.js';
import { load, save } from './lib/storage.js';
import { DEFAULT_SETTINGS, withDefaults } from './lib/settings.js';
import { measureDuration } from './lib/durations.js';
import { forgetZips, rememberZips, restoreZips, savedZips } from './lib/persist.js';
import Welcome from './components/Welcome.jsx';
import Library from './components/Library.jsx';
import Player from './components/Player.jsx';

export default function App() {
  const [phase, setPhase] = useState('welcome'); // welcome | importing | library
  const [memories, setMemories] = useState([]);
  const [importInfo, setImportInfo] = useState({ done: 0, total: 0, name: '' });
  const [error, setError] = useState('');
  const [hidden, setHidden] = useState(() => load('hidden', {}));
  const [settings, setSettings] = useState(() => withDefaults(load('settings', DEFAULT_SETTINGS)));
  const [player, setPlayer] = useState(null);
  const [durations, setDurations] = useState(() => load('durations', {})); // video id -> seconds
  const [saved, setSaved] = useState([]); // zips from last time that need a click to reopen

  const mapRef = useRef(new Map());
  const durRef = useRef(durations);
  const measureGen = useRef(0);

  // Read each video's length once, in the background, a few at a time.
  const measureVideos = useCallback(async (list) => {
    const gen = ++measureGen.current;
    const todo = list.filter((m) => m.kind === 'video' && durRef.current[m.id] === undefined);
    let n = 0;
    const flush = () => { setDurations(durRef.current); save('durations', durRef.current); };
    const worker = async () => {
      while (n < todo.length && gen === measureGen.current) {
        const m = todo[n++];
        durRef.current = { ...durRef.current, [m.id]: await measureDuration(m.main) };
        if (n % 10 === 0) flush();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (gen === measureGen.current) flush();
  }, []);

  useEffect(() => save('settings', settings), [settings]);
  useEffect(() => save('hidden', hidden), [hidden]);

  const update = useCallback((patch) => setSettings((s) => ({ ...s, ...patch })), []);
  const updateMode = useCallback((mode, patch) => setSettings((s) => ({ ...s, [mode]: { ...s[mode], ...patch } })), []);

  // items: [{ file, handle? }]
  const addZips = useCallback(async (items, { remember = true } = {}) => {
    items = items.filter(({ file }) => file.name.toLowerCase().endsWith('.zip'));
    if (!items.length) return setError('Please choose the .zip files from your Snapchat data download.');
    const files = items.map((i) => i.file);
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
      setSaved([]);
      if (remember) rememberZips(items);
      measureVideos(list);
    } catch (e) {
      console.error(e);
      setError(`Couldn't read that zip: ${e.message}`);
      setPhase(prevPhase === 'library' ? 'library' : 'welcome');
    }
  }, [phase, measureVideos]);

  // Reopen the zips from last time. Chrome/Edge may need one click to re-grant access.
  const restore = useCallback(async (records, interactive) => {
    const { files, needsPermission } = await restoreZips(records, interactive);
    if (needsPermission && !interactive) return setSaved(records);
    if (files.length) await addZips(files.map((file) => ({ file })), { remember: false });
    else setSaved([]);
  }, [addZips]);

  const restoredOnce = useRef(false);
  useEffect(() => {
    if (restoredOnce.current) return;
    restoredOnce.current = true;
    savedZips().then((records) => records.length && restore(records, false));
  }, [restore]);

  const startOver = useCallback(async () => {
    await forgetZips();
    mapRef.current = new Map();
    setMemories([]);
    setSaved([]);
    setPhase('welcome');
  }, []);

  const isFiltered = useCallback((m) => !!hidden[m.id], [hidden]);

  const visible = useMemo(() => {
    const ex = new Set(settings.excludedYears);
    const list = memories.filter((m) => !isFiltered(m) && !ex.has(new Date(m.date).getFullYear()));
    return settings.newestFirst ? [...list].reverse() : list;
  }, [memories, isFiltered, settings.excludedYears, settings.newestFirst]);

  const hideOne = useCallback((id) => setHidden((h) => ({ ...h, [id]: true })), []);

  if (player) {
    return (
      <Player
        {...player}
        settings={settings[player.mode]}
        update={(patch) => updateMode(player.mode, patch)}
        onHide={hideOne}
        onClose={() => setPlayer(null)}
      />
    );
  }
  if (phase === 'library') {
    return (
      <Library
        memories={memories}
        visible={visible}
        hidden={hidden}
        durations={durations}
        isFiltered={isFiltered}
        settings={settings}
        update={update}
        updateMode={updateMode}
        error={error}
        onAddZips={addZips}
        onUnhideAll={() => setHidden({})}
        onStartOver={startOver}
        onPlay={setPlayer}
      />
    );
  }
  return (
    <Welcome
      importing={phase === 'importing'}
      importInfo={importInfo}
      error={error}
      onFiles={addZips}
      saved={saved}
      onRestore={() => restore(saved, true)}
      onForget={startOver}
    />
  );
}
