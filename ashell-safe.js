(() => {
  const SHORTCUT_NAME = 'DlStream a-Shell';
  const TITLE_KEY_PREFIX = 'dlstream.contentTitle.';
  const DIRECT_EXT_RE = /\.(mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|mpe|m2v|m2ts|mts|ts|vob|ogv|ogg|3gp|3g2|wmv|flv|f4v|asf|divx|rm|rmvb)(?:$|[?#])/i;
  let boundRoot = null;

  function text(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function cfg() {
    return window.__DLSTREAM__ || {};
  }

  function platformLabel() {
    const host = String(cfg().rootHost || '').toLowerCase();
    return host.split('.').filter(Boolean)[0] || '';
  }

  function cleanTitle(value) {
    let title = text(value);
    if (!title) return '';

    const label = platformLabel();
    if (label) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      title = title.replace(new RegExp(`^${escaped}\\s*[-–—|:•]\\s*`, 'i'), '');
    }

    title = title
      .replace(/^didvip\s*[-–—|:•]\s*/i, '')
      .replace(/^(video|vidéo|player|stream|watch|lecture)\s*[-–—|:•]\s*/i, '')
      .trim();

    if (title.length < 2 || title.length > 180) return '';
    if (/^(video|vidéo|player|stream|watch|lecture|home|accueil|dlstream)$/i.test(title)) return '';
    if (/(vrodaz|vromov|ofbax|swift\s*-?\s*streamlined|streamlined\s*-?\s*safe)/i.test(title)) return '';
    return title;
  }

  function titleFromPage() {
    const selectors = [
      'meta[name="dlstream-title"]',
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'meta[itemprop="name"]',
    ];

    for (const selector of selectors) {
      const title = cleanTitle(document.querySelector(selector)?.getAttribute('content'));
      if (title) return title;
    }

    for (const selector of ['[data-dlstream-title]', '[itemprop="name"]', 'h1', '.movie-title', '.film-title', '.video-title', '.watch-title', '.detail-title']) {
      const node = document.querySelector(selector);
      const title = cleanTitle(node?.getAttribute?.('data-dlstream-title') || node?.textContent);
      if (title) return title;
    }

    return cleanTitle(document.title);
  }

  function titleKey() {
    return `${TITLE_KEY_PREFIX}${String(cfg().rootHost || 'default').toLowerCase()}`;
  }

  function isPlatformPage() {
    try {
      const host = new URL(cfg().targetUrl || location.href).hostname.toLowerCase();
      const root = String(cfg().rootHost || '').toLowerCase();
      return Boolean(root) && (host === root || host.endsWith(`.${root}`));
    } catch {
      return false;
    }
  }

  function rememberTitle() {
    if (!isPlatformPage()) return;
    const title = titleFromPage();
    if (!title) return;
    try { localStorage.setItem(titleKey(), title); } catch (_) {}
  }

  function rememberedTitle() {
    try { return cleanTitle(localStorage.getItem(titleKey()) || ''); }
    catch { return ''; }
  }

  function outputTitle(media) {
    rememberTitle();
    return titleFromPage() || rememberedTitle() || cleanTitle(media?.title) || '';
  }

  function safeFilename(value) {
    return text(value)
      .replace(/'/g, '’')
      .replace(/[\\/:*?"<>|`$;\u0000-\u001f]+/g, '-')
      .replace(/\s+-\s+/g, ' - ')
      .replace(/-{2,}/g, '-')
      .replace(/^\.+|\.+$/g, '')
      .trim()
      .slice(0, 120);
  }

  function timestamp() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  }

  function quote(value) {
    return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')}"`;
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
    return DIRECT_EXT_RE.test(url?.href || '') ? 'direct' : 'stream';
  }

  function directExtension(media, url) {
    const values = [media?.filename, decodeURIComponent(url?.pathname?.split('/').pop() || '')];
    for (const value of values) {
      const match = String(value || '').match(/\.([a-z0-9]{2,5})$/i);
      if (match && DIRECT_EXT_RE.test(`x.${match[1]}`)) return match[1].toLowerCase();
    }
    return 'mp4';
  }

  function buildCommand(media = window.__DLSTREAM_ACTIVE_MEDIA__) {
    const url = mediaUrl(media);
    if (!url) throw new Error('Aucun média actif pour a-Shell.');

    const title = safeFilename(outputTitle(media)) || `video-${timestamp()}`;
    const base = title.replace(/\.[a-z0-9]{2,5}$/i, '');

    if (mediaKind(media, url) === 'direct') {
      const output = `${base}.${directExtension(media, url)}`;
      return `cd ~/Documents\nclear\ncurl -L --fail --retry 2 --progress-bar -o ${quote(output)} ${quote(url.href)}`;
    }

    const output = `${base}.mp4`;
    return `cd ~/Documents\nclear\nffmpeg -hide_banner -loglevel error -stats -stats_period 3 -http_persistent 1 -http_multiple 1 -y -i ${quote(url.href)} -c copy ${quote(output)}`;
  }

  function shortcutUrl() {
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

  function bind() {
    rememberTitle();
    const root = document.querySelector('#dlstream-controls')?.shadowRoot;
    if (!root || root === boundRoot) return;
    boundRoot = root;

    root.addEventListener('click', async (event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      const button = path.find((node) => ['openAShell', 'copyAShellCommand'].includes(node?.id));
      if (!button) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      let command;
      try { command = buildCommand(window.__DLSTREAM_ACTIVE_MEDIA__); }
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

  setInterval(bind, 150);
})();
