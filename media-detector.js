(() => {
  const cfg = window.__DLSTREAM__;
  if (!cfg?.targetUrl) return;

  const DIRECT_MEDIA_RE = /\.(mp4|m4v|mov|webm|mkv|avi)(?:$|[?#])/i;
  const DIRECT_MIME_RE = /^video\/(mp4|webm|quicktime|x-matroska|x-msvideo)/i;
  const MAX_SCRIPT_TEXT = 1_000_000;
  let scanTimer = null;
  let lastPublishedUrl = '';

  function normalize(value, base = cfg.targetUrl) {
    if (!value) return null;
    try {
      const url = new URL(String(value).trim(), base);
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      return url;
    } catch {
      return null;
    }
  }

  function looksLikeDirectMedia(url, mime = '') {
    return Boolean(url && (DIRECT_MEDIA_RE.test(url.href) || DIRECT_MIME_RE.test(String(mime || ''))));
  }

  function filenameFromUrl(url) {
    try {
      const name = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || 'video.mp4');
      return name.includes('.') ? name : `${name}.mp4`;
    } catch {
      return 'video.mp4';
    }
  }

  function addCandidate(list, rawUrl, score, source, options = {}) {
    const url = normalize(rawUrl, options.base || cfg.targetUrl);
    if (!looksLikeDirectMedia(url, options.mime)) return;

    const existing = list.find((item) => item.url.href === url.href);
    const candidate = {
      url,
      score,
      source,
      filename: options.filename || filenameFromUrl(url),
      title: options.title || document.title || 'Vidéo',
    };

    if (!existing) {
      list.push(candidate);
      return;
    }

    if (candidate.score > existing.score) Object.assign(existing, candidate);
  }

  function collectExplicitMarkers(list) {
    const meta = document.querySelector('meta[name="dlstream-download-url"]');
    if (meta?.content) {
      addCandidate(list, meta.content, 1000, 'dlstream-meta', {
        filename: document.querySelector('meta[name="dlstream-filename"]')?.content || '',
      });
    }

    document.querySelectorAll('[data-dlstream-download-url]').forEach((node) => {
      addCandidate(list, node.getAttribute('data-dlstream-download-url'), 980, 'dlstream-data', {
        filename: node.getAttribute('data-dlstream-filename') || '',
      });
    });
  }

  function collectMediaElements(list) {
    document.querySelectorAll('video').forEach((video) => {
      addCandidate(list, video.getAttribute('src'), 860, 'video-src', {
        mime: video.getAttribute('type') || '',
      });

      video.querySelectorAll('source[src]').forEach((source) => {
        addCandidate(list, source.getAttribute('src'), 850, 'video-source', {
          mime: source.getAttribute('type') || '',
        });
      });
    });

    document.querySelectorAll('source[src]').forEach((source) => {
      addCandidate(list, source.getAttribute('src'), 840, 'source', {
        mime: source.getAttribute('type') || '',
      });
    });
  }

  function collectDownloadLinks(list) {
    document.querySelectorAll('a[href][download]').forEach((anchor) => {
      addCandidate(list, anchor.getAttribute('href'), 930, 'download-link', {
        filename: anchor.getAttribute('download') || '',
      });
    });

    document.querySelectorAll('a[href]').forEach((anchor) => {
      addCandidate(list, anchor.getAttribute('href'), 700, 'direct-media-link');
    });
  }

  function collectDataAttributes(list) {
    const attributes = [
      'data-download-url',
      'data-file-url',
      'data-video-url',
      'data-video-src',
      'data-file',
      'data-src',
    ];

    for (const attribute of attributes) {
      document.querySelectorAll(`[${attribute}]`).forEach((node) => {
        addCandidate(list, node.getAttribute(attribute), 820, attribute, {
          filename: node.getAttribute('data-filename') || node.getAttribute('download') || '',
        });
      });
    }
  }

  function collectMetadata(list) {
    const selectors = [
      'meta[property="og:video"]',
      'meta[property="og:video:url"]',
      'meta[property="og:video:secure_url"]',
      'meta[name="twitter:player:stream"]',
    ];

    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach((meta) => {
        addCandidate(list, meta.getAttribute('content'), 760, selector);
      });
    }
  }

  function walkJson(value, list, score, source, depth = 0) {
    if (depth > 8 || value == null) return;

    if (Array.isArray(value)) {
      for (const item of value) walkJson(item, list, score, source, depth + 1);
      return;
    }

    if (typeof value !== 'object') return;

    const preferredKeys = new Set([
      'downloadUrl', 'download_url', 'contentUrl', 'content_url',
      'fileUrl', 'file_url', 'videoUrl', 'video_url',
      'file', 'src', 'url',
    ]);

    for (const [key, child] of Object.entries(value)) {
      if (typeof child === 'string' && preferredKeys.has(key)) {
        addCandidate(list, child, score, `${source}:${key}`);
      }
      if (typeof child === 'object' && child !== null) {
        walkJson(child, list, score, source, depth + 1);
      }
    }
  }

  function collectJson(list) {
    document.querySelectorAll('script[type="application/ld+json"], script[type="application/json"]').forEach((script) => {
      const text = script.textContent || '';
      if (!text || text.length > MAX_SCRIPT_TEXT) return;

      try {
        const value = JSON.parse(text);
        const score = script.type === 'application/ld+json' ? 790 : 740;
        walkJson(value, list, score, script.type);
      } catch {
        // Ignorer les blocs qui ne sont pas du JSON strict.
      }
    });
  }

  function collectInlineSourceLiterals(list) {
    document.querySelectorAll('script:not([src])').forEach((script) => {
      let text = script.textContent || '';
      if (!text || text.length > MAX_SCRIPT_TEXT) return;

      text = text.replace(/\\\//g, '/');

      const absolutePattern = /https?:\/\/[^\s"'<>`\\]+?\.(?:mp4|m4v|mov|webm|mkv|avi)(?:\?[^\s"'<>`\\]*)?/gi;
      for (const match of text.matchAll(absolutePattern)) {
        addCandidate(list, match[0], 620, 'inline-script-absolute');
      }

      const quotedPattern = /["']([^"']+?\.(?:mp4|m4v|mov|webm|mkv|avi)(?:\?[^"']*)?)["']/gi;
      for (const match of text.matchAll(quotedPattern)) {
        addCandidate(list, match[1], 590, 'inline-script-relative');
      }
    });
  }

  function chooseCandidate(candidates) {
    if (!candidates.length) return null;
    return candidates.sort((a, b) => b.score - a.score)[0];
  }

  function publish(candidate) {
    if (!candidate || !window.DlStream?.exposeMedia) return;
    if (candidate.url.href === lastPublishedUrl) return;

    lastPublishedUrl = candidate.url.href;
    window.DlStream.exposeMedia({
      title: candidate.title,
      downloadUrl: candidate.url.href,
      filename: candidate.filename,
      detectedBy: candidate.source,
    });
  }

  function scan() {
    const candidates = [];

    collectExplicitMarkers(candidates);
    collectDownloadLinks(candidates);
    collectMediaElements(candidates);
    collectDataAttributes(candidates);
    collectMetadata(candidates);
    collectJson(candidates);
    collectInlineSourceLiterals(candidates);

    publish(chooseCandidate(candidates));
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 250);
  }

  function start() {
    scan();

    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        'src', 'href', 'download', 'content',
        'data-dlstream-download-url', 'data-download-url',
        'data-file-url', 'data-video-url', 'data-video-src',
        'data-file', 'data-src',
      ],
    });

    window.addEventListener('load', scheduleScan, { once: true });

    window.DlStreamMediaDetector = Object.freeze({
      scan,
      rescan: scheduleScan,
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
