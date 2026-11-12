import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { importZips } from './lib/importer.js';
import { importMedia, isMediaFile } from './lib/camera.js';
import { load, save } from './lib/storage.js';
import { DEFAULT_SETTINGS, withDefaults } from './lib/settings.js';
import { measureDuration } from './lib/durations.js';
import { forgetZips, rememberZips, restoreZips, savedZips } from './lib/persist.js';
import Welcome from './components/Welcome.jsx';
import Library from './components/Library.jsx';
import Player from './components/Player.jsx';
import FaceAlign from './components/FaceAlign.jsx';

// Each mode is its own page (#/slideshow, #/recap, #/align), so the browser's Back button returns home.
const ROUTES = ['slideshow', 'recap', 'align'];
const routeFromHash = () => {
  const r = window.location.hash.replace(/^#\/?/, '');
  return ROUTES.includes(r) ? r : 'home';
};

function useRoute() {
  const [route, setRoute] = useState(routeFromHash);
  useEffect(() => {
    const sync = () => setRoute(routeFromHash());
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener('hashchange', sync);
    };
  }, []);
  const go = useCallback((r) => {
    if (r === 'home') {
      // Opened from home in this tab: step back, so Back/Forward stay in step. Otherwise just go home.
      // (history.back() is async; the popstate listener updates the route.)
      if (window.history.state?.fromHome) return window.history.back();
      window.history.replaceState(null, '', '#/');
    } else {
      window.history.pushState({ fromHome: true }, '', `#/${r}`);
    }
    setRoute(r);
  }, []);
  return [route, go];
}

export default function App() {
  const [phase, setPhase] = useState('welcome'); // welcome | importing | library
  const [memories, setMemories] = useState([]);
  const [importInfo, setImportInfo] = useState({ done: 0, total: 0, name: '' });
  const [error, setError] = useState('');
  const [hidden, setHidden] = useState(() => load('hidden', {}));
  const [settings, setSettings] = useState(() => withDefaults(load('settings', DEFAULT_SETTINGS)));
  const [route, go] = useRoute();
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

  // items: [{ file, handle? }]: Snapchat export zips and/or photos and videos from a camera roll.
  const addZips = useCallback(async (items, { remember = true } = {}) => {
    const zips = items.filter(({ file }) => file.name.toLowerCase().endsWith('.zip'));
    const media = items.filter(({ file }) => isMediaFile(file));
    if (!zips.length && !media.length) {
      return setError("Couldn't find any .zip files, photos or videos there. Choose the zips from your Snapchat data download, the folder they're in, or photos from your camera roll.");
    }
    const files = zips.map((i) => i.file);
    setError('');
    const prevPhase = phase;
    setPhase('importing');
    try {
      let list = [];
      if (files.length) {
        ({ list } = await importZips(files, (done, total, name) => setImportInfo({ done, total, name }), mapRef.current));
      }
      if (media.length) {
        ({ list } = await importMedia(media.map((i) => i.file),
          (done, total, name) => setImportInfo({ done, total, name, media: true }), mapRef.current));
      }
      if (!list.length) {
        setError(files.length
          ? "Couldn't find any photos or videos in those zips. Make sure you picked the Memories download."
          : "Couldn't read any of those photos or videos.");
        setPhase(prevPhase === 'library' ? 'library' : 'welcome');
        return;
      }
      setMemories(list);
      setPhase('library');
      setSaved([]);
      // Only zips are remembered; camera roll picks are too big to keep a copy of, so they're chosen again.
      if (remember && zips.length) rememberZips(zips);
      measureVideos(list);
    } catch (e) {
      console.error(e);
      setError(`Couldn't read ${files.length ? 'that zip' : 'those files'}: ${e.message}`);
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
    go('home');
    setPhase('welcome');
  }, [go]);

  const isFiltered = useCallback((m) => !!hidden[m.id], [hidden]);

  const visible = useMemo(() => {
    const ex = new Set(settings.excludedYears);
    const list = memories.filter((m) => !isFiltered(m) && !ex.has(new Date(m.date).getFullYear()));
    return settings.newestFirst ? [...list].reverse() : list;
  }, [memories, isFiltered, settings.excludedYears, settings.newestFirst]);

  const photos = useMemo(() => visible.filter((m) => m.kind === 'photo'), [visible]);
  const videos = useMemo(() => visible.filter((m) => m.kind === 'video'), [visible]);

  const hideOne = useCallback((id) => setHidden((h) => ({ ...h, [id]: true })), []);

  const goHome = () => go('home');
  if (phase === 'library' && (route === 'slideshow' || route === 'recap')) {
    const mode = route === 'slideshow' ? 'photo' : 'video';
    const items = mode === 'photo' ? photos : videos;
    if (items.length) {
      return (
        <Player
          key={route}
          mode={mode}
          items={items}
          settings={settings[mode]}
          update={(patch) => updateMode(mode, patch)}
          onHide={hideOne}
          onClose={goHome}
        />
      );
    }
  }
  if (phase === 'library' && route === 'align') {
    return <FaceAlign photos={photos} onClose={goHome} />;
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
        onPlay={({ mode }) => go(mode === 'photo' ? 'slideshow' : 'recap')}
        onFaceAlign={() => go('align')}
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
