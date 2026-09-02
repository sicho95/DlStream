(() => {
  if (window.__DLSTREAM_VLOCATION__) return;

  const nativePushState = history.pushState.bind(history);
  const nativeReplaceState = history.replaceState.bind(history);
  const nativeAssign = Location.prototype.assign.bind(location);
  const nativeReplace = Location.prototype.replace.bind(location);
  const nativeReload = Location.prototype.reload.bind(location);

  function initialTarget() {
    try {
      const configured = window.__DLSTREAM__?.targetUrl;
      if (configured) return new URL(configured);
    } catch (_) {}

    try {
      const encoded = new URL(location.href).searchParams.get('url');
      if (encoded) return new URL(encoded);
    } catch (_) {}

    try {
      const stored = localStorage.getItem('dlstream.platformUrl');
      if (stored) return new URL(stored);
    } catch (_) {}

    return null;
  }

  let current = initialTarget();

  function stats() {
    return window.__DLSTREAM_ROUTE_STATS__ ||= {
      rewrittenSources: 0,
      historyUpdates: 0,
      navigations: 0,
      current: current?.href || '',
      lastHistory: '',
      lastNavigation: '',
    };
  }

  function syncCurrent(url) {
    if (!url) return;
    current = url;
    const state = stats();
    state.current = current.href;
    document.dispatchEvent(new CustomEvent('dlstream-virtual-location-changed', {
      detail: { href: current.href },
    }));
  }

  function resolve(value) {
    try {
      if (value instanceof URL) return new URL(value.href);
      return new URL(String(value || ''), current?.href || initialTarget()?.href || document.baseURI || location.href);
    } catch {
      return null;
    }
  }

  function appEntry() {
    try {
      if (window.__DLSTREAM__?.appEntry) return new URL(window.__DLSTREAM__.appEntry);
    } catch (_) {}
    try {
      const url = new URL('./', location.href);
      url.search = '';
      url.hash = '';
      return url;
    } catch {
      return null;
    }
  }

  function appUrl(target) {
    const entry = appEntry();
    if (!entry || !target) return null;
    entry.searchParams.set('url', target.href);
    return entry;
  }

  function samePlatform(target) {
    return Boolean(target && current && target.origin === current.origin);
  }

  function navigate(value, replace = false) {
    const target = resolve(value);
    if (!target) return;

    const state = stats();
    state.navigations += 1;
    state.lastNavigation = target.href;
    syncCurrent(target);

    if (!samePlatform(target)) {
      return replace ? nativeReplace(target.href) : nativeAssign(target.href);
    }

    const wrapped = appUrl(target);
    if (!wrapped) return replace ? nativeReplace(target.href) : nativeAssign(target.href);
    return replace ? nativeReplace(wrapped.href) : nativeAssign(wrapped.href);
  }

  function updateHistory(nativeMethod, state, title, value) {
    if (value == null) return nativeMethod(state, title, value);
    const target = resolve(value);
    if (!target || !samePlatform(target)) return nativeMethod(state, title, value);

    syncCurrent(target);
    const wrapped = appUrl(target);
    const info = stats();
    info.historyUpdates += 1;
    info.lastHistory = target.href;
    return nativeMethod(state, title, wrapped?.href || location.href);
  }

  try {
    history.pushState = function dlStreamPushState(state, title, url) {
      return updateHistory(nativePushState, state, title, url);
    };
    history.replaceState = function dlStreamReplaceState(state, title, url) {
      return updateHistory(nativeReplaceState, state, title, url);
    };
  } catch (_) {}

  window.addEventListener('popstate', () => {
    try {
      const encoded = new URL(location.href).searchParams.get('url');
      if (encoded) syncCurrent(new URL(encoded));
    } catch (_) {}
  });

  const api = {
    assign(value) { return navigate(value, false); },
    replace(value) { return navigate(value, true); },
    reload() { return nativeReload(); },
    toString() { return current?.href || ''; },
    valueOf() { return current?.href || ''; },
  };

  const readonly = ['origin', 'protocol', 'host', 'hostname', 'port', 'username', 'password'];
  for (const key of readonly) {
    Object.defineProperty(api, key, {
      enumerable: true,
      configurable: false,
      get() { return current?.[key] || ''; },
    });
  }

  for (const key of ['href', 'pathname', 'search', 'hash']) {
    Object.defineProperty(api, key, {
      enumerable: true,
      configurable: false,
      get() { return current?.[key] || ''; },
      set(value) {
        const target = new URL(current?.href || initialTarget()?.href || location.href);
        if (key === 'href') return navigate(value, false);
        target[key] = String(value || '');
        return navigate(target, false);
      },
    });
  }

  function rewriteSource(source) {
    let text = String(source || '');
    const before = text;

    text = text.replace(/\bwindow\.location\b/g, 'window.__DLSTREAM_VLOCATION__');
    text = text.replace(/\bdocument\.location\b/g, 'window.__DLSTREAM_VLOCATION__');
    text = text.replace(/\bglobalThis\.location\b/g, 'window.__DLSTREAM_VLOCATION__');
    text = text.replace(/\bself\.location\b/g, 'window.__DLSTREAM_VLOCATION__');
    text = text.replace(/(^|[^\w$.])location\.(href|origin|protocol|host|hostname|port|pathname|search|hash|assign|replace|reload)\b/g,
      '$1window.__DLSTREAM_VLOCATION__.$2');

    if (text !== before) stats().rewrittenSources += 1;
    return text;
  }

  window.__DLSTREAM_VLOCATION__ = api;
  window.DlStreamVirtualLocation = Object.freeze({
    current: () => current ? new URL(current.href) : null,
    resolve,
    navigate,
    rewriteSource,
    sync(value) {
      const url = resolve(value);
      if (url) syncCurrent(url);
    },
  });

  stats();
})();
