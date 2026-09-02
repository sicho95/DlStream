(() => {
  if (window.__DLSTREAM_UI_FIXES__) return;
  window.__DLSTREAM_UI_FIXES__ = true;

  function apply() {
    const root = document.querySelector('#dlstream-controls')?.shadowRoot;
    if (!root) return;

    if (!root.querySelector('#dlstreamUiFixStyle')) {
      const style = document.createElement('style');
      style.id = 'dlstreamUiFixStyle';
      style.textContent = '#candidateActions[hidden],#ashellInfoPanel[hidden]{display:none!important}';
      root.appendChild(style);
    }

    const actions = root.querySelector('#candidateActions');
    if (actions) actions.style.display = actions.hidden ? 'none' : 'flex';
  }

  setInterval(apply, 250);
  setTimeout(apply, 100);
})();
