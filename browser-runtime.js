(() => {
  const cfg = window.__DLSTREAM__;
  if (!cfg?.targetUrl || !cfg?.upstreamOrigin || !cfg?.appEntry || !cfg?.proxyBase) return;

  const nativeFetch = window.fetch.bind(window);
  const nativeOpen = XMLHttpRequest.prototype.open;

  function normalize(value, base = document.baseURI) {
    try {
      return new URL(String(value), base);
    } catch {
      return null;
    }
  }

  function isUpstream(url) {
    return Boolean(url && url.origin === cfg.upstreamOrigin);
  }

  function proxyUrl(target) {
    const p = new URL(cfg.proxyBase);
    p.searchParams.set('url', target.href || String(target));
    return p.href;
  }

  function appUrl(target) {
    const u = new URL(cfg.appEntry);
    u.searchParams.set('url', target.href || String(target));
    return u.href;
  }

  // Faire repasser les appels AJAX vers l'origine de la plateforme par le Worker.
  window.fetch = function dlStreamFetch(input, init) {
    try {
      const raw = input instanceof Request ? input.url : input;
      const target = normalize(raw);
      if (isUpstream(target)) {
        if (input instanceof Request) {
          const requestInit = {
            method: input.method,
            headers: input.headers,
            body: ['GET', 'HEAD'].includes(input.method) ? undefined : input.body,
            credentials: 'omit',
            redirect: input.redirect,
            signal: input.signal,
          };
          return nativeFetch(proxyUrl(target), { ...requestInit, ...(init || {}) });
        }
        return nativeFetch(proxyUrl(target), init);
      }
    } catch (_) {}
    return nativeFetch(input, init);
  };

  XMLHttpRequest.prototype.open = function dlStreamXhrOpen(method, url, ...rest) {
    const target = normalize(url);
    const nextUrl = isUpstream(target) ? proxyUrl(target) : url;
    return nativeOpen.call(this, method, nextUrl, ...rest);
  };

  // Conserver la navigation dans la PWA pour les liens de la plateforme.
  document.addEventListener('click', (event) => {
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor || event.defaultPrevented) return;
    if (anchor.hasAttribute('download')) return;

    const href = anchor.getAttribute('href') || '';
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

    const target = normalize(anchor.href);
    if (!isUpstream(target)) return;

    event.preventDefault();
    location.assign(appUrl(target));
  }, true);

  document.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;

    const method = String(form.method || 'get').toLowerCase();
    if (method !== 'get') return;

    const target = normalize(form.action || cfg.targetUrl);
    if (!isUpstream(target)) return;

    event.preventDefault();
    const params = new URLSearchParams(new FormData(form));
    for (const [key, value] of params) target.searchParams.set(key, value);
    location.assign(appUrl(target));
  }, true);

  function startDownload(url, filename) {
    const target = normalize(url, cfg.targetUrl);
    if (!target) return;

    const a = document.createElement('a');
    a.href = target.href;
    if (filename) a.download = filename;
    a.target = '_blank';
    a.rel = 'noopener';
    a.click();
  }

  function mountControls() {
    if (!document.body || document.querySelector('#dlstream-controls')) return;

    const host = document.createElement('div');
    host.id = 'dlstream-controls';
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647';
    document.body.appendChild(host);

    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif}
        button,input{font:inherit}
        .fab{pointer-events:auto;position:fixed;display:grid;place-items:center;border:1px solid rgba(255,255,255,.25);background:rgba(15,15,18,.68);color:#fff;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 8px 24px rgba(0,0,0,.28)}
        #menu{top:max(10px,env(safe-area-inset-top));right:max(10px,env(safe-area-inset-right));width:40px;height:40px;border-radius:999px;font-weight:800;letter-spacing:1px}
        #download{right:max(12px,env(safe-area-inset-right));bottom:max(14px,env(safe-area-inset-bottom));width:48px;height:48px;border-radius:999px;background:rgba(255,255,255,.94);color:#000;font-size:25px;font-weight:900}
        #download[hidden]{display:none}
        .sheet{pointer-events:auto;position:fixed;left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom));padding:14px;border-radius:20px;background:rgba(22,22,25,.96);color:#fff;box-shadow:0 18px 50px rgba(0,0,0,.45);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px)}
        .sheet[hidden]{display:none}
        .head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}.head strong{font-size:18px}.close{width:34px;height:34px;border:0;border-radius:999px;background:#35353a;color:#fff;font-size:22px}
        label{display:grid;gap:6px;font-size:12px;color:#b4b4bb}input{width:100%;min-height:44px;border:1px solid #44444a;border-radius:11px;background:#111114;color:#fff;padding:9px 11px}
        .actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.actions button{min-height:42px;border:1px solid #44444a;border-radius:11px;background:#2b2b30;color:#fff}.actions .primary{grid-column:1/-1;background:#fff;color:#000;border-color:#fff;font-weight:750}
        .url{margin-top:9px;color:#92929b;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      </style>
      <button id="menu" class="fab" aria-label="DlStream">•••</button>
      <button id="download" class="fab" hidden aria-label="Télécharger">↓</button>
      <section id="sheet" class="sheet" hidden>
        <div class="head"><strong>DlStream</strong><button id="close" class="close" aria-label="Fermer">×</button></div>
        <label>URL de la plateforme<input id="url" type="url" inputmode="url"></label>
        <div class="actions">
          <button id="home">Accueil</button>
          <button id="reload">Recharger</button>
          <button id="direct">Safari</button>
          <button id="save" class="primary">Enregistrer et ouvrir</button>
        </div>
        <div class="url" id="current"></div>
      </section>`;

    const menu = root.querySelector('#menu');
    const sheet = root.querySelector('#sheet');
    const close = root.querySelector('#close');
    const input = root.querySelector('#url');
    const current = root.querySelector('#current');
    const home = root.querySelector('#home');
    const reload = root.querySelector('#reload');
    const direct = root.querySelector('#direct');
    const save = root.querySelector('#save');
    const download = root.querySelector('#download');

    input.value = localStorage.getItem('dlstream.platformUrl') || cfg.targetUrl;
    current.textContent = cfg.targetUrl;

    menu.addEventListener('click', () => { sheet.hidden = !sheet.hidden; });
    close.addEventListener('click', () => { sheet.hidden = true; });
    reload.addEventListener('click', () => location.assign(appUrl(cfg.targetUrl)));
    direct.addEventListener('click', () => window.open(cfg.targetUrl, '_blank', 'noopener'));
    home.addEventListener('click', () => {
      const target = normalize(localStorage.getItem('dlstream.platformUrl') || cfg.targetUrl);
      if (target) location.assign(appUrl(target));
    });
    save.addEventListener('click', () => {
      const target = normalize(input.value);
      if (!target) return;
      localStorage.setItem('dlstream.platformUrl', target.href);
      location.assign(appUrl(target));
    });

    window.DlStream = {
      exposeMedia(media = {}) {
        const url = media.downloadUrl ? normalize(media.downloadUrl, cfg.targetUrl) : null;
        download.hidden = !url;
        download.onclick = url ? () => startDownload(url.href, media.filename || '') : null;
      },
      clearMedia() {
        download.hidden = true;
        download.onclick = null;
      },
    };

    const meta = document.querySelector('meta[name="dlstream-download-url"]');
    const marked = document.querySelector('[data-dlstream-download-url]');
    const explicitUrl = meta?.content || marked?.getAttribute('data-dlstream-download-url');
    if (explicitUrl) {
      window.DlStream.exposeMedia({
        downloadUrl: explicitUrl,
        filename: marked?.getAttribute('data-dlstream-filename') || '',
      });
    }
  }

  localStorage.setItem('dlstream.lastUrl', cfg.targetUrl);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountControls, { once: true });
  } else {
    mountControls();
  }
})();
