(() => {
  const cfg = window.__DLSTREAM__;
  if (!cfg) return;

  function normalize(value, base = cfg.targetUrl) {
    try {
      const u = new URL(String(value || ''), base);
      return ['http:', 'https:'].includes(u.protocol) ? u : null;
    } catch { return null; }
  }

  function readMap(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
  }

  function readList(key) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || '[]');
      return Array.isArray(value) ? value.map(String).map((v) => v.toLowerCase()) : [];
    } catch { return []; }
  }

  function trustedRoot() {
    const host = String(cfg.rootHost || '').toLowerCase();
    return readList('dlstream.trustedRoots').some((root) => host === root || host.endsWith(`.${root}`));
  }

  function learnedDomains() {
    const map = readMap('dlstream.learnedDomains');
    return Array.isArray(map[cfg.rootHost]) ? map[cfg.rootHost].map(String).map((v) => v.toLowerCase()) : [];
  }

  function ignoredDomains() {
    const map = readMap('dlstream.ignoredDomains');
    return Array.isArray(map[cfg.rootHost]) ? map[cfg.rootHost].map(String).map((v) => v.toLowerCase()) : [];
  }

  function hostAllowed(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (!trustedRoot() || !host) return false;
    const root = String(cfg.rootHost || '').toLowerCase();
    if (host === root || host.endsWith(`.${root}`)) return true;
    if (ignoredDomains().includes(host)) return false;
    return learnedDomains().includes(host);
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
    if (!u || !hostAllowed(u.hostname)) throw new Error('Fichier hors domaines autorisés pour cette racine.');
    const a = document.createElement('a');
    a.href = u.href;
    a.target = '_blank';
    a.rel = 'noopener';
    if (media.filename) a.download = media.filename;
    a.click();
  }

  function hlsDownload(media) {
    const u = normalize(media.manifestUrl || media.downloadUrl || media.url);
    if (!u || !hostAllowed(u.hostname)) throw new Error('Manifest HLS hors domaines autorisés pour cette racine.');
    const endpoint = new URL('./__dlstream_hls_download__', cfg.appEntry);
    endpoint.searchParams.set('manifest', u.href);
    endpoint.searchParams.set('filename', filename(media.filename || media.title, 'ts'));
    endpoint.searchParams.set('allowed', [cfg.rootHost, ...learnedDomains()].filter(Boolean).join(','));
    window.open(endpoint.href, '_blank', 'noopener');
  }

  async function download(media = {}) {
    const type = String(media.type || media.mediaType || '').toLowerCase();
    if (type === 'hls' || /\.m3u8(?:$|[?#])/i.test(media.manifestUrl || media.url || '')) return hlsDownload(media);
    if (type === 'dash' || /\.mpd(?:$|[?#])/i.test(media.manifestUrl || media.url || '')) {
      throw new Error('DASH détecté : audio et vidéo sont souvent séparés. Un muxage serveur est nécessaire pour produire un fichier VLC fiable.');
    }
    return directDownload(media);
  }

  window.DlStreamOffline = Object.freeze({ download, hostAllowed });
})();
