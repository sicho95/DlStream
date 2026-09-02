(() => {
  if (window.__DLSTREAM_COMPAT_STATUS__) return;
  window.__DLSTREAM_COMPAT_STATUS__ = true;

  function mount() {
    const root = document.querySelector('#dlstream-controls')?.shadowRoot;
    const sheet = root?.querySelector('#sheet');
    if (!root || !sheet) return;

    let panel = root.querySelector('#compatStatusPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'compatStatusPanel';
      panel.className = 'section';
      panel.innerHTML = '<h3>Compatibilité</h3><div id="compatStatusText" class="subtle"></div>';
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
      `Faux médias filtrés : ${Number(filter.rejected || 0)}`,
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
    if (filter.lastRejected) lines.push(`Dernier rejet média : ${filter.lastRejected}`);

    const text = panel.querySelector('#compatStatusText');
    if (text) {
      text.textContent = lines.join(' · ');
      text.style.wordBreak = 'break-word';
    }
  }

  setInterval(mount, 350);
  setTimeout(mount, 150);
})();
