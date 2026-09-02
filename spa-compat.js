(() => {
  if (window.__DLSTREAM_SPA_COMPAT__) return;
  window.__DLSTREAM_SPA_COMPAT__ = true;

  const nativeFetch = window.fetch.bind(window);
  const nativeXhrOpen = XMLHttpRequest.prototype.open;
  const AD_HOST_RE = /(?:^|[.-])(?:ads?|adserver|adservice|tracking|tracker|analytics|pixel)(?:[.-]|$)|adexchange|adexchanger|doubleclick|googlesyndication|taboola|outbrain|exoclick/i;
  const MEDIA_FILE_RE = /\.(?:mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|mpe|m2v|m2ts|mts|ts|vob|ogv|ogg|3gp|3g2|wmv|flv|f4v|asf|divx|rm|rmvb|m3u8|mpd|m4s|cmfv|cmfa)(?:$|[?#])/i;
  let fetchFallback = null;
  let xhrOpenFallback = null;

  function cfg() {
    return window.__DLSTREAM__ || null;
  }

  function normalize(value, base = document.baseURI || location.href) {
    try {
      const url = new URL(String(value || ''), base);
      return ['http:', 'https:'].includes(url.protocol) ? url : null;
    } catch {
      return null;
    }
  }

  function appBase() {
    try { return new URL(cfg()?.appEntry || location.href); }
    catch { return null; }
  }

  function targetOrigin() {
    try { return new URL(cfg()?.targetUrl || '').origin; }
    catch { return ''; }
  }

  function internalHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (!host) return false;
    try {
      const app = appBase();
      if (app?.hostname?.toLowerCase() === host) return true;
    } catch (_) {}
    try {
      const proxyHost = new URL(cfg()?.proxyBase || '').hostname.toLowerCase();
      if (proxyHost && proxyHost === host) return true;
    } catch (_) {}
    return false;
  }

  function isDlStreamAsset(url) {
    const app = appBase();
    if (!url || !app || url.origin !== app.origin) return false;
    const basePath = app.pathname.endsWith('/') ? app.pathname : `${app.pathname}/`;
    return url.pathname === app.pathname || url.pathname.startsWith(basePath);
  }

  function mapVirtualOrigin(url) {
    const app = appBase();
    const origin = targetOrigin();
    if (!url || !app || !origin) return url;
    if (url.origin !== app.origin || isDlStreamAsset(url)) return url;
    try { return new URL(`${url.pathname}${url.search}${url.hash}`, origin); }
    catch { return url; }
  }

  // Ne considérer comme média direct que les vraies ressources portant une extension média.
  // Les routes applicatives /api/stream, /video-sources, /player, etc. renvoient souvent du JSON
  // et doivent rester relayées par le proxy pour éviter les erreurs CORS de la page reconstruite.
  function mediaFile(url) {
    return MEDIA_FILE_RE.test(url?.href || '');
  }

  function hostAllowed(url) {
    if (!url) return false;
    try {
      const host = url.hostname.toLowerCase();
      if (internalHost(host) || AD_HOST_RE.test(host)) return false;
      if (url.origin === targetOrigin()) return true;
      if (window.DlStreamTrust?.hostAllowed) return Boolean(window.DlStreamTrust.hostAllowed(host));

      const config = cfg();
      const root = String(config?.rootHost || '').toLowerCase();
      if (host === root || host.endsWith(`.${root}`)) return true;
      const learned = Array.isArray(config?.learnedDomains) ? config.learnedDomains : [];
      return learned.some((domain) => host === domain || host.endsWith(`.${domain}`));
    } catch {
      return false;
    }
  }

  function shouldProxyAppRequest(url) {
    return Boolean(url && hostAllowed(url) && !mediaFile(url));
  }

  function proxyUrl(target) {
    const config = cfg();
    if (!config?.proxyBase) return target;
    try {
      const proxy = new URL(config.proxyBase);
      proxy.searchParams.set('url', target.href);
      proxy.searchParams.set('mode', 'browser');
      return proxy;
    } catch {
      return target;
    }
  }

  function recordRequest(target, method, status = 0, error = '') {
    const state = window.__DLSTREAM_SPA_STATS__ ||= {};
    const entry = {
      method: String(method || 'GET').toUpperCase(),
      url: target?.href || '',
      status: Number(status || 0),
      error: String(error || ''),
      at: Date.now(),
    };
    state.history = [...(Array.isArray(state.history) ? state.history : []), entry].slice(-8);
    if (entry.url) state.lastProxy = entry.url;
    if (entry.status) state.lastStatus = entry.status;
    if (entry.error) state.lastError = `${entry.url} — ${entry.error}`;
  }

  async function proxyRequest(input, init, target) {
    const proxied = proxyUrl(target);
    if (!(input instanceof Request)) return nativeFetch(proxied.href, init);

    const request = input.clone();
    const options = {
      method: request.method,
      headers: new Headers(request.headers),
      redirect: request.redirect,
      signal: request.signal,
      cache: 'no-store',
      credentials: 'omit',
    };

    if (!['GET', 'HEAD'].includes(request.method.toUpperCase())) {
      try { options.body = await request.arrayBuffer(); } catch (_) {}
    }

    if (init && typeof init === 'object') Object.assign(options, init);
    return nativeFetch(proxied.href, options);
  }

  function installFetchWrapper() {
    const config = cfg();
    if (!config?.targetUrl || !config?.proxyBase) return;
    if (window.fetch?.__dlstreamSpaCompat) return;

    fetchFallback = window.fetch.bind(window);

    const wrapper = async function dlStreamSpaFetch(input, init) {
      const raw = input instanceof Request ? input.url : input;
      const original = normalize(raw);
      const target = mapVirtualOrigin(original);
      const method = String(init?.method || (input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase();

      if (shouldProxyAppRequest(target)) {
        try {
          const response = await proxyRequest(input, init, target);
          const state = window.__DLSTREAM_SPA_STATS__ ||= {};
          state.proxied = Number(state.proxied || 0) + 1;
          recordRequest(target, method, response.status);
          return response;
        } catch (error) {
          const state = window.__DLSTREAM_SPA_STATS__ ||= {};
          state.failed = Number(state.failed || 0) + 1;
          recordRequest(target, method, 0, error?.message || error);
          throw error;
        }
      }

      if (target && original && target.href !== original.href) {
        if (input instanceof Request) {
          try {
            const mapped = new Request(target.href, input);
            return fetchFallback(mapped, init);
          } catch (_) {
            return fetchFallback(target.href, init);
          }
        }
        return fetchFallback(target.href, init);
      }

      return fetchFallback(input, init);
    };

    Object.defineProperty(wrapper, '__dlstreamSpaCompat', { value: true });
    window.fetch = wrapper;
  }

  function installXhrWrapper() {
    const config = cfg();
    if (!config?.targetUrl || !config?.proxyBase) return;
    if (XMLHttpRequest.prototype.open?.__dlstreamSpaCompat) return;

    xhrOpenFallback = XMLHttpRequest.prototype.open;

    const wrapper = function dlStreamSpaXhrOpen(method, url, ...rest) {
      const original = normalize(url);
      const target = mapVirtualOrigin(original);
      const requestMethod = String(method || 'GET').toUpperCase();

      if (shouldProxyAppRequest(target)) {
        try {
          this.__dlstreamTarget = target;
          this.addEventListener('loadend', () => {
            const state = window.__DLSTREAM_SPA_STATS__ ||= {};
            state.proxied = Number(state.proxied || 0) + 1;
            recordRequest(target, requestMethod, this.status);
          }, { once: true });
        } catch (_) {}
        return nativeXhrOpen.call(this, method, proxyUrl(target).href, ...rest);
      }

      if (target && original && target.href !== original.href) {
        return xhrOpenFallback.call(this, method, target.href, ...rest);
      }

      return xhrOpenFallback.call(this, method, url, ...rest);
    };

    Object.defineProperty(wrapper, '__dlstreamSpaCompat', { value: true });
    XMLHttpRequest.prototype.open = wrapper;
  }

  function install() {
    installFetchWrapper();
    installXhrWrapper();
  }

  // browser-runtime.js remplace fetch/XHR après l’injection de la page.
  // Réinstaller cette couche au-dessus afin de conserver la compatibilité SPA.
  setInterval(install, 100);
})();
