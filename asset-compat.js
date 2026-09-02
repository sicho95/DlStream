(() => {
  if (window.__DLSTREAM_ASSET_COMPAT__) return;
  window.__DLSTREAM_ASSET_COMPAT__ = true;

  const VIRTUAL_SEGMENT = '__dlstream_asset__';
  const nativeWrite = Document.prototype.write;
  const nativeWriteln = Document.prototype.writeln;
  const nativeSetAttribute = Element.prototype.setAttribute;
  const scriptSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'src');
  const linkHrefDescriptor = Object.getOwnPropertyDescriptor(HTMLLinkElement.prototype, 'href');

  function appBase() {
    try {
      const url = new URL('./', location.href);
      url.search = '';
      url.hash = '';
      return url;
    } catch {
      return null;
    }
  }

  function targetUrl() {
    try {
      const configured = window.__DLSTREAM__?.targetUrl;
      if (configured) return new URL(configured);
    } catch (_) {}

    try {
      const fromQuery = new URL(location.href).searchParams.get('url');
      if (fromQuery) return new URL(fromQuery);
    } catch (_) {}

    try {
      const stored = localStorage.getItem('dlstream.platformUrl');
      if (stored) return new URL(stored);
    } catch (_) {}

    return null;
  }

  function normalize(value, base = document.baseURI || targetUrl()?.href || location.href) {
    if (!value) return null;
    try {
      const url = new URL(String(value), base);
      return ['http:', 'https:'].includes(url.protocol) ? url : null;
    } catch {
      return null;
    }
  }

  function virtualPrefix() {
    const base = appBase();
    return base ? new URL(`./${VIRTUAL_SEGMENT}/`, base) : null;
  }

  function isVirtual(url) {
    const prefix = virtualPrefix();
    return Boolean(url && prefix && url.origin === prefix.origin && url.pathname.startsWith(prefix.pathname));
  }

  function isDlStreamAsset(url) {
    const base = appBase();
    if (!url || !base || url.origin !== base.origin) return false;
    if (!url.pathname.startsWith(base.pathname)) return false;
    if (isVirtual(url)) return false;
    return true;
  }

  function mapGithubAbsoluteToTarget(url) {
    const target = targetUrl();
    const base = appBase();
    if (!url || !target || !base) return url;
    if (url.origin !== base.origin || isDlStreamAsset(url) || isVirtual(url)) return url;
    try {
      return new URL(`${url.pathname}${url.search}${url.hash}`, target.origin);
    } catch {
      return url;
    }
  }

  function virtualize(value, kind = 'script', node = null) {
    const target = targetUrl();
    const prefix = virtualPrefix();
    if (!target || !prefix) return null;

    let url = normalize(value);
    if (!url || isVirtual(url) || isDlStreamAsset(url)) return null;
    url = mapGithubAbsoluteToTarget(url);

    if (url.origin !== target.origin) return null;

    if (kind === 'link') {
      const rel = String(node?.getAttribute?.('rel') || '').toLowerCase();
      const as = String(node?.getAttribute?.('as') || '').toLowerCase();
      const useful = rel.includes('modulepreload')
        || (rel.includes('preload') && ['script', 'worker', 'fetch'].includes(as));
      if (!useful) return null;
    }

    const scheme = url.protocol.replace(':', '');
    const host = encodeURIComponent(url.host);
    const pathname = url.pathname.startsWith('/') ? url.pathname : `/${url.pathname}`;
    const virtual = new URL(`./${VIRTUAL_SEGMENT}/${scheme}/${host}${pathname}`, appBase());
    virtual.search = url.search;

    const stats = window.__DLSTREAM_ASSET_STATS__ ||= { rewritten: 0, lastAsset: '' };
    stats.rewritten += 1;
    stats.lastAsset = url.href;
    return virtual;
  }

  function escapeHtmlAttribute(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function readAttr(tag, name) {
    const match = String(tag).match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
    return match ? match[2] : '';
  }

  function rewriteHtml(value) {
    let html = String(value ?? '');
    if (!html || !targetUrl()) return html;

    html = html.replace(
      /<script\b([^>]*?)\bsrc\s*=\s*(["'])(.*?)\2([^>]*)>/gi,
      (full, before, quote, rawSrc, after) => {
        const virtual = virtualize(rawSrc, 'script');
        if (!virtual) return full;
        return `<script${before}src=${quote}${escapeHtmlAttribute(virtual.href)}${quote}${after}>`;
      },
    );

    html = html.replace(
      /<link\b([^>]*?)\bhref\s*=\s*(["'])(.*?)\2([^>]*)>/gi,
      (full, before, quote, rawHref, after) => {
        const shadow = document.createElement('link');
        const rel = readAttr(full, 'rel');
        const as = readAttr(full, 'as');
        if (rel) nativeSetAttribute.call(shadow, 'rel', rel);
        if (as) nativeSetAttribute.call(shadow, 'as', as);
        const virtual = virtualize(rawHref, 'link', shadow);
        if (!virtual) return full;
        return `<link${before}href=${quote}${escapeHtmlAttribute(virtual.href)}${quote}${after}>`;
      },
    );

    return html;
  }

  try {
    Document.prototype.write = function dlStreamAssetWrite(...parts) {
      return nativeWrite.call(this, ...parts.map(rewriteHtml));
    };
    Document.prototype.writeln = function dlStreamAssetWriteln(...parts) {
      return nativeWriteln.call(this, ...parts.map(rewriteHtml));
    };
  } catch (_) {}

  if (scriptSrcDescriptor?.get && scriptSrcDescriptor?.set) {
    try {
      Object.defineProperty(HTMLScriptElement.prototype, 'src', {
        configurable: scriptSrcDescriptor.configurable,
        enumerable: scriptSrcDescriptor.enumerable,
        get: scriptSrcDescriptor.get,
        set(value) {
          const virtual = virtualize(value, 'script', this);
          return scriptSrcDescriptor.set.call(this, virtual?.href || value);
        },
      });
    } catch (_) {}
  }

  if (linkHrefDescriptor?.get && linkHrefDescriptor?.set) {
    try {
      Object.defineProperty(HTMLLinkElement.prototype, 'href', {
        configurable: linkHrefDescriptor.configurable,
        enumerable: linkHrefDescriptor.enumerable,
        get: linkHrefDescriptor.get,
        set(value) {
          const virtual = virtualize(value, 'link', this);
          return linkHrefDescriptor.set.call(this, virtual?.href || value);
        },
      });
    } catch (_) {}
  }

  try {
    Object.defineProperty(HTMLScriptElement.prototype, 'setAttribute', {
      configurable: true,
      writable: true,
      value(name, value) {
        if (String(name || '').toLowerCase() === 'src') {
          const virtual = virtualize(value, 'script', this);
          return nativeSetAttribute.call(this, name, virtual?.href || value);
        }
        return nativeSetAttribute.call(this, name, value);
      },
    });
  } catch (_) {}

  try {
    Object.defineProperty(HTMLLinkElement.prototype, 'setAttribute', {
      configurable: true,
      writable: true,
      value(name, value) {
        if (String(name || '').toLowerCase() === 'href') {
          const virtual = virtualize(value, 'link', this);
          return nativeSetAttribute.call(this, name, virtual?.href || value);
        }
        return nativeSetAttribute.call(this, name, value);
      },
    });
  } catch (_) {}

  function repairNode(node) {
    if (!(node instanceof Element)) return;

    if (node instanceof HTMLScriptElement) {
      const raw = node.getAttribute('src');
      const virtual = raw ? virtualize(raw, 'script', node) : null;
      if (virtual && raw !== virtual.href) nativeSetAttribute.call(node, 'src', virtual.href);
    }

    if (node instanceof HTMLLinkElement) {
      const raw = node.getAttribute('href');
      const virtual = raw ? virtualize(raw, 'link', node) : null;
      if (virtual && raw !== virtual.href) nativeSetAttribute.call(node, 'href', virtual.href);
    }

    node.querySelectorAll?.('script[src],link[href]').forEach(repairNode);
  }

  try {
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') mutation.addedNodes.forEach(repairNode);
        if (mutation.type === 'attributes') repairNode(mutation.target);
      }
    }).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src', 'href', 'rel', 'as'],
    });
  } catch (_) {}

  window.DlStreamAssetCompat = Object.freeze({
    virtualize,
    rewriteHtml,
    isVirtual,
  });
})();
