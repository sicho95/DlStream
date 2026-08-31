(() => {
  const cfg = window.__DLSTREAM__;
  if (!cfg || cfg.isNested) return;

  const STATE_KEY = 'dlstream.folderMode.v2';
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

    for (const line of lines) {
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
      throw new Error('Manifeste maître détecté. Il faut importer la playlist média qui contient les segments .ts/.m4s.');
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
    if (!url) throw new Error('Aucun manifeste HLS actif à lire.');
    window.open(url.href, '_blank', 'noopener');
    saveState({ message: 'Le manifeste a été ouvert comme flux. Sur iOS il peut lancer directement la lecture vidéo ; cette action ne garantit pas le téléchargement du fichier .m3u8.' });
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
      testOutcome: '',
      testUrl: parsed.urls[0] || '',
      folderExpected: parsed.refs.length,
      folderPresent: 0,
      folderMissing: [],
      folderExtra: 0,
      folderDuplicates: [],
      message: online
        ? `${parsed.refs.length} segments trouvés. Teste d’abord un segment de façon visible.`
        : `${parsed.refs.length} segments trouvés, mais l’URL en ligne du manifeste manque pour reconstruire les URL des segments.`,
    });
  }

  function testFirstSegment() {
    const state = readState();
    if (!state?.urls?.length) throw new Error('Importe d’abord le manifeste .m3u8 détecté.');
    const url = state.urls[0];
    const popup = window.open(url, '_blank', 'noopener');
    saveState({
      state: 'segment-test-opened',
      testUrl: url,
      testFilename: fileNameFromRef(state.refs?.[0] || url),
      testOutcome: '',
      message: popup
        ? 'Premier segment ouvert dans une fenêtre visible. Vérifie maintenant ce qu’iOS a réellement fait puis indique le résultat dans DlStream.'
        : 'iOS a bloqué l’ouverture du segment. Le téléchargement automatique par navigation n’est pas exploitable ici.',
    });
  }

  function setTestOutcome(outcome) {
    const allowed = new Set(['downloaded', 'opened', 'nothing']);
    if (!allowed.has(outcome)) throw new Error('Résultat de test invalide.');
    const messages = {
      downloaded: 'Test confirmé : le segment a réellement été enregistré dans Fichiers. Le lancement en série peut être tenté.',
      opened: 'Test confirmé : iOS ouvre/lit le segment au lieu de le télécharger. Le lancement automatique de tous les segments est désactivé pour cet hébergeur.',
      nothing: 'Test confirmé : aucun fichier n’a été créé. Le lancement automatique de tous les segments est désactivé pour cet hébergeur.',
    };
    return saveState({ state: 'segment-test-result', testOutcome: outcome, message: messages[outcome] });
  }

  function triggerOneDownload(url, filename) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener';
    anchor.download = filename || '';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  async function launchAllSegments(delayMs = DEFAULT_DELAY_MS) {
    const state = readState();
    if (!state?.refs?.length) throw new Error('Importe d’abord le manifeste .m3u8.');
    if (state.testOutcome !== 'downloaded') {
      throw new Error('Le lancement en série est désactivé tant que le test d’un segment n’a pas été confirmé comme réellement téléchargé dans Fichiers.');
    }

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
      message: 'Demandes de téléchargement en cours. Le pourcentage indique uniquement les demandes envoyées à iOS, pas les fichiers effectivement écrits.',
    });

    for (let i = 0; i < total; i += 1) {
      if (launchCancelled) {
        saveState({ state: 'launch-paused', message: `File arrêtée après ${i}/${total} demandes lancées.` });
        return;
      }

      triggerOneDownload(urls[i], fileNameFromRef(state.refs[i] || urls[i]));
      const index = i + 1;
      saveState({
        state: 'launching',
        launchIndex: index,
        percent: Math.round((index / total) * 1000) / 10,
        message: `${index}/${total} demandes lancées. Aucune confirmation d’écriture n’est disponible depuis la PWA.`,
      });
      await delay(Math.max(250, Number(delayMs) || DEFAULT_DELAY_MS));
    }

    saveState({
      state: 'downloads-launched',
      launchIndex: total,
      percent: 100,
      message: 'Toutes les demandes ont été lancées. Ce 100 % n’est pas une preuve de téléchargement. La vérification réelle se fait en sélectionnant le dossier.',
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
    const duplicates = [];

    for (const file of files) {
      const relative = normalizeRelativePath(file.webkitRelativePath || file.name);
      if (relative) {
        if (byRelative.has(relative)) duplicates.push(relative);
        byRelative.set(relative, file);
      }
      const name = file.name || relative.split('/').pop() || '';
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(file);
    }

    for (const [name, matches] of byName.entries()) {
      if (matches.length > 1) duplicates.push(name);
    }

    return { byRelative, byName, duplicates: [...new Set(duplicates)] };
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
    const matchedFiles = new Set();

    for (const ref of parsed.refs) {
      const file = matchFile(ref, maps);
      if (file) {
        ordered.push(file);
        matchedFiles.add(file);
      } else {
        missing.push(fileNameFromRef(ref));
      }
    }

    const folderName = String(files[0]?.webkitRelativePath || '').split('/').filter(Boolean)[0] || 'dossier temporaire';
    const extra = files.filter((file) => !matchedFiles.has(file) && !/\.m3u8(?:\.m3u8)?$/i.test(file.name || '')).length;

    saveState({
      ...state,
      state: missing.length ? 'folder-check-failed' : 'folder-check-ok',
      manifestName,
      manifestText,
      refs: parsed.refs,
      total: parsed.refs.length,
      folderExpected: parsed.refs.length,
      folderPresent: ordered.length,
      folderMissing: missing.slice(0, 200),
      folderMissingCount: missing.length,
      folderExtra: extra,
      folderDuplicates: maps.duplicates.slice(0, 100),
      tempFolderName: folderName,
      percent: parsed.refs.length ? Math.round((ordered.length / parsed.refs.length) * 1000) / 10 : 0,
      message: missing.length
        ? `Dossier incomplet : ${ordered.length}/${parsed.refs.length} segments présents, ${missing.length} manquants.`
        : `Vérification exacte : ${ordered.length}/${parsed.refs.length} segments présents. Assemblage en cours…`,
    });

    if (missing.length) {
      const sample = missing.slice(0, 12).join('\n');
      throw new Error(`${missing.length} segment(s) manquant(s) sur ${parsed.refs.length}.\n\nPremiers fichiers manquants :\n${sample}`);
    }

    const extension = parsed.format || 'ts';
    const outputName = safeOutputName(manifestName, extension);
    const fileKey = `assembled-${Date.now()}-${Math.random().toString(16).slice(2)}.${extension}`;
    const dir = await opfsDir();
    const handle = await dir.getFileHandle(fileKey, { create: true });
    const writable = await handle.createWritable();

    let bytes = 0;
    const total = ordered.length;
    saveState({
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

  function technicalReport() {
    const state = readState() || {};
    const active = activeMedia || window.__DLSTREAM_ACTIVE_MEDIA__ || {};
    const manifest = activeManifestUrl();
    const firstUrls = Array.isArray(state.urls) ? state.urls.slice(0, 5) : [];
    const lastUrls = Array.isArray(state.urls) ? state.urls.slice(-5) : [];
    const appOrigin = location.origin;
    const mediaHost = manifest?.hostname || '';
    const mediaOrigin = manifest?.origin || '';
    const crossOrigin = Boolean(mediaOrigin && mediaOrigin !== appOrigin);

    const lines = [
      'DlStream - Rapport technique dossier HLS',
      `Date: ${new Date().toISOString()}`,
      `Build: ${cfg.build || 'inconnu'}`,
      `User-Agent: ${navigator.userAgent}`,
      `Mode PWA standalone: ${String(Boolean(window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone))}`,
      `Service Worker contrôleur: ${String(Boolean(navigator.serviceWorker?.controller))}`,
      `OPFS disponible: ${String(Boolean(navigator.storage?.getDirectory))}`,
      `webkitdirectory disponible: ${String('webkitdirectory' in document.createElement('input'))}`,
      '',
      `Page cible: ${cfg.targetUrl || ''}`,
      `Racine: ${cfg.rootHost || ''}`,
      `Média actif type: ${active.type || active.mediaType || ''}`,
      `Média actif URL: ${active.url || active.manifestUrl || ''}`,
      `Manifest en ligne: ${state.manifestUrl || manifest?.href || ''}`,
      `Manifest importé: ${state.manifestName || ''}`,
      `Origine DlStream: ${appOrigin}`,
      `Origine média: ${mediaOrigin}`,
      `Cross-origin: ${String(crossOrigin)}`,
      `Hôte média: ${mediaHost}`,
      '',
      `Segments attendus: ${Number(state.total || state.folderExpected || 0)}`,
      `Demandes lancées: ${Number(state.launchIndex || 0)}`,
      `Résultat test segment: ${state.testOutcome || 'non renseigné'}`,
      `URL segment test: ${state.testUrl || ''}`,
      `Nom segment test: ${state.testFilename || ''}`,
      '',
      `Dossier sélectionné: ${state.tempFolderName || ''}`,
      `Segments présents vérifiés: ${Number(state.folderPresent || 0)}`,
      `Segments manquants: ${Number(state.folderMissingCount || state.folderMissing?.length || 0)}`,
      `Fichiers supplémentaires: ${Number(state.folderExtra || 0)}`,
      `Doublons détectés: ${Number(state.folderDuplicates?.length || 0)}`,
      `Assemblage index: ${Number(state.importIndex || 0)}`,
      `Octets assemblés: ${Number(state.bytes || 0)}`,
      `État: ${state.state || ''}`,
      `Message: ${state.message || ''}`,
      `Erreur: ${state.error || ''}`,
      '',
      'Premières URL segments:',
      ...firstUrls,
      '',
      'Dernières URL segments:',
      ...lastUrls,
      '',
      'Premiers segments manquants:',
      ...(Array.isArray(state.folderMissing) ? state.folderMissing.slice(0, 30) : []),
      '',
      'Diagnostic téléchargement navigateur:',
      crossOrigin
        ? 'L’attribut HTML download ne peut pas forcer un téléchargement cross-origin. Si le serveur renvoie le segment en lecture/inline, Safari peut l’ouvrir au lieu de l’enregistrer.'
        : 'Le média est same-origin avec DlStream ; le comportement download dépend encore des en-têtes serveur et d’iOS.',
    ];

    return lines.join('\n');
  }

  async function copyTechnicalReport() {
    const text = technicalReport();
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  function downloadTechnicalReport() {
    const text = technicalReport();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `dlstream-rapport-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
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
    setTestOutcome,
    launchAllSegments,
    cancelLaunch,
    concatenateFolder,
    exportResult,
    removeResult,
    clearState,
    technicalReport,
    copyTechnicalReport,
    downloadTechnicalReport,
  });
})();