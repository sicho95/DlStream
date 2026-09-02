(() => {
  if (window.__DLSTREAM_MEDIA_FILTER__) return;
  window.__DLSTREAM_MEDIA_FILTER__ = true;

  const DIRECT_EXT_RE = /\.(mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|mpe|m2v|m2ts|mts|ts|vob|ogv|ogg|3gp|3g2|wmv|flv|f4v|asf|divx|rm|rmvb)(?:$|[?#])/i;
  const HLS_RE = /\.m3u8(?:$|[?#])/i;
  const DASH_RE = /\.mpd(?:$|[?#])/i;
  const AD_RE = /(?:^|[._\/-])(?:ads?|advert(?:ising)?|banner|promo|tracking|tracker|analytics|pixel|beacon|sponsor)(?:[._\/-]|$)|doubleclick|googlesyndication|adservice|adserver|adexchange|adexchanger|taboola|outbrain|exoclick/i;
  const DECORATIVE_NAME_RE = /^(?:site|bg|background|hero|banner|loader|loading|ambient|splash|logo|wallpaper|backdrop)(?:[-_.][^/]*)?\.(?:webm|mp4|m4v|mov)$/i;
  const MEDIA_PATH_RE = /(?:^|\/)(?:video|videos|media|stream|streams|playback|manifest|playlist|master|source|hls|dash)(?:\/|$|[._-])|videoplayback/i;
  const STRONG_SOURCE_RE = /(?:media-element|video-source|^video$|download-link|dlstream-download|dlstream-manifest|og:video|twitter:player|contenturl|manifest|hls|dash)/i;
  let currentApi = null;

  function normalize(value, base = window.__DLSTREAM__?.targetUrl || document.baseURI || location.href) {
    try {
      const url = new URL(String(value || ''), base);
      return ['http:', 'https:'].includes(url.protocol) ? url : null;
    } catch {
      return null;
    }
  }

  function sourceOf(media) {
    return String(media?.detectedBy || media?.source || '').toLowerCase();
  }

  function isDecorativeDomVideo(url) {
    try {
      for (const video of document.querySelectorAll('video')) {
        const values = [video.currentSrc, video.getAttribute('src')].filter(Boolean);
        const matches = values.some((value) => normalize(value)?.href === url.href);
        if (!matches) {
          const sourceMatch = [...video.querySelectorAll('source[src]')]
            .some((source) => normalize(source.getAttribute('src'))?.href === url.href);
          if (!sourceMatch) continue;
        }
        const hasControls = video.controls || video.hasAttribute('controls');
        if (!hasControls && (video.autoplay || video.loop || video.muted || video.hasAttribute('playsinline'))) return true;
      }
    } catch (_) {}
    return false;
  }

  function rejectionReason(media) {
    const url = normalize(media?.url || media?.downloadUrl || media?.manifestUrl, media?.sourcePage);
    if (!url) return 'url-invalide';

    const href = url.href;
    const path = decodeURIComponent(`${url.pathname}${url.search}`).toLowerCase();
    const hostPath = `${url.hostname}${path}`;
    const type = String(media?.type || media?.mediaType || '').toLowerCase();
    const mime = String(media?.mime || '').toLowerCase();
    const source = sourceOf(media);
    const filename = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '').toLowerCase();

    if (AD_RE.test(hostPath)) return 'publicite-tracking';

    if (DIRECT_EXT_RE.test(href)) {
      if (isDecorativeDomVideo(url)) return 'video-decorative';
      if (DECORATIVE_NAME_RE.test(filename) && !STRONG_SOURCE_RE.test(source)) return 'asset-decoratif';
      return '';
    }

    if (HLS_RE.test(href) || DASH_RE.test(href) || type === 'hls' || type === 'dash') return '';

    if (type === 'stream' || type === 'direct' || mime.startsWith('video/') || mime.startsWith('audio/')) {
      if (STRONG_SOURCE_RE.test(source)) return '';
      if (MEDIA_PATH_RE.test(path)) return '';
      return 'endpoint-opaque-sans-indice-media';
    }

    return '';
  }

  function recordReject(media, reason) {
    const stats = window.__DLSTREAM_FILTER_STATS__ ||= { rejected: 0, lastRejected: '' };
    stats.rejected += 1;
    stats.lastRejected = `${reason} — ${media?.url || media?.downloadUrl || media?.manifestUrl || ''}`;
  }

  function sanitizeOne(media) {
    if (!media || typeof media !== 'object') return null;
    const reason = rejectionReason(media);
    if (!reason) return media;
    recordReject(media, reason);
    return null;
  }

  function sanitizeList(list) {
    return (Array.isArray(list) ? list : []).map(sanitizeOne).filter(Boolean);
  }

  function wrapApi(value) {
    if (!value || typeof value !== 'object') return value;
    if (value.__dlstreamMediaFiltered) return value;

    const originalCandidates = typeof value.exposeCandidates === 'function' ? value.exposeCandidates.bind(value) : null;
    const originalMedia = typeof value.exposeMedia === 'function' ? value.exposeMedia.bind(value) : null;
    if (!originalCandidates && !originalMedia) return value;

    const wrapped = {
      ...value,
      exposeCandidates(list = []) {
        return originalCandidates?.(sanitizeList(list));
      },
      exposeMedia(media = {}) {
        const clean = sanitizeOne(media);
        if (!clean) return undefined;
        return originalMedia?.(clean);
      },
    };
    try { Object.defineProperty(wrapped, '__dlstreamMediaFiltered', { value: true, enumerable: false }); } catch (_) {}
    return wrapped;
  }

  try {
    const existing = window.DlStream;
    Object.defineProperty(window, 'DlStream', {
      configurable: true,
      enumerable: true,
      get() { return currentApi; },
      set(value) { currentApi = wrapApi(value); },
    });
    if (existing) window.DlStream = existing;
  } catch (_) {
    setInterval(() => {
      try {
        if (window.DlStream && !window.DlStream.__dlstreamMediaFiltered) window.DlStream = wrapApi(window.DlStream);
      } catch (_) {}
    }, 50);
  }

  window.DlStreamMediaFilter = Object.freeze({
    sanitizeOne,
    sanitizeList,
    rejectionReason,
  });
})();
