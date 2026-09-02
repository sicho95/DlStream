(() => {
  if (window.__DLSTREAM_INLINE_LOCATION__) return;
  window.__DLSTREAM_INLINE_LOCATION__ = true;

  const previousWrite = Document.prototype.write;
  const previousWriteln = Document.prototype.writeln;

  function javascriptType(attrs) {
    const match = String(attrs || '').match(/\btype\s*=\s*(["'])(.*?)\1/i);
    if (!match) return true;
    const type = String(match[2] || '').trim().toLowerCase();
    return !type || type === 'module' || /(?:javascript|ecmascript)/i.test(type);
  }

  function rewriteInlineScripts(value) {
    let html = String(value ?? '');
    if (!html || !window.DlStreamVirtualLocation?.rewriteSource) return html;

    return html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (full, attrs, source) => {
      if (/\bsrc\s*=/i.test(attrs) || !javascriptType(attrs)) return full;
      const rewritten = window.DlStreamVirtualLocation.rewriteSource(source);
      return `<script${attrs}>${rewritten}<\/script>`;
    });
  }

  try {
    Document.prototype.write = function dlStreamInlineLocationWrite(...parts) {
      return previousWrite.call(this, ...parts.map(rewriteInlineScripts));
    };
    Document.prototype.writeln = function dlStreamInlineLocationWriteln(...parts) {
      return previousWriteln.call(this, ...parts.map(rewriteInlineScripts));
    };
  } catch (_) {}

  window.DlStreamInlineLocation = Object.freeze({ rewriteInlineScripts });
})();
