(() => {
  const providers = new Map();
  let mountedRoot = null;
  let scanTimer = null;

  function cfg() {
    return window.__DLSTREAM__ || {};
  }

  function normalize(value, base = cfg().targetUrl || location.href) {
    if (!value) return null;
    try {
      const url = new URL(String(value).trim(), base);
      return ['http:', 'https:'].includes(url.protocol) ? url : null;
    } catch {
      return null;
    }
  }

  function youtube(url) {
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!['youtube.com', 'youtube-nocookie.com', 'm.youtube.com', 'youtu.be'].includes(host)) return null;
    let id = '';
    if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] || '';
    else {
      const parts = url.pathname.split('/').filter(Boolean);
      const embed = parts.indexOf('embed');
      const shorts = parts.indexOf('shorts');
      const live = parts.indexOf('live');
      if (embed >= 0) id = parts[embed + 1] || '';
      else if (shorts >= 0) id = parts[shorts + 1] || '';
      else if (live >= 0) id = parts[live + 1] || '';
      else id = url.searchParams.get('v') || '';
    }
    return {
      provider: 'YouTube',
      id,
      openUrl: id ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : url.href,
    };
  }

  function vimeo(url) {
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!(host === 'vimeo.com' || host === 'player.vimeo.com')) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const videoIndex = parts.indexOf('video');
    const id = videoIndex >= 0 ? parts[videoIndex + 1] || '' : parts.find((part) => /^\d+$/.test(part)) || '';
    return {
      provider: 'Vimeo',
      id,
      openUrl: id ? `https://vimeo.com/${id}` : url.href,
    };
  }

  function dailymotion(url) {
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!(host === 'dailymotion.com' || host === 'dai.ly')) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    let id = '';
    if (host === 'dai.ly') id = parts[0] || '';
    else {
      const videoIndex = parts.indexOf('video');
      id = videoIndex >= 0 ? parts[videoIndex + 1] || '' : '';
    }
    return {
      provider: 'Dailymotion',
      id,
      openUrl: id ? `https://www.dailymotion.com/video/${id}` : url.href,
    };
  }

  function twitch(url) {
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!(host === 'twitch.tv' || host === 'player.twitch.tv')) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const videoQuery = url.searchParams.get('video') || '';
    const channel = url.searchParams.get('channel') || '';
    const videoPath = parts[0] === 'videos' ? parts[1] || '' : '';
    const videoId = String(videoQuery || videoPath).replace(/^v/i, '');
    return {
      provider: 'Twitch',
      id: videoId || channel,
      openUrl: videoId ? `https://www.twitch.tv/videos/${encodeURIComponent(videoId)}` : channel ? `https://www.twitch.tv/${encodeURIComponent(channel)}` : url.href,
    };
  }

  function generic(url, node) {
    const path = `${url.hostname}${url.pathname}`.toLowerCase();
    const hint = `${node?.getAttribute?.('title') || ''} ${node?.getAttribute?.('allow') || ''}`.toLowerCase();
    if (!/(?:\/embed(?:\/|$)|\/player(?:\/|$)|\/video(?:\/|$)|^player\.)/i.test(path) && !/(?:video|player|lecture|stream|autoplay)/i.test(hint)) return null;
    return {
      provider: 'Lecteur externe',
      id: '',
      openUrl: url.href,
    };
  }

  function identify(url, node) {
    return youtube(url) || vimeo(url) || dailymotion(url) || twitch(url) || generic(url, node);
  }

  function providerPriority(item) {
    const values = { YouTube: 500, Vimeo: 450, Dailymotion: 430, Twitch: 410, 'Lecteur externe': 100 };
    return values[item?.provider] || 0;
  }

  function keyFor(item) {
    return `${item.provider}|${item.id || item.openUrl}`;
  }

  function publish(item) {
    const key = keyFor(item);
    const previous = providers.get(key);
    providers.set(key, { ...previous, ...item, lastSeen: Date.now() });
  }

  function activeProvider() {
    return [...providers.values()]
      .sort((a, b) => ((b.visible ? 1000 : 0) + providerPriority(b) + Number(b.lastSeen || 0) / 1e13)
        - ((a.visible ? 1000 : 0) + providerPriority(a) + Number(a.lastSeen || 0) / 1e13))[0] || null;
  }

  function providerAction(item) {
    if (!item) return null;
    if (item.provider === 'YouTube') {
      return {
        label: 'Télécharger ma vidéo',
        url: item.id ? `https://studio.youtube.com/video/${encodeURIComponent(item.id)}/edit` : 'https://studio.youtube.com/',
        note: 'YouTube Studio web : pour une vidéo mise en ligne sur ton compte, utiliser le menu ⋮ puis Télécharger. Aucun besoin d’installer l’app Studio.',
      };
    }
    if (item.provider === 'Vimeo') {
      return {
        label: 'Télécharger ma vidéo',
        url: item.openUrl,
        note: 'Vimeo : connecté comme propriétaire, ouvrir la page de la vidéo puis utiliser Télécharger si cette fonction est disponible sur le compte.',
      };
    }
    if (item.provider === 'Dailymotion') {
      return {
        label: 'Télécharger ma vidéo',
        url: 'https://www.dailymotion.com/partner',
        note: 'Dailymotion Studio : Médias → Vidéos → ⋮ → Télécharger pour une vidéo de ton compte.',
      };
    }
    if (item.provider === 'Twitch') {
      return {
        label: 'Télécharger ma vidéo',
        url: 'https://dashboard.twitch.tv/',
        note: 'Twitch : Tableau de bord des créateurs → Studio vidéo → ⋮ → Télécharger pour ta propre VOD.',
      };
    }
    return {
      label: 'Ouvrir le lecteur',
      url: item.openUrl,
      note: 'Lecteur externe détecté. Si aucune source HLS/DASH/directe n’est exposée, utiliser la fonction de téléchargement officielle du fournisseur pour ton propre contenu.',
    };
  }

  function officialDownload(item = activeProvider()) {
    const action = providerAction(item);
    if (!action?.url) return null;
    window.open(action.url, '_blank', 'noopener');
    return action;
  }

  function isProviderUrl(value) {
    const url = normalize(value);
    return Boolean(url && identify(url, null));
  }

  function scan() {
    const config = cfg();
    if (!config?.rootTrusted) return;
    const found = [];

    document.querySelectorAll('iframe[src],iframe[data-src],iframe[data-url],embed[src],object[data]').forEach((node) => {
      const raw = node.getAttribute('src') || node.getAttribute('data-src') || node.getAttribute('data-url') || node.getAttribute('data');
      const url = normalize(raw);
      if (!url) return;
      const item = identify(url, node);
      if (!item) return;
      const visible = Boolean(node.getClientRects?.().length || node.offsetWidth || node.offsetHeight);
      const value = {
        ...item,
        embedUrl: url.href,
        host: url.hostname.toLowerCase(),
        sourcePage: config.targetUrl || location.href,
        visible,
      };
      found.push(value);
      publish(value);
      window.DlStreamTrust?.learnHost?.(url.hostname);
    });

    if (config.isNested && found.length) {
      try {
        window.parent?.postMessage({ type: 'DLSTREAM_EMBEDDED_PROVIDER_BATCH', providers: found }, location.origin);
      } catch (_) {}
    }

    render();
    syncDownloadFallback();
  }

  function schedule() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 120);
  }

  function copy(value) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value).catch(() => {});
    const area = document.createElement('textarea');
    area.value = value;
    area.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
    document.body.appendChild(area);
    area.select();
    try { document.execCommand('copy'); } catch (_) {}
    area.remove();
    return Promise.resolve();
  }

  function ensurePanel(root) {
    let panel = root.querySelector('#embeddedProviderPanel');
    if (panel) return panel;
    const sheet = root.querySelector('#sheet');
    if (!sheet) return null;

    panel = document.createElement('div');
    panel.id = 'embeddedProviderPanel';
    panel.className = 'section';
    panel.hidden = true;
    panel.innerHTML = '<h3>Lecteurs embarqués</h3><div class="subtle">Une source HLS/DASH/directe reste prioritaire. Sinon DlStream bascule vers le téléchargement officiel de tes propres vidéos chez le fournisseur.</div><div id="embeddedProviderList"></div>';

    const mediaSection = [...sheet.querySelectorAll('.section')].find((section) => section.querySelector('h3')?.textContent?.includes('Téléchargement'));
    if (mediaSection) sheet.insertBefore(panel, mediaSection);
    else sheet.appendChild(panel);
    return panel;
  }

  function render() {
    const config = cfg();
    if (config.isNested) return;
    const root = document.querySelector('#dlstream-controls')?.shadowRoot;
    if (!root) return;
    mountedRoot = root;
    const panel = ensurePanel(root);
    if (!panel) return;
    const list = panel.querySelector('#embeddedProviderList');
    if (!list) return;

    const items = [...providers.values()].sort((a, b) => providerPriority(b) - providerPriority(a));
    panel.hidden = !items.length;
    list.textContent = '';

    for (const item of items) {
      const action = providerAction(item);
      const row = document.createElement('div');
      row.style.cssText = 'margin-top:7px;padding:8px;border-radius:10px;background:#18181b;border:1px solid #34343a';

      const title = document.createElement('div');
      title.style.cssText = 'font-size:11px;font-weight:700';
      title.textContent = item.provider;

      const host = document.createElement('div');
      host.style.cssText = 'font-size:9px;color:#9999a2;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      host.textContent = item.id ? `${item.host} · ${item.id}` : item.host;

      const note = document.createElement('div');
      note.style.cssText = 'font-size:9px;color:#8f8f98;line-height:1.35;margin-top:5px';
      note.textContent = action.note;

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:7px;flex-wrap:wrap;margin-top:7px';

      const downloadOwn = document.createElement('button');
      downloadOwn.type = 'button';
      downloadOwn.textContent = action.label;
      downloadOwn.style.cssText = 'min-height:32px;border:1px solid #fff;border-radius:9px;background:#fff;color:#000;padding:5px 8px;font-weight:700';
      downloadOwn.onclick = () => officialDownload(item);

      const open = document.createElement('button');
      open.type = 'button';
      open.textContent = `Ouvrir dans ${item.provider}`;
      open.style.cssText = 'min-height:32px;border:1px solid #44444a;border-radius:9px;background:#2b2b30;color:#fff;padding:5px 8px';
      open.onclick = () => window.open(item.openUrl, '_blank', 'noopener');

      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.textContent = 'Copier URL du lecteur';
      copyButton.style.cssText = open.style.cssText;
      copyButton.onclick = async () => {
        await copy(item.openUrl);
        const previous = copyButton.textContent;
        copyButton.textContent = 'URL copiée';
        setTimeout(() => { copyButton.textContent = previous; }, 1000);
      };

      actions.append(downloadOwn, open, copyButton);
      row.append(title, host, note, actions);
      list.appendChild(row);
    }
  }

  function syncDownloadFallback() {
    const config = cfg();
    if (config.isNested) return;
    const root = document.querySelector('#dlstream-controls')?.shadowRoot;
    const download = root?.querySelector('#download');
    if (!download) return;
    const media = window.__DLSTREAM_ACTIVE_MEDIA__;
    const item = activeProvider();
    if (!media && item) {
      download.hidden = false;
      download.title = `${providerAction(item)?.label || 'Ouvrir'} · ${item.provider}`;
      download.dataset.embeddedFallback = '1';
    } else {
      delete download.dataset.embeddedFallback;
    }
  }

  window.addEventListener('click', (event) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const button = path.find((node) => node?.id === 'download');
    if (!button || window.__DLSTREAM_ACTIVE_MEDIA__) return;
    const item = activeProvider();
    if (!item) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    officialDownload(item);
  }, true);

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.data?.type !== 'DLSTREAM_EMBEDDED_PROVIDER_BATCH') return;
    for (const item of Array.isArray(event.data.providers) ? event.data.providers : []) {
      if (item?.provider && item?.openUrl) publish(item);
    }
    render();
    syncDownloadFallback();
  });

  document.addEventListener('dlstream-active-media', syncDownloadFallback);
  document.addEventListener('dlstream-media-changed', syncDownloadFallback);

  window.DlStreamEmbedded = Object.freeze({
    activeProvider,
    officialDownload,
    providerAction,
    isProviderUrl,
    list: () => [...providers.values()],
  });

  new MutationObserver(schedule).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src','data-src','data-url','data','title','allow'] });
  window.addEventListener('load', schedule);
  window.addEventListener('dlstream-domains-updated', schedule);
  setInterval(() => {
    scan();
    syncDownloadFallback();
    if (mountedRoot) render();
  }, 500);
  setTimeout(scan, 300);
})();
