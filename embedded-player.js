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
    const canonicalUrl = id ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : url.href;
    return { provider: 'YouTube', id, canonicalUrl, openUrl: canonicalUrl };
  }

  function vimeo(url) {
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!(host === 'vimeo.com' || host === 'player.vimeo.com')) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const videoIndex = parts.indexOf('video');
    const id = videoIndex >= 0 ? parts[videoIndex + 1] || '' : parts.find((part) => /^\d+$/.test(part)) || '';
    const canonicalUrl = id ? `https://vimeo.com/${id}` : url.href;
    return { provider: 'Vimeo', id, canonicalUrl, openUrl: canonicalUrl };
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
    const canonicalUrl = id ? `https://www.dailymotion.com/video/${id}` : url.href;
    return { provider: 'Dailymotion', id, canonicalUrl, openUrl: canonicalUrl };
  }

  function twitch(url) {
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (!(host === 'twitch.tv' || host === 'player.twitch.tv')) return null;
    const parts = url.pathname.split('/').filter(Boolean);
    const videoQuery = url.searchParams.get('video') || '';
    const channel = url.searchParams.get('channel') || '';
    const videoPath = parts[0] === 'videos' ? parts[1] || '' : '';
    const videoId = String(videoQuery || videoPath).replace(/^v/i, '');
    const id = videoId || channel;
    const canonicalUrl = videoId
      ? `https://www.twitch.tv/videos/${encodeURIComponent(videoId)}`
      : channel ? `https://www.twitch.tv/${encodeURIComponent(channel)}` : url.href;
    return { provider: 'Twitch', id, canonicalUrl, openUrl: canonicalUrl };
  }

  function generic(url, node) {
    const path = `${url.hostname}${url.pathname}`.toLowerCase();
    const hint = `${node?.getAttribute?.('title') || ''} ${node?.getAttribute?.('allow') || ''}`.toLowerCase();
    if (!/(?:\/embed(?:\/|$)|\/player(?:\/|$)|\/video(?:\/|$)|^player\.)/i.test(path)
        && !/(?:video|player|lecture|stream|autoplay)/i.test(hint)) return null;
    return {
      provider: 'Lecteur externe',
      id: '',
      canonicalUrl: url.href,
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
    return `${item.provider}|${item.id || item.canonicalUrl || item.openUrl}`;
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

  function launch(item = activeProvider()) {
    if (!item) throw new Error('Aucun lecteur embarqué détecté.');
    if (!window.DlStreamAShell?.launchEmbedded) throw new Error('Le module yt-dlp/a-Shell n’est pas disponible.');
    return window.DlStreamAShell.launchEmbedded(item);
  }

  async function copyCommand(item = activeProvider()) {
    if (!item) throw new Error('Aucun lecteur embarqué détecté.');
    const command = window.DlStreamAShell?.buildEmbeddedCommand?.(item);
    if (!command) throw new Error('Impossible de générer la commande yt-dlp.');
    if (navigator.clipboard?.writeText) {
      try { await navigator.clipboard.writeText(command); return true; } catch (_) {}
    }
    const area = document.createElement('textarea');
    area.value = command;
    area.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    area.remove();
    return ok;
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

  function ensurePanel(root) {
    let panel = root.querySelector('#embeddedProviderPanel');
    if (panel) return panel;
    const sheet = root.querySelector('#sheet');
    if (!sheet) return null;

    panel = document.createElement('div');
    panel.id = 'embeddedProviderPanel';
    panel.className = 'section';
    panel.hidden = true;
    panel.innerHTML = '<h3>Lecteurs embarqués</h3><div class="subtle">Si aucune URL directe/HLS/DASH exploitable n’est détectée, DlStream reconstruit l’URL canonique du lecteur et la délègue à yt-dlp dans a-Shell.<br>À installer une seule fois dans a-Shell : <code>pip install --upgrade yt-dlp</code>.<br>MP4/M4A est préféré ; un éventuel WebM n’est que remuxé si possible, sans réencodage vidéo lourd automatique.</div><div id="embeddedProviderList"></div>';

    const mediaSection = [...sheet.querySelectorAll('.section')].find((section) => section.querySelector('h3')?.textContent?.includes('Téléchargement'));
    if (mediaSection) sheet.insertBefore(panel, mediaSection);
    else sheet.appendChild(panel);
    return panel;
  }

  function buttonStyle(button, primary = false) {
    button.style.cssText = `min-height:32px;border:1px solid ${primary ? '#fff' : '#44444a'};border-radius:9px;background:${primary ? '#fff' : '#2b2b30'};color:${primary ? '#000' : '#fff'};padding:5px 8px${primary ? ';font-weight:700' : ''}`;
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
      const row = document.createElement('div');
      row.style.cssText = 'margin-top:7px;padding:8px;border-radius:10px;background:#18181b;border:1px solid #34343a';

      const title = document.createElement('div');
      title.style.cssText = 'font-size:11px;font-weight:700';
      title.textContent = item.provider;

      const host = document.createElement('div');
      host.style.cssText = 'font-size:9px;color:#9999a2;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      host.textContent = item.id ? `${item.host} · ID ${item.id}` : item.host;

      const note = document.createElement('div');
      note.style.cssText = 'font-size:9px;color:#8f8f98;line-height:1.35;margin-top:5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      note.textContent = item.canonicalUrl || item.openUrl;

      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:7px;flex-wrap:wrap;margin-top:7px';

      const download = document.createElement('button');
      download.type = 'button';
      download.textContent = 'Télécharger avec yt-dlp';
      buttonStyle(download, true);
      download.onclick = () => {
        try { launch(item); } catch (error) { alert(error?.message || String(error)); }
      };

      const copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = 'Copier commande';
      buttonStyle(copy);
      copy.onclick = async () => {
        const ok = await copyCommand(item).catch(() => false);
        const previous = copy.textContent;
        copy.textContent = ok ? 'Commande copiée' : 'Échec copie';
        setTimeout(() => { copy.textContent = previous; }, 1000);
      };

      const open = document.createElement('button');
      open.type = 'button';
      open.textContent = `Ouvrir dans ${item.provider}`;
      buttonStyle(open);
      open.onclick = () => window.open(item.openUrl, '_blank', 'noopener');

      actions.append(download, copy, open);
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
      download.title = `Télécharger avec a-Shell (yt-dlp · ${item.provider})`;
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
    try { launch(item); } catch (error) { alert(error?.message || String(error)); }
  }, true);

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.data?.type !== 'DLSTREAM_EMBEDDED_PROVIDER_BATCH') return;
    for (const item of Array.isArray(event.data.providers) ? event.data.providers : []) {
      if (item?.provider && (item?.canonicalUrl || item?.openUrl)) publish(item);
    }
    render();
    syncDownloadFallback();
  });

  window.DlStreamEmbedded = Object.freeze({
    activeProvider,
    identify,
    launch,
    copyCommand,
    list: () => [...providers.values()],
  });

  new MutationObserver(schedule).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src','data-src','data-url','data','title','allow'],
  });
  window.addEventListener('load', schedule);
  window.addEventListener('dlstream-domains-updated', schedule);
  setInterval(() => {
    scan();
    syncDownloadFallback();
    if (mountedRoot) render();
  }, 500);
  setTimeout(scan, 300);
})();
