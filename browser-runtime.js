(() => {
  const cfg = window.__DLSTREAM__;
  if (!cfg?.targetUrl || !cfg?.appEntry || !cfg?.proxyBase) return;

  const nativeFetch = window.fetch.bind(window);
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  const mediaBySource = new Map();
  const networkCandidates = window.__DLSTREAM_NETWORK_CANDIDATES__ ||= [];
  let currentMedia = null;
  let evaluationSerial = 0;

  function normalize(value, base = document.baseURI) {
    try { return new URL(String(value), base); } catch { return null; }
  }

  function cleanHost(value) {
    try {
      const raw = String(value || '').trim().toLowerCase();
      if (!raw) return '';
      const u = raw.includes('://') ? new URL(raw) : new URL(`https://${raw}`);
      return u.hostname.replace(/^\*\./, '');
    } catch { return ''; }
  }

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; } catch { return fallback; }
  }

  function writeJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

  function domainMap(key) {
    const value = readJson(key, {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function trustedRoots() {
    const values = readJson('dlstream.trustedRoots', []);
    return [...new Set((Array.isArray(values) ? values : []).map(cleanHost).filter(Boolean))];
  }

  function setTrustedRoots(values) {
    writeJson('dlstream.trustedRoots', [...new Set(values.map(cleanHost).filter(Boolean))]);
  }

  function learnedDomains() {
    const map = domainMap('dlstream.learnedDomains');
    return [...new Set((Array.isArray(map[cfg.rootHost]) ? map[cfg.rootHost] : []).map(cleanHost).filter(Boolean))];
  }

  function setLearned(values) {
    const map = domainMap('dlstream.learnedDomains');
    map[cfg.rootHost] = [...new Set(values.map(cleanHost).filter(Boolean))].slice(0, 128);
    writeJson('dlstream.learnedDomains', map);
    window.dispatchEvent(new CustomEvent('dlstream-domains-updated'));
  }

  function ignoredDomains() {
    const map = domainMap('dlstream.ignoredDomains');
    return [...new Set((Array.isArray(map[cfg.rootHost]) ? map[cfg.rootHost] : []).map(cleanHost).filter(Boolean))];
  }

  function setIgnored(values) {
    const map = domainMap('dlstream.ignoredDomains');
    map[cfg.rootHost] = [...new Set(values.map(cleanHost).filter(Boolean))].slice(0, 128);
    writeJson('dlstream.ignoredDomains', map);
    window.dispatchEvent(new CustomEvent('dlstream-domains-updated'));
  }

  function hostMatches(host, root) { return host === root || host.endsWith(`.${root}`); }
  function rootTrusted() { return trustedRoots().some((root) => hostMatches(cfg.rootHost, root)); }

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
    setLearned([...learned, host]);
    return true;
  }

  window.DlStreamTrust = Object.freeze({
    rootTrusted,
    hostAllowed,
    learnHost,
    learnedDomains,
    ignoredDomains,
    trustedRoots,
  });

  function proxyUrl(target) {
    const p = new URL(cfg.proxyBase);
    p.searchParams.set('url', target.href || String(target));
    return p.href;
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

  function classifyMedia(url, mime = '') {
    const href = url?.href || '';
    const type = String(mime || '').toLowerCase();
    if (/\.m3u8(?:$|[?#])/i.test(href) || type.includes('mpegurl')) return 'hls';
    if (/\.mpd(?:$|[?#])/i.test(href) || type.includes('dash+xml')) return 'dash';
    if (/\.(mp4|m4v|mov|webm|mkv|avi)(?:$|[?#])/i.test(href) || type.startsWith('video/')) return 'direct';
    return null;
  }

  function observeMediaUrl(value, source = 'network', mime = '') {
    if (!rootTrusted()) return;
    const url = normalize(value, cfg.targetUrl);
    if (!url || !['http:', 'https:'].includes(url.protocol)) return;
    learnHost(url.hostname);
    const type = classifyMedia(url, mime);
    if (!type) return;
    const key = `${type}|${url.href}`;
    if (networkCandidates.some((item) => item.key === key)) return;
    networkCandidates.push({ key, url: url.href, type, source, mime, score: 880, title: document.title || 'Vidéo' });
    if (networkCandidates.length > 64) networkCandidates.splice(0, networkCandidates.length - 64);
    window.DlStreamMediaDetector?.rescan?.();
  }

  function inspectResponseClone(response, requestUrl, source) {
    try {
      const contentType = response.headers.get('content-type') || '';
      observeMediaUrl(requestUrl, source, contentType);
      if (!/json|text|javascript/i.test(contentType)) return;
      const length = Number(response.headers.get('content-length') || 0);
      if (length > 2_000_000) return;
      response.clone().text().then((text) => {
        const re = /https?:\\?\/\\?\/[^\s"'<>`\\]+?\.(?:mp4|m4v|mov|webm|mkv|avi|m3u8|mpd)(?:\?[^\s"'<>`\\]*)?/gi;
        for (const match of String(text || '').replace(/\\\//g, '/').matchAll(re)) observeMediaUrl(match[0], `${source}-response`);
      }).catch(() => {});
    } catch (_) {}
  }

  window.fetch = function dlStreamFetch(input, init) {
    let target = null;
    try {
      const raw = input instanceof Request ? input.url : input;
      target = normalize(raw);
      if (target) observeMediaUrl(target, 'fetch-request');
    } catch (_) {}

    let promise;
    if (target && classifyMedia(target) && hostAllowed(target.hostname)) promise = nativeFetch(input, init);
    else promise = isUpstream(target) ? nativeFetch(proxyUrl(target), init) : nativeFetch(input, init);

    return promise.then((response) => {
      if (target) inspectResponseClone(response, target, 'fetch');
      return response;
    });
  };

  XMLHttpRequest.prototype.open = function dlStreamXhrOpen(method, url, ...rest) {
    const target = normalize(url);
    if (target) observeMediaUrl(target, 'xhr-request');
    this.__dlstreamTarget = target;
    if (target && classifyMedia(target) && hostAllowed(target.hostname)) return nativeOpen.call(this, method, target.href, ...rest);
    return nativeOpen.call(this, method, isUpstream(target) ? proxyUrl(target) : url, ...rest);
  };

  XMLHttpRequest.prototype.send = function dlStreamXhrSend(...args) {
    if (!this.__dlstreamObserved) {
      this.__dlstreamObserved = true;
      this.addEventListener('loadend', () => {
        try {
          const target = this.__dlstreamTarget;
          const mime = this.getResponseHeader('content-type') || '';
          if (target) observeMediaUrl(target, 'xhr', mime);
          if (!/json|text|javascript/i.test(mime)) return;
          const text = typeof this.responseText === 'string' ? this.responseText : '';
          if (!text || text.length > 2_000_000) return;
          const re = /https?:\\?\/\\?\/[^\s"'<>`\\]+?\.(?:mp4|m4v|mov|webm|mkv|avi|m3u8|mpd)(?:\?[^\s"'<>`\\]*)?/gi;
          for (const match of text.replace(/\\\//g, '/').matchAll(re)) observeMediaUrl(match[0], 'xhr-response');
        } catch (_) {}
      });
    }
    return nativeSend.apply(this, args);
  };

  document.addEventListener('click', (event) => {
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor || event.defaultPrevented || anchor.hasAttribute('download')) return;
    const href = anchor.getAttribute('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
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
    const urls = [];
    const attrs = ['src','href','poster','data-src','data-url','data-video-url','data-file-url','data-manifest','data-manifest-url','data-hls','data-dash'];
    if (!(node instanceof Element)) return urls;
    for (const attr of attrs) {
      const raw = node.getAttribute(attr);
      if (!raw) continue;
      const u = normalize(raw, cfg.targetUrl);
      if (u && ['http:', 'https:'].includes(u.protocol)) urls.push(u);
    }
    return urls;
  }

  function inspectResourceNode(node) {
    if (!(node instanceof Element)) return;
    for (const u of resourceUrls(node)) {
      learnHost(u.hostname);
      observeMediaUrl(u, `dom-${node.tagName.toLowerCase()}`);
    }
    node.querySelectorAll?.('[src],[href],[poster],[data-src],[data-url],[data-video-url],[data-file-url],[data-manifest],[data-manifest-url],[data-hls],[data-dash]').forEach((child) => {
      for (const u of resourceUrls(child)) {
        learnHost(u.hostname);
        observeMediaUrl(u, `dom-${child.tagName.toLowerCase()}`);
      }
    });
  }

  function rewriteIframe(frame) {
    if (!(frame instanceof HTMLIFrameElement) || !rootTrusted() || Number(cfg.depth || 0) >= Number(cfg.maxDepth || 4)) return;
    const raw = frame.getAttribute('src');
    if (!raw) return;
    const target = normalize(raw, cfg.targetUrl);
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

  const resourceObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList') mutation.addedNodes.forEach(inspectDynamicNode);
      if (mutation.type === 'attributes') inspectDynamicNode(mutation.target);
    }
  });

  function mediaKey(media) {
    return `${media.type || media.mediaType || ''}|${media.url || media.downloadUrl || media.manifestUrl || ''}`;
  }

  function normalizeMediaBatch(list, sourcePage) {
    const out = [];
    const seen = new Set();
    for (const raw of Array.isArray(list) ? list : []) {
      const url = normalize(raw?.url || raw?.downloadUrl || raw?.manifestUrl, sourcePage || cfg.targetUrl);
      if (!url) continue;
      learnHost(url.hostname);
      const type = raw.type || raw.mediaType || classifyMedia(url, raw.mime || '') || 'unknown';
      const item = { ...raw, type, mediaType: type, url: url.href, sourcePage: sourcePage || cfg.targetUrl };
      if (type === 'direct') item.downloadUrl ||= url.href;
      if (type === 'hls' || type === 'dash') item.manifestUrl ||= url.href;
      const key = mediaKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }

  function relayBatch(list, sourcePage = cfg.targetUrl) {
    const media = normalizeMediaBatch(list, sourcePage);
    if (cfg.isNested) {
      window.parent?.postMessage({ type: 'DLSTREAM_NESTED_MEDIA_BATCH', sourcePage, media }, location.origin);
      return;
    }
    mediaBySource.set(sourcePage, media);
    evaluateMediaPool();
  }

  async function evaluateMediaPool() {
    const serial = ++evaluationSerial;
    const unique = new Map();
    for (const list of mediaBySource.values()) {
      for (const media of list) {
        const key = mediaKey(media);
        const previous = unique.get(key);
        if (!previous || Number(media.score || 0) > Number(previous.score || 0)) unique.set(key, media);
      }
    }

    const priority = { direct: 3000, hls: 2000, dash: 1000, unknown: 0 };
    const candidates = [...unique.values()]
      .sort((a, b) => ((priority[b.type] || 0) + Number(b.score || 0)) - ((priority[a.type] || 0) + Number(a.score || 0)))
      .slice(0, 16);

    let best = null;
    let bestRank = -Infinity;
    for (const media of candidates) {
      if (serial !== evaluationSerial) return;
      const check = await window.DlStreamOffline?.analyze?.(media);
      if (!check?.feasible) continue;
      const rank = (priority[check.type || media.type] || 0) + Number(media.score || 0) + (check.format === 'mp4' ? 100 : 0);
      if (rank > bestRank) {
        bestRank = rank;
        best = { ...media, downloadCheck: check };
      }
    }

    if (serial !== evaluationSerial) return;
    currentMedia = best;
    document.dispatchEvent(new CustomEvent('dlstream-media-changed', { detail: currentMedia }));
  }

  window.DlStream = {
    exposeMedia(media = {}) { relayBatch(media ? [media] : [], cfg.targetUrl); },
    exposeCandidates(media = []) { relayBatch(media, cfg.targetUrl); },
    clearMedia() { relayBatch([], cfg.targetUrl); },
  };

  window.addEventListener('message', (event) => {
    if (event.origin !== location.origin || event.data?.type !== 'DLSTREAM_NESTED_MEDIA_BATCH') return;
    const sourcePage = String(event.data.sourcePage || cfg.targetUrl);
    const media = Array.isArray(event.data.media) ? event.data.media : [];
    if (cfg.isNested) {
      window.parent?.postMessage({ type: 'DLSTREAM_NESTED_MEDIA_BATCH', sourcePage, media }, location.origin);
      return;
    }
    mediaBySource.set(sourcePage, normalizeMediaBatch(media, sourcePage));
    evaluateMediaPool();
  });

  function makeDomainRow(domain, kind, onAction) {
    const row = document.createElement('div');
    row.className = 'domain-row';
    const name = document.createElement('span');
    name.textContent = domain;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = kind === 'ignored' ? 'Réautoriser' : '×';
    button.addEventListener('click', onAction);
    row.append(name, button);
    return row;
  }

  function mountControls() {
    if (cfg.isNested || !document.body || document.querySelector('#dlstream-controls')) return;
    const host = document.createElement('div');
    host.id = 'dlstream-controls';
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif}button,input{font:inherit}.fab{pointer-events:auto;position:fixed;display:grid;place-items:center;border:1px solid rgba(255,255,255,.25);background:rgba(15,15,18,.68);color:#fff;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 8px 24px rgba(0,0,0,.28)}#menu{top:max(10px,env(safe-area-inset-top));right:max(10px,env(safe-area-inset-right));width:40px;height:40px;border-radius:999px;font-weight:800}#download{right:max(12px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));width:48px;height:48px;border-radius:999px;background:#fff;color:#000;font-size:25px;font-weight:900}#download[hidden],.sheet[hidden]{display:none}.sheet{pointer-events:auto;position:fixed;left:10px;right:10px;bottom:max(10px,env(safe-area-inset-bottom));max-height:82dvh;overflow:auto;padding:14px;border-radius:20px;background:rgba(22,22,25,.97);color:#fff;box-shadow:0 18px 50px rgba(0,0,0,.45);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px)}.head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}.close{width:34px;height:34px;border:0;border-radius:999px;background:#35353a;color:#fff;font-size:22px}label{display:grid;gap:6px;font-size:12px;color:#b4b4bb}input{width:100%;min-height:44px;border:1px solid #44444a;border-radius:11px;background:#111114;color:#fff;padding:9px 11px}.actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.actions button,.trust button,.domain-row button{min-height:38px;border:1px solid #44444a;border-radius:10px;background:#2b2b30;color:#fff;padding:7px 10px}.actions .primary{grid-column:1/-1;background:#fff;color:#000;border-color:#fff;font-weight:750}.section{margin-top:14px;padding-top:12px;border-top:1px solid #36363c}.section h3{font-size:13px;margin:0 0 7px}.subtle{font-size:11px;color:#94949d;line-height:1.35}.root-line{display:flex;gap:8px;align-items:center;justify-content:space-between}.root-line code{font-size:11px;overflow:hidden;text-overflow:ellipsis}.domain-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:6px;padding:6px 8px;border-radius:9px;background:#18181b}.domain-row span{font-size:11px;overflow:hidden;text-overflow:ellipsis}.domain-row button{min-height:30px;font-size:11px}.trust{display:grid;gap:7px}.empty{font-size:11px;color:#777780;margin:6px 0}.media-state{font-size:11px;color:#c7c7cf;line-height:1.4;word-break:break-word}
      </style>
      <button id="menu" class="fab">•••</button><button id="download" class="fab" hidden aria-label="Télécharger">↓</button>
      <section id="sheet" class="sheet" hidden><div class="head"><strong>DlStream</strong><button id="close" class="close">×</button></div>
        <label>URL de la plateforme<input id="url" type="url"></label>
        <div class="actions"><button id="home">Accueil</button><button id="reload">Recharger</button><button id="direct">Safari</button><button id="save" class="primary">Enregistrer et ouvrir</button></div>
        <div class="section trust"><h3>Racine de confiance</h3><div class="root-line"><code id="rootHost"></code><button id="toggleTrust"></button></div><div class="subtle">Une racine approuvée apprend automatiquement les domaines réellement référencés par ses pages, lecteurs et requêtes média.</div></div>
        <div class="section"><h3>Domaines appris</h3><div id="learned"></div></div>
        <div class="section"><h3>Domaines ignorés</h3><div id="ignored"></div><button id="resetLearning" type="button" style="margin-top:8px;min-height:36px;border:1px solid #44444a;border-radius:10px;background:#2b2b30;color:#fff">Réinitialiser l’apprentissage</button></div>
        <div class="section"><h3>Téléchargement détecté</h3><div id="mediaState" class="media-state">Aucun média téléchargeable vérifié.</div></div>
      </section>`;

    const $ = (s) => root.querySelector(s);
    const menu=$('#menu'), sheet=$('#sheet'), close=$('#close'), input=$('#url'), download=$('#download');
    input.value = cfg.rootUrl || cfg.targetUrl;
    $('#rootHost').textContent = cfg.rootHost || '';

    function renderDomains() {
      const learnedBox=$('#learned'), ignoredBox=$('#ignored');
      learnedBox.textContent=''; ignoredBox.textContent='';
      const learned=learnedDomains(), ignored=ignoredDomains();
      if (!learned.length) learnedBox.innerHTML='<div class="empty">Aucun domaine appris.</div>';
      learned.forEach((domain) => learnedBox.appendChild(makeDomainRow(domain,'learned',() => {
        setLearned(learnedDomains().filter((d)=>d!==domain));
        setIgnored([...ignoredDomains(),domain]);
        renderDomains();
      })));
      if (!ignored.length) ignoredBox.innerHTML='<div class="empty">Aucun domaine ignoré.</div>';
      ignored.forEach((domain) => ignoredBox.appendChild(makeDomainRow(domain,'ignored',() => {
        setIgnored(ignoredDomains().filter((d)=>d!==domain));
        setLearned([...learnedDomains(),domain]);
        renderDomains();
      })));
      $('#toggleTrust').textContent=rootTrusted()?'Retirer la confiance':'Faire confiance';
    }

    function renderMedia() {
      download.hidden=!currentMedia;
      if (!currentMedia) {
        $('#mediaState').textContent='Aucun média téléchargeable vérifié.';
        return;
      }
      const check=currentMedia.downloadCheck||{};
      $('#mediaState').textContent=`${check.reason || 'Téléchargement disponible'} — ${currentMedia.url || currentMedia.downloadUrl || currentMedia.manifestUrl || ''}`;
      download.title=check.reason||'Télécharger';
    }

    menu.onclick=()=>{sheet.hidden=!sheet.hidden;renderDomains();renderMedia();};
    close.onclick=()=>sheet.hidden=true;
    $('#reload').onclick=()=>location.assign(appUrl(normalize(cfg.targetUrl)));
    $('#direct').onclick=()=>window.open(cfg.targetUrl,'_blank','noopener');
    $('#home').onclick=()=>location.assign(appUrl(normalize(cfg.rootUrl || cfg.targetUrl)));
    $('#save').onclick=()=>{const target=normalize(input.value);if(!target)return;localStorage.setItem('dlstream.platformUrl',target.href);location.assign(appUrl(target));};
    $('#toggleTrust').onclick=()=>{
      const roots=trustedRoots();
      if(rootTrusted()) setTrustedRoots(roots.filter((r)=>!hostMatches(cfg.rootHost,r)));
      else setTrustedRoots([...roots,cfg.rootHost]);
      location.reload();
    };
    $('#resetLearning').onclick=()=>{setLearned([]);setIgnored([]);location.reload();};

    document.addEventListener('dlstream-media-changed',(event)=>{currentMedia=event.detail||null;renderMedia();});
    window.addEventListener('dlstream-domains-updated',renderDomains);
    download.onclick=()=>{
      if(!currentMedia)return;
      try{window.DlStreamOffline?.download(currentMedia);}catch(error){alert(error?.message||String(error));}
    };
    renderDomains(); renderMedia();
  }

  resourceObserver.observe(document.documentElement, {
    subtree:true,
    childList:true,
    attributes:true,
    attributeFilter:['src','href','poster','data-src','data-url','data-video-url','data-file-url','data-manifest','data-manifest-url','data-hls','data-dash']
  });
  inspectDynamicNode(document.documentElement);
  localStorage.setItem('dlstream.lastUrl', cfg.targetUrl);

  if (!cfg.isNested) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountControls, { once:true }); else mountControls();
  }
})();
