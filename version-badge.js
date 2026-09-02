(() => {
  if (window.__DLSTREAM_VERSION_BADGE__) return;
  window.__DLSTREAM_VERSION_BADGE__ = true;

  function releaseVersion() {
    return String(window.__DLSTREAM_RELEASE__ || '').trim();
  }

  function engineBuild() {
    const value = window.__DLSTREAM__?.build || window.DlStreamConfig?.build || '';
    return String(value || '').trim();
  }

  function mount() {
    const root = document.querySelector('#dlstream-controls')?.shadowRoot;
    if (!root) return;

    const title = root.querySelector('.head strong');
    if (!title) return;

    let badge = title.querySelector('#dlstreamBuildBadge');
    if (!badge) {
      badge = document.createElement('span');
      badge.id = 'dlstreamBuildBadge';
      badge.style.cssText = 'display:inline-flex;align-items:center;margin-left:7px;padding:2px 6px;border-radius:999px;background:#35353a;color:#bdbdc5;font-size:10px;font-weight:650;vertical-align:1px';
      title.appendChild(badge);
    }

    const release = releaseVersion();
    const engine = engineBuild();
    const shown = release || engine;
    badge.textContent = shown ? `v${shown}` : 'v?';
    badge.title = release && engine && release !== engine
      ? `DlStream v${release} · moteur ${engine}`
      : shown ? `DlStream v${shown}` : 'Version DlStream inconnue';
  }

  // Le document de la plateforme remplace le document de démarrage avec document.write.
  // Réinstaller le badge après chaque reconstruction du panneau DlStream.
  setInterval(mount, 250);
  window.addEventListener('load', mount);
  setTimeout(mount, 100);
})();
