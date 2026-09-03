(() => {
  if (window.__DLSTREAM_COMPAT_STATUS__) return;
  window.__DLSTREAM_COMPAT_STATUS__ = true;

  const runtime = window.__DLSTREAM_RUNTIME_STATS__ ||= {
    errors: 0,
    rejections: 0,
    lastError: '',
  };

  window.addEventListener('error', (event) => {
    runtime.errors += 1;
    runtime.lastError = String(event?.error?.message || event?.message || event?.filename || 'Erreur JavaScript');
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    runtime.rejections += 1;
    runtime.lastError = String(event?.reason?.message || event?.reason || 'Promise rejetée');
  });

  function shortApi(item) {
    try {
      const url = new URL(item.url);
      const label = `${item.method || 'GET'} ${url.hostname}${url.pathname}${url.search}`;
      return `${label} → ${item.status || 'ERR'}`;
    } catch {
      return `${item.method || 'GET'} ${item.url || ''} → ${item.status || 'ERR'}`;
    }
  }

  function shortRoute(value) {
    try {
      const url = new URL(value);
      const route = `${url.pathname}${url.search}${url.hash}`;
      return route.length > 110 ? `${route.slice(0, 107)}…` : route;
    } catch {
      return String(value || '');
    }
  }

  function shortAsset(value) {
    try {
      const url = new URL(value);
      return url.pathname.split('/').pop() || url.hostname;
    } catch {
      return String(value || '');
    }
  }

  function mount() {
    const root = document.querySelector('#dlstream-controls')?.shadowRoot;
    const sheet = root?.querySelector('#sheet');
    if (!root || !sheet) return;

    let panel = root.querySelector('#compatStatusPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'compatStatusPanel';
      panel.className = 'section';
      panel.innerHTML = '<h3>Compatibilité</h3><div id="compatStatusText" class="subtle"></div><div id="compatApiHistory" class="subtle" style="margin-top:7px"></div>';
      const mediaSection = [...sheet.querySelectorAll('.section')]
        .find((section) => section.querySelector('h3')?.textContent?.includes('Téléchargement'));
      if (mediaSection) sheet.insertBefore(panel, mediaSection);
      else sheet.appendChild(panel);
    }

    const spa = window.__DLSTREAM_SPA_STATS__ || {};
    const transparent = window.__DLSTREAM_TRANSPARENT_STATS__ || {};
    const filter = window.__DLSTREAM_FILTER_STATS__ || {};
    const assets = window.__DLSTREAM_ASSET_STATS__ || {};
    const route = window.__DLSTREAM_ROUTE_STATS__ || {};
    const search = window.__DLSTREAM_SEARCH_STATS__ || {};
    const lines = [
      `Assets JS relayés : ${Number(assets.rewritten || 0)}`,
      `JS réellement exécutés : ${Number(assets.executed || 0)}`,
      `URL de chunks réécrites : ${Number(assets.literalRewrites || 0)}`,
      `Assets chargés (DOM) : ${Number(assets.loaded || 0)}`,
      `Assets en erreur : ${Number(assets.failed || 0)}`,
      `Scripts Location réécrits : ${Number(route.rewrittenSources || 0)}`,
      `Historique virtuel : ${Number(route.historyUpdates || 0)}`,
      `Requêtes app relayées : ${Number(spa.proxied || 0)}`,
      `Requêtes app en erreur : ${Number(spa.failed || 0)}`,
      `URL réponses restaurées : ${Number(transparent.restored || 0)}`,
      `Recherches complétées : ${Number(search.patched || 0)}`,
      `Faux médias filtrés : ${Number(filter.rejected || 0)}`,
      `Erreurs JS : ${Number(runtime.errors || 0) + Number(runtime.rejections || 0)}`,
    ];
    if (route.current) lines.push(`Route virtuelle : ${shortRoute(route.current)}`);
    if (route.lastHistory) lines.push(`Dernière route client : ${shortRoute(route.lastHistory)}`);
    if (transparent.lastUrl) lines.push(`Dernière URL réponse : ${shortRoute(transparent.lastUrl)}`);
    if (search.lastValue) lines.push(`Dernière recherche injectée : ${search.lastValue}`);
    if (assets.lastExecuted) lines.push(`Dernier JS exécuté : ${shortAsset(assets.lastExecuted)}`);
    if (assets.lastAsset) lines.push(`Dernier asset relayé : ${shortAsset(assets.lastAsset)}`);
    if (assets.lastError) lines.push(`Dernier asset en erreur : ${assets.lastError}`);
    if (spa.lastStatus) lines.push(`Dernier statut API : HTTP ${spa.lastStatus}`);
    if (spa.lastProxy) {
      try { lines.push(`Dernier domaine API : ${new URL(spa.lastProxy).hostname}`); }
      catch (_) {}
    }
    if (spa.lastError) lines.push(`Dernière erreur API : ${spa.lastError}`);
    if (runtime.lastError) lines.push(`Dernière erreur JS : ${runtime.lastError}`);
    if (filter.lastRejected) lines.push(`Dernier rejet média : ${filter.lastRejected}`);

    const text = panel.querySelector('#compatStatusText');
    if (text) {
      text.textContent = lines.join(' · ');
      text.style.wordBreak = 'break-word';
    }

    const history = panel.querySelector('#compatApiHistory');
    if (history) {
      const items = (Array.isArray(spa.history) ? spa.history : []).slice(-5);
      history.textContent = items.length ? `Derniers appels : ${items.map(shortApi).join(' | ')}` : 'Derniers appels : aucun.';
      history.style.wordBreak = 'break-word';
    }
  }

  setInterval(mount, 350);
  setTimeout(mount, 100);
})();
