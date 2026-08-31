(() => {
  const cfg = window.__DLSTREAM__;
  if (!cfg || cfg.isNested) return;

  const candidates = new Map();
  let active = null;
  let wrapped = false;

  function normalize(value, base = cfg.targetUrl) {
    try {
      const url = new URL(String(value || ''), base);
      return ['http:', 'https:'].includes(url.protocol) ? url : null;
    } catch {
      return null;
    }
  }

  function mediaUrl(media) {
    return normalize(media?.url || media?.downloadUrl || media?.manifestUrl, media?.sourcePage || cfg.targetUrl);
  }

  function keyFor(media) {
    const url = mediaUrl(media);
    return `${media?.type || media?.mediaType || ''}|${url?.href || ''}`;
  }

  function priority(media) {
    const type = String(media?.type || media?.mediaType || '').toLowerCase();
    const typeScore = type === 'direct' ? 3000 : type === 'hls' ? 2000 : type === 'dash' ? 1000 : 0;
    return typeScore + Number(media?.score || 0);
  }

  function publish() {
    const media = active ? { ...active } : null;
    window.__DLSTREAM_ACTIVE_MEDIA__ = media;
    document.dispatchEvent(new CustomEvent('dlstream-active-media', { detail: media }));
  }

  function selectBest() {
    active = [...candidates.values()].sort((a, b) => priority(b) - priority(a))[0] || null;
    publish();
    syncUi();
  }

  function addBatch(list, sourcePage = cfg.targetUrl) {
    for (const raw of Array.isArray(list) ? list : []) {
      const url = normalize(raw?.url || raw?.downloadUrl || raw?.manifestUrl, sourcePage);
      if (!url) continue;
      const media = { ...raw, url: url.href, sourcePage };
      candidates.set(keyFor(media), media);
    }
    selectBest();
  }

  function buttonStyle(button) {
    button.style.cssText = 'pointer-events:auto;min-height:38px;border:1px solid #44444a;border-radius:10px;background:#2b2b30;color:#fff;padding:7px 12px';
  }

  function ensureActions(root, state) {
    root.querySelector('#download')?.remove();
    root.querySelector('#offlineJobPanel')?.remove();
    root.querySelector('#folderModePanel')?.remove();

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

      actions.append(launch, copy);
      state?.parentElement?.appendChild(actions);
    }

    actions.querySelector('#openVlc')?.remove();
    actions.querySelector('#copyMediaUrl')?.remove();
    return actions;
  }

  function syncUi() {
    const root = document.querySelector('#dlstream-controls')?.shadowRoot;
    if (!root) return false;

    const state = root.querySelector('#mediaState');
    const actions = ensureActions(root, state);
    actions.hidden = !active;

    if (state) {
      if (!active) state.textContent = 'Aucun média détecté.';
      else {
        const type = String(active.type || active.mediaType || 'média').toUpperCase();
        const host = mediaUrl(active)?.hostname || '';
        state.textContent = `${type} détecté${host ? ` • ${host}` : ''}`;
      }
    }
    return true;
  }

  function wrapDlStream() {
    if (wrapped) return;
    const api = window.DlStream;
    if (!api) return;

    const originalExposeCandidates = api.exposeCandidates?.bind(api);
    const originalExposeMedia = api.exposeMedia?.bind(api);

    const proxy = {
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
      window.DlStream = proxy;
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
    syncUi();
    if (wrapped) {
      try { window.DlStreamMediaDetector?.scan?.(); } catch (_) {}
    }
  }, 300);
})();
