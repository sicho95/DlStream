(() => {
  const DIRECT_RE = /\.(mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|mpe|m2v|m2ts|mts|ts|vob|ogv|ogg|3gp|3g2|wmv|flv|f4v|asf|divx|rm|rmvb)(?:$|[?#])/i;
  const HLS_RE = /\.m3u8(?:$|[?#])/i;
  const DASH_RE = /\.mpd(?:$|[?#])/i;
  const STREAM_RE = /(?:\.m3u(?:8)?|\.mpd|\.f4m|\.ismc)(?:$|[?#])|\.(?:ism|isml)\/manifest(?:$|[?#])/i;
  const MEDIA_HINT_RE = /(?:video|media|stream|play(?:back)?|manifest|playlist|master|source|hls|dash)/i;
  const seen = new Map();
  let installedDocument = null;
  let observer = null;
  let scanTimer = null;

  function cfg() {
    return window.__DLSTREAM__ || null;
  }

  function trusted() {
    const config = cfg();
    if (!config?.rootTrusted) return false;
    return window.DlStreamTrust?.rootTrusted ? Boolean(window.DlStreamTrust.rootTrusted()) : true;
  }

  function normalize(value, base) {
    if (!value) return null;
    try {
      const raw = String(value).trim().replace(/\\\//g, '/');
      const url = new URL(raw, base || cfg()?.targetUrl || location.href);
      return ['http:', 'https:'].includes(url.protocol) ? url : null;
    } catch {
      return null;
    }
  }

  function classify(url, hint = '', mime = '') {
    const href = url?.href || '';
    const type = String(mime || '').toLowerCase();
    if (HLS_RE.test(href) || type.includes('mpegurl')) return 'hls';
    if (DASH_RE.test(href) || type.includes('dash+xml')) return 'dash';
    if (DIRECT_RE.test(href)) return 'direct';
    if (STREAM_RE.test(href)) return 'stream';
    if (type.startsWith('video/') || type.startsWith('audio/')) return 'stream';
    if (MEDIA_HINT_RE.test(String(hint || ''))) return 'stream';
    return null;
  }

  function scoreFor(type, source) {
    let score = type === 'hls' ? 1360 : type === 'dash' ? 1320 : type === 'direct' ? 1280 : 1060;
    if (/performance-observer|media-element/i.test(source)) score += 120;
    if (/inline|json|attribute/i.test(source)) score -= 80;
    return score;
  }

  function publish(value, source, options = {}) {
    if (!trusted() || !window.DlStream?.exposeCandidates) return;
    const url = normalize(value, options.base);
    if (!url) return;
    const type = classify(url, options.hint || source, options.mime || '');
    if (!type) return;

    window.DlStreamTrust?.learnHost?.(url.hostname);
    const key = `${type}|${url.href}`;
    const score = Number(options.score || scoreFor(type, source));
    const previous = seen.get(key);
    if (previous && previous.score >= score) return;

    const item = {
      type,
      mediaType: type,
      url: url.href,
      score,
      detectedBy: `observer-v2:${source}`,
      source,
      mime: options.mime || '',
      title: document.title || 'Vidéo',
    };
    if (type === 'direct') item.downloadUrl = url.href;
    if (type === 'hls' || type === 'dash') item.manifestUrl = url.href;
    seen.set(key, item);
    window.DlStream.exposeCandidates([item]);
  }

  function scanMediaElements() {
    document.querySelectorAll('video,audio').forEach((media) => {
      const values = [media.currentSrc, media.getAttribute('src')];
      for (const value of values) {
        if (!value || String(value).startsWith('blob:')) continue;
        publish(value, 'media-element', { hint: media.tagName.toLowerCase(), mime: media.getAttribute('type') || '' });
      }
      media.querySelectorAll('source[src]').forEach((source) => {
        publish(source.getAttribute('src'), 'media-element-source', { hint: 'video source', mime: source.type || '' });
      });
    });
  }

  function scanAttributes() {
    const attrs = [
      'data-video','data-video-url','data-video-src','data-media','data-media-url','data-stream','data-stream-url',
      'data-playback','data-playback-url','data-manifest','data-manifest-url','data-playlist','data-playlist-url',
      'data-hls','data-dash','data-source','data-file','data-file-url','data-src','data-url'
    ];
    document.querySelectorAll('*').forEach((node) => {
      for (const attr of attrs) {
        const value = node.getAttribute?.(attr);
        if (!value) continue;
        publish(value, `attribute:${attr}`, { hint: attr });
      }
    });
  }

  function scanInlineScripts() {
    const keyed = /(?:video(?:Url|URL|_url|Src|_src)?|media(?:Url|URL|_url)?|stream(?:Url|URL|_url)?|playback(?:Url|URL|_url)?|manifest(?:Url|URL|_url)?|playlist(?:Url|URL|_url)?|file(?:Url|URL|_url)?|source|src)\s*[:=]\s*["']([^"']+)["']/gi;
    document.querySelectorAll('script:not([src])').forEach((script) => {
      let content = String(script.textContent || '');
      if (!content || content.length > 2_000_000) return;
      content = content.replace(/\\\//g, '/');
      for (const match of content.matchAll(keyed)) {
        const key = match[0].split(/[:=]/, 1)[0] || 'media';
        publish(match[1], 'inline-keyed', { hint: key });
      }
    });
  }

  function scanJson() {
    const keys = /(?:video|media|stream|playback|manifest|playlist|file|source|src|url|uri)/i;
    const visit = (value, depth = 0, count = { value: 0 }) => {
      if (!value || depth > 5 || count.value > 600) return;
      if (Array.isArray(value)) {
        value.slice(0, 80).forEach((item) => visit(item, depth + 1, count));
        return;
      }
      if (typeof value !== 'object') return;
      count.value += 1;
      let entries = [];
      try { entries = Object.entries(value).slice(0, 120); } catch { return; }
      for (const [key, child] of entries) {
        if (typeof child === 'string' && keys.test(key)) publish(child, 'json-keyed', { hint: key });
        else if (child && typeof child === 'object') visit(child, depth + 1, count);
      }
    };

    document.querySelectorAll('script[type="application/json"],script[type="application/ld+json"]').forEach((script) => {
      const content = String(script.textContent || '');
      if (!content || content.length > 2_000_000) return;
      try { visit(JSON.parse(content)); } catch (_) {}
    });
  }

  function inspectPerformanceEntry(entry, source = 'performance') {
    const url = normalize(entry?.name);
    if (!url) return;
    const initiator = String(entry?.initiatorType || '');
    if (HLS_RE.test(url.href) || DASH_RE.test(url.href) || DIRECT_RE.test(url.href) || STREAM_RE.test(url.href)) {
      publish(url.href, source, { hint: initiator, score: 1250 });
      return;
    }
    if (/^(video|audio)$/i.test(initiator)) {
      publish(url.href, `${source}-media`, { hint: 'video playback', score: 1180 });
      return;
    }
    if (/^(fetch|xmlhttprequest)$/i.test(initiator) && MEDIA_HINT_RE.test(`${url.pathname}${url.search}`)) {
      publish(url.href, `${source}-network`, { hint: 'media stream playback', score: 850 });
    }
  }

  function scanPerformance() {
    try {
      performance.getEntriesByType('resource').slice(-800).forEach((entry) => inspectPerformanceEntry(entry));
    } catch (_) {}
  }

  function learnEmbeddedHosts() {
    document.querySelectorAll('iframe[src],iframe[data-src],iframe[data-url],embed[src],object[data]').forEach((node) => {
      const raw = node.getAttribute('src') || node.getAttribute('data-src') || node.getAttribute('data-url') || node.getAttribute('data');
      const url = normalize(raw);
      if (url) window.DlStreamTrust?.learnHost?.(url.hostname);
    });
  }

  function scan() {
    if (!trusted()) return;
    scanMediaElements();
    scanAttributes();
    scanInlineScripts();
    scanJson();
    scanPerformance();
    learnEmbeddedHosts();
  }

  function schedule() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 120);
  }

  function normalizeExistingCandidates() {
    const api = window.DlStream;
    if (!api || api.__observerV2Wrapped) return;
    const originalCandidates = api.exposeCandidates?.bind(api);
    const originalMedia = api.exposeMedia?.bind(api);
    if (!originalCandidates && !originalMedia) return;

    const normalizeOne = (raw = {}) => {
      const url = normalize(raw.url || raw.downloadUrl || raw.manifestUrl);
      if (!url) return raw;
      const declared = String(raw.type || raw.mediaType || '').toLowerCase();
      let type = declared;
      if (HLS_RE.test(url.href)) type = 'hls';
      else if (DASH_RE.test(url.href)) type = 'dash';
      else if (DIRECT_RE.test(url.href)) type = 'direct';
      else if (declared === 'direct' || /^video\//i.test(String(raw.mime || ''))) type = 'stream';
      return {
        ...raw,
        type,
        mediaType: type,
        url: url.href,
        downloadUrl: type === 'direct' ? url.href : null,
        manifestUrl: type === 'hls' || type === 'dash' ? url.href : null,
      };
    };

    window.DlStream = {
      ...api,
      exposeCandidates(list = []) {
        return originalCandidates?.((Array.isArray(list) ? list : []).map(normalizeOne));
      },
      exposeMedia(media = {}) {
        return originalMedia?.(normalizeOne(media));
      },
      __observerV2Wrapped: true,
    };
  }

  function install() {
    const config = cfg();
    if (!config?.targetUrl || !document.documentElement) return;
    normalizeExistingCandidates();
    if (installedDocument === document) return;
    installedDocument = document;

    observer?.disconnect?.();
    observer = new MutationObserver(schedule);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['src','href','data-src','data-url','data-video','data-video-url','data-video-src','data-media','data-media-url','data-stream','data-stream-url','data-playback','data-playback-url','data-manifest','data-manifest-url','data-playlist','data-playlist-url','data-hls','data-dash','data-source','data-file','data-file-url'],
    });

    try {
      const performanceObserver = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => inspectPerformanceEntry(entry, 'performance-observer'));
      });
      performanceObserver.observe({ type: 'resource', buffered: true });
    } catch (_) {}

    window.addEventListener('load', schedule, { once: true });
    window.addEventListener('dlstream-domains-updated', schedule);
    setTimeout(scan, 250);
    setTimeout(scan, 1000);
    setTimeout(scan, 3000);
  }

  setInterval(() => {
    normalizeExistingCandidates();
    install();
  }, 180);
})();
