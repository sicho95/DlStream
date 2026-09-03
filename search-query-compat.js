(() => {
  if (window.__DLSTREAM_SEARCH_QUERY_COMPAT__) return;
  window.__DLSTREAM_SEARCH_QUERY_COMPAT__ = true;

  const state = window.__DLSTREAM_SEARCH_STATS__ ||= {
    patched: 0,
    lastValue: '',
    lastUrl: '',
  };

  function cfg() {
    return window.__DLSTREAM__ || {};
  }

  function searchValue() {
    const active = document.activeElement;
    const candidates = [];
    if (active instanceof HTMLInputElement) candidates.push(active);

    document.querySelectorAll('input[type="search"],input[name="q"],input[name="query"],input[name="search"],input[placeholder*="recher" i],input[aria-label*="recher" i],input[placeholder*="search" i],input[aria-label*="search" i]')
      .forEach((input) => candidates.push(input));

    for (const input of candidates) {
      if (!(input instanceof HTMLInputElement)) continue;
      const value = String(input.value || '').trim();
      if (!value) continue;
      try {
        const style = getComputedStyle(input);
        const visible = style.display !== 'none' && style.visibility !== 'hidden' && input.getClientRects().length > 0;
        if (visible || input === active) return value;
      } catch {
        return value;
      }
    }
    return '';
  }

  function searchEndpoint(url) {
    if (!url) return false;
    const path = String(url.pathname || '').toLowerCase();
    return /(?:^|\/)(?:search|suggest|suggestions|autocomplete)(?:\/|$)/.test(path)
      || /\/catalog\/search(?:\/|$)/.test(path);
  }

  function hasSearchParam(url) {
    return ['q', 'query', 'search', 'term', 'keyword'].some((name) => {
      const value = url.searchParams.get(name);
      return value != null && String(value).trim() !== '';
    });
  }

  function patchTarget(url) {
    if (!searchEndpoint(url) || hasSearchParam(url)) return url;
    const value = searchValue();
    if (!value) return url;

    const patched = new URL(url.href);
    patched.searchParams.set('q', value);
    state.patched = Number(state.patched || 0) + 1;
    state.lastValue = value;
    state.lastUrl = patched.href;
    return patched;
  }

  function patchUrl(value) {
    try {
      const url = new URL(String(value || ''), document.baseURI || location.href);
      const proxyBase = cfg().proxyBase ? new URL(cfg().proxyBase) : null;

      if (proxyBase && url.origin === proxyBase.origin && url.searchParams.has('url')) {
        const target = new URL(url.searchParams.get('url'));
        const patchedTarget = patchTarget(target);
        if (patchedTarget.href === target.href) return url;
        const patchedProxy = new URL(url.href);
        patchedProxy.searchParams.set('url', patchedTarget.href);
        return patchedProxy;
      }

      return patchTarget(url);
    } catch {
      return null;
    }
  }

  function installFetch() {
    const current = window.fetch;
    if (typeof current !== 'function' || current.__dlstreamSearchQueryCompat) return;

    const upstream = current.bind(window);
    const wrapper = function dlStreamSearchQueryFetch(input, init) {
      try {
        if (input instanceof Request) {
          const patched = patchUrl(input.url);
          if (patched && patched.href !== input.url) return upstream(new Request(patched.href, input), init);
        } else {
          const patched = patchUrl(input);
          if (patched && patched.href !== String(input || '')) return upstream(patched.href, init);
        }
      } catch (_) {}
      return upstream(input, init);
    };

    Object.defineProperty(wrapper, '__dlstreamSearchQueryCompat', { value: true });
    for (const marker of ['__dlstreamSpaCompat', '__dlstreamTransparentResponse']) {
      if (current[marker]) {
        try { Object.defineProperty(wrapper, marker, { value: true }); } catch (_) {}
      }
    }
    window.fetch = wrapper;
  }

  function installXhr() {
    const current = XMLHttpRequest.prototype.open;
    if (typeof current !== 'function' || current.__dlstreamSearchQueryCompat) return;

    const wrapper = function dlStreamSearchQueryXhrOpen(method, url, ...rest) {
      try {
        const patched = patchUrl(url);
        if (patched && patched.href !== String(url || '')) return current.call(this, method, patched.href, ...rest);
      } catch (_) {}
      return current.call(this, method, url, ...rest);
    };

    Object.defineProperty(wrapper, '__dlstreamSearchQueryCompat', { value: true });
    if (current.__dlstreamSpaCompat) {
      try { Object.defineProperty(wrapper, '__dlstreamSpaCompat', { value: true }); } catch (_) {}
    }
    XMLHttpRequest.prototype.open = wrapper;
  }

  function install() {
    installFetch();
    installXhr();
  }

  setInterval(install, 80);
  setTimeout(install, 0);
})();
