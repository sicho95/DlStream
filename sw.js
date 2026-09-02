const CACHE = 'dlstream-static-v41';
const PROXY_BASE = 'https://proxy.sicho95.workers.dev/';
const ASSET_PREFIX = new URL('./__dlstream_asset__/', self.location.href).pathname;

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './browser-runtime.js',
  './media-detector.js',
  './stream-detector-extra.js',
  './media-observer-v2.js',
  './embedded-player.js',
  './embed-bridge.js',
  './offline-downloader.js',
  './candidate-observer.js',
  './ashell-safe.js',
  './platform-manager.js',
  './iframe-direct.js',
  './spa-compat.js',
  './media-filter.js',
  './asset-compat.js',
  './version-badge.js',
  './compat-status.js',
  './ui-fixes.js',
  './manifest.webmanifest',
  './icon.svg',
];

function parseVirtualAsset(url) {
  if (!url.pathname.startsWith(ASSET_PREFIX)) return null;
  const rest = url.pathname.slice(ASSET_PREFIX.length);
  const parts = rest.split('/');
  const scheme = parts.shift();
  const encodedHost = parts.shift();
  if (!['http', 'https'].includes(scheme) || !encodedHost) return null;

  let host;
  try { host = decodeURIComponent(encodedHost); }
  catch { return null; }

  const path = `/${parts.join('/')}`;
  try {
    return new URL(`${scheme}://${host}${path}${url.search}`);
  } catch {
    return null;
  }
}

function virtualAssetUrl(target) {
  const scheme = target.protocol.replace(':', '');
  const host = encodeURIComponent(target.host);
  const path = target.pathname.startsWith('/') ? target.pathname : `/${target.pathname}`;
  const url = new URL(`.${ASSET_PREFIX}${scheme}/${host}${path}`, self.location.origin);
  url.search = target.search;
  return url;
}

function rewriteModuleSpecifiers(source, target) {
  const resolveRoot = (specifier) => {
    if (!specifier?.startsWith('/') || specifier.startsWith('//')) return specifier;
    try { return virtualAssetUrl(new URL(specifier, target.origin)).href; }
    catch { return specifier; }
  };

  let text = String(source || '');
  text = text.replace(/(\bimport\s*\(\s*)(["'])(\/(?!\/)[^"']+)\2(\s*\))/g,
    (full, before, quote, specifier, after) => `${before}${quote}${resolveRoot(specifier)}${quote}${after}`);
  text = text.replace(/(\bfrom\s*)(["'])(\/(?!\/)[^"']+)\2/g,
    (full, before, quote, specifier) => `${before}${quote}${resolveRoot(specifier)}${quote}`);
  text = text.replace(/(\bimport\s*)(["'])(\/(?!\/)[^"']+)\2/g,
    (full, before, quote, specifier) => `${before}${quote}${resolveRoot(specifier)}${quote}`);
  return text;
}

async function proxyAssetRequest(request, requestUrl) {
  const target = parseVirtualAsset(requestUrl);
  if (!target) return new Response('Invalid DlStream asset target', { status: 400 });

  const proxy = new URL(PROXY_BASE);
  proxy.searchParams.set('url', target.href);
  proxy.searchParams.set('mode', 'asset');

  try {
    const upstream = await fetch(proxy.href, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow',
      headers: {
        Accept: request.headers.get('accept') || '*/*',
      },
    });

    const headers = new Headers(upstream.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.set('Cache-Control', 'no-store');
    headers.set('X-DlStream-Asset-Target', target.hostname);

    const contentType = headers.get('content-type') || '';
    if (request.destination === 'script' || /(?:javascript|ecmascript)/i.test(contentType)) {
      const source = await upstream.text();
      const rewritten = rewriteModuleSpecifiers(source, target);
      if (!contentType) headers.set('Content-Type', 'application/javascript; charset=utf-8');
      return new Response(rewritten, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers,
      });
    }

    const body = await upstream.arrayBuffer();
    return new Response(body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  } catch (error) {
    return new Response(`DlStream asset proxy error: ${error?.message || error}`, {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
    )),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith(ASSET_PREFIX)) {
    event.respondWith(proxyAssetRequest(event.request, url));
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch('./index.html', { cache: 'no-store' })
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
