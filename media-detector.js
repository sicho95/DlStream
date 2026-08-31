(() => {
  const cfg = window.__DLSTREAM__;
  if (!cfg?.targetUrl) return;

  const DIRECT_RE = /\.(mp4|m4v|mov|webm|mkv|avi)(?:$|[?#])/i;
  const HLS_RE = /\.m3u8(?:$|[?#])/i;
  const DASH_RE = /\.mpd(?:$|[?#])/i;
  const MAX_SCRIPT_TEXT = 1_000_000;
  let scanTimer = null;

  function normalize(value, base = cfg.targetUrl) {
    if (!value) return null;
    try {
      const u = new URL(String(value).trim(), base);
      return ['http:', 'https:'].includes(u.protocol) ? u : null;
    } catch { return null; }
  }

  function rootTrusted() {
    if (window.DlStreamTrust?.rootTrusted) return Boolean(window.DlStreamTrust.rootTrusted());
    try {
      const roots = JSON.parse(localStorage.getItem('dlstream.trustedRoots') || '[]');
      const host = String(cfg.rootHost || '').toLowerCase();
      return Array.isArray(roots) && roots.some((raw) => {
        const root = String(raw || '').toLowerCase();
        return host === root || host.endsWith(`.${root}`);
      });
    } catch { return false; }
  }

  function mediaType(url, mime = '') {
    const type = String(mime || '').toLowerCase();
    if (HLS_RE.test(url?.href || '') || type.includes('mpegurl')) return 'hls';
    if (DASH_RE.test(url?.href || '') || type.includes('dash+xml')) return 'dash';
    if (DIRECT_RE.test(url?.href || '') || type.startsWith('video/')) return 'direct';
    return null;
  }

  function filenameFromUrl(url, type) {
    try {
      const raw = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || 'video');
      if (type === 'hls') return `${raw.replace(/\.m3u8$/i, '') || 'video'}.ts`;
      if (type === 'dash') return `${raw.replace(/\.mpd$/i, '') || 'video'}.mp4`;
      return raw.includes('.') ? raw : `${raw}.mp4`;
    } catch { return type === 'hls' ? 'video.ts' : 'video.mp4'; }
  }

  function addCandidate(list, rawUrl, score, source, options = {}) {
    const url = normalize(rawUrl, options.base || cfg.targetUrl);
    if (!url) return;
    const type = mediaType(url, options.mime);
    if (!type) return;
    window.DlStreamTrust?.learnHost?.(url.hostname);
    const existing = list.find((item) => item.url.href === url.href && item.type === type);
    const candidate = {
      url,
      type,
      score,
      source,
      mime: options.mime || '',
      filename: options.filename || filenameFromUrl(url, type),
      title: options.title || document.title || 'Vidéo',
    };
    if (!existing) list.push(candidate);
    else if (candidate.score > existing.score) Object.assign(existing, candidate);
  }

  function collectExplicit(list) {
    const selectors = [
      ['meta[name="dlstream-download-url"]', 'content', 1100],
      ['meta[name="dlstream-manifest-url"]', 'content', 1090],
      ['[data-dlstream-download-url]', 'data-dlstream-download-url', 1080],
      ['[data-dlstream-manifest-url]', 'data-dlstream-manifest-url', 1070],
    ];
    for (const [selector, attr, score] of selectors) {
      document.querySelectorAll(selector).forEach((node) => addCandidate(list, node.getAttribute(attr), score, selector, {
        filename: node.getAttribute('data-dlstream-filename') || '',
      }));
    }
  }

  function collectElements(list) {
    document.querySelectorAll('video').forEach((video) => {
      addCandidate(list, video.currentSrc || video.getAttribute('src'), 930, 'video', { mime: video.getAttribute('type') || '' });
      video.querySelectorAll('source[src]').forEach((source) => addCandidate(list, source.getAttribute('src'), 920, 'video-source', { mime: source.type || '' }));
    });
    document.querySelectorAll('source[src]').forEach((source) => addCandidate(list, source.getAttribute('src'), 900, 'source', { mime: source.type || '' }));
    document.querySelectorAll('a[href][download]').forEach((a) => addCandidate(list, a.href, 1000, 'download-link', { filename: a.download || '' }));
    document.querySelectorAll('a[href]').forEach((a) => addCandidate(list, a.href, 700, 'media-link'));
  }

  function collectAttributes(list) {
    const attrs = ['data-download-url','data-file-url','data-video-url','data-video-src','data-file','data-src','data-manifest','data-manifest-url','data-hls','data-dash'];
    for (const attr of attrs) document.querySelectorAll(`[${attr}]`).forEach((node) => addCandidate(list, node.getAttribute(attr), 850, attr));
  }

  function collectMetadata(list) {
    const selectors = ['meta[property="og:video"]','meta[property="og:video:url"]','meta[property="og:video:secure_url"]','meta[name="twitter:player:stream"]'];
    for (const selector of selectors) document.querySelectorAll(selector).forEach((meta) => addCandidate(list, meta.content, 780, selector));
  }

  function walkJson(value, list, score, source, depth = 0) {
    if (depth > 8 || value == null) return;
    if (Array.isArray(value)) return value.forEach((item) => walkJson(item, list, score, source, depth + 1));
    if (typeof value !== 'object') return;
    const keys = new Set(['downloadUrl','download_url','contentUrl','content_url','fileUrl','file_url','videoUrl','video_url','manifestUrl','manifest_url','hlsUrl','hls_url','dashUrl','dash_url','file','src','url']);
    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string' && keys.has(key)) addCandidate(list, child, score, `${source}:${key}`);
      if (typeof child === 'object' && child !== null) walkJson(child, list, score, source, depth + 1);
    }
  }

  function collectJson(list) {
    document.querySelectorAll('script[type="application/ld+json"],script[type="application/json"]').forEach((script) => {
      const text = script.textContent || '';
      if (!text || text.length > MAX_SCRIPT_TEXT) return;
      try { walkJson(JSON.parse(text), list, script.type.includes('ld+json') ? 800 : 760, script.type); } catch (_) {}
    });
  }

  function collectInline(list) {
    document.querySelectorAll('script:not([src])').forEach((script) => {
      let text = script.textContent || '';
      if (!text || text.length > MAX_SCRIPT_TEXT) return;
      text = text.replace(/\\\//g, '/');

      const absolute = /https?:\/\/[^\s"'<>`\\]+?\.(?:mp4|m4v|mov|webm|mkv|avi|m3u8|mpd)(?:\?[^\s"'<>`\\]*)?/gi;
      for (const match of text.matchAll(absolute)) addCandidate(list, match[0], 650, 'inline-script-absolute');

      const quoted = /["']([^"']+?\.(?:mp4|m4v|mov|webm|mkv|avi|m3u8|mpd)(?:\?[^"']*)?)["']/gi;
      for (const match of text.matchAll(quoted)) addCandidate(list, match[1], 620, 'inline-script-relative');
    });
  }

  function collectNetwork(list) {
    const items = Array.isArray(window.__DLSTREAM_NETWORK_CANDIDATES__) ? window.__DLSTREAM_NETWORK_CANDIDATES__ : [];
    for (const item of items) addCandidate(list, item.url, Number(item.score || 880), item.source || 'network', {
      mime: item.mime || '',
      title: item.title || document.title || 'Vidéo',
    });
  }

  function serialize(candidate) {
    return {
      title: candidate.title,
      type: candidate.type,
      mediaType: candidate.type,
      url: candidate.url.href,
      downloadUrl: candidate.type === 'direct' ? candidate.url.href : null,
      manifestUrl: candidate.type === 'hls' || candidate.type === 'dash' ? candidate.url.href : null,
      filename: candidate.filename,
      detectedBy: candidate.source,
      score: candidate.score,
      mime: candidate.mime || '',
    };
  }

  function scan() {
    if (!rootTrusted()) {
      window.DlStream?.clearMedia?.();
      return;
    }
    const candidates = [];
    collectExplicit(candidates);
    collectElements(candidates);
    collectAttributes(candidates);
    collectMetadata(candidates);
    collectJson(candidates);
    collectInline(candidates);
    collectNetwork(candidates);
    const batch = candidates.sort((a, b) => b.score - a.score).slice(0, 40).map(serialize);
    window.DlStream?.exposeCandidates?.(batch);
  }

  function scheduleScan() { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 250); }

  function start() {
    scan();
    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src','href','download','content','data-dlstream-download-url','data-dlstream-manifest-url','data-download-url','data-file-url','data-video-url','data-video-src','data-file','data-src','data-manifest','data-manifest-url','data-hls','data-dash'],
    });
    window.addEventListener('load', scheduleScan, { once: true });
    window.addEventListener('storage', scheduleScan);
    window.addEventListener('dlstream-domains-updated', scheduleScan);
    window.DlStreamMediaDetector = Object.freeze({ scan, rescan: scheduleScan });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
