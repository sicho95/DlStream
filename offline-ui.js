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

  function buttonStyle(button) {
    button.style.cssText = 'min-height:36px;border:1px solid #44444a;border-radius:10px;background:#2b2b30;color:#fff;padding:7px 10px;font:inherit';
  }

  function createLocalPanel(root) {
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

    panel.querySelectorAll('button').forEach(buttonStyle);
    panel.querySelector('#offlinePause').addEventListener('click', () => window.DlStreamOffline?.pause?.());
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

  function createFolderPanel(root) {
    let panel = root.querySelector('#folderModePanel');
    if (panel) return panel;

    const state = root.querySelector('#mediaState');
    const section = state?.parentElement;
    if (!section) return null;

    panel = document.createElement('div');
    panel.id = 'folderModePanel';
    panel.hidden = true;
    panel.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid #36363c';
    panel.innerHTML = `
      <div style="font-size:13px;font-weight:700;margin-bottom:5px">Dossier temporaire HLS</div>
      <div style="font-size:10px;color:#9b9ba4;line-height:1.45">
        Mode expérimental pour les HLS bloqués par CORS. Choisir d’abord dans les réglages Safari/iOS un dossier temporaire comme destination des téléchargements.
      </div>
      <div id="folderState" style="font-size:11px;color:#d0d0d6;line-height:1.45;margin-top:8px"></div>
      <div style="height:7px;background:#34343a;border-radius:999px;overflow:hidden;margin-top:8px">
        <div id="folderBar" style="height:100%;width:0%;background:#fff;border-radius:999px;transition:width .2s ease"></div>
      </div>
      <div id="folderMeta" style="font-size:10px;color:#8d8d96;margin-top:6px"></div>
      <div style="font-size:10px;color:#b8b8c0;margin-top:10px">1. Récupérer le manifeste</div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:7px">
        <button id="folderOpenManifest" type="button">Ouvrir .m3u8</button>
        <button id="folderPickManifest" type="button">Choisir .m3u8</button>
      </div>
      <div style="font-size:10px;color:#b8b8c0;margin-top:10px">2. Tester puis lancer les segments</div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:7px">
        <button id="folderTestSegment" type="button">Tester 1 segment</button>
        <button id="folderLaunchAll" type="button">Lancer tous les segments</button>
        <button id="folderCancelLaunch" type="button">Arrêter la file</button>
      </div>
      <div style="font-size:10px;color:#b8b8c0;margin-top:10px">3. Sélectionner le dossier téléchargé</div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:7px">
        <button id="folderPickDirectory" type="button">Sélectionner le dossier</button>
      </div>
      <div style="font-size:10px;color:#b8b8c0;margin-top:10px">4. Fichier final</div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:7px">
        <button id="folderExportResult" type="button">Exporter le film</button>
        <button id="folderClear" type="button">Effacer le résultat local</button>
      </div>
      <input id="folderManifestInput" type="file" accept=".m3u8,application/vnd.apple.mpegurl,application/x-mpegURL,text/plain" hidden>
      <input id="folderDirectoryInput" type="file" webkitdirectory multiple hidden>`;

    panel.querySelectorAll('button').forEach(buttonStyle);

    const manifestInput = panel.querySelector('#folderManifestInput');
    const directoryInput = panel.querySelector('#folderDirectoryInput');
    directoryInput.setAttribute('webkitdirectory', '');

    panel.querySelector('#folderOpenManifest').addEventListener('click', () => {
      try { window.DlStreamFolderMode?.openManifest?.(); }
      catch (error) { alert(error?.message || String(error)); }
    });

    panel.querySelector('#folderPickManifest').addEventListener('click', () => manifestInput.click());
    manifestInput.addEventListener('change', async () => {
      try {
        const file = manifestInput.files?.[0];
        if (file) await window.DlStreamFolderMode?.importManifestFile?.(file);
      } catch (error) {
        alert(error?.message || String(error));
      } finally {
        manifestInput.value = '';
      }
    });

    panel.querySelector('#folderTestSegment').addEventListener('click', () => {
      try { window.DlStreamFolderMode?.testFirstSegment?.(); }
      catch (error) { alert(error?.message || String(error)); }
    });

    panel.querySelector('#folderLaunchAll').addEventListener('click', async () => {
      const count = Number(window.DlStreamFolderMode?.getState?.()?.total || 0);
      const ok = confirm(`DlStream va tenter de lancer ${count || 'toutes les'} demandes de téléchargement une par une.\n\nCe mode dépend du comportement de Safari et de l’hébergeur. Vérifie d’abord que « Tester 1 segment » a bien créé un fichier dans ton dossier temporaire.\n\nContinuer ?`);
      if (!ok) return;
      try { await window.DlStreamFolderMode?.launchAllSegments?.(); }
      catch (error) { alert(error?.message || String(error)); }
    });

    panel.querySelector('#folderCancelLaunch').addEventListener('click', () => window.DlStreamFolderMode?.cancelLaunch?.());

    panel.querySelector('#folderPickDirectory').addEventListener('click', () => directoryInput.click());
    directoryInput.addEventListener('change', async () => {
      try {
        const files = directoryInput.files;
        if (files?.length) await window.DlStreamFolderMode?.concatenateFolder?.(files);
      } catch (error) {
        alert(error?.message || String(error));
      } finally {
        directoryInput.value = '';
      }
    });

    panel.querySelector('#folderExportResult').addEventListener('click', async () => {
      try { await window.DlStreamFolderMode?.exportResult?.(); }
      catch (error) { alert(error?.message || String(error)); }
    });

    panel.querySelector('#folderClear').addEventListener('click', async () => {
      try { await window.DlStreamFolderMode?.removeResult?.(); }
      catch (error) { alert(error?.message || String(error)); }
    });

    section.appendChild(panel);
    return panel;
  }

  function renderLocal(job = window.DlStreamOffline?.getJob?.()) {
    const host = document.querySelector('#dlstream-controls');
    const root = host?.shadowRoot;
    if (!root) return false;

    const panel = createLocalPanel(root);
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

  function renderFolder(folderState = window.DlStreamFolderMode?.getState?.()) {
    const host = document.querySelector('#dlstream-controls');
    const root = host?.shadowRoot;
    if (!root) return false;

    const panel = createFolderPanel(root);
    if (!panel) return false;

    const active = window.__DLSTREAM_ACTIVE_MEDIA__;
    const activeType = String(active?.type || active?.mediaType || '').toLowerCase();
    const show = activeType === 'hls' || Boolean(folderState);
    panel.hidden = !show;
    if (!show) return true;

    const state = folderState || {};
    const percent = Math.max(0, Math.min(100, Number(state.percent || 0)));
    panel.querySelector('#folderBar').style.width = `${percent}%`;

    const defaultMessage = activeType === 'hls'
      ? 'HLS détecté. Pour un hébergeur sans CORS, ce mode tente de passer par les téléchargements iOS puis réassemble le dossier sélectionné.'
      : 'Mode dossier temporaire prêt.';
    panel.querySelector('#folderState').textContent = state.error ? `Erreur : ${state.error}` : (state.message || defaultMessage);

    const launch = Number(state.launchIndex || 0);
    const imported = Number(state.importIndex || 0);
    const total = Number(state.total || 0);
    const pieces = [];
    if (total) pieces.push(`${total} segments`);
    if (state.state === 'launching' || state.state === 'downloads-launched' || state.state === 'launch-paused') pieces.push(`${launch}/${total} demandes lancées`);
    if (state.state === 'assembling-folder' || state.state === 'folder-ready' || state.state === 'folder-export-requested') pieces.push(`${imported}/${total} concaténés`);
    if (state.bytes) pieces.push(formatBytes(state.bytes));
    if (state.tempFolderName) pieces.push(`dossier : ${state.tempFolderName}`);
    panel.querySelector('#folderMeta').textContent = pieces.join(' • ');

    panel.querySelector('#folderTestSegment').disabled = !state.refs?.length;
    panel.querySelector('#folderLaunchAll').disabled = !state.refs?.length || !state.urls?.length || state.state === 'launching';
    panel.querySelector('#folderCancelLaunch').hidden = state.state !== 'launching';
    panel.querySelector('#folderExportResult').hidden = !['folder-ready', 'folder-export-requested'].includes(state.state);
    panel.querySelector('#folderClear').hidden = !state.resultFileKey;
    return true;
  }

  function renderAll() {
    const a = renderLocal();
    const b = renderFolder();
    return a || b;
  }

  window.addEventListener('dlstream-offline-progress', (event) => renderLocal(event.detail));
  window.addEventListener('dlstream-folder-progress', (event) => renderFolder(event.detail));
  document.addEventListener('dlstream-active-media', () => renderFolder());

  let tries = 0;
  const timer = setInterval(() => {
    tries += 1;
    if (renderAll() || tries > 100) clearInterval(timer);
  }, 250);
})();
