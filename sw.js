const CACHE = 'dlstream-static-v47';
const BUILD = '47';
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
  './transparent-response.js',
  './media-filter.js',
  './asset-compat.js',
  './astro-compat.js',
  './virtual-location.js',
  './route-sync.js',
  './inline-location.js',
  './version-badge.js',
  './compat-status.js',
  './framework-status.js',
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
  const rootAssetPath = /^\/(?:_astro|assets?|build|static|chunks?|js|scripts|client|_next|_nuxt|dist)\//i;
  const rootAssetFile = /\.(?:m?js|css|wasm)(?:$|[?#])/i;
  let rewrites = 0;

  const resolveRoot = (specifier) => {
    if (!specifier?.startsWith('/') || specifier.startsWith('//')) return specifier;
    try {
      const resolved = virtualAssetUrl(new URL(specifier, target.origin)).href;
      if (resolved !== specifier) rewrites += 1;
      return resolved;
    } catch {
      return specifier;
    }
  };

  let text = String(source || '');
  text = text.replace(/(\bimport\s*\(\s*)(["'])(\/(?!\/)[^"']+)\2(\s*\))/g,
    (full, before, quote, specifier, after) => `${before}${quote}${resolveRoot(specifier)}${quote}${after}`);
  text = text.replace(/(\bfrom\s*)(["'])(\/(?!\/)[^"']+)\2/g,
    (full, before, quote, specifier) => `${before}${quote}${resolveRoot(specifier)}${quote}`);
  text = text.replace(/(\bimport\s*)(["'])(\/(?!\/)[^"']+)\2/g,
    (full, before, quote, specifier) => `${before}${quote}${resolveRoot(specifier)}${quote}`);

  // Les runtimes Vite/Astro conservent souvent les chunks différés dans de simples chaînes.
  // Les réécrire uniquement lorsqu'elles ressemblent clairement à une ressource front-end,
  // afin de ne pas transformer les routes applicatives /api/... en faux assets.
  text = text.replace(/(["'`])(\/(?!\/)[^"'`\r\n]+)\1/g, (full, quote, specifier) => {
    const path = specifier.split(/[?#]/, 1)[0];
    if (!rootAssetPath.test(path) && !rootAssetFile.test(specifier)) return full;
    return `${quote}${resolveRoot(specifier)}${quote}`;
  });

  return { text, rewrites };
}

// Remplacer uniquement les lectures explicites de Location dans les bundles de la plateforme.
// Le document réel reste sur GitHub Pages, mais le code applicatif voit le pathname/search/href cible.
function rewriteVirtualLocationReferences(source) {
  let text = String(source || '');
  const before = text;
  const properties = '(?:href|origin|protocol|host|hostname|port|pathname|search|hash|assign|replace|reload)';

  text = text.replace(new RegExp(`\\bwindow\\.location\\.(${properties})\\b`, 'g'),
    'window.__DLSTREAM_VLOCATION__.$1');
  text = text.replace(new RegExp(`\\bdocument\\.location\\.(${properties})\\b`, 'g'),
    'window.__DLSTREAM_VLOCATION__.$1');
  text = text.replace(new RegExp(`\\bglobalThis\\.location\\.(${properties})\\b`, 'g'),
    'window.__DLSTREAM_VLOCATION__.$1');
  text = text.replace(new RegExp(`\\bself\\.location\\.(${properties})\\b`, 'g'),
    'window.__DLSTREAM_VLOCATION__.$1');
  text = text.replace(new RegExp(`(^|[^\\w$.])location\\.(${properties})\\b`, 'gm'),
    '$1window.__DLSTREAM_VLOCATION__.$2');

  if (text !== before) {
    text += '\n;try{window.__DLSTREAM_ROUTE_STATS__&&(window.__DLSTREAM_ROUTE_STATS__.rewrittenSources=(Number(window.__DLSTREAM_ROUTE_STATS__.rewrittenSources||0)+1))}catch(_){}';
  }
  return text;
}

function executionMarker(target, literalRewrites) {
  const href = JSON.stringify(target.href);
  const count = Number(literalRewrites || 0);
  return `\n;try{const s=window.__DLSTREAM_ASSET_STATS__||=(window.__DLSTREAM_ASSET_STATS__={});s.executed=Number(s.executed||0)+1;s.literalRewrites=Number(s.literalRewrites||0)+${count};s.lastExecuted=${href}}catch(_){}`;
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
      const modules = rewriteModuleSpecifiers(source, target);
      const rewritten = rewriteVirtualLocationReferences(modules.text) + executionMarker(target, modules.rewrites);
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

async function serveAlignedApp(request) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    const source = await response.text();
    let aligned = source.replace(/const DLSTREAM_BUILD = ['"]\d+['"];?/,
      `const DLSTREAM_BUILD = '${BUILD}';`);

    // Forcer également le chargement initial de la plateforme à déclarer son intention navigateur.
    // Le Worker peut ainsi distinguer une page web d'une ancienne requête API VigiMap.
    aligned = aligned.replace(
      /function buildProxyUrl\(targetUrl\) \{\s*const u = new URL\(PROXY_BASE\);\s*u\.searchParams\.set\('url', targetUrl\);\s*return u\.href;\s*\}/,
      `function buildProxyUrl(targetUrl) {\n  const u = new URL(PROXY_BASE);\n  u.searchParams.set('url', targetUrl);\n  u.searchParams.set('mode', 'browser');\n  return u.href;\n}`,
    );

    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.set('Cache-Control', 'no-store');
    headers.set('Content-Type', 'application/javascript; charset=utf-8');
    return new Response(aligned, { status: response.status, statusText: response.statusText, headers });
  } catch {
    return caches.match('./app.js');
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

  if (/\/app\.js$/i.test(url.pathname)) {
    event.respondWith(serveAlignedApp(event.request));
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