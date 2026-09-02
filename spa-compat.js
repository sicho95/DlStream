(() => {
  if (window.__DLSTREAM_SPA_COMPAT__) return;
  window.__DLSTREAM_SPA_COMPAT__ = true;

  const nativeFetch = window.fetch.bind(window);
  const nativeXhrOpen = XMLHttpRequest.prototype.open;
  const AD_HOST_RE = /(?:^|[.-])(?:ads?|adserver|adservice|adexchange|tracking|tracker|analytics|pixel)(?:[.-]|$)|doubleclick|googlesyndication|taboola|outbrain|exoclick/i;
  const MEDIA_PATH_RE = /(?:^|\/)(?:video|media|stream|playback|manifest|playlist|master|hls|dash)(?:\/|$|[._-])|videoplayback|\.m3u8(?:$|[?#])|\.mpd(?:$|[?#])/i;
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

  function mediaLike(url) {
    return /\.(?:mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|m2ts|mts|ts|m3u8|mpd|m4s|cmfv|cmfa)(?:$|[?#])/i.test(url?.href || '')
      || MEDIA_PATH_RE.test(`${url?.pathname || ''}${url?.search || ''}`);
  }

  function hostAllowed(url) {
    if (!url) return false;
    try {
      if (url.origin === targetOrigin()) return true;
      if (AD_HOST_RE.test(url.hostname)) return false;
      if (window.DlStreamTrust?.hostAllowed) return Boolean(window.DlStreamTrust.hostAllowed(url.hostname));

      const config = cfg();
      const host = url.hostname.toLowerCase();
      const root = String(config?.rootHost || '').toLowerCase();
      if (host === root || host.endsWith(`.${root}`)) return true;
      const learned = Array.isArray(config?.learnedDomains) ? config.learnedDomains : [];
      return learned.some((domain) => host === domain || host.endsWith(`.${domain}`));
    } catch {
      return false;
    }
  }

  function shouldProxyAppRequest(url) {
    return Boolean(url && hostAllowed(url) && !mediaLike(url));
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

  async function proxyRequest(input, init, target) {
    const proxied = proxyUrl(target);
    if (!(input instanceof Request)) return nativeFetch(proxied.href, init);

    const request = input.clone();
    const options = {
      method: request.method,
      headers: new Headers(request.headers),
      redirect: request.redirect,
      signal: request.signal,
      cache: request.cache,
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

      if (shouldProxyAppRequest(target)) {
        try {
          const response = await proxyRequest(input, init, target);
          window.__DLSTREAM_SPA_STATS__ = {
            ...(window.__DLSTREAM_SPA_STATS__ || {}),
            lastProxy: target.href,
            lastStatus: response.status,
            proxied: Number(window.__DLSTREAM_SPA_STATS__?.proxied || 0) + 1,
          };
          return response;
        } catch (error) {
          window.__DLSTREAM_SPA_STATS__ = {
            ...(window.__DLSTREAM_SPA_STATS__ || {}),
            lastError: `${target.href} — ${error?.message || error}`,
            failed: Number(window.__DLSTREAM_SPA_STATS__?.failed || 0) + 1,
          };
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

      if (shouldProxyAppRequest(target)) {
        try {
          this.__dlstreamTarget = target;
          this.addEventListener('loadend', () => {
            window.__DLSTREAM_SPA_STATS__ = {
              ...(window.__DLSTREAM_SPA_STATS__ || {}),
              lastProxy: target.href,
              lastStatus: this.status,
              proxied: Number(window.__DLSTREAM_SPA_STATS__?.proxied || 0) + 1,
            };
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

  // browser-runtime.js remplace fetch/XHR après l'injection de la page.
  // Réinstaller cette couche au-dessus afin de conserver la compatibilité SPA.
  setInterval(install, 100);
})();
