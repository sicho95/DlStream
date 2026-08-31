(() => {
  let boundRoot = null;

  function text(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function usefulTitle(value) {
    const title = text(value);
    if (title.length < 2 || title.length > 180) return '';
    if (/^(video|vidéo|player|stream|watch|lecture|home|accueil|dlstream)$/i.test(title)) return '';
    return title;
  }

  function titleFromJsonLd() {
    const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 20);
    const found = [];

    function visit(value, depth = 0) {
      if (!value || depth > 5) return;
      if (Array.isArray(value)) {
        value.slice(0, 30).forEach((item) => visit(item, depth + 1));
        return;
      }
      if (typeof value !== 'object') return;

      const type = text(value['@type']).toLowerCase();
      const priority = /(movie|videoobject|tvseries|tvseason|episode|creativework)/i.test(type);
      const name = usefulTitle(value.name || value.headline);
      if (name) found.push({ name, score: priority ? 100 : 20 });

      Object.values(value).slice(0, 80).forEach((child) => {
        if (child && typeof child === 'object') visit(child, depth + 1);
      });
    }

    for (const script of scripts) {
      try { visit(JSON.parse(script.textContent || '')); } catch (_) {}
    }
    found.sort((a, b) => b.score - a.score);
    return found[0]?.name || '';
  }

  function titleFromPage() {
    const metaSelectors = [
      'meta[name="dlstream-title"]',
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'meta[itemprop="name"]',
    ];

    for (const selector of metaSelectors) {
      const value = usefulTitle(document.querySelector(selector)?.getAttribute('content'));
      if (value) return value;
    }

    const jsonLd = titleFromJsonLd();
    if (jsonLd) return jsonLd;

    const explicitSelectors = [
      '[data-dlstream-title]',
      '[itemprop="name"]',
      'h1',
      '.movie-title',
      '.film-title',
      '.video-title',
      '.watch-title',
      '.detail-title',
    ];

    for (const selector of explicitSelectors) {
      const node = document.querySelector(selector);
      const value = usefulTitle(node?.getAttribute?.('data-dlstream-title') || node?.textContent);
      if (value) return value;
    }

    const htmlTitle = usefulTitle(document.title);
    if (htmlTitle && !/^dlstream$/i.test(htmlTitle)) return htmlTitle;

    const mediaTitle = usefulTitle(window.__DLSTREAM_ACTIVE_MEDIA__?.title);
    return mediaTitle || '';
  }

  function safeFilename(value) {
    return text(value)
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
      .replace(/\s+-\s+/g, ' - ')
      .replace(/-+/g, '-')
      .replace(/^\.+|\.+$/g, '')
      .trim()
      .slice(0, 120);
  }

  function timestamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  }

  function shellQuote(value) {
    return `'${String(value || '').replace(/'/g, `'"'"'`)}'`;
  }

  function mediaUrl() {
    const media = window.__DLSTREAM_ACTIVE_MEDIA__;
    const raw = media?.url || media?.downloadUrl || media?.manifestUrl;
    try {
      const url = new URL(String(raw || ''));
      return ['http:', 'https:'].includes(url.protocol) ? url : null;
    } catch {
      return null;
    }
  }

  function buildCommand() {
    const url = mediaUrl();
    if (!url) throw new Error('Aucun média actif pour a-Shell.');

    const rawTitle = titleFromPage();
    const title = safeFilename(rawTitle);
    const output = `${title || `video-${timestamp()}`}.mp4`;
    return `ffmpeg -y -i ${shellQuote(url.href)} -c copy ~/Documents/${shellQuote(output)}`;
  }

  function copySync(value) {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
    document.body.appendChild(area);
    area.focus();
    area.select();
    try { area.setSelectionRange(0, area.value.length); } catch (_) {}
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) {}
    area.remove();
    return ok;
  }

  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      return copySync(value);
    }
  }

  function bind() {
    const root = document.querySelector('#dlstream-controls')?.shadowRoot;
    if (!root || root === boundRoot) return;
    boundRoot = root;

    root.addEventListener('click', async (event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      const button = path.find((node) => node?.id === 'openAShell' || node?.id === 'copyAShellCommand');
      if (!button) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      let command;
      try {
        command = buildCommand();
      } catch (error) {
        alert(error?.message || String(error));
        return;
      }

      if (button.id === 'copyAShellCommand') {
        const ok = await copy(command);
        const previous = button.textContent;
        button.textContent = ok ? 'Commande copiée' : 'Échec copie';
        setTimeout(() => { button.textContent = previous; }, 1200);
        return;
      }

      copySync(command);
      location.href = 'ashell://';
    }, true);
  }

  window.DlStreamAShell = Object.freeze({ buildCommand, titleFromPage });
  setInterval(bind, 200);
})();
