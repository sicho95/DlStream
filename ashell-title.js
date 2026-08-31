(() => {
  const SHORTCUT_NAME = 'DlStream a-Shell';
  const TITLE_KEY_PREFIX = 'dlstream.contentTitle.';
  const DIRECT_EXT_RE = /\.(mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|mpe|m2v|m2ts|mts|ts|vob|ogv|ogg|3gp|3g2|wmv|flv|f4v|asf|divx|rm|rmvb)(?:$|[?#])/i;
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

    return usefulTitle(document.title);
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

  function mediaTitle(media = window.__DLSTREAM_ACTIVE_MEDIA__) {
    return usefulTitle(media?.title || '');
  }

  function outputTitle(media) {
    rememberPlatformTitle();
    return titleFromPage() || rememberedTitle() || mediaTitle(media);
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

  function mediaUrl(media = window.__DLSTREAM_ACTIVE_MEDIA__) {
    const raw = media?.url || media?.downloadUrl || media?.manifestUrl;
    try {
      const url = new URL(String(raw || ''));
      return ['http:', 'https:'].includes(url.protocol) ? url : null;
    } catch {
      return null;
    }
  }

  function mediaKind(media, url) {
    const declared = String(media?.type || media?.mediaType || '').toLowerCase();
    if (declared === 'direct') return 'direct';
    if (['hls', 'dash', 'stream'].includes(declared)) return 'stream';
    if (DIRECT_EXT_RE.test(url?.href || '')) return 'direct';
    return 'stream';
  }

  function directExtension(media, url) {
    const candidates = [media?.filename, decodeURIComponent(url?.pathname?.split('/').pop() || '')];
    for (const value of candidates) {
      const match = String(value || '').match(/\.([a-z0-9]{2,5})$/i);
      if (match && DIRECT_EXT_RE.test(`x.${match[1]}`)) return match[1].toLowerCase();
    }
    return 'mp4';
  }

  function buildCommand(media = window.__DLSTREAM_ACTIVE_MEDIA__) {
    const url = mediaUrl(media);
    if (!url) throw new Error('Aucun média actif pour a-Shell.');

    const title = safeFilename(outputTitle(media)) || `video-${timestamp()}`;
    const kind = mediaKind(media, url);

    if (kind === 'direct') {
      const ext = directExtension(media, url);
      const output = `${title.replace(/\.[a-z0-9]{2,5}$/i, '')}.${ext}`;
      return `cd ~/Documents\nclear\ncurl -L --fail --retry 2 -o ${shellQuote(output)} ${shellQuote(url.href)}`;
    }

    const output = `${title.replace(/\.[a-z0-9]{2,5}$/i, '')}.mp4`;
    return `cd ~/Documents\nclear\nffmpeg -hide_banner -loglevel warning -nostats -stats_period 3 -progress pipe:1 -http_persistent 1 -http_multiple 1 -y -i ${shellQuote(url.href)} -c copy ${shellQuote(output)}`;
  }

  function shortcutUrl() {
    // Utiliser %20 explicitement : l’app Raccourcis ne traduit pas toujours '+' en espace pour ce schéma URL.
    return `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}`;
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

  function launch(media = window.__DLSTREAM_ACTIVE_MEDIA__) {
    const command = buildCommand(media);
    copySync(command);
    location.href = shortcutUrl();
    return command;
  }

  function simplifyUi(root) {
    root.querySelector('#openVlc')?.remove();
    root.querySelector('#copyMediaUrl')?.remove();
    root.querySelector('#offlineJobPanel')?.remove();
    root.querySelector('#folderModePanel')?.remove();

    const launchButton = root.querySelector('#openAShell');
    if (launchButton) launchButton.textContent = 'Lancer avec a-Shell';
    const copyButton = root.querySelector('#copyAShellCommand');
    if (copyButton) copyButton.textContent = 'Copier commande';
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
      const button = path.find((node) => ['openAShell', 'copyAShellCommand'].includes(node?.id));
      if (!button) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      const media = window.__DLSTREAM_ACTIVE_MEDIA__;
      let command;
      try { command = buildCommand(media); }
      catch (error) { alert(error?.message || String(error)); return; }

      if (button.id === 'copyAShellCommand') {
        const ok = await copy(command);
        const previous = button.textContent;
        button.textContent = ok ? 'Commande copiée' : 'Échec copie';
        setTimeout(() => { button.textContent = previous; }, 1200);
        return;
      }

      copySync(command);
      location.href = shortcutUrl();
    }, true);
  }

  window.DlStreamAShell = Object.freeze({
    buildCommand,
    launch,
    shortcutUrl,
    titleFromPage,
    rememberedTitle,
    shortcutName: SHORTCUT_NAME,
  });

  setInterval(bind, 200);
})();