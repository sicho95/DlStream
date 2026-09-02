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
    const target = event.target;
    if (target && target !== window && (target.src || target.href)) {
      runtime.lastError = `Ressource : ${target.src || target.href}`;
      return;
    }
    runtime.lastError = `${event.message || 'Erreur JS'}${event.filename ? ` — ${event.filename}` : ''}`;
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    runtime.rejections += 1;
    const reason = event.reason;
    runtime.lastError = `Promise : ${reason?.message || String(reason || 'rejet sans détail')}`;
  });

  function shortApi(entry) {
    try {
      const url = new URL(entry.url);
      const path = `${url.pathname}${url.search}`;
      return `${entry.method || 'GET'} ${url.hostname}${path.length > 90 ? `${path.slice(0, 87)}…` : path} → ${entry.status || 'ERR'}`;
    } catch {
      return `${entry.method || 'GET'} ${entry.url || ''} → ${entry.status || 'ERR'}`;
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
    const filter = window.__DLSTREAM_FILTER_STATS__ || {};
    const assets = window.__DLSTREAM_ASSET_STATS__ || {};
    const lines = [
      `Assets JS relayés : ${Number(assets.rewritten || 0)}`,
      `Assets chargés : ${Number(assets.loaded || 0)}`,
      `Assets en erreur : ${Number(assets.failed || 0)}`,
      `Requêtes app relayées : ${Number(spa.proxied || 0)}`,
      `Requêtes app en erreur : ${Number(spa.failed || 0)}`,
      `Faux médias filtrés : ${Number(filter.rejected || 0)}`,
      `Erreurs JS : ${Number(runtime.errors || 0) + Number(runtime.rejections || 0)}`,
    ];
    if (assets.lastAsset) {
      try { lines.push(`Dernier asset : ${new URL(assets.lastAsset).pathname.split('/').pop() || new URL(assets.lastAsset).hostname}`); }
      catch (_) {}
    }
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
  setTimeout(mount, 150);
})();
