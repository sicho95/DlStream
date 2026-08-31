(() => {
  function normalize(value) {
    try {
      const url = new URL(String(value || ''));
      return ['http:', 'https:'].includes(url.protocol) ? url : null;
    } catch {
      return null;
    }
  }

  function activeMediaUrl() {
    const media = window.__DLSTREAM_ACTIVE_MEDIA__;
    return normalize(media?.url || media?.downloadUrl || media?.manifestUrl);
  }

  function safeFileStem(value) {
    const clean = String(value || 'video')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
    return (clean || 'video').slice(0, 70);
  }

  function shellQuote(value) {
    return `'${String(value || '').replace(/'/g, `'"'"'`)}'`;
  }

  function timestampForFilename() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  }

  function buildCommand() {
    const media = window.__DLSTREAM_ACTIVE_MEDIA__;
    const url = activeMediaUrl();
    if (!url) throw new Error('Aucun média actif pour a-Shell.');

    const type = String(media?.type || media?.mediaType || '').toLowerCase();
    if (!['hls', 'direct'].includes(type) && !/\.(?:m3u8|mp4|m4v|mov|webm|mkv|ts)(?:$|[?#])/i.test(url.href)) {
      throw new Error('Ce média n’est pas adapté au téléchargement a-Shell.');
    }

    const title = safeFileStem(media?.title || document.title || 'video');
    const output = `~/Documents/DlStream/${title}-${timestampForFilename()}.mp4`;
    return `ffmpeg -y -i ${shellQuote(url.href)} -c copy ${output}`;
  }

  function copySync(text) {
    const area = document.createElement('textarea');
    area.value = text;
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

  async function copyCommand() {
    const command = buildCommand();
    try {
      await navigator.clipboard.writeText(command);
      return true;
    } catch {
      return copySync(command);
    }
  }

  window.addEventListener('click', async (event) => {
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
      const ok = await copyCommand();
      const previous = button.textContent;
      button.textContent = ok ? 'Commande copiée' : 'Échec copie';
      setTimeout(() => { button.textContent = previous; }, 1200);
      return;
    }

    const copied = copySync(command);
    button.textContent = copied ? 'Commande copiée' : 'a-Shell';
    location.href = 'ashell://';
  }, true);
})();
