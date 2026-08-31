(() => {
  const cfg = window.__DLSTREAM__;
  if (!cfg) return;

  function normalize(value, base = cfg.targetUrl) {
    try {
      const u = new URL(String(value || ''), base);
      return ['http:', 'https:'].includes(u.protocol) ? u : null;
    } catch { return null; }
  }

  function hostAllowed(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (!cfg.rootTrusted || !host) return false;
    const root = String(cfg.rootHost || '').toLowerCase();
    if (host === root || host.endsWith(`.${root}`)) return true;
    if ((cfg.ignoredDomains || []).includes(host)) return false;
    return (cfg.learnedDomains || []).includes(host);
  }

  function filename(base, extension) {
    const clean = String(base || document.title || 'video')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'video';
    return clean.toLowerCase().endsWith(`.${extension}`) ? clean : `${clean}.${extension}`;
  }

  function directDownload(media) {
    const u = normalize(media.downloadUrl || media.url);
    if (!u) return;
    const a = document.createElement('a');
    a.href = u.href;
    a.target = '_blank';
    a.rel = 'noopener';
    if (media.filename) a.download = media.filename;
    a.click();
  }

  function hlsDownload(media) {
    const u = normalize(media.manifestUrl || media.downloadUrl || media.url);
    if (!u || !hostAllowed(u.hostname)) {
      throw new Error('Le manifest HLS n’appartient pas à un domaine appris depuis une racine de confiance.');
    }

    const endpoint = new URL('./__dlstream_hls_download__', cfg.appEntry);
    endpoint.searchParams.set('manifest', u.href);
    endpoint.searchParams.set('filename', filename(media.filename || media.title, 'ts'));
    endpoint.searchParams.set('root', cfg.rootHost || '');
    endpoint.searchParams.set('allowed', [cfg.rootHost, ...(cfg.learnedDomains || [])].filter(Boolean).join(','));
    window.open(endpoint.href, '_blank', 'noopener');
  }

  async function download(media = {}) {
    const type = String(media.type || media.mediaType || '').toLowerCase();
    if (type === 'hls' || /\.m3u8(?:$|[?#])/i.test(media.manifestUrl || media.url || '')) {
      hlsDownload(media);
      return;
    }

    if (type === 'dash' || /\.mpd(?:$|[?#])/i.test(media.manifestUrl || media.url || '')) {
      throw new Error('DASH détecté : l’audio et la vidéo sont souvent séparés. DlStream le détecte, mais un vrai muxage serveur est nécessaire pour produire un fichier VLC fiable.');
    }

    directDownload(media);
  }

  window.DlStreamOffline = Object.freeze({ download, hostAllowed });
})();
