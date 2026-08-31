(() => {
  const cfg = window.__DLSTREAM__;
  if (!cfg || cfg.isNested) return;

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 o';
    const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
    let n = bytes;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i += 1;
    }
    return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
  }

  function stateLabel(job) {
    if (!job) return '';
    if (job.state === 'preparing') return 'Préparation du HLS…';
    if (job.state === 'downloading') return 'Téléchargement en cours';
    if (job.state === 'paused') return 'En pause';
    if (job.state === 'ready') return 'Prêt à exporter';
    if (job.state === 'error') return `Erreur : ${job.error || 'inconnue'}`;
    return job.state || '';
  }

  function createPanel(root) {
    let panel = root.querySelector('#offlineJobPanel');
    if (panel) return panel;

    const state = root.querySelector('#mediaState');
    const section = state?.parentElement;
    if (!section) return null;

    panel = document.createElement('div');
    panel.id = 'offlineJobPanel';
    panel.hidden = true;
    panel.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid #36363c';
    panel.innerHTML = `
      <div style="font-size:13px;font-weight:700;margin-bottom:7px">Hors ligne local</div>
      <div id="offlineState" style="font-size:11px;color:#c7c7cf;line-height:1.4"></div>
      <div style="height:7px;background:#34343a;border-radius:999px;overflow:hidden;margin-top:8px">
        <div id="offlineBar" style="height:100%;width:0%;background:#fff;border-radius:999px;transition:width .2s ease"></div>
      </div>
      <div id="offlineMeta" style="font-size:10px;color:#8d8d96;margin-top:6px"></div>
      <div id="offlineActions" style="display:flex;gap:7px;flex-wrap:wrap;margin-top:9px">
        <button id="offlinePause" type="button">Pause</button>
        <button id="offlineResume" type="button">Reprendre</button>
        <button id="offlineExport" type="button">Exporter</button>
        <button id="offlineDelete" type="button">Effacer</button>
      </div>`;

    panel.querySelectorAll('button').forEach((button) => {
      button.style.cssText = 'min-height:36px;border:1px solid #44444a;border-radius:10px;background:#2b2b30;color:#fff;padding:7px 10px;font:inherit';
    });

    panel.querySelector('#offlinePause').addEventListener('click', () => {
      window.DlStreamOffline?.pause?.();
    });

    panel.querySelector('#offlineResume').addEventListener('click', async () => {
      try { await window.DlStreamOffline?.resume?.(); }
      catch (error) { alert(error?.message || String(error)); }
    });

    panel.querySelector('#offlineExport').addEventListener('click', async () => {
      try { await window.DlStreamOffline?.exportFile?.(); }
      catch (error) { alert(error?.message || String(error)); }
    });

    panel.querySelector('#offlineDelete').addEventListener('click', async () => {
      try { await window.DlStreamOffline?.removeJob?.(); }
      catch (error) { alert(error?.message || String(error)); }
    });

    section.appendChild(panel);
    return panel;
  }

  function render(job = window.DlStreamOffline?.getJob?.()) {
    const host = document.querySelector('#dlstream-controls');
    const root = host?.shadowRoot;
    if (!root) return false;

    const panel = createPanel(root);
    if (!panel) return false;

    if (!job) {
      panel.hidden = true;
      return true;
    }

    panel.hidden = false;
    const percent = Math.max(0, Math.min(100, Number(job.percent || 0)));
    panel.querySelector('#offlineBar').style.width = `${percent}%`;
    panel.querySelector('#offlineState').textContent = `${stateLabel(job)} • ${percent}%`;
    panel.querySelector('#offlineMeta').textContent = `${Number(job.index || 0)}/${Number(job.total || 0)} éléments • ${formatBytes(job.bytes)} • ${job.filename || ''}`;

    panel.querySelector('#offlinePause').hidden = job.state !== 'downloading' && job.state !== 'preparing';
    panel.querySelector('#offlineResume').hidden = !['paused', 'error'].includes(job.state);
    panel.querySelector('#offlineExport').hidden = job.state !== 'ready';
    panel.querySelector('#offlineDelete').hidden = job.state === 'downloading' || job.state === 'preparing';
    return true;
  }

  window.addEventListener('dlstream-offline-progress', (event) => render(event.detail));

  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (render() || tries > 80) clearInterval(timer);
  }, 250);
})();
