(() => {
  const cfg = window.__DLSTREAM__;
  if (!cfg?.targetUrl || cfg.isNested) return;

  const STREAM_RE = /(?:\.m3u(?:8)?|\.mpd|\.f4m|\.ismc)(?:$|[?#])|\.(?:ism|isml)\/manifest(?:$|[?#])/i;
  const URL_RE = /https?:\\?\/\\?\/[^\s"'<>`\\]+/gi;
  let timer = null;

  function trusted() {
    return Boolean(window.DlStreamTrust?.rootTrusted?.());
  }

  function normalize(value, base = cfg.targetUrl) {
    try {
      const url = new URL(String(value || '').replace(/\\\//g, '/'), base);
      return ['http:', 'https:'].includes(url.protocol) ? url : null;
    } catch {
      return null;
    }
  }

  function classify(url) {
    const href = url?.href || '';
    if (/\.m3u8(?:$|[?#])/i.test(href)) return 'hls';
    if (/\.mpd(?:$|[?#])/i.test(href)) return 'dash';
    if (STREAM_RE.test(href)) return 'stream';
    return null;
  }

  function add(map, value, score, source, base = cfg.targetUrl) {
    const url = normalize(value, base);
    if (!url) return;
    const type = classify(url);
    if (!type) return;
    window.DlStreamTrust?.learnHost?.(url.hostname);
    const key = `${type}|${url.href}`;
    const previous = map.get(key);
    if (!previous || score > previous.score) {
      map.set(key, {
        type,
        mediaType: type,
        url: url.href,
        manifestUrl: url.href,
        score,
        source,
        title: document.title || 'Vidéo',
      });
    }
  }

  function scan() {
    if (!trusted() || !window.DlStream?.exposeCandidates) return;
    const found = new Map();

    const attrs = [
      'src','href','data-src','data-url','data-stream','data-stream-url','data-manifest','data-manifest-url',
      'data-playlist','data-playlist-url','data-hls','data-dash','data-file','data-file-url',
    ];

    document.querySelectorAll('*').forEach((node) => {
      for (const attr of attrs) {
        const raw = node.getAttribute?.(attr);
        if (raw) add(found, raw, 940, `attr:${attr}`);
      }
    });

    document.querySelectorAll('script:not([src])').forEach((script) => {
      const text = String(script.textContent || '').replace(/\\\//g, '/');
      if (!text || text.length > 2_000_000) return;
      for (const match of text.matchAll(URL_RE)) add(found, match[0], 820, 'inline-script');
    });

    try {
      performance.getEntriesByType('resource').slice(-500).forEach((entry) => add(found, entry.name, 900, 'performance'));
    } catch (_) {}

    if (found.size) window.DlStream.exposeCandidates([...found.values()]);
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(scan, 180);
  }

  new MutationObserver(schedule).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
  });

  window.addEventListener('load', schedule);
  window.addEventListener('dlstream-domains-updated', schedule);
  setTimeout(scan, 400);
  setTimeout(scan, 1500);
  setInterval(scan, 5000);
})();
