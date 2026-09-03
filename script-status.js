(() => {
  if (window.__DLSTREAM_SCRIPT_STATUS__) return;
  window.__DLSTREAM_SCRIPT_STATUS__ = true;

  function short(value) {
    try {
      const url = new URL(String(value || ''), location.href);
      return url.pathname.split('/').pop() || url.hostname;
    } catch {
      return String(value || '');
    }
  }

  function mount() {
    const root = document.querySelector('#dlstream-controls')?.shadowRoot;
    const panel = root?.querySelector('#compatStatusPanel');
    if (!root || !panel) return;

    let text = root.querySelector('#scriptStatusText');
    if (!text) {
      text = document.createElement('div');
      text.id = 'scriptStatusText';
      text.className = 'subtle';
      text.style.cssText = 'margin-top:7px;word-break:break-word';
      panel.appendChild(text);
    }

    const s = window.__DLSTREAM_SCRIPT_STATS__ || {};
    const parts = [
      `Scripts externes DOM : ${Number(s.external || 0)}`,
      `Scripts virtuels : ${Number(s.virtual || 0)}`,
      `Scripts assainis : ${Number(s.sanitized || 0)}`,
      `Chargements confirmés : ${Number(s.loadEvents || 0)}`,
      `Erreurs de chargement : ${Number(s.errorEvents || 0)}`,
    ];
    if (s.lastLoaded) parts.push(`Dernier script chargé : ${short(s.lastLoaded)}`);
    if (s.lastError) parts.push(`Dernier script en erreur : ${short(s.lastError)}`);
    text.textContent = parts.join(' · ');
  }

  setInterval(mount, 350);
  setTimeout(mount, 100);
})();
