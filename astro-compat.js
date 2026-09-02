(() => {
  if (window.__DLSTREAM_ASTRO_COMPAT__) return;
  window.__DLSTREAM_ASTRO_COMPAT__ = true;

  const upstreamWrite = Document.prototype.write;
  const upstreamWriteln = Document.prototype.writeln;
  const nativeSetAttribute = Element.prototype.setAttribute;
  const ATTRS = ['component-url', 'renderer-url', 'before-hydration-url', 'data-component-url', 'data-renderer-url'];

  function stats() {
    return window.__DLSTREAM_ASTRO_STATS__ ||= {
      islands: 0,
      rewritten: 0,
      pending: 0,
      lastComponent: '',
    };
  }

  function virtualize(value, node = null) {
    try {
      return window.DlStreamAssetCompat?.virtualize?.(value, 'script', node) || null;
    } catch {
      return null;
    }
  }

  function rewriteAttributeValue(raw, node = null) {
    const virtual = virtualize(raw, node);
    if (!virtual) return raw;
    const state = stats();
    state.rewritten += 1;
    state.lastComponent = String(raw || '');
    return virtual.href;
  }

  function escapeAttribute(value) {
    return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function rewriteIslandTag(tag) {
    let out = String(tag || '');
    for (const name of ATTRS) {
      const re = new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'gi');
      out = out.replace(re, (full, quote, raw) => {
        const rewritten = rewriteAttributeValue(raw);
        if (rewritten === raw) return full;
        return `${name}=${quote}${escapeAttribute(rewritten)}${quote}`;
      });
    }
    return out;
  }

  function rewriteHtml(value) {
    let html = String(value ?? '');
    if (!html) return html;
    return html.replace(/<astro-island\b[^>]*>/gi, rewriteIslandTag);
  }

  try {
    Document.prototype.write = function dlStreamAstroWrite(...parts) {
      return upstreamWrite.call(this, ...parts.map(rewriteHtml));
    };
    Document.prototype.writeln = function dlStreamAstroWriteln(...parts) {
      return upstreamWriteln.call(this, ...parts.map(rewriteHtml));
    };
  } catch (_) {}

  function repairIsland(node) {
    if (!(node instanceof Element)) return;
    if (node.tagName?.toLowerCase() !== 'astro-island' && !ATTRS.some((name) => node.hasAttribute(name))) return;

    for (const name of ATTRS) {
      const raw = node.getAttribute(name);
      if (!raw) continue;
      const rewritten = rewriteAttributeValue(raw, node);
      if (rewritten !== raw) nativeSetAttribute.call(node, name, rewritten);
    }
  }

  function repairTree(node) {
    if (!(node instanceof Element)) return;
    repairIsland(node);
    node.querySelectorAll?.(`astro-island,${ATTRS.map((name) => `[${name}]`).join(',')}`).forEach(repairIsland);
  }

  try {
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'childList') mutation.addedNodes.forEach(repairTree);
        if (mutation.type === 'attributes') repairIsland(mutation.target);
      }
    }).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ATTRS,
    });
  } catch (_) {}

  function refreshStats() {
    try {
      const islands = [...document.querySelectorAll('astro-island')];
      const state = stats();
      state.islands = islands.length;
      state.pending = islands.filter((node) => node.hasAttribute('ssr')).length;
      islands.forEach(repairIsland);
    } catch (_) {}
  }

  setInterval(refreshStats, 350);
  setTimeout(() => {
    try { repairTree(document.documentElement); } catch (_) {}
    refreshStats();
  }, 50);
})();
