(() => {
  const cfg = window.__DLSTREAM__;
  if (!cfg?.targetUrl || !cfg?.appEntry) return;

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

  function learnDomains(domains = []) {
    if (!trustedRoot()) return;
    const ignored = new Set(ignoredDomains());
    const current = new Set(learnedDomains());
    const root = String(cfg.rootHost || '').toLowerCase();
    for (const raw of domains) {
      const host = String(raw || '').trim().toLowerCase();
      if (!host || host === root || host.endsWith(`.${root}`) || ignored.has(host)) continue;
      current.add(host);
    }
    const map = readMap('dlstream.learnedDomains');
    map[cfg.rootHost] = [...current].slice(0, 128);
    localStorage.setItem('dlstream.learnedDomains', JSON.stringify(map));
    window.dispatchEvent(new CustomEvent('dlstream-domains-updated'));
  }

  function hostAllowed(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (!trustedRoot() || !host) return false;
    const root = String(cfg.rootHost || '').toLowerCase();
    if (host === root || host.endsWith(`.${root}`)) return true;
    if (ignoredDomains().includes(host)) return false;
    return learnedDomains().includes(host);
  }

  function allowedQuery() {
    return [cfg.rootHost, ...learnedDomains()].filter(Boolean).join(',');
  }

  function filename(base, extension) {
    const clean = String(base || document.title || 'video')
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'video';
    const stripped = clean.replace(/\.(mp4|m4v|mov|webm|mkv|avi|m3u8|mpd|ts)$/i, '');
    return `${stripped}.${extension}`;
  }

  function mediaUrl(media) {
    return normalize(media.downloadUrl || media.manifestUrl || media.url);
  }

  function corsBlocked(reason) {
    return /\bCORS\b/i.test(String(reason || ''));
  }

  async function analyzeDirect(u) {
    const endpoint = new URL('./__dlstream_direct_probe__', cfg.appEntry);
    endpoint.searchParams.set('url', u.href);
    endpoint.searchParams.set('allowed', allowedQuery());

    try {
      const response = await fetch(endpoint.href, { cache: 'no-store' });
      const data = await response.json();

      if (data?.feasible) {
        return {
          feasible: true,
          type: 'direct',
          mode: 'local-relay',
          reason: data.reason || 'Fichier direct téléchargeable.',
          contentType: data.contentType || '',
          size: data.size || null,
        };
      }

      // Une navigation navigateur vers un fichier direct n'est pas soumise au CORS de fetch.
      // Conserver donc le bouton de téléchargement si seul le relais local est bloqué par CORS.
      if (corsBlocked(data?.reason)) {
        return {
          feasible: true,
          type: 'direct',
          mode: 'browser-direct',
          reason: 'Fichier direct détecté ; le relais local est bloqué par CORS, ouverture directe du fichier.',
          contentType: '',
          size: null,
        };
      }

      return {
        feasible: false,
        type: 'direct',
        reason: data?.reason || `Pré-contrôle direct impossible (${response.status}).`,
      };
    } catch (error) {
      const reason = error?.message || 'Pré-contrôle du fichier direct impossible.';
      return corsBlocked(reason)
        ? {
            feasible: true,
            type: 'direct',
            mode: 'browser-direct',
            reason: 'Fichier direct détecté ; le relais local est bloqué par CORS, ouverture directe du fichier.',
          }
        : { feasible: false, type: 'direct', reason };
    }
  }

  async function analyze(media = {}) {
    const u = mediaUrl(media);
    if (!u) return { feasible: false, reason: 'URL média invalide.', type: 'unknown' };
    if (!hostAllowed(u.hostname)) return { feasible: false, reason: `Domaine non autorisé : ${u.hostname}`, type: media.type || 'unknown' };

    const type = String(media.type || media.mediaType || '').toLowerCase();
    if (type === 'dash' || /\.mpd(?:$|[?#])/i.test(u.href)) {
      return { feasible: false, type: 'dash', reason: 'DASH segmenté détecté : muxage audio/vidéo serveur requis.' };
    }

    if (type === 'hls' || /\.m3u8(?:$|[?#])/i.test(u.href)) {
      const endpoint = new URL('./__dlstream_hls_probe__', cfg.appEntry);
      endpoint.searchParams.set('manifest', u.href);
      endpoint.searchParams.set('allowed', allowedQuery());
      try {
        const response = await fetch(endpoint.href, { cache: 'no-store' });
        const data = await response.json();
        if (Array.isArray(data?.discoveredDomains)) learnDomains(data.discoveredDomains);
        return data?.feasible
          ? { feasible: true, type: 'hls', format: data.format || 'ts', reason: data.reason || 'HLS recomposable.', segmentCount: data.segmentCount || 0 }
          : { feasible: false, type: 'hls', reason: data?.reason || `Pré-contrôle HLS impossible (${response.status}).` };
      } catch (error) {
        return { feasible: false, type: 'hls', reason: error?.message || 'Pré-contrôle HLS impossible.' };
      }
    }

    return analyzeDirect(u);
  }

  function browserDirectDownload(media) {
    const u = mediaUrl(media);
    if (!u || !hostAllowed(u.hostname)) throw new Error('Fichier hors domaines autorisés pour cette racine.');

    const a = document.createElement('a');
    a.href = u.href;
    a.target = '_blank';
    a.rel = 'noopener';
    if (media.filename) a.download = media.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function localRelayDownload(media) {
    const u = mediaUrl(media);
    if (!u || !hostAllowed(u.hostname)) throw new Error('Fichier hors domaines autorisés pour cette racine.');
    const ext = (u.pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1] || 'mp4').toLowerCase();
    const endpoint = new URL('./__dlstream_direct_download__', cfg.appEntry);
    endpoint.searchParams.set('url', u.href);
    endpoint.searchParams.set('filename', filename(media.filename || media.title, ext));
    endpoint.searchParams.set('allowed', allowedQuery());
    window.open(endpoint.href, '_blank', 'noopener');
  }

  function hlsDownload(media) {
    const u = mediaUrl(media);
    if (!u || !hostAllowed(u.hostname)) throw new Error('Manifest HLS hors domaines autorisés pour cette racine.');
    const endpoint = new URL('./__dlstream_hls_download__', cfg.appEntry);
    endpoint.searchParams.set('manifest', u.href);
    endpoint.searchParams.set('filename', media.filename || media.title || 'video');
    endpoint.searchParams.set('allowed', allowedQuery());
    window.open(endpoint.href, '_blank', 'noopener');
  }

  async function download(media = {}) {
    const check = media.downloadCheck || await analyze(media);
    if (!check?.feasible) throw new Error(check?.reason || 'Ce média ne peut pas être téléchargé localement.');
    if (check.type === 'hls') return hlsDownload(media);
    if (check.type === 'direct' && check.mode === 'browser-direct') return browserDirectDownload(media);
    if (check.type === 'direct') return localRelayDownload(media);
    throw new Error(check.reason || 'Ce média ne peut pas être assemblé localement.');
  }

  window.DlStreamOffline = Object.freeze({ download, analyze, hostAllowed, learnDomains });
})();
