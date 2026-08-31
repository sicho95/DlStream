(() => {
  const cfg = window.__DLSTREAM__;
  if (!cfg || cfg.isNested) return;

  const candidates = new Map();
  let active = null;
  let serial = 0;
  let boundButton = null;
  let shadowObserver = null;
  let rescanRequested = false;

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
    return /(?:^|\/)(?:index\.html|manifest(?:\.webmanifest|\.webm)?|sw\.js|app\.js|browser-runtime(?:-v2)?\.js|media-detector\.js|offline-downloader\.js|candidate-observer\.js|offline-ui\.js|folder-mode\.js|styles\.css|icon\.svg)$/i.test(relative)
      || /\.(?:js|css|webmanifest|svg|html)$/i.test(relative);
  }

  function keyFor(media) {
    return `${media?.type || media?.mediaType || ''}|${media?.url || media?.downloadUrl || media?.manifestUrl || ''}`;
  }

  function typePriority(media) {
    const type = String(media?.type || media?.mediaType || '').toLowerCase();
    if (type === 'direct') return 3000;
    if (type === 'hls') return 2000;
    if (type === 'dash') return 1000;
    return 0;
  }

  function mediaUrl(media) {
    return normalize(media?.url || media?.downloadUrl || media?.manifestUrl, media?.sourcePage || cfg.targetUrl);
  }

  function publishActive() {
    const media = active?.media ? { ...active.media, downloadCheck: active.check || null } : null;
    window.__DLSTREAM_ACTIVE_MEDIA__ = media;
    document.dispatchEvent(new CustomEvent('dlstream-active-media', { detail: media }));
  }

  function addBatch(list, sourcePage = cfg.targetUrl) {
    for (const raw of Array.isArray(list) ? list : []) {
      const url = normalize(raw?.url || raw?.downloadUrl || raw?.manifestUrl, sourcePage);
      if (!url || isDlStreamAsset(url)) continue;
      const item = { ...raw, url: url.href, sourcePage };
      const key = keyFor(item);
      const previous = candidates.get(key);
      if (!previous || Number(item.score || 0) >= Number(previous.media?.score || 0)) {
        candidates.set(key, { media: item, check: null });
      }
    }
    evaluate();
  }

  async function evaluate() {
    const run = ++serial;
    const entries = [...candidates.values()]
      .filter((entry) => !isDlStreamAsset(mediaUrl(entry.media)))
      .sort((a, b) => (typePriority(b.media) + Number(b.media?.score || 0)) - (typePriority(a.media) + Number(a.media?.score || 0)))
      .slice(0, 20);

    if (!entries.length) {
      active = null;
      publishActive();
      syncUi();
      return;
    }

    let bestFeasible = null;
    const bestDetected = entries[0];

    for (const entry of entries) {
      if (run !== serial) return;
      try {
        entry.check = await window.DlStreamOffline?.analyze?.(entry.media) || {
          feasible: false,
          reason: 'Analyse indisponible.',
        };
      } catch (error) {
        entry.check = {
          feasible: false,
          reason: error?.message || String(error),
        };
      }

      if (entry.check?.feasible && !bestFeasible) bestFeasible = entry;
    }

    if (run !== serial) return;
    active = bestFeasible || bestDetected;
    publishActive();
    syncUi();
  }

  function describe(entry) {
    if (!entry?.media) return 'Aucun média détecté.';
    const media = entry.media;
    const check = entry.check || {};
    const url = mediaUrl(media);
    const type = String(media.type || media.mediaType || 'inconnu').toUpperCase();
    const state = check.feasible ? 'téléchargement possible' : (check.reason || 'téléchargement non vérifié');
    return `${type} • ${state}${url ? ` • ${url.hostname}` : ''}`;
  }

  function copyTextSync(text) {
    if (!text) return false;
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
    document.body.appendChild(area);
    area.focus();
    area.select();
    try { area.setSelectionRange(0, area.value.length); } catch (_) {}
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    area.remove();
    return ok;
  }

  async function copyText(text) {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      return copyTextSync(text);
    }
  }

  function safeFileStem(value) {
    const clean = String(value || 'video')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
    return (clean || 'video').slice(0, 70);
  }

  function shellQuote(value) {
    return `'${String(value || '').replace(/'/g, `'"'"'`)}'`;
  }

  function timestampForFilename() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  }

  function buildAShellCommand() {
    const url = mediaUrl(active?.media);
    if (!url) throw new Error('Aucun média actif pour a-Shell.');
    const type = String(active?.media?.type || active?.media?.mediaType || '').toLowerCase();
    if (!['hls', 'direct'].includes(type) && !/\.(?:m3u8|mp4|m4v|mov|webm|mkv|ts)(?:$|[?#])/i.test(url.href)) {
      throw new Error('Ce média n’est pas adapté au téléchargement a-Shell.');
    }

    const title = safeFileStem(active?.media?.title || document.title || 'video');
    const output = `${title}-${timestampForFilename()}.mp4`;
    return `cd && mkdir -p DlStream && cd DlStream && ffmpeg -y -i ${shellQuote(url.href)} -c copy ${shellQuote(output)}`;
  }

  function openInVlc() {
    const url = mediaUrl(active?.media);
    if (!url) return;
    location.href = `vlc://${url.href}`;
  }

  function openInAShell(button) {
    let command;
    try {
      command = buildAShellCommand();
    } catch (error) {
      alert(error?.message || String(error));
      return;
    }

    const copied = copyTextSync(command);
    button.textContent = copied ? 'Commande copiée' : 'Ouvre a-Shell';
    button.title = copied
      ? 'Commande copiée. Colle-la dans a-Shell puis valide.'
      : 'a-Shell va s’ouvrir. Utilise « Copier commande » si le presse-papiers n’a pas été rempli.';

    const link = document.createElement('a');
    link.href = 'ashell://';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function copyAShellCommand(button) {
    let command;
    try {
      command = buildAShellCommand();
    } catch (error) {
      alert(error?.message || String(error));
      return;
    }
    const ok = await copyText(command);
    const previous = button.textContent;
    button.textContent = ok ? 'Commande copiée' : 'Échec copie';
    setTimeout(() => { button.textContent = previous; }, 1200);
  }

  async function copyActiveUrl(button) {
    const url = mediaUrl(active?.media);
    if (!url) return;
    const ok = await copyText(url.href);
    const previous = button.textContent;
    button.textContent = ok ? 'Copié' : 'Échec copie';
    setTimeout(() => { button.textContent = previous; }, 1200);
  }

  async function handleDownload(event) {
    if (!active?.media) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const check = active.check || await window.DlStreamOffline?.analyze?.(active.media);
    active.check = check || { feasible: false, reason: 'Analyse indisponible.' };
    publishActive();
    syncUi();

    if (!active.check?.feasible) {
      const url = mediaUrl(active.media);
      alert(`DlStream a bien détecté un média, mais le téléchargement n'est pas réalisable directement.\n\n${active.check?.reason || 'Cause inconnue.'}\n\nType : ${active.media.type || active.media.mediaType || 'inconnu'}\nURL : ${url?.href || ''}\n\nTu peux utiliser « a-Shell », « VLC », « Copier URL » ou le mode « Dossier temporaire » dans le menu DlStream.`);
      return;
    }

    try {
      await window.DlStreamOffline?.download?.({ ...active.media, downloadCheck: active.check });
    } catch (error) {
      alert(error?.message || String(error));
    }
  }

  function ensureActionButtons(root, state) {
    let actions = root.querySelector('#candidateActions');
    if (!actions) {
      actions = document.createElement('div');
      actions.id = 'candidateActions';
      actions.style.cssText = 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap';

      const ashell = document.createElement('button');
      ashell.id = 'openAShell';
      ashell.type = 'button';
      ashell.textContent = 'a-Shell';
      ashell.title = 'Copier une commande ffmpeg simple puis ouvrir a-Shell';
      ashell.style.cssText = 'pointer-events:auto;min-height:38px;border:1px solid #44444a;border-radius:10px;background:#2b2b30;color:#fff;padding:7px 12px';
      ashell.addEventListener('click', () => openInAShell(ashell));

      const copyAShell = document.createElement('button');
      copyAShell.id = 'copyAShellCommand';
      copyAShell.type = 'button';
      copyAShell.textContent = 'Copier commande';
      copyAShell.title = 'Copier uniquement la commande ffmpeg pour a-Shell';
      copyAShell.style.cssText = 'pointer-events:auto;min-height:38px;border:1px solid #44444a;border-radius:10px;background:#2b2b30;color:#fff;padding:7px 12px';
      copyAShell.addEventListener('click', () => copyAShellCommand(copyAShell));

      const vlc = document.createElement('button');
      vlc.id = 'openVlc';
      vlc.type = 'button';
      vlc.textContent = 'VLC';
      vlc.style.cssText = 'pointer-events:auto;min-height:38px;border:1px solid #44444a;border-radius:10px;background:#2b2b30;color:#fff;padding:7px 12px';
      vlc.addEventListener('click', openInVlc);

      const copy = document.createElement('button');
      copy.id = 'copyMediaUrl';
      copy.type = 'button';
      copy.textContent = 'Copier URL';
      copy.style.cssText = 'pointer-events:auto;min-height:38px;border:1px solid #44444a;border-radius:10px;background:#2b2b30;color:#fff;padding:7px 12px';
      copy.addEventListener('click', () => copyActiveUrl(copy));

      actions.append(ashell, copyAShell, vlc, copy);
      state?.parentElement?.appendChild(actions);
    }
    return actions;
  }

  function bindShadowUi() {
    const host = document.querySelector('#dlstream-controls');
    const root = host?.shadowRoot;
    if (!root) return false;

    const button = root.querySelector('#download');
    const state = root.querySelector('#mediaState');
    if (!button) return false;

    const actions = ensureActionButtons(root, state);

    if (boundButton !== button) {
      boundButton?.removeEventListener('click', handleDownload, true);
      boundButton = button;
      button.addEventListener('click', handleDownload, true);

      shadowObserver?.disconnect();
      shadowObserver = new MutationObserver(() => {
        if (active?.media && button.hidden) button.hidden = false;
      });
      shadowObserver.observe(button, { attributes: true, attributeFilter: ['hidden'] });
    }

    if (active?.media) {
      button.hidden = false;
      button.style.opacity = active.check?.feasible ? '1' : '.72';
      button.title = active.check?.feasible ? 'Télécharger' : 'Média détecté : voir le diagnostic';
      if (actions) actions.hidden = false;
      if (state) state.textContent = describe(active);
    } else {
      button.hidden = true;
      if (actions) actions.hidden = true;
      if (state) state.textContent = 'Aucun média détecté.';
    }

    return true;
  }

  function syncUi() {
    if (bindShadowUi()) return;
    setTimeout(bindShadowUi, 250);
  }

  function requestFreshScan() {
    if (rescanRequested || !window.DlStreamMediaDetector?.scan) return;
    rescanRequested = true;
    queueMicrotask(() => {
      try { window.DlStreamMediaDetector.scan(); } catch (_) {}
    });
  }

  function wrapDlStream() {
    const api = window.DlStream;
    if (!api || api.__candidateObserverWrapped) {
      if (api?.__candidateObserverWrapped) requestFreshScan();
      return;
    }

    const originalExposeCandidates = api.exposeCandidates?.bind(api);
    const originalExposeMedia = api.exposeMedia?.bind(api);

    const wrapped = {
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

    try {
      window.DlStream = wrapped;
      requestFreshScan();
    } catch (_) {}
  }

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.data?.type !== 'DLSTREAM_NESTED_MEDIA_BATCH') return;
    addBatch(event.data.media || [], event.data.sourcePage || cfg.targetUrl);
  });

  document.addEventListener('dlstream-media-changed', (event) => {
    if (event.detail) addBatch([event.detail], event.detail.sourcePage || cfg.targetUrl);
    queueMicrotask(syncUi);
  });

  wrapDlStream();
  const wrapTimer = setInterval(() => {
    wrapDlStream();
    bindShadowUi();
    requestFreshScan();
    if (document.readyState === 'complete' && window.DlStream?.__candidateObserverWrapped && document.querySelector('#dlstream-controls')?.shadowRoot && rescanRequested) {
      clearInterval(wrapTimer);
    }
  }, 250);
})();
