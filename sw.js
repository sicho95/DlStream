const CACHE = 'dlstream-static-v6';
const APP_SHELL = [
  './','./index.html','./styles.css','./app.js','./browser-runtime.js','./media-detector.js','./offline-downloader.js','./manifest.webmanifest','./icon.svg'
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
  const base = decodeURIComponent(String(value || 'video')).replace(/[\\/:*?"<>|]+/g, '-').replace(/\.(m3u8|ts|mp4)$/i, '').trim() || 'video';
  return `${base.slice(0, 120)}.${ext}`;
}

function allowedSet(url) {
  return new Set((url.searchParams.get('allowed') || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
}

function hostAllowed(host, allowed) {
  const h = String(host || '').toLowerCase();
  return [...allowed].some((a) => h === a || h.endsWith(`.${a}`));
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

async function resolveHls(manifestUrl, allowed) {
  let current = new URL(manifestUrl);
  if (!hostAllowed(current.hostname, allowed)) throw new Error('Manifest hors domaines autorisés.');

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
      variants.push({ url: new URL(next, current.href), bandwidth: Number(attrs.BANDWIDTH || attrs['AVERAGE-BANDWIDTH'] || 0), audio: attrs.AUDIO || '' });
    }

    if (!variants.length) return { url: current, text };
    if (externalAudio || variants.some((v) => v.audio)) throw new Error('HLS audio/vidéo séparés : muxage serveur requis.');
    variants.sort((a, b) => b.bandwidth - a.bandwidth);
    current = variants[0].url;
    allowed.add(current.hostname.toLowerCase());
  }
  throw new Error('Trop de manifests HLS imbriqués.');
}

function parseMediaPlaylist(text, manifestUrl, allowed) {
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
      allowed.add(u.hostname.toLowerCase());
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
    allowed.add(u.hostname.toLowerCase());
    items.push({ url: u.href, range: nextRange });
    if (nextRange) previousEnd = nextRange.end + 1;
    nextRange = null;
    if (/\.(m4s|mp4)(?:$|[?#])/i.test(u.href)) fmp4 = true;
  }
  if (!items.length) throw new Error('Aucun segment HLS trouvé.');
  return { items, fmp4 };
}

async function hlsDownload(requestUrl) {
  const manifest = requestUrl.searchParams.get('manifest');
  const allowed = allowedSet(requestUrl);
  if (!manifest) return new Response('Manifest manquant', { status: 400 });

  try {
    const resolved = await resolveHls(manifest, allowed);
    const playlist = parseMediaPlaylist(resolved.text, resolved.url.href, allowed);
    const extension = playlist.fmp4 ? 'mp4' : 'ts';
    const filename = safeFilename(requestUrl.searchParams.get('filename'), extension);

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for (const item of playlist.items) {
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
        'Content-Type': playlist.fmp4 ? 'video/mp4' : 'video/mp2t',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return new Response(`DlStream : ${error?.message || String(error)}`, { status: 422, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin === self.location.origin && url.pathname.endsWith('/__dlstream_hls_download__')) {
    event.respondWith(hlsDownload(url));
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
