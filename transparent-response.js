(() => {
  if (window.__DLSTREAM_TRANSPARENT_RESPONSE__) return;
  window.__DLSTREAM_TRANSPARENT_RESPONSE__ = true;

  const nativeResponseUrl = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseURL');

  function cfg() {
    return window.__DLSTREAM__ || {};
  }

  function stats() {
    return window.__DLSTREAM_TRANSPARENT_STATS__ ||= {
      restored: 0,
      fetchRestored: 0,
      xhrRestored: 0,
      lastUrl: '',
      lastKind: '',
    };
  }

  function originalFromProxy(value) {
    try {
      const responseUrl = new URL(String(value || ''));
      const proxy = new URL(cfg().proxyBase || 'https://proxy.sicho95.workers.dev/');
      if (responseUrl.origin !== proxy.origin) return null;
      const raw = responseUrl.searchParams.get('url');
      if (!raw) return null;
      const target = new URL(raw);
      return ['http:', 'https:'].includes(target.protocol) ? target : null;
    } catch {
      return null;
    }
  }

  function record(kind, target) {
    const state = stats();
    state.restored += 1;
    if (kind === 'fetch') state.fetchRestored += 1;
    if (kind === 'xhr') state.xhrRestored += 1;
    state.lastUrl = target?.href || '';
    state.lastKind = kind;
  }

  function facadeResponse(response, target, count = true) {
    if (!response || !target) return response;
    if (count) record('fetch', target);

    return new Proxy(response, {
      get(object, property) {
        if (property === 'url') return target.href;
        if (property === 'redirected') return false;
        if (property === 'clone') {
          return () => facadeResponse(object.clone(), target, false);
        }
        const value = Reflect.get(object, property, object);
        return typeof value === 'function' ? value.bind(object) : value;
      },
    });
  }

  function installFetch() {
    const current = window.fetch;
    if (typeof current !== 'function' || current.__dlstreamTransparentResponse) return;

    const upstream = current.bind(window);
    const wrapper = async function dlStreamTransparentFetch(...args) {
      const response = await upstream(...args);
      const target = originalFromProxy(response?.url);
      return target ? facadeResponse(response, target) : response;
    };

    Object.defineProperty(wrapper, '__dlstreamTransparentResponse', { value: true });
    if (current.__dlstreamSpaCompat) Object.defineProperty(wrapper, '__dlstreamSpaCompat', { value: true });
    window.fetch = wrapper;
  }

  function installXhrResponseUrl() {
    if (!nativeResponseUrl?.get || nativeResponseUrl.configurable === false) return;
    const current = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseURL');
    if (current?.get?.__dlstreamTransparentResponse) return;

    const getter = function dlStreamTransparentResponseURL() {
      const raw = nativeResponseUrl.get.call(this);
      const target = originalFromProxy(raw);
      if (!target) return raw;

      if (!this.__dlstreamTransparentResponseCounted) {
        this.__dlstreamTransparentResponseCounted = true;
        record('xhr', target);
      }
      return target.href;
    };
    Object.defineProperty(getter, '__dlstreamTransparentResponse', { value: true });

    try {
      Object.defineProperty(XMLHttpRequest.prototype, 'responseURL', {
        configurable: nativeResponseUrl.configurable,
        enumerable: nativeResponseUrl.enumerable,
        get: getter,
      });
    } catch (_) {}
  }

  function install() {
    installFetch();
    installXhrResponseUrl();
  }

  // browser-runtime et spa-compat peuvent réinstaller fetch après le démarrage.
  // Reposer cette façade au-dessus afin de conserver une URL de réponse transparente.
  setInterval(install, 80);
  setTimeout(install, 0);
})();
