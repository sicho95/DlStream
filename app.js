const PROXY_BASE = 'https://proxy.sicho95.workers.dev/';
const DEFAULT_PLATFORM_URL = 'https://didvip.com/b6ig41m4d/home/didvip';
const MAX_RECURSION_DEPTH = 4;
const PAGE_CACHE_NAME = 'dlstream-pages-v1';
const MAX_PAGE_CACHE_AGE_MS = 5 * 60 * 1000;
const TRANSIENT_PROXY_STATUS = new Set([500, 502, 503, 504]);
const DLSTREAM_BUILD = '20';

const bootMessage = document.querySelector('#bootMessage');
const bootError = document.querySelector('#bootError');
const errorText = document.querySelector('#errorText');
const retryButton = document.querySelector('#retryButton');
const directButton = document.querySelector('#directButton');
const configForm = document.querySelector('#configForm');
const platformUrlInput = document.querySelector('#platformUrl');

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return ['http:', 'https:'].includes(u.protocol) ? u.href : null;
  } catch {
    try { return new URL(`https://${raw}`).href; } catch { return null; }
  }
}

function normalizeHost(value) {
  try {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    const u = raw.includes('://') ? new URL(raw) : new URL(`https://${raw}`);
    return u.hostname.replace(/^\*\./, '');
  } catch { return ''; }
}

function readJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '');
    return value ?? fallback;
  } catch { return fallback; }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getStoredPlatformUrl() {
  return localStorage.getItem('dlstream.platformUrl') || DEFAULT_PLATFORM_URL;
}

function getRequestedPlatformUrl() {
  const q = new URL(location.href).searchParams.get('url');
  return normalizeUrl(q) || getStoredPlatformUrl();
}

function getDepth() {
  const n = Number(new URL(location.href).searchParams.get('depth') || 0);
  return Number.isFinite(n) ? Math.max(0, Math.min(MAX_RECURSION_DEPTH, n)) : 0;
}

function isNestedLoad() {
  return new URL(location.href).searchParams.get('nested') === '1';
}

function getRootUrl() {
  return normalizeUrl(getStoredPlatformUrl()) || DEFAULT_PLATFORM_URL;
}

function getRootHost() {
  try { return new URL(getRootUrl()).hostname.toLowerCase(); } catch { return ''; }
}

function getTrustedRoots() {
  const roots = readJson('dlstream.trustedRoots', []);
  return [...new Set((Array.isArray(roots) ? roots : []).map(normalizeHost).filter(Boolean))];
}

function setTrustedRoots(roots) {
  writeJson('dlstream.trustedRoots', [...new Set(roots.map(normalizeHost).filter(Boolean))]);
}

function getDomainMap(key) {
  const map = readJson(key, {});
  return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
}

function getLearnedDomains(root = getRootHost()) {
  const map = getDomainMap('dlstream.learnedDomains');
  return [...new Set((Array.isArray(map[root]) ? map[root] : []).map(normalizeHost).filter(Boolean))];
}

function setLearnedDomains(domains, root = getRootHost()) {
  const map = getDomainMap('dlstream.learnedDomains');
  map[root] = [...new Set(domains.map(normalizeHost).filter(Boolean))].slice(0, 128);
  writeJson('dlstream.learnedDomains', map);
}

function getIgnoredDomains(root = getRootHost()) {
  const map = getDomainMap('dlstream.ignoredDomains');
  return [...new Set((Array.isArray(map[root]) ? map[root] : []).map(normalizeHost).filter(Boolean))];
}

function setIgnoredDomains(domains, root = getRootHost()) {
  const map = getDomainMap('dlstream.ignoredDomains');
  map[root] = [...new Set(domains.map(normalizeHost).filter(Boolean))].slice(0, 128);
  writeJson('dlstream.ignoredDomains', map);
}

function hostMatches(host, root) {
  return host === root || host.endsWith(`.${root}`);
}

function rootIsTrusted(root = getRootHost()) {
  return getTrustedRoots().some((trusted) => hostMatches(root, trusted));
}

function domainIsAllowed(hostname) {
  const host = normalizeHost(hostname);
  const root = getRootHost();
  if (!host || !rootIsTrusted(root)) return false;
  if (hostMatches(host, root)) return true;
  if (getIgnoredDomains(root).includes(host)) return false;
  return getLearnedDomains(root).includes(host);
}

function learnHosts(hosts) {
  const root = getRootHost();
  if (!rootIsTrusted(root)) return;
  const ignored = new Set(getIgnoredDomains(root));
  const learned = new Set(getLearnedDomains(root));
  for (const value of hosts) {
    const host = normalizeHost(value);
    if (!host || hostMatches(host, root) || ignored.has(host)) continue;
    learned.add(host);
  }
  setLearnedDomains([...learned], root);
}

function discoverSourceHosts(html, baseUrl) {
  if (!rootIsTrusted()) return [];
  const hosts = new Set();
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const selectors = [
    'iframe[src]','script[src]','img[src]','video[src]','audio[src]','source[src]','track[src]','link[href]',
    '[poster]','[data-src]','[data-url]','[data-video-url]','[data-file-url]','[data-manifest]','[data-manifest-url]','[data-hls]','[data-dash]'
  ];
  doc.querySelectorAll(selectors.join(',')).forEach((node) => {
    const attrs = ['src','href','poster','data-src','data-url','data-video-url','data-file-url','data-manifest','data-manifest-url','data-hls','data-dash'];
    for (const attr of attrs) {
      const raw = node.getAttribute(attr);
      if (!raw) continue;
      try {
        const u = new URL(raw, baseUrl);
        if (['http:','https:'].includes(u.protocol)) hosts.add(u.hostname.toLowerCase());
      } catch (_) {}
    }
  });
  return [...hosts];
}

function buildProxyUrl(targetUrl) {
  const u = new URL(PROXY_BASE);
  u.searchParams.set('url', targetUrl);
  return u.href;
}

function appEntryUrl() {
  const u = new URL('./', location.href);
  u.search = '';
  u.hash = '';
  return u;
}

function buildAppUrl(targetUrl, { nested = false, depth = 0 } = {}) {
  const u = appEntryUrl();
  u.searchParams.set('url', targetUrl);
  if (nested) u.searchParams.set('nested', '1');
  if (depth) u.searchParams.set('depth', String(depth));
  return u.href;
}

function pageCacheRequest(targetUrl) {
  const u = new URL('./__dlstream_page_cache__', appEntryUrl());
  u.searchParams.set('url', targetUrl);
  return new Request(u.href, { method: 'GET' });
}

async function cachePageHtml(targetUrl, html) {
  if (!('caches' in window) || !html) return;
  try {
    const cache = await caches.open(PAGE_CACHE_NAME);
    await cache.put(pageCacheRequest(targetUrl), new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-DlStream-Cached-At': String(Date.now()),
      },
    }));
  } catch (_) {}
}

async function readCachedPageHtml(targetUrl) {
  if (!('caches' in window)) return null;
  try {
    const cache = await caches.open(PAGE_CACHE_NAME);
    const response = await cache.match(pageCacheRequest(targetUrl));
    if (!response) return null;
    const cachedAt = Number(response.headers.get('X-DlStream-Cached-At') || 0);
    if (!cachedAt || Date.now() - cachedAt > MAX_PAGE_CACHE_AGE_MS) return null;
    const html = await response.text();
    return html ? { html, cachedAt } : null;
  } catch {
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPageHtml(targetUrl) {
  const delays = [0, 300, 900];
  let lastError = null;

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    if (delays[attempt]) {
      bootMessage.textContent = `Nouvelle tentative… (${attempt + 1}/${delays.length})`;
      await sleep(delays[attempt]);
    }

    try {
      const response = await fetch(buildProxyUrl(targetUrl), {
        method: 'GET',
        cache: 'no-store',
        redirect: 'follow',
      });

      if (!response.ok) {
        const error = new Error(`Proxy HTTP ${response.status}`);
        error.status = response.status;
        lastError = error;
        if (TRANSIENT_PROXY_STATUS.has(response.status) && attempt < delays.length - 1) continue;
        throw error;
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html')) {
        throw new Error(`La cible n’a pas renvoyé une page HTML (${contentType || 'type inconnu'}).`);
      }

      const html = await response.text();
      await cachePageHtml(targetUrl, html);
      return { html, fromCache: false };
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      const transient = !status || TRANSIENT_PROXY_STATUS.has(status);
      if (transient && attempt < delays.length - 1) continue;
      break;
    }
  }

  const cached = await readCachedPageHtml(targetUrl);
  if (cached) return { html: cached.html, fromCache: true };
  throw lastError || new Error('Impossible de joindre le proxy.');
}

function escapeInlineJson(value) {
  return JSON.stringify(value).replace(/</g, '\u003c');
}

function rewriteAllowedIframes(html, targetUrl, depth) {
  if (!rootIsTrusted() || depth >= MAX_RECURSION_DEPTH) return String(html);
  return String(html).replace(
    /<iframe\b([^>]*?)\bsrc\s*=\s*(["'])(.*?)\2([^>]*)>/gi,
    (full, before, quote, rawSrc, after) => {
      try {
        const frameUrl = new URL(rawSrc, targetUrl);
        if (!domainIsAllowed(frameUrl.hostname)) return full;
        const nested = buildAppUrl(frameUrl.href, { nested: true, depth: depth + 1 });
        return `<iframe${before}src=${quote}${nested.replace(/&/g, '&amp;')}${quote}${after}>`;
      } catch { return full; }
    },
  );
}

function transformHtml(html, targetUrl, { fromCache = false } = {}) {
  const target = new URL(targetUrl);
  const depth = getDepth();
  const runtimeUrl = new URL(`./browser-runtime.js?v=${DLSTREAM_BUILD}`, appEntryUrl()).href;
  const detectorUrl = new URL(`./media-detector.js?v=${DLSTREAM_BUILD}`, appEntryUrl()).href;
  const downloaderUrl = new URL(`./offline-downloader.js?v=${DLSTREAM_BUILD}`, appEntryUrl()).href;
  const offlineUiUrl = new URL(`./offline-ui.js?v=${DLSTREAM_BUILD}`, appEntryUrl()).href;
  const manifestUrl = new URL('./manifest.webmanifest', appEntryUrl()).href;

  if (rootIsTrusted()) learnHosts(discoverSourceHosts(html, target.href));

  let out = String(html || '');
  out = out.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*>/gi, '');
  out = out.replace(/<base\b[^>]*>/gi, '');
  out = rewriteAllowedIframes(out, target.href, depth);

  const config = {
    targetUrl: target.href,
    rootUrl: getRootUrl(),
    rootHost: getRootHost(),
    rootTrusted: rootIsTrusted(),
    isNested: isNestedLoad(),
    depth,
    maxDepth: MAX_RECURSION_DEPTH,
    appEntry: appEntryUrl().href,
    proxyBase: PROXY_BASE,
    trustedRoots: getTrustedRoots(),
    learnedDomains: getLearnedDomains(),
    ignoredDomains: getIgnoredDomains(),
    pageFromCache: Boolean(fromCache),
    build: DLSTREAM_BUILD,
  };

  const injection = `\n<base href="${target.href.replace(/"/g, '&quot;')}">\n` +
    `<meta name="apple-mobile-web-app-capable" content="yes">\n` +
    `<link rel="manifest" href="${manifestUrl}">\n` +
    `<script>window.__DLSTREAM__=${escapeInlineJson(config)};<\/script>\n` +
    `<script src="${runtimeUrl}"><\/script>\n` +
    `<script src="${downloaderUrl}"><\/script>\n` +
    `<script src="${offlineUiUrl}"><\/script>\n` +
    `<script src="${detectorUrl}"><\/script>\n`;

  if (/<head\b[^>]*>/i.test(out)) out = out.replace(/<head\b([^>]*)>/i, `<head$1>${injection}`);
  else if (/<html\b[^>]*>/i.test(out)) out = out.replace(/<html\b([^>]*)>/i, `<html$1><head>${injection}</head>`);
  else out = `<!doctype html><html><head>${injection}</head><body>${out}</body></html>`;
  return out;
}

function showError(message, targetUrl) {
  bootMessage.textContent = 'Impossible de charger la plateforme';
  errorText.textContent = message;
  platformUrlInput.value = targetUrl;
  bootError.hidden = false;
}

async function loadPlatform(targetUrl) {
  const normalized = normalizeUrl(targetUrl);
  if (!normalized) return showError('URL de plateforme invalide.', targetUrl || '');

  if (!isNestedLoad()) localStorage.setItem('dlstream.platformUrl', normalized);
  platformUrlInput.value = isNestedLoad() ? getRootUrl() : normalized;
  bootError.hidden = true;
  bootMessage.textContent = 'Chargement via le proxy Sicho95…';

  try {
    const result = await fetchPageHtml(normalized);
    if (result.fromCache) bootMessage.textContent = 'Proxy indisponible, ouverture du dernier chargement valide…';
    const transformed = transformHtml(result.html, normalized, { fromCache: result.fromCache });
    document.open();
    document.write(transformed);
    document.close();
  } catch (error) {
    showError(error?.message || String(error), normalized);
  }
}

retryButton.addEventListener('click', () => loadPlatform(getRequestedPlatformUrl()));
directButton.addEventListener('click', () => location.assign(getRequestedPlatformUrl()));
configForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const u = normalizeUrl(platformUrlInput.value);
  if (!u) return;
  localStorage.setItem('dlstream.platformUrl', u);
  location.assign(buildAppUrl(u));
});

window.DlStreamConfig = Object.freeze({
  getTrustedRoots,
  setTrustedRoots,
  getLearnedDomains,
  setLearnedDomains,
  getIgnoredDomains,
  setIgnoredDomains,
  getRootHost,
  rootIsTrusted,
  domainIsAllowed,
  learnHosts,
  buildAppUrl,
  build: DLSTREAM_BUILD,
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register(`./sw.js?v=${DLSTREAM_BUILD}`).catch(() => {});
loadPlatform(getRequestedPlatformUrl());