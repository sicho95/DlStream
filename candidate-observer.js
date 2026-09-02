(() => {
  const cfg = window.__DLSTREAM__;
  if (!cfg || cfg.isNested) return;

  const DIRECT_EXT_RE = /\.(mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|mpe|m2v|m2ts|mts|ts|vob|ogv|ogg|3gp|3g2|wmv|flv|f4v|asf|divx|rm|rmvb)(?:$|[?#])/i;
  const candidates = new Map();
  let activeKey = '';
  let manualSelection = false;
  let wrapped = false;

  function normalize(value, base = cfg.targetUrl) {
    try {
      const url = new URL(String(value || ''), base);
      return ['http:', 'https:'].includes(url.protocol) ? url : null;
    } catch {
      return null;
    }
  }

  function appBase() {
    try { return new URL(cfg.appEntry); } catch { return null; }
  }

  function isDlStreamAsset(url) {
    const app = appBase();
    if (!url || !app || url.origin !== app.origin) return false;
    const basePath = app.pathname.endsWith('/') ? app.pathname : `${app.pathname}/`;
    if (!url.pathname.startsWith(basePath)) return false;
    const relative = url.pathname.slice(basePath.length).toLowerCase();
    if (!relative) return true;
    return /(?:^|\/)(?:index\.html|manifest(?:\.webmanifest|\.webm)?|sw\.js|app\.js|browser-runtime\.js|media-detector\.js|offline-downloader\.js|candidate-observer\.js|ashell-safe\.js|platform-manager\.js|styles\.css|icon\.svg)$/i.test(relative)
      || /\.(?:js|css|webmanifest|svg|html)$/i.test(relative);
  }

  function mediaUrl(media) {
    return normalize(media?.url || media?.downloadUrl || media?.manifestUrl, media?.sourcePage || cfg.targetUrl);
  }

  function keyFor(media) {
    const url = mediaUrl(media);
    return `${String(media?.type || media?.mediaType || '').toLowerCase()}|${url?.href || ''}`;
  }

  function kind(media) {
    const url = mediaUrl(media);
    return DIRECT_EXT_RE.test(url?.href || '') ? 'direct' : 'stream';
  }

  function isStrongMedia(media) {
    const type = String(media?.type || media?.mediaType || '').toLowerCase();
    return kind(media) === 'direct' || type === 'hls' || type === 'dash';
  }

  function typePriority(media) {
    const type = String(media?.type || media?.mediaType || '').toLowerCase();
    if (type === 'direct') return kind(media) === 'direct' ? 4000 : 2400;
    if (type === 'hls') return 3000;
    if (type === 'dash') return 2600;
    if (type === 'stream') return 2200;
    return 0;
  }

  function sortedEntries() {
    return [...candidates.entries()]
      .sort((a, b) => (typePriority(b[1]) + Number(b[1]?.score || 0)) - (typePriority(a[1]) + Number(a[1]?.score || 0)))
      .slice(0, 40);
  }

  function embeddedProvider() {
    try { return window.DlStreamEmbedded?.activeProvider?.() || null; }
    catch { return null; }
  }

  function refreshAutoSelection() {
    if (manualSelection && candidates.has(activeKey)) return;
    manualSelection = false;
    const entries = sortedEntries();
    const embedded = embeddedProvider();
    const preferred = embedded ? entries.find(([, media]) => isStrongMedia(media)) : entries[0];
    activeKey = preferred?.[0] || '';
  }

  function activeMedia() {
    refreshAutoSelection();
    return candidates.get(activeKey) || null;
  }

  function publishActive() {
    const media = activeMedia();
    window.__DLSTREAM_ACTIVE_MEDIA__ = media ? { ...media } : null;
    document.dispatchEvent(new CustomEvent('dlstream-active-media', { detail: window.__DLSTREAM_ACTIVE_MEDIA__ }));
  }

  function addBatch(list, sourcePage = cfg.targetUrl) {
    for (const raw of Array.isArray(list) ? list : []) {
      const url = normalize(raw?.url || raw?.downloadUrl || raw?.manifestUrl, sourcePage);
      if (!url || isDlStreamAsset(url)) continue;
      const media = { ...raw, url: url.href, sourcePage };
      const key = keyFor(media);
      const previous = candidates.get(key);
      if (!previous || Number(media?.score || 0) >= Number(previous?.score || 0)) candidates.set(key, media);
    }

    if (!candidates.has(activeKey)) manualSelection = false;
    refreshAutoSelection();
    publishActive();
    syncUi();
  }

  function filenameFor(media) {
    if (media?.filename) return String(media.filename);
    const url = mediaUrl(media);
    try { return decodeURIComponent(url?.pathname?.split('/').filter(Boolean).pop() || 'video'); }
    catch { return 'video'; }
  }

  function smartDownload(media) {
    if (!media) return;
    if (!window.DlStreamAShell?.launch) throw new Error('Le module a-Shell n’est pas disponible.');
    window.DlStreamAShell.launch(media);
  }

  function buttonStyle(button) {
    button.style.cssText = 'pointer-events:auto;min-height:36px;border:1px solid #44444a;border-radius:10px;background:#2b2b30;color:#fff;padding:7px 10px';
  }

  function ensureActions(root, state) {
    root.querySelector('#offlineJobPanel')?.remove();
    root.querySelector('#folderModePanel')?.remove();
    root.querySelector('#openVlc')?.remove();
    root.querySelector('#copyMediaUrl')?.remove();

    let actions = root.querySelector('#candidateActions');
    if (!actions) {
      actions = document.createElement('div');
      actions.id = 'candidateActions';
      actions.style.cssText = 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap';

      const launch = document.createElement('button');
      launch.id = 'openAShell';
      launch.type = 'button';
      launch.textContent = 'Lancer avec a-Shell';
      buttonStyle(launch);

      const copy = document.createElement('button');
      copy.id = 'copyAShellCommand';
      copy.type = 'button';
      copy.textContent = 'Copier commande';
      buttonStyle(copy);

      const info = document.createElement('button');
      info.id = 'ashellInfoButton';
      info.type = 'button';
      info.textContent = 'ⓘ a-Shell';
      buttonStyle(info);

      actions.append(launch, copy, info);
      state?.parentElement?.appendChild(actions);
    }
    return actions;
  }

  function ensureInfo(root, state) {
    let panel = root.querySelector('#ashellInfoPanel');
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = 'ashellInfoPanel';
    panel.hidden = true;
    panel.style.cssText = 'margin-top:9px;padding:10px;border-radius:11px;background:#18181b;border:1px solid #34343a;font-size:11px;line-height:1.45;color:#d4d4da';
    panel.innerHTML = `
      <strong style="display:block;margin-bottom:6px">Configurer a-Shell une seule fois</strong>
      <div>1. Installer <strong>a-Shell</strong> depuis l’App Store.</div>
      <div>2. Ouvrir a-Shell et exécuter <code style="user-select:all">pip install --upgrade yt-dlp</code>.</div>
      <div>3. Dans Raccourcis, créer un raccourci nommé exactement <strong>DlStream a-Shell</strong>.</div>
      <div>4. Ajouter <strong>Obtenir le presse-papiers</strong>.</div>
      <div>5. Ajouter l’action a-Shell <strong>Exécuter</strong> et lui donner la variable <strong>Presse-papiers</strong>.</div>
      <div>6. Régler <strong>Ouvrir l’application</strong> sur toujours / dans l’app pour que curl, ffmpeg et yt-dlp soient disponibles.</div>
      <div style="margin-top:7px;color:#a8a8b0">La flèche choisit automatiquement : <strong>curl</strong> pour un fichier complet avec extension ; <strong>ffmpeg</strong> pour HLS/DASH ; <strong>yt-dlp</strong> pour un lecteur embarqué reconnu lorsqu’aucune source complète/HLS/DASH n’est disponible ; sinon <strong>ffmpeg</strong> reste utilisé pour les endpoints vidéo opaques. Pour yt-dlp, MP4/M4A est préféré. Un éventuel WebM n’est que remuxé en MP4 lorsque les codecs le permettent : <strong>aucun réencodage vidéo lourd n’est lancé automatiquement</strong>.</div>
      <div style="margin-top:7px;color:#a8a8b0">Les fichiers sont enregistrés dans <strong>~/Documents</strong>, visibles dans <strong>Fichiers → a-Shell</strong>.</div>`;
    state?.parentElement?.appendChild(panel);
    return panel;
  }

  function ensureList(root, state) {
    let list = root.querySelector('#candidateList');
    if (!list) {
      list = document.createElement('div');
      list.id = 'candidateList';
      list.style.cssText = 'display:grid;gap:6px;margin-top:8px';
      state?.parentElement?.insertBefore(list, root.querySelector('#candidateActions') || null);
    }
    return list;
  }

  function renderList(root, state) {
    const list = ensureList(root, state);
    list.innerHTML = '';

    for (const [key, media] of sortedEntries()) {
      const url = mediaUrl(media);
      const row = document.createElement('button');
      row.type = 'button';
      row.dataset.mediaKey = key;
      const selected = key === activeKey;
      row.style.cssText = `pointer-events:auto;text-align:left;width:100%;border:1px solid ${selected ? '#fff' : '#34343a'};border-radius:9px;background:${selected ? '#2a2a30' : '#18181b'};color:#fff;padding:7px 8px`;

      const top = document.createElement('div');
      top.style.cssText = 'font-size:11px;font-weight:700';
      const type = String(media.type || media.mediaType || 'média').toUpperCase();
      top.textContent = `${type} · ${kind(media) === 'direct' ? 'fichier complet · curl' : 'stream/endpoint · ffmpeg'}`;

      const name = document.createElement('div');
      name.style.cssText = 'font-size:10px;color:#b5b5bd;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      name.textContent = filenameFor(media);

      const host = document.createElement('div');
      host.style.cssText = 'font-size:9px;color:#85858d;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      host.textContent = url?.hostname || '';

      row.append(top, name, host);
      list.appendChild(row);
    }
  }

  function syncUi() {
    const root = document.querySelector('#dlstream-controls')?.shadowRoot;
    if (!root) return false;

    refreshAutoSelection();
    const media = candidates.get(activeKey) || null;
    const embedded = embeddedProvider();
    const download = root.querySelector('#download');
    const state = root.querySelector('#mediaState');
    const actions = ensureActions(root, state);
    const info = ensureInfo(root, state);
    renderList(root, state);

    if (download) {
      download.hidden = !(media || embedded);
      if (media) download.title = kind(media) === 'direct' ? 'Télécharger avec a-Shell (curl)' : 'Télécharger avec a-Shell (ffmpeg)';
      else if (embedded) download.title = `Télécharger avec a-Shell (yt-dlp · ${embedded.provider || 'lecteur embarqué'})`;
    }
    actions.hidden = !media;

    if (state) {
      const entries = sortedEntries();
      if (!media && embedded) state.textContent = `Lecteur embarqué détecté · ${embedded.provider || 'lecteur externe'} · yt-dlp`;
      else if (!media) state.textContent = 'Aucun média détecté.';
      else {
        const url = mediaUrl(media);
        const type = String(media.type || media.mediaType || 'média').toUpperCase();
        state.textContent = `${entries.length} média${entries.length > 1 ? 's' : ''} détecté${entries.length > 1 ? 's' : ''} · sélection : ${type} · ${kind(media) === 'direct' ? 'curl' : 'ffmpeg'} · ${url?.hostname || ''}`;
      }
    }

    if (!media) info.hidden = true;
    return true;
  }

  function bindUi() {
    const root = document.querySelector('#dlstream-controls')?.shadowRoot;
    if (!root) return;
    syncUi();
    if (root.__dlstreamSmartBound) return;
    root.__dlstreamSmartBound = true;

    root.addEventListener('click', (event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      const download = path.find((node) => node?.id === 'download');
      const mediaRow = path.find((node) => node?.dataset?.mediaKey);
      const infoButton = path.find((node) => node?.id === 'ashellInfoButton');

      if (mediaRow) {
        event.preventDefault();
        event.stopImmediatePropagation();
        activeKey = mediaRow.dataset.mediaKey;
        manualSelection = true;
        publishActive();
        syncUi();
        return;
      }

      if (infoButton) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const panel = root.querySelector('#ashellInfoPanel');
        if (panel) panel.hidden = !panel.hidden;
        return;
      }

      if (!download) return;
      const media = activeMedia();
      if (!media) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      try { smartDownload(media); }
      catch (error) { alert(error?.message || String(error)); }
    }, true);
  }

  function wrapDlStream() {
    if (wrapped) return;
    const api = window.DlStream;
    if (!api) return;

    const originalExposeCandidates = api.exposeCandidates?.bind(api);
    const originalExposeMedia = api.exposeMedia?.bind(api);

    try {
      window.DlStream = {
        ...api,
        exposeCandidates(list = []) {
          addBatch(list, cfg.targetUrl);
          return originalExposeCandidates?.(list);
        },
        exposeMedia(media = {}) {
          if (media) addBatch([media], cfg.targetUrl);
          return originalExposeMedia?.(media);
        },
        __candidateObserverWrapped: true,
      };
      wrapped = true;
      window.DlStreamMediaDetector?.scan?.();
    } catch (_) {}
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.data?.type !== 'DLSTREAM_NESTED_MEDIA_BATCH') return;
    addBatch(event.data.media || [], event.data.sourcePage || cfg.targetUrl);
  });

  document.addEventListener('dlstream-media-changed', (event) => {
    if (event.detail) addBatch([event.detail], event.detail.sourcePage || cfg.targetUrl);
  });

  setInterval(() => {
    wrapDlStream();
    bindUi();
    syncUi();
    try { window.DlStreamMediaDetector?.scan?.(); } catch (_) {}
  }, 300);
})();
