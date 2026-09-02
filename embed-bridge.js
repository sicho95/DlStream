(() => {
  if (window.__DLSTREAM_EMBED_BRIDGE__) return;
  window.__DLSTREAM_EMBED_BRIDGE__ = true;

  const genericPlayers = new Map();
  let wrappedApi = null;

  function normalize(value, base = document.baseURI || location.href) {
    try {
      const url = new URL(String(value || ''), base);
      return ['http:', 'https:'].includes(url.protocol) ? url : null;
    } catch {
      return null;
    }
  }

  function itemFrom(frame, value, providerHint = '') {
    const url = normalize(value);
    if (!url) return null;
    const helper = window.DlStreamDirectEmbeds;
    if (frame && helper?.looksLikePlayerFrame && !helper.looksLikePlayerFrame(frame, url)) return null;

    const provider = providerHint || helper?.providerFor?.(url) || url.hostname.replace(/^www\./, '');
    const pathParts = url.pathname.split('/').filter(Boolean);
    const id = pathParts.at(-1) || url.searchParams.get('id') || url.searchParams.get('v') || '';

    return {
      provider,
      id,
      canonicalUrl: url.href,
      openUrl: url.href,
      embedUrl: url.href,
      host: url.hostname.toLowerCase(),
      sourcePage: window.__DLSTREAM__?.targetUrl || location.href,
      visible: Boolean(frame?.getClientRects?.().length || frame?.offsetWidth || frame?.offsetHeight),
      generic: true,
      lastSeen: Date.now(),
    };
  }

  function publish(item) {
    if (!item?.canonicalUrl) return;
    genericPlayers.set(item.canonicalUrl, { ...genericPlayers.get(item.canonicalUrl), ...item, lastSeen: Date.now() });
  }

  function scan() {
    document.querySelectorAll?.('iframe[src]').forEach((frame) => {
      const raw = frame.getAttribute('src') || frame.src;
      const item = itemFrom(frame, raw);
      if (item) publish(item);
    });
  }

  function bestGeneric() {
    return [...genericPlayers.values()]
      .sort((a, b) => ((b.visible ? 1000 : 0) + Number(b.lastSeen || 0) / 1e13)
        - ((a.visible ? 1000 : 0) + Number(a.lastSeen || 0) / 1e13))[0] || null;
  }

  function installApiBridge() {
    const api = window.DlStreamEmbedded;
    if (!api || api.__genericBridge || api === wrappedApi) return;

    const activeProvider = api.activeProvider?.bind(api);
    const list = api.list?.bind(api);
    const launch = api.launch?.bind(api);
    const copyCommand = api.copyCommand?.bind(api);

    wrappedApi = Object.freeze({
      ...api,
      activeProvider() {
        return activeProvider?.() || bestGeneric();
      },
      list() {
        const base = Array.isArray(list?.()) ? list() : [];
        const seen = new Set(base.map((item) => item?.canonicalUrl || item?.openUrl));
        return [...base, ...[...genericPlayers.values()].filter((item) => !seen.has(item.canonicalUrl))];
      },
      launch(item) {
        const selected = item || activeProvider?.() || bestGeneric();
        if (!selected) throw new Error('Aucun lecteur embarqué détecté.');
        if (!selected.generic && launch) return launch(selected);
        if (!window.DlStreamAShell?.launchEmbedded) throw new Error('Le module yt-dlp/a-Shell n’est pas disponible.');
        return window.DlStreamAShell.launchEmbedded(selected);
      },
      async copyCommand(item) {
        const selected = item || activeProvider?.() || bestGeneric();
        if (!selected) throw new Error('Aucun lecteur embarqué détecté.');
        if (!selected.generic && copyCommand) return copyCommand(selected);
        const command = window.DlStreamAShell?.buildEmbeddedCommand?.(selected);
        if (!command) throw new Error('Impossible de générer la commande yt-dlp.');
        if (navigator.clipboard?.writeText) {
          try { await navigator.clipboard.writeText(command); return true; } catch (_) {}
        }
        const area = document.createElement('textarea');
        area.value = command;
        area.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
        document.body.appendChild(area);
        area.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (_) {}
        area.remove();
        return ok;
      },
      __genericBridge: true,
    });

    window.DlStreamEmbedded = wrappedApi;
  }

  window.addEventListener('dlstream-direct-embed', (event) => {
    const detail = event.detail || {};
    const item = itemFrom(detail.frame || null, detail.url, detail.provider || '');
    if (item) publish(item);
    installApiBridge();
  });

  new MutationObserver(scan).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src', 'allow', 'allowfullscreen', 'title', 'class', 'id'],
  });

  setInterval(() => {
    scan();
    installApiBridge();
  }, 180);
})();
