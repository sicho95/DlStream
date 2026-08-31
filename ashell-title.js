(() => {
  const SHORTCUT_NAME = 'DlStream a-Shell';
  const TITLE_KEY_PREFIX = 'dlstream.contentTitle.';
  let boundRoot = null;

  function text(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function config() {
    return window.__DLSTREAM__ || {};
  }

  function usefulTitle(value) {
    const title = text(value);
    if (title.length < 2 || title.length > 180) return '';
    if (/^(video|vidéo|player|stream|watch|lecture|home|accueil|dlstream)$/i.test(title)) return '';
    if (/(vrodaz|vromov|ofbax|swift\s*-?\s*streamlined|streamlined\s*-?\s*safe)/i.test(title)) return '';
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
    if (htmlTitle) return htmlTitle;
    return '';
  }

  function platformPage() {
    const cfg = config();
    try {
      const host = new URL(cfg.targetUrl || location.href).hostname.toLowerCase();
      const root = String(cfg.rootHost || '').toLowerCase();
      return Boolean(root) && (host === root || host.endsWith(`.${root}`));
    } catch {
      return false;
    }
  }

  function titleStorageKey() {
    return `${TITLE_KEY_PREFIX}${String(config().rootHost || 'default').toLowerCase()}`;
  }

  function rememberPlatformTitle() {
    if (!platformPage()) return;
    const title = titleFromPage();
    if (!title) return;
    try { localStorage.setItem(titleStorageKey(), title); } catch (_) {}
  }

  function rememberedTitle() {
    try { return usefulTitle(localStorage.getItem(titleStorageKey()) || ''); }
    catch { return ''; }
  }

  function mediaTitle() {
    return usefulTitle(window.__DLSTREAM_ACTIVE_MEDIA__?.title || '');
  }

  function outputTitle() {
    rememberPlatformTitle();
    return titleFromPage() || rememberedTitle() || mediaTitle();
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

    const title = safeFilename(outputTitle());
    const output = `${title || `video-${timestamp()}`}.mp4`;
    return `cd ~/Documents\nffmpeg -y -i ${shellQuote(url.href)} -c copy ${shellQuote(output)}`;
  }

  function shortcutUrl(command) {
    const url = new URL('shortcuts://run-shortcut');
    url.searchParams.set('name', SHORTCUT_NAME);
    url.searchParams.set('input', 'text');
    url.searchParams.set('text', command);
    return url.href;
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

  function simplifyUi(root) {
    root.querySelector('#download')?.remove();
    root.querySelector('#openVlc')?.remove();
    root.querySelector('#copyMediaUrl')?.remove();
    root.querySelector('#offlineJobPanel')?.remove();
    root.querySelector('#folderModePanel')?.remove();

    const launch = root.querySelector('#openAShell');
    if (launch) {
      launch.textContent = 'Lancer avec a-Shell';
      launch.title = `Exécuter le raccourci « ${SHORTCUT_NAME} » avec la commande ffmpeg`;
    }

    const copyButton = root.querySelector('#copyAShellCommand');
    if (copyButton) {
      copyButton.textContent = 'Copier commande';
      copyButton.title = 'Copier les deux commandes a-Shell';
    }
  }

  function bind() {
    rememberPlatformTitle();
    const root = document.querySelector('#dlstream-controls')?.shadowRoot;
    if (!root) return;
    simplifyUi(root);
    if (root === boundRoot) return;
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
      location.href = shortcutUrl(command);
    }, true);
  }

  window.DlStreamAShell = Object.freeze({
    buildCommand,
    shortcutUrl,
    titleFromPage,
    rememberedTitle,
    shortcutName: SHORTCUT_NAME,
  });

  setInterval(bind, 200);
})();
