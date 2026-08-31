const CACHE = 'dlstream-static-v20';
const APP_SHELL = [
  './','./index.html','./styles.css','./app.js','./browser-runtime.js','./media-detector.js','./offline-downloader.js','./candidate-observer.js','./offline-ui.js','./folder-mode.js','./manifest.webmanifest','./icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

function parseAttrs(text) {
  const out = {};
  const re = /([A-Z0-9-]+)=((?:"[^"]*")|[^,]*)/gi;
  for (const match of text.matchAll(re)) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    out[match[1].toUpperCase()] = value;
  }
  return out;
}

function safeFilename(value, ext) {
  const base = decodeURIComponent(String(value || 'video'))
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\.(m3u8|mpd|ts|mp4|m4v|mov|webm|mkv|avi)$/i, '')
    .trim() || 'video';
  return `${base.slice(0, 120)}.${ext}`;
}

function allowedSet(url) {
  return new Set((url.searchParams.get('allowed') || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
}

function hostAllowed(host, allowed) {
  const h = String(host || '').toLowerCase();
  return [...allowed].some((a) => h === a || h.endsWith(`.${a}`));
}

function rememberHost(url, allowed, discovered) {
  const host = new URL(url).hostname.toLowerCase();
  allowed.add(host);
  discovered.add(host);
}

async function fetchCors(url, options = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, mode: 'cors', cache: 'no-store', credentials: 'include' });
  } catch {
    throw new Error(`CORS bloque l’accès direct à ${new URL(url).hostname}`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} sur ${new URL(url).pathname}`);
  return response;
}

async function resolveHls(manifestUrl, allowed, discovered) {
  let current = new URL(manifestUrl);
  if (!hostAllowed(current.hostname, allowed)) throw new Error('Manifest hors domaines autorisés.');
  rememberHost(current.href, allowed, discovered);

  for (let depth = 0; depth < 4; depth += 1) {
    const response = await fetchCors(current.href);
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
      rememberHost(variant.href, allowed, discovered);
      variants.push({ url: variant, bandwidth: Number(attrs.BANDWIDTH || attrs['AVERAGE-BANDWIDTH'] || 0), audio: attrs.AUDIO || '' });
    }

    if (!variants.length) return { url: current, text };
    if (externalAudio || variants.some((v) => v.audio)) throw new Error('HLS audio/vidéo séparés : muxage serveur requis.');
    variants.sort((a, b) => b.bandwidth - a.bandwidth);
    current = variants[0].url;
  }
  throw new Error('Trop de manifests HLS imbriqués.');
}

function parseMediaPlaylist(text, manifestUrl, allowed, discovered) {
  const lines = String(text).split(/\r?\n/).map((line) => line.trim());
  if (!lines.some((line) => line === '#EXT-X-ENDLIST')) throw new Error('Flux HLS live/non finalisé : téléchargement fichier désactivé.');
  const items = [];
  let nextRange = null;
  let previousEnd = 0;
  let fmp4 = false;

  for (const line of lines) {
    if (!line) continue;
    if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttrs(line.slice(line.indexOf(':') + 1));
      if (String(attrs.METHOD || '').toUpperCase() !== 'NONE') throw new Error('HLS chiffré détecté : téléchargement local non assemblé.');
      continue;
    }
    if (line.startsWith('#EXT-X-DISCONTINUITY')) throw new Error('HLS avec discontinuité : remux serveur recommandé.');
    if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttrs(line.slice(line.indexOf(':') + 1));
      if (!attrs.URI) continue;
      const u = new URL(attrs.URI, manifestUrl);
      rememberHost(u.href, allowed, discovered);
      let range = null;
      if (attrs.BYTERANGE) {
        const [lenRaw, offRaw] = attrs.BYTERANGE.split('@');
        const length = Number(lenRaw), offset = Number(offRaw || 0);
        if (Number.isFinite(length) && Number.isFinite(offset)) range = { start: offset, end: offset + length - 1 };
      }
      items.push({ url: u.href, range });
      fmp4 = true;
      continue;
    }
    if (line.startsWith('#EXT-X-BYTERANGE:')) {
      const [lenRaw, offRaw] = line.slice(line.indexOf(':') + 1).split('@');
      const length = Number(lenRaw), offset = offRaw == null ? previousEnd : Number(offRaw);
      if (Number.isFinite(length) && Number.isFinite(offset)) nextRange = { start: offset, end: offset + length - 1 };
      continue;
    }
    if (line.startsWith('#')) continue;
    const u = new URL(line, manifestUrl);
    rememberHost(u.href, allowed, discovered);
    items.push({ url: u.href, range: nextRange });
    if (nextRange) previousEnd = nextRange.end + 1;
    nextRange = null;
    if (/\.(m4s|mp4)(?:$|[?#])/i.test(u.href)) fmp4 = true;
  }

  if (!items.length) throw new Error('Aucun segment HLS trouvé.');
  return { items, fmp4 };
}

async function prepareHls(requestUrl) {
  const manifest = requestUrl.searchParams.get('manifest');
  const allowed = allowedSet(requestUrl);
  const discovered = new Set();
  if (!manifest) throw new Error('Manifest manquant.');
  const resolved = await resolveHls(manifest, allowed, discovered);
  const playlist = parseMediaPlaylist(resolved.text, resolved.url.href, allowed, discovered);
  return { ...playlist, allowed, discovered: [...discovered] };
}

async function probeHls(requestUrl) {
  try {
    const prepared = await prepareHls(requestUrl);
    const first = prepared.items[0];
    const headers = new Headers();
    if (first.range) headers.set('Range', `bytes=${first.range.start}-${Math.min(first.range.end, first.range.start + 1)}`);
    else headers.set('Range', 'bytes=0-1');
    const response = await fetchCors(first.url, { headers });
    try { await response.body?.cancel(); } catch (_) {}
    return Response.json({
      feasible: true,
      format: prepared.fmp4 ? 'mp4' : 'ts',
      reason: prepared.fmp4 ? 'HLS fMP4 recomposable.' : 'HLS MPEG-TS recomposable.',
      discoveredDomains: prepared.discovered,
      segmentCount: prepared.items.length,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ feasible: false, reason: error?.message || String(error), discoveredDomains: [] }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
  }
}

async function probeDirect(requestUrl) {
  const raw = requestUrl.searchParams.get('url');
  const allowed = allowedSet(requestUrl);
  if (!raw) return Response.json({ feasible: false, reason: 'URL média manquante.' }, { status: 400 });

  let target;
  try { target = new URL(raw); }
  catch { return Response.json({ feasible: false, reason: 'URL média invalide.' }, { status: 400 }); }

  if (!hostAllowed(target.hostname, allowed)) {
    return Response.json({ feasible: false, reason: 'Domaine média non autorisé.' }, { status: 403 });
  }

  try {
    const headers = new Headers({ Range: 'bytes=0-1' });
    const response = await fetchCors(target.href, { headers });
    const contentType = response.headers.get('Content-Type') || '';
    const contentRange = response.headers.get('Content-Range') || '';
    const contentLength = response.headers.get('Content-Length') || '';
    let size = null;
    const total = contentRange.match(/\/(\d+)$/)?.[1];
    if (total) size = Number(total);
    else if (contentLength && response.status === 200) size = Number(contentLength);
    try { await response.body?.cancel(); } catch (_) {}

    return Response.json({
      feasible: true,
      type: 'direct',
      reason: 'Fichier direct accessible depuis la PWA.',
      contentType,
      size: Number.isFinite(size) ? size : null,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ feasible: false, reason: error?.message || String(error) }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
  }
}

async function hlsDownload(requestUrl) {
  try {
    const prepared = await prepareHls(requestUrl);
    const extension = prepared.fmp4 ? 'mp4' : 'ts';
    const filename = safeFilename(requestUrl.searchParams.get('filename'), extension);
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for (const item of prepared.items) {
            const headers = new Headers();
            if (item.range) headers.set('Range', `bytes=${item.range.start}-${item.range.end}`);
            const response = await fetchCors(item.url, { headers });
            const reader = response.body?.getReader();
            if (!reader) throw new Error('Segment illisible.');
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
          }
          controller.close();
        } catch (error) { controller.error(error); }
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': prepared.fmp4 ? 'video/mp4' : 'video/mp2t',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return new Response(`DlStream : ${error?.message || String(error)}`, { status: 422, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function directDownload(requestUrl) {
  const raw = requestUrl.searchParams.get('url');
  const allowed = allowedSet(requestUrl);
  if (!raw) return new Response('URL média manquante', { status: 400 });
  let target;
  try { target = new URL(raw); } catch { return new Response('URL média invalide', { status: 400 }); }
  if (!hostAllowed(target.hostname, allowed)) return new Response('Domaine média non autorisé', { status: 403 });

  try {
    const upstream = await fetchCors(target.href);
    const ext = target.pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1] || 'mp4';
    const filename = safeFilename(requestUrl.searchParams.get('filename'), ext);
    const headers = new Headers({
      'Content-Type': upstream.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    });
    const length = upstream.headers.get('Content-Length');
    if (length) headers.set('Content-Length', length);
    return new Response(upstream.body, { status: 200, headers });
  } catch (error) {
    return new Response(`DlStream : ${error?.message || String(error)}`, { status: 422, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && url.pathname.endsWith('/__dlstream_hls_probe__')) {
    event.respondWith(probeHls(url));
    return;
  }
  if (url.origin === self.location.origin && url.pathname.endsWith('/__dlstream_direct_probe__')) {
    event.respondWith(probeDirect(url));
    return;
  }
  if (url.origin === self.location.origin && url.pathname.endsWith('/__dlstream_hls_download__')) {
    event.respondWith(hlsDownload(url));
    return;
  }
  if (url.origin === self.location.origin && url.pathname.endsWith('/__dlstream_direct_download__')) {
    event.respondWith(directDownload(url));
    return;
  }
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch('./index.html', { cache: 'no-store' }).then((response) => {
      const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put('./index.html', copy)); return response;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(event.request, copy)); return response;
  }).catch(() => caches.match(event.request)));
});
