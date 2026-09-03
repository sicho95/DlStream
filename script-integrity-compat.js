(() => {
  if (window.__DLSTREAM_SCRIPT_INTEGRITY_COMPAT__) return;
  window.__DLSTREAM_SCRIPT_INTEGRITY_COMPAT__ = true;

  const previousWrite = Document.prototype.write;
  const previousWriteln = Document.prototype.writeln;

  const stats = window.__DLSTREAM_SCRIPT_STATS__ ||= {
    sanitized: 0,
    external: 0,
    virtual: 0,
    loadEvents: 0,
    errorEvents: 0,
    lastLoaded: '',
    lastError: '',
  };

  function probeLoad(value) {
    try {
      stats.loadEvents += 1;
      stats.lastLoaded = String(value || '');
    } catch (_) {}
  }

  function probeError(value) {
    try {
      stats.errorEvents += 1;
      stats.lastError = String(value || '');
    } catch (_) {}
  }

  window.__DLSTREAM_SCRIPT_PROBE_LOAD__ = probeLoad;
  window.__DLSTREAM_SCRIPT_PROBE_ERROR__ = probeError;

  function escapeAttribute(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;');
  }

  function readSrc(tag) {
    const match = String(tag).match(/\bsrc\s*=\s*(["'])(.*?)\1/i);
    return match ? match[2] : '';
  }

  function addProbeAttribute(tag, name, code) {
    const re = new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i');
    if (re.test(tag)) {
      return tag.replace(re, (full, quote, current) =>
        ` ${name}=${quote}${current};${code}${quote}`);
    }
    return tag.replace(/>$/, ` ${name}="${escapeAttribute(code)}">`);
  }

  function sanitizeScriptTag(tag) {
    const src = readSrc(tag);
    if (!src) return tag;

    let out = String(tag);
    const before = out;

    // Le service worker peut réécrire les imports et les lectures de location.
    // Une empreinte SRI calculée sur le fichier d'origine ne peut donc plus rester valide.
    out = out.replace(/\sintegrity\s*=\s*(["']).*?\1/gi, '');

    const encoded = JSON.stringify(src).replace(/"/g, '&quot;');
    out = addProbeAttribute(
      out,
      'onload',
      `try{window.__DLSTREAM_SCRIPT_PROBE_LOAD__&&window.__DLSTREAM_SCRIPT_PROBE_LOAD__(${encoded})}catch(_){}`,
    );
    out = addProbeAttribute(
      out,
      'onerror',
      `try{window.__DLSTREAM_SCRIPT_PROBE_ERROR__&&window.__DLSTREAM_SCRIPT_PROBE_ERROR__(${encoded})}catch(_){}`,
    );

    if (out !== before) stats.sanitized += 1;
    return out;
  }

  function sanitizeLinkTag(tag) {
    const text = String(tag);
    const rel = (text.match(/\brel\s*=\s*(["'])(.*?)\1/i)?.[2] || '').toLowerCase();
    const as = (text.match(/\bas\s*=\s*(["'])(.*?)\1/i)?.[2] || '').toLowerCase();
    const scriptLike = rel.includes('modulepreload') || (rel.includes('preload') && ['script', 'worker', 'fetch'].includes(as));
    if (!scriptLike) return text;
    const out = text.replace(/\sintegrity\s*=\s*(["']).*?\1/gi, '');
    if (out !== text) stats.sanitized += 1;
    return out;
  }

  function sanitizeHtml(value) {
    let html = String(value ?? '');
    if (!html) return html;
    html = html.replace(/<script\b[^>]*\bsrc\s*=\s*(["']).*?\1[^>]*>/gi, sanitizeScriptTag);
    html = html.replace(/<link\b[^>]*>/gi, sanitizeLinkTag);
    return html;
  }

  try {
    Document.prototype.write = function dlStreamScriptSafeWrite(...parts) {
      return previousWrite.call(this, ...parts.map(sanitizeHtml));
    };
    Document.prototype.writeln = function dlStreamScriptSafeWriteln(...parts) {
      return previousWriteln.call(this, ...parts.map(sanitizeHtml));
    };
  } catch (_) {}

  function scan() {
    try {
      const scripts = [...document.querySelectorAll('script[src]')];
      stats.external = scripts.length;
      stats.virtual = scripts.filter((script) => String(script.src || '').includes('/__dlstream_asset__/')).length;
    } catch (_) {}
  }

  setInterval(scan, 250);
  setTimeout(scan, 50);
})();
