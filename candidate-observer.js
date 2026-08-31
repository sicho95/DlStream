(() => {
  const cfg = window.__DLSTREAM__;
  if (!cfg || cfg.isNested) return;

  const candidates = new Map();
  let active = null;
  let serial = 0;
  let boundButton = null;
  let shadowObserver = null;

  function normalize(value, base = cfg.targetUrl) {
    try {
      const url = new URL(String(value || ''), base);
      return ['http:', 'https:'].includes(url.protocol) ? url : null;
    } catch {
      return null;
    }
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

  function addBatch(list, sourcePage = cfg.targetUrl) {
    for (const raw of Array.isArray(list) ? list : []) {
      const url = normalize(raw?.url || raw?.downloadUrl || raw?.manifestUrl, sourcePage);
      if (!url) continue;
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
      .sort((a, b) => (typePriority(b.media) + Number(b.media?.score || 0)) - (typePriority(a.media) + Number(a.media?.score || 0)))
      .slice(0, 20);

    if (!entries.length) {
      active = null;
      syncUi();
      return;
    }

    let bestFeasible = null;
    let bestDetected = entries[0];

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
    syncUi();
  }

  function describe(entry) {
    if (!entry?.media) return 'Aucun média détecté.';
    const media = entry.media;
    const check = entry.check || {};
    const url = normalize(media.url || media.downloadUrl || media.manifestUrl, media.sourcePage || cfg.targetUrl);
    const type = String(media.type || media.mediaType || 'inconnu').toUpperCase();
    const state = check.feasible ? 'téléchargement possible' : (check.reason || 'téléchargement non vérifié');
    return `${type} • ${state}${url ? ` • ${url.hostname}` : ''}`;
  }

  async function handleDownload(event) {
    if (!active?.media) return;
    event.preventDefault();
    event.stopImmediatePropagation();

    const check = active.check || await window.DlStreamOffline?.analyze?.(active.media);
    active.check = check || { feasible: false, reason: 'Analyse indisponible.' };
    syncUi();

    if (!active.check?.feasible) {
      alert(`DlStream a bien détecté un média, mais le téléchargement n'est pas réalisable directement.\n\n${active.check?.reason || 'Cause inconnue.'}\n\nType : ${active.media.type || active.media.mediaType || 'inconnu'}\nURL : ${active.media.url || active.media.downloadUrl || active.media.manifestUrl || ''}`);
      return;
    }

    try {
      await window.DlStreamOffline?.download?.({ ...active.media, downloadCheck: active.check });
    } catch (error) {
      alert(error?.message || String(error));
    }
  }

  function bindShadowUi() {
    const host = document.querySelector('#dlstream-controls');
    const root = host?.shadowRoot;
    if (!root) return false;

    const button = root.querySelector('#download');
    const state = root.querySelector('#mediaState');
    if (!button) return false;

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
    }

    if (state && active?.media) state.textContent = describe(active);
    return true;
  }

  function syncUi() {
    if (bindShadowUi()) return;
    setTimeout(bindShadowUi, 250);
  }

  function wrapDlStream() {
    const api = window.DlStream;
    if (!api || api.__candidateObserverWrapped) return;

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

    try { window.DlStream = wrapped; } catch (_) {}
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
    if (document.readyState === 'complete' && window.DlStream?.__candidateObserverWrapped && document.querySelector('#dlstream-controls')?.shadowRoot) {
      clearInterval(wrapTimer);
    }
  }, 250);
})();
