(() => {
  const cfg = window.__DLSTREAM__;
  if (!cfg?.appEntry || cfg.isNested) return;

  const DIRECT_RE = /\.(mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|mpe|m2v|m2ts|mts|ts|vob|ogv|ogg|3gp|3g2|wmv|flv|f4v|asf|divx|rm|rmvb)(?:$|[?#])/i;
  const STREAM_RE = /\.(m3u8|mpd|m3u|f4m)(?:$|[?#])/i;

  function normalizeMedia(media = {}) {
    const raw = media.url || media.downloadUrl || media.manifestUrl || '';
    let url = null;
    try { url = new URL(String(raw)); } catch (_) {}
    const declared = String(media.type || media.mediaType || '').toLowerCase();
    let type = declared;

    if (!type || type === 'unknown') {
      if (url && DIRECT_RE.test(url.href)) type = 'direct';
      else if (url && /\.m3u8(?:$|[?#])/i.test(url.href)) type = 'hls';
      else if (url && /\.mpd(?:$|[?#])/i.test(url.href)) type = 'dash';
      else if (url && STREAM_RE.test(url.href)) type = 'stream';
    }

    return { ...media, url: url?.href || raw, type, mediaType: type };
  }

  function supported(media = {}) {
    const item = normalizeMedia(media);
    const type = item.type;
    if (['direct', 'hls', 'dash', 'stream'].includes(type)) return true;
    try {
      const url = new URL(item.url);
      return DIRECT_RE.test(url.href) || STREAM_RE.test(url.href);
    } catch {
      return false;
    }
  }

  window.DlStreamOffline = Object.freeze({
    async analyze(media = {}) {
      const item = normalizeMedia(media);
      const feasible = supported(item);
      const direct = item.type === 'direct';
      return {
        feasible,
        type: item.type || 'unknown',
        mode: direct ? 'direct' : 'stream',
        reason: feasible
          ? (direct ? 'Fichier complet détecté — téléchargement direct via a-Shell.' : 'Stream détecté — reconstruction/remux via a-Shell et ffmpeg.')
          : 'Type média non pris en charge.',
      };
    },

    async download(media = {}) {
      const item = normalizeMedia(media);
      if (!supported(item)) throw new Error('Ce média n’est pas pris en charge.');
      if (!window.DlStreamAShell?.launch) throw new Error('Module a-Shell non disponible.');
      return window.DlStreamAShell.launch(item);
    },
  });

  if (!document.querySelector('script[data-dlstream-candidate-observer]')) {
    const script = document.createElement('script');
    script.src = new URL('./candidate-observer.js?v=24', cfg.appEntry).href;
    script.dataset.dlstreamCandidateObserver = '1';
    document.head.appendChild(script);
  }
})();
