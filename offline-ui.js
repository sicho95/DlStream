(() => {
  const cfg = window.__DLSTREAM__;
  if (!cfg || cfg.isNested) return;

  function ensureFolderModeLoaded() {
    if (window.DlStreamFolderMode || document.querySelector('script[data-dlstream-folder-mode]')) return;
    const script = document.createElement('script');
    script.src = new URL(`./folder-mode.js?v=${cfg.build || '15'}`, cfg.appEntry).href;
    script.dataset.dlstreamFolderMode = '1';
    script.addEventListener('load', () => {
      window.dispatchEvent(new CustomEvent('dlstream-folder-progress', { detail: window.DlStreamFolderMode?.getState?.() || null }));
    });
    document.head.appendChild(script);
  }

  ensureFolderModeLoaded();

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
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:9px">
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
        Mode expérimental pour les HLS bloqués par CORS. Un pourcentage de file signifie « demandes lancées », pas « fichiers écrits ».
      </div>
      <div id="folderState" style="font-size:11px;color:#d0d0d6;line-height:1.45;margin-top:8px"></div>
      <div style="height:7px;background:#34343a;border-radius:999px;overflow:hidden;margin-top:8px">
        <div id="folderBar" style="height:100%;width:0%;background:#fff;border-radius:999px;transition:width .2s ease"></div>
      </div>
      <div id="folderMeta" style="font-size:10px;color:#8d8d96;margin-top:6px"></div>

      <div style="font-size:10px;color:#b8b8c0;margin-top:10px">1. Manifeste</div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:7px">
        <button id="folderOpenManifest" type="button">Lire le flux</button>
        <button id="folderPickManifest" type="button">Choisir .m3u8</button>
      </div>

      <div style="font-size:10px;color:#b8b8c0;margin-top:10px">2. Test réel d’un segment</div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:7px">
        <button id="folderTestSegment" type="button">Ouvrir 1 segment</button>
      </div>
      <div id="folderTestOutcome" hidden style="margin-top:8px">
        <div style="font-size:10px;color:#d0d0d6;margin-bottom:6px">Qu’a fait iOS ?</div>
        <div style="display:flex;gap:7px;flex-wrap:wrap">
          <button id="folderOutcomeDownloaded" type="button">Téléchargé dans Fichiers</button>
          <button id="folderOutcomeOpened" type="button">Ouvert / lu</button>
          <button id="folderOutcomeNothing" type="button">Rien</button>
        </div>
      </div>

      <div style="font-size:10px;color:#b8b8c0;margin-top:10px">3. File de segments</div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:7px">
        <button id="folderLaunchAll" type="button">Lancer tous les segments</button>
        <button id="folderCancelLaunch" type="button">Arrêter la file</button>
      </div>
      <div id="folderLaunchWarning" style="font-size:9px;color:#8d8d96;margin-top:5px;line-height:1.35"></div>

      <div style="font-size:10px;color:#b8b8c0;margin-top:10px">4. Vérification réelle et assemblage</div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:7px">
        <button id="folderPickDirectory" type="button">Sélectionner le dossier</button>
      </div>

      <div style="font-size:10px;color:#b8b8c0;margin-top:10px">5. Résultat</div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:7px">
        <button id="folderExportResult" type="button">Exporter le film</button>
        <button id="folderClear" type="button">Effacer le résultat local</button>
      </div>

      <div style="font-size:10px;color:#b8b8c0;margin-top:10px">Diagnostic</div>
      <div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:7px">
        <button id="folderDownloadReport" type="button">Rapport technique</button>
        <button id="folderCopyReport" type="button">Copier le rapport</button>
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

    panel.querySelector('#folderOutcomeDownloaded').addEventListener('click', () => window.DlStreamFolderMode?.setTestOutcome?.('downloaded'));
    panel.querySelector('#folderOutcomeOpened').addEventListener('click', () => window.DlStreamFolderMode?.setTestOutcome?.('opened'));
    panel.querySelector('#folderOutcomeNothing').addEventListener('click', () => window.DlStreamFolderMode?.setTestOutcome?.('nothing'));

    panel.querySelector('#folderLaunchAll').addEventListener('click', async () => {
      const count = Number(window.DlStreamFolderMode?.getState?.()?.total || 0);
      const ok = confirm(`DlStream va lancer ${count || 'toutes les'} demandes une par une.\n\nLe compteur ne prouve pas l’écriture dans Fichiers. La preuve réelle sera la sélection du dossier à la fin.\n\nContinuer ?`);
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

    panel.querySelector('#folderDownloadReport').addEventListener('click', () => {
      try { window.DlStreamFolderMode?.downloadTechnicalReport?.(); }
      catch (error) { alert(error?.message || String(error)); }
    });

    panel.querySelector('#folderCopyReport').addEventListener('click', async () => {
      try {
        const ok = await window.DlStreamFolderMode?.copyTechnicalReport?.();
        alert(ok ? 'Rapport copié.' : 'Impossible de copier automatiquement. Utilise « Rapport technique » pour télécharger le fichier texte.');
      } catch (error) { alert(error?.message || String(error)); }
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
    ensureFolderModeLoaded();
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
      ? 'HLS détecté. Importe le .m3u8 puis fais un test visible d’un segment.'
      : 'Mode dossier temporaire prêt.';
    panel.querySelector('#folderState').textContent = state.error ? `Erreur : ${state.error}` : (state.message || defaultMessage);

    const launch = Number(state.launchIndex || 0);
    const imported = Number(state.importIndex || 0);
    const total = Number(state.total || 0);
    const pieces = [];
    if (total) pieces.push(`${total} segments attendus`);
    if (['launching', 'downloads-launched', 'launch-paused'].includes(state.state)) pieces.push(`${launch}/${total} demandes lancées`);
    if (state.folderExpected) pieces.push(`${Number(state.folderPresent || 0)}/${Number(state.folderExpected || 0)} présents vérifiés`);
    if (state.folderMissingCount) pieces.push(`${state.folderMissingCount} manquants`);
    if (state.folderExtra) pieces.push(`${state.folderExtra} en trop`);
    if (['assembling-folder', 'folder-ready', 'folder-export-requested'].includes(state.state)) pieces.push(`${imported}/${total} concaténés`);
    if (state.bytes) pieces.push(formatBytes(state.bytes));
    if (state.tempFolderName) pieces.push(`dossier : ${state.tempFolderName}`);
    panel.querySelector('#folderMeta').textContent = pieces.join(' • ');

    const outcomeBox = panel.querySelector('#folderTestOutcome');
    outcomeBox.hidden = state.state !== 'segment-test-opened' && !state.testOutcome;

    const launchAllowed = state.testOutcome === 'downloaded';
    panel.querySelector('#folderTestSegment').disabled = !state.refs?.length;
    panel.querySelector('#folderLaunchAll').disabled = !launchAllowed || !state.refs?.length || !state.urls?.length || state.state === 'launching';
    panel.querySelector('#folderCancelLaunch').hidden = state.state !== 'launching';
    panel.querySelector('#folderLaunchWarning').textContent = launchAllowed
      ? 'Test confirmé comme téléchargé. La file peut être tentée, mais seule la vérification du dossier prouvera le résultat final.'
      : 'La file reste désactivée jusqu’à ce que le test d’un segment ait réellement créé un fichier dans Fichiers.';

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