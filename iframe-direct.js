(() => {
  if (window.__DLSTREAM_DIRECT_EMBEDS_PATCHED__) return;
  window.__DLSTREAM_DIRECT_EMBEDS_PATCHED__ = true;

  const nativeSetAttribute = Element.prototype.setAttribute;
  const nativeSrcDescriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src');

  function normalize(value, base = location.href) {
    try {
      const url = new URL(String(value || ''), base);
      return ['http:', 'https:'].includes(url.protocol) ? url : null;
    } catch {
      return null;
    }
  }

  function hostMatches(host, root) {
    return host === root || host.endsWith(`.${root}`);
  }

  function providerFor(value) {
    const url = value instanceof URL ? value : normalize(value);
    if (!url) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');

    if (host === 'youtu.be' || hostMatches(host, 'youtube.com') || hostMatches(host, 'youtube-nocookie.com')) return 'YouTube';
    if (hostMatches(host, 'vimeo.com')) return 'Vimeo';
    if (host === 'dai.ly' || hostMatches(host, 'dailymotion.com')) return 'Dailymotion';
    if (hostMatches(host, 'twitch.tv')) return 'Twitch';
    return null;
  }

  function looksLikePlayerFrame(frame, target) {
    if (!frame || !target) return Boolean(providerFor(target));
    if (providerFor(target)) return true;

    const path = `${target.hostname}${target.pathname}`.toLowerCase();
    const hint = [
      frame.getAttribute?.('title'),
      frame.getAttribute?.('allow'),
      frame.getAttribute?.('name'),
      frame.getAttribute?.('id'),
      frame.getAttribute?.('class'),
    ].filter(Boolean).join(' ').toLowerCase();

    if (frame.hasAttribute?.('allowfullscreen')) return true;
    if (/(?:autoplay|fullscreen|picture-in-picture|encrypted-media)/i.test(frame.getAttribute?.('allow') || '')) return true;
    if (/(?:video|vidéo|player|stream|lecture|watch)/i.test(hint)) return true;
    if (/(?:^|\/)(?:embed|player|video|watch|stream)(?:\/|$)/i.test(path)) return true;
    if (/\/(?:e|v)\/[a-z0-9_-]{4,}(?:$|[/?#])/i.test(target.href)) return true;
    return false;
  }

  function nestedTarget(value) {
    const candidate = normalize(value);
    if (!candidate || candidate.origin !== location.origin) return null;

    const nested = candidate.searchParams.get('nested');
    const targetRaw = candidate.searchParams.get('url');
    if (nested !== '1' || !targetRaw) return null;
    return normalize(targetRaw);
  }

  function directTarget(value, frame = null) {
    const candidate = normalize(value);
    if (!candidate) return null;
    if (providerFor(candidate)) return candidate;

    const target = nestedTarget(candidate);
    if (!target) return null;
    return looksLikePlayerFrame(frame, target) ? target : null;
  }

  function notify(frame, url) {
    try {
      const provider = providerFor(url) || url.hostname.replace(/^www\./, '');
      window.dispatchEvent(new CustomEvent('dlstream-direct-embed', {
        detail: { provider, url: url.href, frame },
      }));
    } catch (_) {}
  }

  if (nativeSrcDescriptor?.get && nativeSrcDescriptor?.set) {
    try {
      Object.defineProperty(HTMLIFrameElement.prototype, 'src', {
        configurable: nativeSrcDescriptor.configurable,
        enumerable: nativeSrcDescriptor.enumerable,
        get: nativeSrcDescriptor.get,
        set(value) {
          const direct = directTarget(value, this);
          nativeSrcDescriptor.set.call(this, direct?.href || value);
          if (direct) notify(this, direct);
        },
      });
    } catch (_) {}
  }

  try {
    Object.defineProperty(HTMLIFrameElement.prototype, 'setAttribute', {
      configurable: true,
      writable: true,
      value(name, value) {
        if (String(name || '').toLowerCase() === 'src') {
          const direct = directTarget(value, this);
          nativeSetAttribute.call(this, name, direct?.href || value);
          if (direct) notify(this, direct);
          return;
        }
        nativeSetAttribute.call(this, name, value);
      },
    });
  } catch (_) {}

  function restoreDirectFrames() {
    document.querySelectorAll?.('iframe[src]').forEach((frame) => {
      const raw = frame.getAttribute('src');
      const direct = directTarget(raw, frame);
      if (!direct) return;

      const current = normalize(frame.src);
      if (current?.href === direct.href) return;
      nativeSetAttribute.call(frame, 'src', direct.href);
      notify(frame, direct);
    });
  }

  window.DlStreamDirectEmbeds = Object.freeze({
    providerFor,
    looksLikePlayerFrame,
    isDirectProviderUrl: (value) => Boolean(providerFor(value)),
    directTarget,
    restoreDirectFrames,
  });

  // Conserver le correctif après document.open/document.write et pour les lecteurs créés tardivement.
  setInterval(restoreDirectFrames, 120);
})();
