(() => {
  if (window.__DLSTREAM_FRAMEWORK_STATUS__) return;
  window.__DLSTREAM_FRAMEWORK_STATUS__ = true;

  function mount() {
    const root = document.querySelector('#dlstream-controls')?.shadowRoot;
    const panel = root?.querySelector('#compatStatusPanel');
    if (!root || !panel) return;

    let text = root.querySelector('#frameworkStatusText');
    if (!text) {
      text = document.createElement('div');
      text.id = 'frameworkStatusText';
      text.className = 'subtle';
      text.style.cssText = 'margin-top:7px;word-break:break-word';
      panel.appendChild(text);
    }

    const astro = window.__DLSTREAM_ASTRO_STATS__ || {};
    const route = window.__DLSTREAM_ROUTE_STATS__ || {};
    const parts = [
      `Îlots Astro : ${Number(astro.islands || 0)}`,
      `URL d’îlots relayées : ${Number(astro.rewritten || 0)}`,
      `Îlots en attente : ${Number(astro.pending || 0)}`,
    ];
    if (route.current) {
      try {
        const url = new URL(route.current);
        parts.push(`Route synchronisée : ${url.pathname}${url.search}`);
      } catch (_) {}
    }
    if (astro.lastComponent) {
      try {
        parts.push(`Dernier composant : ${new URL(astro.lastComponent, route.current || location.href).pathname.split('/').pop()}`);
      } catch (_) {}
    }
    text.textContent = parts.join(' · ');
  }

  setInterval(mount, 350);
  setTimeout(mount, 100);
})();
