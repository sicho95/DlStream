(() => {
  const cfg = window.__DLSTREAM__;
  if (!cfg || cfg.isNested) return;

  const STATE_KEY = 'dlstream.folderMode.v1';
  const OPFS_DIR = 'dlstream-folder-mode';
  const DEFAULT_DELAY_MS = 650;

  let activeMedia = window.__DLSTREAM_ACTIVE_MEDIA__ || null;
  let launchCancelled = false;

  function normalize(value, base = cfg.targetUrl) {
    try {
      const url = new URL(String(value || ''), base);
      return ['http:', 'https:'].includes(url.protocol) ? url : null;
    } catch {
      return null;
    }
  }

  function readState() {
    try {
      const value = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
      return value && typeof value === 'object' ? value : null;
    } catch {
      return null;
    }
  }

  function saveState(patch = {}) {
    const current = readState() || {};
    const next = { ...current, ...patch, updatedAt: Date.now() };
    localStorage.setItem(STATE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('dlstream-folder-progress', { detail: next }));
    return next;
  }

  function clearState() {
    localStorage.removeItem(STATE_KEY);
    window.dispatchEvent(new CustomEvent('dlstream-folder-progress', { detail: null }));
  }

  function activeManifestUrl() {
    const media = activeMedia || window.__DLSTREAM_ACTIVE_MEDIA__;
    const type = String(media?.type || media?.mediaType || '').toLowerCase();
    if (type !== 'hls') return null;
    return normalize(media?.manifestUrl || media?.url, media?.sourcePage || cfg.targetUrl);
  }

  function cleanRef(value) {
    return String(value || '')
      .trim()
      .replace(/^['"]|['"]$/g, '')
      .split('#')[0]
      .split('?')[0]
      .replace(/^\.\//, '');
  }

  function fileNameFromRef(value) {
    const clean = cleanRef(value);
    const tail = clean.split('/').filter(Boolean).pop() || 'segment.ts';
    try { return decodeURIComponent(tail); } catch { return tail; }
  }

  function safeOutputName(value, extension) {
    const base = String(value || 'video')
      .replace(/\.m3u8(?:\.m3u8)?$/i, '')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .trim() || 'video';
    return `${base.slice(0, 120)}.${extension}`;
  }

  function parseAttrs(text) {
    const out = {};
    const re = /([A-Z0-9-]+)=((?:"[^"]*")|[^,]*)/gi;
    for (const match of String(text || '').matchAll(re)) {
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      out[match[1].toUpperCase()] = value;
    }
    return out;
  }

  function parseManifest(text, baseUrl = '') {
    const raw = String(text || '');
    if (!raw.includes('#EXTM3U')) throw new Error('Le fichier sélectionné n’est pas un manifeste HLS valide.');

    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const refs = [];
    let fmp4 = false;
    let hasMediaSegments = false;
    let hasMasterVariants = false;

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];

      if (line.startsWith('#EXT-X-KEY:')) {
        const attrs = parseAttrs(line.slice(line.indexOf(':') + 1));
        if (String(attrs.METHOD || '').toUpperCase() !== 'NONE') {
          throw new Error('Ce HLS est chiffré. Le mode dossier temporaire ne l’assemble pas.');
        }
        continue;
      }

      if (line.startsWith('#EXT-X-DISCONTINUITY')) {
        throw new Error('Ce HLS contient des discontinuités. Un remuxage réel est nécessaire.');
      }

      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        hasMasterVariants = true;
        continue;
      }

      if (line.startsWith('#EXT-X-MAP:')) {
        const attrs = parseAttrs(line.slice(line.indexOf(':') + 1));
        if (attrs.URI) {
          refs.push(attrs.URI);
          fmp4 = true;
        }
        continue;
      }

      if (line.startsWith('#')) continue;
      if (/\.m3u8(?:$|[?#])/i.test(line)) {
        hasMasterVariants = true;
        continue;
      }

      refs.push(line);
      hasMediaSegments = true;
      if (/\.(m4s|mp4)(?:$|[?#])/i.test(line)) fmp4 = true;
    }

    if (!hasMediaSegments && hasMasterVariants) {
      throw new Error('Manifeste maître détecté. Il faut d’abord télécharger/importer la playlist média qui contient les segments .ts/.m4s.');
    }
    if (!refs.length) throw new Error('Aucun segment média trouvé dans le manifeste.');

    const manifestBase = baseUrl ? normalize(baseUrl) : null;
    const urls = manifestBase
      ? refs.map((ref) => normalize(ref, manifestBase.href)?.href || '').filter(Boolean)
      : [];

    return {
      refs,
      urls,
      format: fmp4 ? 'mp4' : 'ts',
      endList: lines.includes('#EXT-X-ENDLIST'),
    };
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function openManifest() {
    const url = activeManifestUrl();
    if (!url) throw new Error('Aucun manifeste HLS actif à ouvrir.');
    window.open(url.href, '_blank', 'noopener');
  }

  async function importManifestFile(file) {
    if (!file) throw new Error('Aucun manifeste sélectionné.');
    const text = await file.text();
    const online = activeManifestUrl();
    const parsed = parseManifest(text, online?.href || '');

    return saveState({
      state: 'manifest-ready',
      error: '',
      manifestName: file.name || 'video.m3u8',
      manifestText: text,
      manifestUrl: online?.href || '',
      format: parsed.format,
      refs: parsed.refs,
      urls: parsed.urls,
      total: parsed.refs.length,
      launchIndex: 0,
      importIndex: 0,
      percent: 0,
      message: online
        ? `${parsed.refs.length} segments prêts. Le téléchargement multiple est expérimental sur iOS.`
        : `${parsed.refs.length} segments trouvés. L’URL en ligne du manifeste est nécessaire pour lancer leur téléchargement.`,
    });
  }

  function ensureDownloadSink() {
    let frame = document.querySelector('iframe[data-dlstream-download-sink]');
    if (frame) return frame;
    frame = document.createElement('iframe');
    frame.name = `dlstream-download-${Date.now()}`;
    frame.dataset.dlstreamDownloadSink = '1';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;width:1px;height:1px;left:-9999px;top:-9999px;border:0;opacity:0;pointer-events:none';
    document.body.appendChild(frame);
    return frame;
  }

  function triggerOneDownload(url, filename) {
    const sink = ensureDownloadSink();
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = sink.name;
    anchor.rel = 'noopener';
    anchor.download = filename || '';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  function testFirstSegment() {
    const state = readState();
    if (!state?.urls?.length) throw new Error('Importe d’abord le manifeste .m3u8 détecté.');
    triggerOneDownload(state.urls[0], fileNameFromRef(state.refs?.[0] || state.urls[0]));
    saveState({ message: 'Premier segment lancé. Vérifie qu’il apparaît bien dans le dossier de téléchargements iOS avant de lancer toute la file.' });
  }

  async function launchAllSegments(delayMs = DEFAULT_DELAY_MS) {
    const state = readState();
    if (!state?.refs?.length) throw new Error('Importe d’abord le manifeste .m3u8.');

    let urls = Array.isArray(state.urls) ? state.urls : [];
    if (urls.length !== state.refs.length) {
      const online = normalize(state.manifestUrl || activeManifestUrl()?.href || '');
      if (!online) throw new Error('Impossible de reconstruire les URL des segments sans l’URL en ligne du manifeste.');
      urls = state.refs.map((ref) => normalize(ref, online.href)?.href || '').filter(Boolean);
      if (urls.length !== state.refs.length) throw new Error('Certaines URL de segments sont invalides.');
      saveState({ urls, manifestUrl: online.href });
    }

    launchCancelled = false;
    const total = urls.length;
    saveState({
      state: 'launching',
      launchIndex: 0,
      total,
      percent: 0,
      error: '',
      message: 'Demandes de téléchargement en cours. iOS peut demander l’autorisation des téléchargements multiples.',
    });

    for (let i = 0; i < total; i += 1) {
      if (launchCancelled) {
        saveState({ state: 'launch-paused', message: `File arrêtée après ${i}/${total} demandes.` });
        return;
      }

      triggerOneDownload(urls[i], fileNameFromRef(state.refs[i] || urls[i]));
      const index = i + 1;
      saveState({
        state: 'launching',
        launchIndex: index,
        percent: Math.round((index / total) * 1000) / 10,
        message: `${index}/${total} demandes de téléchargement lancées. Cela ne confirme pas encore l’écriture de chaque fichier par iOS.`,
      });
      await delay(Math.max(250, Number(delayMs) || DEFAULT_DELAY_MS));
    }

    saveState({
      state: 'downloads-launched',
      launchIndex: total,
      percent: 100,
      message: 'Toutes les demandes ont été lancées. Vérifie le dossier temporaire dans Fichiers puis sélectionne ce dossier dans DlStream.',
    });
  }

  function cancelLaunch() {
    launchCancelled = true;
  }

  function normalizeRelativePath(path) {
    let value = String(path || '').replace(/\\/g, '/');
    const parts = value.split('/').filter(Boolean);
    if (parts.length > 1) parts.shift();
    value = parts.join('/');
    try { value = decodeURIComponent(value); } catch (_) {}
    return value.replace(/^\.\//, '');
  }

  function buildFileMaps(files) {
    const byRelative = new Map();
    const byName = new Map();

    for (const file of files) {
      const relative = normalizeRelativePath(file.webkitRelativePath || file.name);
      if (relative) byRelative.set(relative, file);
      const name = file.name || relative.split('/').pop() || '';
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(file);
    }

    return { byRelative, byName };
  }

  function matchFile(ref, maps) {
    let clean = cleanRef(ref);
    try { clean = decodeURIComponent(clean); } catch (_) {}
    clean = clean.replace(/^\.\//, '');

    if (maps.byRelative.has(clean)) return maps.byRelative.get(clean);

    for (const [relative, file] of maps.byRelative.entries()) {
      if (relative === clean || relative.endsWith(`/${clean}`)) return file;
    }

    const name = fileNameFromRef(clean);
    const sameName = maps.byName.get(name) || [];
    return sameName.length === 1 ? sameName[0] : null;
  }

  async function chooseBestManifest(files, onlineUrl = '') {
    const manifests = files.filter((file) => /\.m3u8(?:\.m3u8)?$/i.test(file.name || ''));
    if (!manifests.length) return null;

    const maps = buildFileMaps(files);
    let best = null;

    for (const file of manifests) {
      try {
        const text = await file.text();
        const parsed = parseManifest(text, onlineUrl);
        const matched = parsed.refs.reduce((count, ref) => count + (matchFile(ref, maps) ? 1 : 0), 0);
        if (!best || matched > best.matched) best = { file, text, parsed, matched };
      } catch (_) {}
    }

    return best;
  }

  async function opfsDir() {
    if (!navigator.storage?.getDirectory) throw new Error('OPFS n’est pas disponible sur ce navigateur.');
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle(OPFS_DIR, { create: true });
  }

  async function concatenateFolder(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) throw new Error('Le dossier sélectionné est vide.');

    let state = readState() || {};
    const onlineUrl = state.manifestUrl || activeManifestUrl()?.href || '';
    const bestManifest = await chooseBestManifest(files, onlineUrl);

    let parsed;
    let manifestName;
    let manifestText;

    if (bestManifest) {
      parsed = bestManifest.parsed;
      manifestName = bestManifest.file.name;
      manifestText = bestManifest.text;
    } else if (state.manifestText) {
      parsed = parseManifest(state.manifestText, onlineUrl);
      manifestName = state.manifestName || 'video.m3u8';
      manifestText = state.manifestText;
    } else {
      throw new Error('Aucun manifeste .m3u8 trouvé dans le dossier et aucun manifeste n’a été importé auparavant.');
    }

    const maps = buildFileMaps(files);
    const ordered = [];
    const missing = [];

    for (const ref of parsed.refs) {
      const file = matchFile(ref, maps);
      if (file) ordered.push(file);
      else missing.push(fileNameFromRef(ref));
    }

    if (missing.length) {
      const sample = missing.slice(0, 12).join('\n');
      throw new Error(`${missing.length} segment(s) manquant(s) sur ${parsed.refs.length}.\n\nPremiers fichiers manquants :\n${sample}`);
    }

    const folderName = String(files[0]?.webkitRelativePath || '').split('/').filter(Boolean)[0] || 'dossier temporaire';
    const extension = parsed.format || 'ts';
    const outputName = safeOutputName(manifestName, extension);
    const fileKey = `assembled-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`;
    const dir = await opfsDir();
    const handle = await dir.getFileHandle(fileKey, { create: true });
    const writable = await handle.createWritable();

    let bytes = 0;
    const total = ordered.length;
    saveState({
      ...state,
      state: 'assembling-folder',
      manifestName,
      manifestText,
      refs: parsed.refs,
      total,
      importIndex: 0,
      bytes: 0,
      percent: 0,
      tempFolderName: folderName,
      resultFileKey: fileKey,
      resultFilename: outputName,
      format: extension,
      error: '',
      message: `Vérification terminée : ${total}/${total} segments présents. Assemblage en cours…`,
    });

    try {
      for (let i = 0; i < ordered.length; i += 1) {
        const reader = ordered[i].stream().getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          await writable.write(value);
          bytes += value.byteLength;
        }

        const index = i + 1;
        if (index === total || index % 5 === 0) {
          saveState({
            state: 'assembling-folder',
            importIndex: index,
            bytes,
            percent: Math.round((index / total) * 1000) / 10,
            message: `${index}/${total} segments concaténés.`,
          });
        }
      }

      await writable.close();
    } catch (error) {
      try { await writable.abort(); } catch (_) {}
      saveState({ state: 'folder-error', error: error?.message || String(error), message: 'Assemblage interrompu.' });
      throw error;
    }

    state = saveState({
      state: 'folder-ready',
      importIndex: total,
      bytes,
      percent: 100,
      resultFileKey: fileKey,
      resultFilename: outputName,
      tempFolderName: folderName,
      message: `Fichier final construit. Exporte-le puis vérifie-le avant de supprimer manuellement « ${folderName} » dans Fichiers.`,
    });

    return state;
  }

  async function exportResult() {
    const state = readState();
    if (!state?.resultFileKey) throw new Error('Aucun fichier assemblé à exporter.');
    const dir = await opfsDir();
    const handle = await dir.getFileHandle(state.resultFileKey, { create: false });
    const file = await handle.getFile();
    const url = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = state.resultFilename || file.name || 'video.ts';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);

    saveState({
      state: 'folder-export-requested',
      message: `Export demandé. Dès que « ${state.resultFilename || 'le fichier final'} » apparaît dans Fichiers et se lit correctement, tu peux supprimer manuellement le dossier temporaire « ${state.tempFolderName || ''} ».`,
    });
  }

  async function removeResult() {
    const state = readState();
    if (state?.resultFileKey) {
      try {
        const dir = await opfsDir();
        await dir.removeEntry(state.resultFileKey);
      } catch (_) {}
    }
    clearState();
  }

  document.addEventListener('dlstream-active-media', (event) => {
    activeMedia = event.detail || null;
    window.dispatchEvent(new CustomEvent('dlstream-folder-progress', { detail: readState() }));
  });

  window.DlStreamFolderMode = Object.freeze({
    getState: readState,
    activeManifestUrl: () => activeManifestUrl()?.href || '',
    openManifest,
    importManifestFile,
    testFirstSegment,
    launchAllSegments,
    cancelLaunch,
    concatenateFolder,
    exportResult,
    removeResult,
    clearState,
  });
})();
