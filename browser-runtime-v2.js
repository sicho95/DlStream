(() => {
  const cfg = window.__DLSTREAM__;
  if (!cfg?.targetUrl || !cfg?.appEntry || !cfg?.proxyBase) return;

  const nativeFetch = window.fetch.bind(window);
  const nativeOpen = XMLHttpRequest.prototype.open;
  const candidates = new Map();
  const directMediaHosts = new Set();
  let selectedMedia = null;
  let mediaStatus = 'Aucun média téléchargeable détecté.';
  let ui = null;

  const normalize = (value, base = document.baseURI) => {
    try { return new URL(String(value), base); } catch { return null; }
  };

  const cleanHost = (value) => {
    try {
      const raw = String(value || '').trim().toLowerCase();
      if (!raw) return '';
      return (raw.includes('://') ? new URL(raw) : new URL(`https://${raw}`)).hostname.replace(/^\*\./, '');
    } catch { return ''; }
  };

  const readJson = (key, fallback) => {
    try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; } catch { return fallback; }
  };
  const writeJson = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const domainMap = (key) => {
    const value = readJson(key, {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  };
  const hostMatches = (host, root) => host === root || host.endsWith(`.${root}`);

  function trustedRoots() {
    const values = readJson('dlstream.trustedRoots', []);
    return [...new Set((Array.isArray(values) ? values : []).map(cleanHost).filter(Boolean))];
  }
  function setTrustedRoots(values) {
    writeJson('dlstream.trustedRoots', [...new Set(values.map(cleanHost).filter(Boolean))]);
    domainsChanged();
  }
  function learnedDomains() {
    const map = domainMap('dlstream.learnedDomains');
    return [...new Set((Array.isArray(map[cfg.rootHost]) ? map[cfg.rootHost] : []).map(cleanHost).filter(Boolean))];
  }
  function setLearned(values) {
    const map = domainMap('dlstream.learnedDomains');
    map[cfg.rootHost] = [...new Set(values.map(cleanHost).filter(Boolean))].slice(0, 128);
    writeJson('dlstream.learnedDomains', map);
    domainsChanged();
  }
  function ignoredDomains() {
    const map = domainMap('dlstream.ignoredDomains');
    return [...new Set((Array.isArray(map[cfg.rootHost]) ? map[cfg.rootHost] : []).map(cleanHost).filter(Boolean))];
  }
  function setIgnored(values) {
    const map = domainMap('dlstream.ignoredDomains');
    map[cfg.rootHost] = [...new Set(values.map(cleanHost).filter(Boolean))].slice(0, 128);
    writeJson('dlstream.ignoredDomains', map);
    domainsChanged();
  }
  function rootTrusted() {
    return trustedRoots().some((root) => hostMatches(cfg.rootHost, root));
  }
  function hostAllowed(hostname) {
    const host = cleanHost(hostname);
    if (!rootTrusted() || !host) return false;
    if (hostMatches(host, cfg.rootHost)) return true;
    if (ignoredDomains().includes(host)) return false;
    return learnedDomains().includes(host);
  }
  function learnHost(hostname) {
    const host = cleanHost(hostname);
    if (!rootTrusted() || !host || hostMatches(host, cfg.rootHost) || ignoredDomains().includes(host)) return false;
    const learned = learnedDomains();
    if (learned.includes(host)) return false;
    const map = domainMap('dlstream.learnedDomains');
    map[cfg.rootHost] = [...new Set([...learned, host])].slice(0, 128);
    writeJson('dlstream.learnedDomains', map);
    domainsChanged();
    return true;
  }
  function domainsChanged() {
    window.dispatchEvent(new CustomEvent('dlstream-domains-updated'));
    ui?.renderDomains();
  }

  function proxyUrl(target) {
    const u = new URL(cfg.proxyBase);
    u.searchParams.set('url', target.href || String(target));
    return u.href;
  }
  function appUrl(target, nested = false, depth = cfg.depth || 0) {
    const u = new URL(cfg.appEntry);
    u.searchParams.set('url', target.href || String(target));
    if (nested) u.searchParams.set('nested', '1');
    if (depth) u.searchParams.set('depth', String(depth));
    return u.href;
  }
  function isUpstream(url) {
    try { return url && url.origin === new URL(cfg.targetUrl).origin; } catch { return false; }
  }

  function mediaType(url) {
    const href = url?.href || '';
    if (/\.m3u8(?:$|[?#])/i.test(href)) return 'hls';
    if (/\.mpd(?:$|[?#])/i.test(href)) return 'dash';
    if (/\.(mp4|m4v|mov|webm|mkv|avi)(?:$|[?#])/i.test(href)) return 'direct';
    return null;
  }

  function exposeNetworkMedia(url) {
    const type = mediaType(url);
    if (!type || !rootTrusted()) return;
    learnHost(url.hostname);
    directMediaHosts.add(url.hostname.toLowerCase());
    window.DlStream?.exposeMedia({
      title: document.title || 'Vidéo',
      type,
      mediaType: type,
      url: url.href,
      downloadUrl: type === 'direct' ? url.href : null,
      manifestUrl: type === 'hls' || type === 'dash' ? url.href : null,
      detectedBy: 'network-request',
    });
  }

  function shouldStayDirect(target) {
    if (!target || !rootTrusted() || !hostAllowed(target.hostname)) return false;
    return Boolean(mediaType(target) || directMediaHosts.has(target.hostname.toLowerCase()));
  }

  function proxyFetchRequest(input, init, target) {
    if (!(input instanceof Request)) return nativeFetch(proxyUrl(target), init);
    const method = input.method || 'GET';
    const requestInit = {
      method,
      headers: input.headers,
      body: ['GET', 'HEAD'].includes(method) ? undefined : input.body,
      credentials: 'omit',
      redirect: input.redirect,
      signal: input.signal,
    };
    return nativeFetch(proxyUrl(target), { ...requestInit, ...(init || {}) });
  }

  // Garder les octets média hors Cloudflare ; conserver le proxy pour les appels de la plateforme.
  window.fetch = function dlStreamFetch(input, init) {
    try {
      const target = normalize(input instanceof Request ? input.url : input);
      if (target) exposeNetworkMedia(target);
      if (shouldStayDirect(target)) return nativeFetch(input, init);
      if (isUpstream(target)) return proxyFetchRequest(input, init, target);
    } catch (_) {}
    return nativeFetch(input, init);
  };

  XMLHttpRequest.prototype.open = function dlStreamXhrOpen(method, url, ...rest) {
    const target = normalize(url);
    if (target) exposeNetworkMedia(target);
    if (shouldStayDirect(target)) return nativeOpen.call(this, method, target.href, ...rest);
    return nativeOpen.call(this, method, isUpstream(target) ? proxyUrl(target) : url, ...rest);
  };

  document.addEventListener('click', (event) => {
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor || event.defaultPrevented || anchor.hasAttribute('download')) return;
    const raw = anchor.getAttribute('href') || '';
    if (!raw || raw.startsWith('#') || raw.startsWith('javascript:') || raw.startsWith('mailto:') || raw.startsWith('tel:')) return;
    const target = normalize(anchor.href);
    if (!isUpstream(target)) return;
    event.preventDefault();
    location.assign(appUrl(target));
  }, true);

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || String(form.method || 'get').toLowerCase() !== 'get') return;
    const target = normalize(form.action || cfg.targetUrl);
    if (!isUpstream(target)) return;
    event.preventDefault();
    for (const [key, value] of new URLSearchParams(new FormData(form))) target.searchParams.set(key, value);
    location.assign(appUrl(target));
  }, true);

  function resourceUrls(node) {
    if (!(node instanceof Element)) return [];
    const attrs = [];
    if (node.matches('iframe,script,img,video,audio,source,track')) attrs.push('src');
    if (node.matches('link')) attrs.push('href');
    attrs.push('poster','data-src','data-url','data-video-url','data-file-url','data-manifest','data-manifest-url');
    return attrs.map((attr) => node.getAttribute(attr)).filter(Boolean).map((raw) => normalize(raw, cfg.targetUrl)).filter((u) => u && ['http:','https:'].includes(u.protocol));
  }

  function inspectResourceNode(node) {
    if (!(node instanceof Element)) return;
    for (const u of resourceUrls(node)) learnHost(u.hostname);
    const selector = 'iframe[src],script[src],img[src],video[src],audio[src],source[src],track[src],link[href],[poster],[data-src],[data-url],[data-video-url],[data-file-url],[data-manifest],[data-manifest-url]';
    node.querySelectorAll?.(selector).forEach((child) => resourceUrls(child).forEach((u) => learnHost(u.hostname)));
  }

  function rewriteIframe(frame) {
    if (!(frame instanceof HTMLIFrameElement) || !rootTrusted() || Number(cfg.depth || 0) >= Number(cfg.maxDepth || 4)) return;
    const target = normalize(frame.getAttribute('src'), cfg.targetUrl);
    if (!target || target.origin === location.origin) return;
    learnHost(target.hostname);
    if (!hostAllowed(target.hostname)) return;
    frame.src = appUrl(target, true, Number(cfg.depth || 0) + 1);
  }

  function inspectDynamicNode(node) {
    if (!(node instanceof Element)) return;
    inspectResourceNode(node);
    if (node instanceof HTMLIFrameElement) rewriteIframe(node);
    node.querySelectorAll?.('iframe[src]').forEach(rewriteIframe);
  }

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') mutation.addedNodes.forEach(inspectDynamicNode);
      if (mutation.type === 'attributes') inspectDynamicNode(mutation.target);
    }
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src','href','poster','data-src','data-url','data-video-url','data-file-url','data-manifest','data-manifest-url'],
  });
  inspectDynamicNode(document.documentElement);

  const mediaKey = (media) => String(media?.downloadUrl || media?.manifestUrl || media?.url || '');
  function learnMediaHost(media) {
    const u = normalize(mediaKey(media), cfg.targetUrl);
    if (!u) return;
    learnHost(u.hostname);
    if (media?.type === 'hls' || media?.type === 'direct') directMediaHosts.add(u.hostname.toLowerCase());
  }

  function priority(entry) {
    if (!entry?.check?.feasible) return 0;
    return entry.check.type === 'direct' ? 300 : entry.check.type === 'hls' ? 200 : 100;
  }

  function refreshSelection() {
    const entries = [...candidates.values()];
    const feasible = entries.filter((entry) => entry.check?.feasible).sort((a, b) => priority(b) - priority(a));
    selectedMedia = feasible[0]?.media || null;

    if (selectedMedia) {
      const chosen = feasible[0];
      const u = normalize(mediaKey(selectedMedia), cfg.targetUrl);
      const prefix = chosen.check.type === 'direct' ? 'Fichier direct' : chosen.check.format === 'mp4' ? 'HLS fMP4 recomposable' : 'HLS MPEG-TS recomposable';
      mediaStatus = `${prefix}${u ? ` • ${u.hostname}` : ''}`;
    } else if (entries.some((entry) => entry.pending)) {
      mediaStatus = 'Analyse des médias détectés…';
    } else if (entries.length) {
      mediaStatus = entries.map((entry) => entry.check?.reason).filter(Boolean)[0] || 'Média détecté mais non recomposable localement.';
    } else {
      mediaStatus = rootTrusted() ? 'Aucun média téléchargeable détecté.' : 'Racine non approuvée : analyse récursive désactivée.';
    }
    ui?.refreshMedia();
  }

  async function registerMedia(media) {
    const key = mediaKey(media);
    if (!key || !rootTrusted()) return;
    learnMediaHost(media);
    if (candidates.has(key)) return;
    const entry = { media: { ...media }, pending: true, check: null };
    candidates.set(key, entry);
    refreshSelection();
    try {
      entry.check = await window.DlStreamOffline?.analyze(entry.media) || { feasible: false, reason: 'Analyse indisponible.' };
    } catch (error) {
      entry.check = { feasible: false, reason: error?.message || String(error) };
    }
    entry.pending = false;
    refreshSelection();
  }

  function publishMedia(media) {
    if (!media) return;
    learnMediaHost(media);
    if (cfg.isNested) {
      window.parent?.postMessage({ type: 'DLSTREAM_NESTED_MEDIA', media, depth: cfg.depth || 0 }, location.origin);
      return;
    }
    registerMedia(media);
  }

  window.DlStream = Object.freeze({
    exposeMedia(media = {}) { publishMedia(media); },
    clearMedia() {},
  });

  // Chaque iframe intermédiaire relaie les découvertes de ses propres enfants vers son parent.
  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.data?.type !== 'DLSTREAM_NESTED_MEDIA') return;
    if (cfg.isNested) window.parent?.postMessage(event.data, location.origin);
    else registerMedia(event.data.media || {});
  });

  if (cfg.isNested) return;

  function makeRow(domain, action, onAction, badge = '') {
    const row = document.createElement('div');
    row.className = 'row';
    const label = document.createElement('span');
    label.textContent = badge ? `${domain} ${badge}` : domain;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = action;
    button.onclick = onAction;
    row.append(label, button);
    return row;
  }

  function recheckAll() {
    const items = [...candidates.values()].map((entry) => entry.media);
    candidates.clear();
    selectedMedia = null;
    items.forEach(registerMedia);
    refreshSelection();
  }

  function mountControls() {
    if (!document.body || document.querySelector('#dlstream-controls')) return;
    const host = document.createElement('div');
    host.id = 'dlstream-controls';
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif}button,input{font:inherit}.fab{pointer-events:auto;position:fixed;display:grid;place-items:center;border:1px solid #ffffff35;background:#101012b5;color:#fff;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px)}#menu{top:max(10px,env(safe-area-inset-top));right:max(10px,env(safe-area-inset-right));width:40px;height:40px;border-radius:50%;font-weight:800}#download{right:max(12px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));width:48px;height:48px;border-radius:50%;background:#fff;color:#000;font-size:25px;font-weight:900}#download[hidden],.sheet[hidden]{display:none}.sheet{pointer-events:auto;position:fixed;left:10px;right:10px;bottom:max(10px,env(safe-area-inset-bottom));max-height:82dvh;overflow:auto;padding:14px;border-radius:20px;background:#161619fa;color:#fff;box-shadow:0 18px 50px #0008}.head,.row{display:flex;align-items:center;justify-content:space-between;gap:8px}.close{width:34px;height:34px;border:0;border-radius:50%;background:#35353a;color:#fff;font-size:22px}label{display:grid;gap:6px;font-size:12px;color:#b4b4bb}input{width:100%;min-height:44px;border:1px solid #44444a;border-radius:11px;background:#111114;color:#fff;padding:9px 11px}.actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.actions button,.row button,.small{min-height:34px;border:1px solid #44444a;border-radius:10px;background:#2b2b30;color:#fff;padding:7px 10px}.actions .primary{grid-column:1/-1;background:#fff;color:#000}.section{margin-top:14px;padding-top:12px;border-top:1px solid #36363c}.section h3{font-size:13px;margin:0 0 7px}.row{margin-top:6px;padding:6px 8px;border-radius:9px;background:#18181b}.row span{font-size:11px;overflow:hidden;text-overflow:ellipsis}.row button{min-height:29px;font-size:11px}.empty,.subtle{font-size:11px;color:#898992;line-height:1.4}.status{padding:9px;border-radius:10px;background:#18181b;font-size:11px;line-height:1.4}.ok{background:#202820}
      </style>
      <button id="menu" class="fab">•••</button><button id="download" class="fab" hidden>↓</button>
      <section id="sheet" class="sheet" hidden>
        <div class="head"><strong>DlStream</strong><button id="close" class="close">×</button></div>
        <label>URL de la plateforme<input id="url" type="url"></label>
        <div class="actions"><button id="home">Accueil</button><button id="reload">Recharger</button><button id="direct">Safari</button><button id="save" class="primary">Enregistrer et ouvrir</button></div>
        <div class="section"><h3>Téléchargement</h3><div id="mediaStatus" class="status"></div></div>
        <div class="section"><h3>Racines approuvées</h3><div id="roots"></div><button id="toggleRoot" class="small" type="button" style="margin-top:8px"></button><div class="subtle">La racine approuvée apprend les domaines réellement utilisés par ses ressources, lecteurs et manifests.</div></div>
        <div class="section"><h3>Domaines appris pour ${cfg.rootHost}</h3><div id="learned"></div></div>
        <div class="section"><h3>Domaines ignorés</h3><div id="ignored"></div><button id="reset" class="small" type="button" style="margin-top:8px">Réinitialiser l’apprentissage</button></div>
      </section>`;

    const $ = (selector) => root.querySelector(selector);
    const menu = $('#menu');
    const sheet = $('#sheet');
    const input = $('#url');
    const download = $('#download');
    input.value = cfg.rootUrl || cfg.targetUrl;

    function renderDomains() {
      const rootsBox = $('#roots');
      const learnedBox = $('#learned');
      const ignoredBox = $('#ignored');
      rootsBox.textContent = ''; learnedBox.textContent = ''; ignoredBox.textContent = '';

      const roots = trustedRoots();
      if (!roots.length) rootsBox.innerHTML = '<div class="empty">Aucune racine approuvée.</div>';
      roots.forEach((domain) => rootsBox.appendChild(makeRow(domain, '×', () => {
        setTrustedRoots(trustedRoots().filter((d) => d !== domain));
        recheckAll();
      }, hostMatches(cfg.rootHost, domain) ? '• actuelle' : '')));

      const learned = learnedDomains();
      if (!learned.length) learnedBox.innerHTML = '<div class="empty">Aucun domaine appris.</div>';
      learned.forEach((domain) => learnedBox.appendChild(makeRow(domain, '×', () => {
        setLearned(learnedDomains().filter((d) => d !== domain));
        setIgnored([...ignoredDomains(), domain]);
        recheckAll();
      })));

      const ignored = ignoredDomains();
      if (!ignored.length) ignoredBox.innerHTML = '<div class="empty">Aucun domaine ignoré.</div>';
      ignored.forEach((domain) => ignoredBox.appendChild(makeRow(domain, 'Réautoriser', () => {
        setIgnored(ignoredDomains().filter((d) => d !== domain));
        setLearned([...learnedDomains(), domain]);
        recheckAll();
      })));

      $('#toggleRoot').textContent = rootTrusted() ? 'Retirer la confiance à cette racine' : 'Faire confiance à cette racine';
    }

    function refreshMedia() {
      download.hidden = !selectedMedia;
      const status = $('#mediaStatus');
      status.textContent = mediaStatus;
      status.classList.toggle('ok', Boolean(selectedMedia));
    }

    menu.onclick = () => { sheet.hidden = !sheet.hidden; renderDomains(); refreshMedia(); };
    $('#close').onclick = () => { sheet.hidden = true; };
    $('#reload').onclick = () => location.assign(appUrl(normalize(cfg.targetUrl)));
    $('#direct').onclick = () => window.open(cfg.targetUrl, '_blank', 'noopener');
    $('#home').onclick = () => location.assign(appUrl(normalize(cfg.rootUrl || cfg.targetUrl)));
    $('#save').onclick = () => {
      const target = normalize(input.value);
      if (!target) return;
      localStorage.setItem('dlstream.platformUrl', target.href);
      location.assign(appUrl(target));
    };
    $('#toggleRoot').onclick = () => {
      const roots = trustedRoots();
      if (rootTrusted()) setTrustedRoots(roots.filter((rootName) => !hostMatches(cfg.rootHost, rootName)));
      else setTrustedRoots([...roots, cfg.rootHost]);
      inspectDynamicNode(document.documentElement);
      window.DlStreamMediaDetector?.rescan?.();
      recheckAll();
    };
    $('#reset').onclick = () => { setLearned([]); setIgnored([]); recheckAll(); };
    download.onclick = async () => {
      if (!selectedMedia) return;
      try { await window.DlStreamOffline?.download(selectedMedia); }
      catch (error) { alert(error?.message || String(error)); }
    };

    ui = { renderDomains, refreshMedia };
    renderDomains();
    refreshMedia();
  }

  window.addEventListener('dlstream-domains-updated', () => ui?.renderDomains());
  localStorage.setItem('dlstream.lastUrl', cfg.targetUrl);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountControls, { once: true });
  else mountControls();
})();
