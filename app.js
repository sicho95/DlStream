const PROXY_BASE = 'https://proxy.sicho95.workers.dev/';
const DEFAULT_PLATFORM_URL = 'https://didvip.com/b6ig41m4d/home/didvip';

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
    try {
      return new URL(`https://${raw}`).href;
    } catch {
      return null;
    }
  }
}

function getStoredPlatformUrl() {
  return localStorage.getItem('dlstream.platformUrl') || DEFAULT_PLATFORM_URL;
}

function getRequestedPlatformUrl() {
  const q = new URL(location.href).searchParams.get('url');
  return normalizeUrl(q) || getStoredPlatformUrl();
}

function getAllowedDomains() {
  const raw = localStorage.getItem('dlstream.allowedDomains') || '';
  return [...new Set(raw.split(/[\n,;\s]+/).map((v) => v.trim().toLowerCase()).filter(Boolean))];
}

function domainIsAllowed(hostname, targetHostname) {
  const host = String(hostname || '').toLowerCase();
  const target = String(targetHostname || '').toLowerCase();
  if (!host) return false;

  // Toujours autoriser le domaine de la plateforme actuellement configurée.
  if (host === target || host.endsWith(`.${target}`)) return true;

  return getAllowedDomains().some((entry) => {
    const allowed = entry.replace(/^https?:\/\//, '').split('/')[0].replace(/^\*\./, '');
    return host === allowed || host.endsWith(`.${allowed}`);
  });
}

function buildProxyUrl(targetUrl) {
  const u = new URL(PROXY_BASE);
  u.searchParams.set('url', targetUrl);
  return u.href;
}

function buildAppUrl(targetUrl, appEntry) {
  const u = new URL(appEntry);
  u.searchParams.set('url', targetUrl);
  return u.href;
}

function escapeInlineJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function rewriteAllowedIframes(html, target, appEntry) {
  return String(html).replace(
    /<iframe\b([^>]*?)\bsrc\s*=\s*(["'])(.*?)\2([^>]*)>/gi,
    (full, before, quote, rawSrc, after) => {
      try {
        const frameUrl = new URL(rawSrc, target.href);
        if (!['http:', 'https:'].includes(frameUrl.protocol)) return full;
        if (!domainIsAllowed(frameUrl.hostname, target.hostname)) return full;
        const nested = buildAppUrl(frameUrl.href, appEntry);
        return `<iframe${before}src=${quote}${nested.replace(/&/g, '&amp;')}${quote}${after}>`;
      } catch {
        return full;
      }
    },
  );
}

function transformHtml(html, targetUrl) {
  const target = new URL(targetUrl);
  const appEntry = new URL('./', location.href);
  appEntry.search = '';
  appEntry.hash = '';

  const runtimeUrl = new URL('./browser-runtime.js', appEntry).href;
  const detectorUrl = new URL('./media-detector.js', appEntry).href;
  const manifestUrl = new URL('./manifest.webmanifest', appEntry).href;

  let out = String(html || '');

  // Supprimer uniquement les politiques HTML qui empêcheraient le runtime local.
  out = out.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?Content-Security-Policy["']?[^>]*>/gi, '');
  out = out.replace(/<base\b[^>]*>/gi, '');

  // Inspecter récursivement uniquement les iframes appartenant aux domaines explicitement autorisés.
  out = rewriteAllowedIframes(out, target, appEntry.href);

  const config = {
    targetUrl: target.href,
    upstreamOrigin: target.origin,
    appEntry: appEntry.href,
    proxyBase: PROXY_BASE,
    allowedDomains: getAllowedDomains(),
  };

  const injection = `\n<base href="${target.href.replace(/"/g, '&quot;')}">\n` +
    `<meta name="apple-mobile-web-app-capable" content="yes">\n` +
    `<link rel="manifest" href="${manifestUrl}">\n` +
    `<script>window.__DLSTREAM__=${escapeInlineJson(config)};<\/script>\n` +
    `<script src="${runtimeUrl}"><\/script>\n` +
    `<script src="${detectorUrl}"><\/script>\n`;

  if (/<head\b[^>]*>/i.test(out)) {
    out = out.replace(/<head\b([^>]*)>/i, `<head$1>${injection}`);
  } else if (/<html\b[^>]*>/i.test(out)) {
    out = out.replace(/<html\b([^>]*)>/i, `<html$1><head>${injection}</head>`);
  } else {
    out = `<!doctype html><html><head>${injection}</head><body>${out}</body></html>`;
  }

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
  if (!normalized) {
    showError('URL de plateforme invalide.', targetUrl || '');
    return;
  }

  localStorage.setItem('dlstream.platformUrl', normalized);
  platformUrlInput.value = normalized;
  bootError.hidden = true;
  bootMessage.textContent = 'Chargement via le proxy Sicho95…';

  try {
    const response = await fetch(buildProxyUrl(normalized), {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow',
    });

    if (!response.ok) throw new Error(`Proxy HTTP ${response.status}`);

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      throw new Error(`La cible n’a pas renvoyé une page HTML (${contentType || 'type inconnu'}).`);
    }

    const html = await response.text();
    const transformed = transformHtml(html, normalized);

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
  const app = new URL('./', location.href);
  app.searchParams.set('url', u);
  location.assign(app.href);
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

loadPlatform(getRequestedPlatformUrl());
