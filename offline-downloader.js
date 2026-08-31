(() => {
  const cfg = window.__DLSTREAM__;
  if (!cfg?.targetUrl || !cfg?.appEntry) return;

  const JOB_KEY = 'dlstream.hlsJob.v1';
  const OPFS_DIR = 'dlstream-offline';
  let activeAbort = null;
  let activeRun = null;

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

  function parseAttrs(text) {
    const out = {};
    const re = /([A-Z0-9-]+)=((?:"[^"]*")|[^,]*)/gi;
    for (const match of String(text || '').matchAll(re)) {
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      out[match[1].toUpperCase()] = value;
    }
    return out;
  }

  async function fetchReadable(url, options = {}) {
    let response;
    try {
      response = await fetch(url, {
        ...options,
        mode: 'cors',
        cache: 'no-store',
        credentials: 'omit',
      });
    } catch {
      throw new Error(`CORS bloque l’accès direct à ${new URL(url).hostname}`);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} sur ${new URL(url).pathname}`);
    return response;
  }

  async function resolveHls(manifestUrl, signal) {
    let current = new URL(manifestUrl);
    learnDomains([current.hostname]);

    for (let depth = 0; depth < 4; depth += 1) {
      const response = await fetchReadable(current.href, { signal });
      const text = await response.text();
      if (!text.includes('#EXTM3U')) throw new Error('Manifest HLS invalide.');

      const lines = text.split(/\r?\n/).map((line) => line.trim());
      const variants = [];
      let externalAudio = false;

      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (line.startsWith('#EXT-X-MEDIA:')) {
          const attrs = parseAttrs(line.slice(line.indexOf(':') + 1));
          if (attrs.TYPE === 'AUDIO' && attrs.URI) externalAudio = true;
        }
        if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
        const attrs = parseAttrs(line.slice(line.indexOf(':') + 1));
        const next = lines.slice(i + 1).find((candidate) => candidate && !candidate.startsWith('#'));
        if (!next) continue;
        const variant = new URL(next, current.href);
        learnDomains([variant.hostname]);
        variants.push({
          url: variant,
          bandwidth: Number(attrs.BANDWIDTH || attrs['AVERAGE-BANDWIDTH'] || 0),
          audio: attrs.AUDIO || '',
        });
      }

      if (!variants.length) return { url: current, text };
      if (externalAudio || variants.some((variant) => variant.audio)) {
        throw new Error('HLS avec audio séparé : muxage audio/vidéo requis.');
      }
      variants.sort((a, b) => b.bandwidth - a.bandwidth);
      current = variants[0].url;
    }

    throw new Error('Trop de manifests HLS imbriqués.');
  }

  function parseMediaPlaylist(text, manifestUrl) {
    const lines = String(text || '').split(/\r?\n/).map((line) => line.trim());
    if (!lines.some((line) => line === '#EXT-X-ENDLIST')) {
      throw new Error('Flux HLS live/non finalisé : téléchargement fichier désactivé.');
    }

    const items = [];
    let nextRange = null;
    let previousEnd = 0;
    let fmp4 = false;

    for (const line of lines) {
      if (!line) continue;

      if (line.startsWith('#EXT-X-KEY:')) {
        const attrs = parseAttrs(line.slice(line.indexOf(':') + 1));
        if (String(attrs.METHOD || '').toUpperCase() !== 'NONE') {
          throw new Error('HLS chiffré détecté : assemblage local désactivé.');
        }
        continue;
      }

      if (line.startsWith('#EXT-X-DISCONTINUITY')) {
        throw new Error('HLS avec discontinuité : remuxage requis.');
      }

      if (line.startsWith('#EXT-X-MAP:')) {
        const attrs = parseAttrs(line.slice(line.indexOf(':') + 1));
        if (!attrs.URI) continue;
        const url = new URL(attrs.URI, manifestUrl);
        learnDomains([url.hostname]);
        let range = null;
        if (attrs.BYTERANGE) {
          const [lengthRaw, offsetRaw] = attrs.BYTERANGE.split('@');
          const length = Number(lengthRaw);
          const offset = Number(offsetRaw || 0);
          if (Number.isFinite(length) && Number.isFinite(offset)) {
            range = { start: offset, end: offset + length - 1 };
          }
        }
        items.push({ url: url.href, range, init: true });
        fmp4 = true;
        continue;
      }

      if (line.startsWith('#EXT-X-BYTERANGE:')) {
        const [lengthRaw, offsetRaw] = line.slice(line.indexOf(':') + 1).split('@');
        const length = Number(lengthRaw);
        const offset = offsetRaw == null ? previousEnd : Number(offsetRaw);
        if (Number.isFinite(length) && Number.isFinite(offset)) {
          nextRange = { start: offset, end: offset + length - 1 };
        }
        continue;
      }

      if (line.startsWith('#')) continue;

      const url = new URL(line, manifestUrl);
      learnDomains([url.hostname]);
      items.push({ url: url.href, range: nextRange, init: false });
      if (nextRange) previousEnd = nextRange.end + 1;
      nextRange = null;
      if (/\.(m4s|mp4)(?:$|[?#])/i.test(url.href)) fmp4 = true;
    }

    if (!items.length) throw new Error('Aucun segment HLS trouvé.');
    return { items, fmp4 };
  }

  async function prepareHls(manifestUrl, signal) {
    const resolved = await resolveHls(manifestUrl, signal);
    const playlist = parseMediaPlaylist(resolved.text, resolved.url.href);
    return {
      ...playlist,
      manifestUrl: resolved.url.href,
      format: playlist.fmp4 ? 'mp4' : 'ts',
    };
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

      if (corsBlocked(data?.reason)) {
        return {
          feasible: true,
          type: 'direct',
          mode: 'browser-direct',
          reason: 'Fichier direct détecté ; ouverture directe car le relais local est bloqué par CORS.',
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
            reason: 'Fichier direct détecté ; ouverture directe car le relais local est bloqué par CORS.',
          }
        : { feasible: false, type: 'direct', reason };
    }
  }

  async function analyze(media = {}) {
    const u = mediaUrl(media);
    if (!u) return { feasible: false, reason: 'URL média invalide.', type: 'unknown' };
    if (!hostAllowed(u.hostname)) {
      return { feasible: false, reason: `Domaine non autorisé : ${u.hostname}`, type: media.type || 'unknown' };
    }

    const type = String(media.type || media.mediaType || '').toLowerCase();
    if (type === 'dash' || /\.mpd(?:$|[?#])/i.test(u.href)) {
      return { feasible: false, type: 'dash', reason: 'DASH segmenté détecté : muxage audio/vidéo requis.' };
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
          ? {
              feasible: true,
              type: 'hls',
              mode: 'opfs',
              format: data.format || 'ts',
              reason: data.reason || 'HLS recomposable localement.',
              segmentCount: data.segmentCount || 0,
            }
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

  function opfsSupported() {
    return Boolean(navigator.storage?.getDirectory);
  }

  function readJob() {
    try {
      const value = JSON.parse(localStorage.getItem(JOB_KEY) || 'null');
      return value && typeof value === 'object' ? value : null;
    } catch { return null; }
  }

  function saveJob(job) {
    localStorage.setItem(JOB_KEY, JSON.stringify(job));
    window.dispatchEvent(new CustomEvent('dlstream-offline-progress', { detail: { ...job } }));
    return job;
  }

  function clearJobState() {
    localStorage.removeItem(JOB_KEY);
    window.dispatchEvent(new CustomEvent('dlstream-offline-progress', { detail: null }));
  }

  async function getOpfsFileHandle(fileKey, create = true) {
    if (!opfsSupported()) throw new Error('OPFS n’est pas disponible dans ce navigateur.');
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(OPFS_DIR, { create: true });
    return dir.getFileHandle(fileKey, { create });
  }

  async function createJob(media) {
    const manifest = mediaUrl(media);
    if (!manifest) throw new Error('Manifest HLS invalide.');
    const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const probe = await prepareHls(manifest.href);
    const outputName = filename(media.filename || media.title || document.title || 'video', probe.format);
    const fileKey = `${id}.${probe.format}`;
    const handle = await getOpfsFileHandle(fileKey, true);
    const writable = await handle.createWritable();
    await writable.truncate(0);
    await writable.close();

    return saveJob({
      id,
      rootHost: cfg.rootHost,
      manifestUrl: manifest.href,
      filename: outputName,
      fileKey,
      format: probe.format,
      state: 'paused',
      index: 0,
      total: probe.items.length,
      bytes: 0,
      percent: 0,
      error: '',
      updatedAt: Date.now(),
    });
  }

  async function fetchSegment(item, signal) {
    const headers = new Headers();
    if (item.range) headers.set('Range', `bytes=${item.range.start}-${item.range.end}`);
    const response = await fetchReadable(item.url, { headers, signal });
    return response.arrayBuffer();
  }

  async function runJob(job) {
    if (activeRun) return activeRun;

    activeAbort = new AbortController();
    const signal = activeAbort.signal;

    activeRun = (async () => {
      const current = { ...job, state: 'preparing', error: '', updatedAt: Date.now() };
      saveJob(current);

      let writable = null;
      try {
        const prepared = await prepareHls(current.manifestUrl, signal);
        current.total = prepared.items.length;
        current.format = prepared.format;
        current.filename = filename(current.filename, prepared.format);

        const handle = await getOpfsFileHandle(current.fileKey, true);
        const file = await handle.getFile();
        if (file.size !== Number(current.bytes || 0)) {
          current.bytes = file.size;
        }

        writable = await handle.createWritable({ keepExistingData: true });
        await writable.seek(current.bytes);

        current.state = 'downloading';
        current.updatedAt = Date.now();
        saveJob(current);

        for (let i = Number(current.index || 0); i < prepared.items.length; i += 1) {
          if (signal.aborted) throw new DOMException('Pause demandée', 'AbortError');
          const data = await fetchSegment(prepared.items[i], signal);
          await writable.write(data);
          current.bytes += data.byteLength;
          current.index = i + 1;
          current.percent = prepared.items.length ? Math.floor((current.index / prepared.items.length) * 100) : 0;
          current.updatedAt = Date.now();
          saveJob(current);
        }

        await writable.close();
        writable = null;
        current.state = 'ready';
        current.percent = 100;
        current.updatedAt = Date.now();
        saveJob(current);
        return current;
      } catch (error) {
        try { await writable?.close(); } catch (_) {}
        if (error?.name === 'AbortError') {
          current.state = 'paused';
          current.error = '';
        } else {
          current.state = 'error';
          current.error = error?.message || String(error);
        }
        current.updatedAt = Date.now();
        saveJob(current);
        return current;
      } finally {
        activeAbort = null;
        activeRun = null;
      }
    })();

    return activeRun;
  }

  async function startHlsOffline(media) {
    if (!opfsSupported()) {
      const u = mediaUrl(media);
      const endpoint = new URL('./__dlstream_hls_download__', cfg.appEntry);
      endpoint.searchParams.set('manifest', u.href);
      endpoint.searchParams.set('filename', media.filename || media.title || 'video');
      endpoint.searchParams.set('allowed', allowedQuery());
      window.open(endpoint.href, '_blank', 'noopener');
      return null;
    }

    const existing = readJob();
    const u = mediaUrl(media);
    let job = existing;
    if (!job || job.manifestUrl !== u.href || ['ready', 'error'].includes(job.state)) {
      job = await createJob(media);
    }
    return runJob(job);
  }

  function pause() {
    activeAbort?.abort();
  }

  async function resume() {
    const job = readJob();
    if (!job) throw new Error('Aucun téléchargement local à reprendre.');
    if (job.state === 'ready') return job;
    return runJob(job);
  }

  async function exportFile() {
    const job = readJob();
    if (!job || job.state !== 'ready') throw new Error('Aucun fichier terminé à exporter.');
    const handle = await getOpfsFileHandle(job.fileKey, false);
    const file = await handle.getFile();
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = job.filename || `video.${job.format || 'mp4'}`;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function removeJob() {
    pause();
    const job = readJob();
    if (job?.fileKey && opfsSupported()) {
      try {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle(OPFS_DIR, { create: true });
        await dir.removeEntry(job.fileKey);
      } catch (_) {}
    }
    clearJobState();
  }

  async function download(media = {}) {
    const check = media.downloadCheck || await analyze(media);
    if (!check?.feasible) throw new Error(check?.reason || 'Ce média ne peut pas être téléchargé localement.');
    if (check.type === 'hls') return startHlsOffline(media);
    if (check.type === 'direct' && check.mode === 'browser-direct') return browserDirectDownload(media);
    if (check.type === 'direct') return localRelayDownload(media);
    throw new Error(check.reason || 'Ce média ne peut pas être assemblé localement.');
  }

  window.DlStreamOffline = Object.freeze({
    download,
    analyze,
    hostAllowed,
    learnDomains,
    pause,
    resume,
    exportFile,
    removeJob,
    getJob: readJob,
    opfsSupported,
  });

  if (!cfg.isNested && !document.querySelector('script[data-dlstream-candidate-observer]')) {
    const script = document.createElement('script');
    script.src = new URL(`./candidate-observer.js?v=${cfg.build || '20'}`, cfg.appEntry).href;
    script.dataset.dlstreamCandidateObserver = '1';
    document.head.appendChild(script);
  }
})();
