(() => {
  const cfg = window.__DLSTREAM__;
  if (!cfg?.targetUrl) return;

  const HLS_RE = /\.m3u8(?:$|[?#])/i;
  const DASH_RE = /\.mpd(?:$|[?#])/i;
  const DIRECT_EXT_RE = /\.(mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|mpe|m2v|m2ts|mts|ts|vob|ogv|ogg|3gp|3g2|wmv|flv|f4v|asf|divx|rm|rmvb)(?:$|[?#])/i;
  const DIRECT_SCAN_EXT = 'mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|mpe|m2v|m2ts|mts|ts|vob|ogv|ogg|3gp|3g2|wmv|flv|f4v|asf|divx|rm|rmvb';
  const MEDIA_SCAN_EXT = `${DIRECT_SCAN_EXT}|m3u8|mpd`;
  const MAX_TEXT = 2_000_000;
  const MAX_GLOBAL_NODES = 600;
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

  function looksLikeSegment(url) {
    const path = decodeURIComponent(url?.pathname || '').toLowerCase();
    const name = path.split('/').pop() || '';
    if (/\.(m4s|cmfv|cmfa)(?:$|[?#])/i.test(url?.href || '')) return true;
    if (!/\.ts$/i.test(name)) return false;
    return /(?:^|[-_.])(seg(?:ment)?|chunk|frag(?:ment)?|part|piece)[-_\.]*\d*/i.test(name)
      || /^\d{1,9}\.ts$/i.test(name)
      || /\/segments?\//i.test(path)
      || /\/chunks?\//i.test(path);
  }

  function mediaType(url, mime = '', forceType = '') {
    const href = url?.href || '';
    const type = String(mime || '').toLowerCase();
    if (HLS_RE.test(href) || type.includes('mpegurl')) return 'hls';
    if (DASH_RE.test(href) || type.includes('dash+xml')) return 'dash';
    if (forceType === 'direct') return looksLikeSegment(url) ? null : 'direct';
    if (DIRECT_EXT_RE.test(href)) return looksLikeSegment(url) ? null : 'direct';
    if (type.startsWith('video/') && !type.includes('mp2t')) return 'direct';
    if (type === 'video/mp2t' && !looksLikeSegment(url)) return 'direct';
    return null;
  }

  function filenameFromUrl(url, type) {
    try {
      const raw = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || 'video');
      if (type === 'hls') return `${raw.replace(/\.m3u8$/i, '') || 'video'}.ts`;
      if (type === 'dash') return `${raw.replace(/\.mpd$/i, '') || 'video'}.mp4`;
      return raw.includes('.') ? raw : 'video.mp4';
    } catch { return type === 'hls' ? 'video.ts' : 'video.mp4'; }
  }

  function addCandidate(list, rawUrl, score, source, options = {}) {
    const url = normalize(rawUrl, options.base || cfg.targetUrl);
    if (!url) return;
    const type = mediaType(url, options.mime, options.forceType || '');
    if (!type) return;

    window.DlStreamTrust?.learnHost?.(url.hostname);

    const candidate = {
      url,
      type,
      score,
      source,
      mime: options.mime || '',
      filename: options.filename || filenameFromUrl(url, type),
      title: options.title || document.title || 'Vidéo',
    };
    const existing = list.find((item) => item.url.href === url.href && item.type === type);
    if (!existing) list.push(candidate);
    else if (candidate.score > existing.score) Object.assign(existing, candidate);
  }

  function collectExplicit(list) {
    const selectors = [
      ['meta[name="dlstream-download-url"]', 'content', 1400, 'direct'],
      ['meta[name="dlstream-manifest-url"]', 'content', 1390, ''],
      ['[data-dlstream-download-url]', 'data-dlstream-download-url', 1380, 'direct'],
      ['[data-dlstream-manifest-url]', 'data-dlstream-manifest-url', 1370, ''],
    ];
    for (const [selector, attr, score, forceType] of selectors) {
      document.querySelectorAll(selector).forEach((node) => addCandidate(list, node.getAttribute(attr), score, selector, {
        forceType,
        filename: node.getAttribute('data-dlstream-filename') || '',
      }));
    }
  }

  function collectElements(list) {
    document.querySelectorAll('video').forEach((video) => {
      addCandidate(list, video.currentSrc || video.getAttribute('src'), 1080, 'video', { mime: video.getAttribute('type') || '' });
      video.querySelectorAll('source[src]').forEach((source) => addCandidate(list, source.getAttribute('src'), 1070, 'video-source', { mime: source.type || '' }));
    });
    document.querySelectorAll('source[src]').forEach((source) => addCandidate(list, source.getAttribute('src'), 1050, 'source', { mime: source.type || '' }));
    document.querySelectorAll('a[href][download]').forEach((a) => addCandidate(list, a.href, 1300, 'download-link', { forceType: 'direct', filename: a.download || '' }));
    document.querySelectorAll('a[href]').forEach((a) => addCandidate(list, a.href, 760, 'media-link'));
  }

  function collectAttributes(list) {
    const directAttrs = [
      'data-download-url','data-file-url','data-content-url','data-original-url','data-original-file','data-download','data-file',
      'data-mp4','data-video-file','data-media-file','data-source-file'
    ];
    const genericAttrs = [
      'data-video-url','data-video-src','data-media-url','data-source','data-src','data-url','data-stream','data-stream-url',
      'data-playback-url','data-manifest','data-manifest-url','data-hls','data-dash'
    ];
    for (const attr of directAttrs) {
      document.querySelectorAll(`[${attr}]`).forEach((node) => addCandidate(list, node.getAttribute(attr), 1020, attr, { forceType: 'direct' }));
    }
    for (const attr of genericAttrs) {
      document.querySelectorAll(`[${attr}]`).forEach((node) => addCandidate(list, node.getAttribute(attr), 930, attr));
    }
  }

  function collectMetadata(list) {
    const selectors = [
      'meta[property="og:video"]','meta[property="og:video:url"]','meta[property="og:video:secure_url"]',
      'meta[name="twitter:player:stream"]','meta[itemprop="contentUrl"]'
    ];
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((meta) => {
        const mime = meta.getAttribute('type') || meta.getAttribute('content-type') || '';
        const forceType = selector.includes('contentUrl') ? 'direct' : '';
        addCandidate(list, meta.content, 900, selector, { mime, forceType });
      });
    }
  }

  function keyHint(key) {
    const k = String(key || '').toLowerCase();
    if (/(download|original|content).*(url|uri|src|file)|^(file|fileurl|file_url|contenturl|content_url|originalurl|original_url)$/i.test(k)) return 'direct';
    if (/(video|media|source|src|stream|playback|manifest|hls|dash|url|uri)/i.test(k)) return 'generic';
    return '';
  }

  function walkObject(value, list, score, source, depth = 0, state = { count: 0 }) {
    if (depth > 6 || value == null || state.count >= MAX_GLOBAL_NODES) return;
    if (typeof value !== 'object') return;
    if (value instanceof Node || value === window || value === document) return;
    state.count += 1;

    if (Array.isArray(value)) {
      for (const item of value.slice(0, 100)) {
        if (typeof item === 'object' && item !== null) walkObject(item, list, score, source, depth + 1, state);
        else if (typeof item === 'string') addCandidate(list, item, score - 20, `${source}:array`);
      }
      return;
    }

    let entries;
    try { entries = Object.entries(value).slice(0, 150); } catch { return; }
    for (const [key, child] of entries) {
      const hint = keyHint(key);
      if (typeof child === 'string' && hint) {
        addCandidate(list, child, score, `${source}:${key}`, { forceType: hint === 'direct' ? 'direct' : '' });
      }
      if (typeof child === 'object' && child !== null) walkObject(child, list, score - 10, source, depth + 1, state);
    }
  }

  function collectJson(list) {
    document.querySelectorAll('script[type="application/ld+json"],script[type="application/json"]').forEach((script) => {
      const text = script.textContent || '';
      if (!text || text.length > MAX_TEXT) return;
      try { walkObject(JSON.parse(text), list, script.type.includes('ld+json') ? 980 : 940, script.type, 0, { count: 0 }); } catch (_) {}
    });
  }

  function collectInline(list) {
    const absolute = new RegExp(`https?:\\/\\/[^\\s\"'<>\\x60\\\\]+?\\.(?:${MEDIA_SCAN_EXT})(?:\\?[^\\s\"'<>\\x60\\\\]*)?`, 'gi');
    const quoted = new RegExp(`[\"']([^\"']+?\\.(?:${MEDIA_SCAN_EXT})(?:\\?[^\"']*)?)[\"']`, 'gi');
    const keyed = /(?:download(?:Url|URL|_url)?|file(?:Url|URL|_url)?|content(?:Url|URL|_url)?|original(?:Url|URL|_url)?|video(?:Url|URL|_url)?|media(?:Url|URL|_url)?|source|src)\s*[:=]\s*["'](https?:\/\/[^"']+)["']/gi;

    document.querySelectorAll('script:not([src])').forEach((script) => {
      let text = script.textContent || '';
      if (!text || text.length > MAX_TEXT) return;
      text = text.replace(/\\\//g, '/');
      for (const match of text.matchAll(absolute)) addCandidate(list, match[0], 820, 'inline-script-absolute');
      for (const match of text.matchAll(quoted)) addCandidate(list, match[1], 790, 'inline-script-relative');
      for (const match of text.matchAll(keyed)) addCandidate(list, match[1], 900, 'inline-script-keyed', { forceType: 'direct' });
    });
  }

  function collectHtmlSource(list) {
    let html = document.documentElement?.outerHTML || '';
    if (!html || html.length > MAX_TEXT) html = html.slice(0, MAX_TEXT);
    if (!html) return;
    html = html.replace(/&amp;/g, '&').replace(/\\\//g, '/');
    const re = new RegExp(`https?:\\/\\/[^\\s\"'<>\\x60\\\\]+?\\.(?:${MEDIA_SCAN_EXT})(?:\\?[^\\s\"'<>\\x60\\\\]*)?`, 'gi');
    for (const match of html.matchAll(re)) addCandidate(list, match[0], 730, 'html-source');
  }

  function collectGlobals(list) {
    const names = Object.keys(window).filter((name) => /(player|video|media|file|source|stream|download|playback|config)/i.test(name)).slice(0, 80);
    for (const name of names) {
      let value;
      try { value = window[name]; } catch { continue; }
      if (!value || typeof value !== 'object' || value instanceof Node) continue;
      walkObject(value, list, 860, `window.${name}`, 0, { count: 0 });
    }
  }

  function collectPerformance(list) {
    try {
      const entries = performance.getEntriesByType('resource').slice(-500);
      for (const entry of entries) {
        const score = entry.initiatorType === 'video' ? 940 : entry.initiatorType === 'xmlhttprequest' || entry.initiatorType === 'fetch' ? 850 : 700;
        addCandidate(list, entry.name, score, `performance:${entry.initiatorType || 'resource'}`);
      }
    } catch (_) {}
  }

  function collectNetwork(list) {
    const items = Array.isArray(window.__DLSTREAM_NETWORK_CANDIDATES__) ? window.__DLSTREAM_NETWORK_CANDIDATES__ : [];
    for (const item of items) addCandidate(list, item.url, Number(item.score || 900), item.source || 'network', {
      mime: item.mime || '',
      title: item.title || document.title || 'Vidéo',
      forceType: item.type === 'direct' ? 'direct' : '',
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
    collectHtmlSource(candidates);
    collectGlobals(candidates);
    collectPerformance(candidates);
    collectNetwork(candidates);

    const batch = candidates
      .sort((a, b) => b.score - a.score)
      .slice(0, 80)
      .map(serialize);
    window.DlStream?.exposeCandidates?.(batch);
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 250);
  }

  function start() {
    scan();
    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'src','href','download','content','type','poster','data-dlstream-download-url','data-dlstream-manifest-url',
        'data-download-url','data-file-url','data-content-url','data-original-url','data-original-file','data-download','data-file',
        'data-mp4','data-video-file','data-media-file','data-source-file','data-video-url','data-video-src','data-media-url',
        'data-source','data-src','data-url','data-stream','data-stream-url','data-playback-url','data-manifest','data-manifest-url','data-hls','data-dash'
      ],
    });
    window.addEventListener('load', scheduleScan, { once: true });
    window.addEventListener('storage', scheduleScan);
    window.addEventListener('dlstream-domains-updated', scheduleScan);
    setTimeout(scheduleScan, 1200);
    setTimeout(scheduleScan, 3500);
    window.DlStreamMediaDetector = Object.freeze({ scan, rescan: scheduleScan });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
