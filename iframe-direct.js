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

  function unwrapDlStreamFrame(value) {
    const candidate = normalize(value);
    if (!candidate) return null;

    if (providerFor(candidate)) return candidate;
    if (candidate.origin !== location.origin) return null;

    const nested = candidate.searchParams.get('nested');
    const targetRaw = candidate.searchParams.get('url');
    if (nested !== '1' || !targetRaw) return null;

    const target = normalize(targetRaw);
    return target && providerFor(target) ? target : null;
  }

  function notify(frame, url) {
    try {
      const provider = providerFor(url);
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
          const direct = unwrapDlStreamFrame(value);
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
          const direct = unwrapDlStreamFrame(value);
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
      const direct = unwrapDlStreamFrame(raw);
      if (!direct) return;

      const current = normalize(frame.src);
      if (current?.href === direct.href) return;
      nativeSetAttribute.call(frame, 'src', direct.href);
      notify(frame, direct);
    });
  }

  window.DlStreamDirectEmbeds = Object.freeze({
    providerFor,
    isDirectProviderUrl: (value) => Boolean(providerFor(value)),
    unwrapDlStreamFrame,
    restoreDirectFrames,
  });

  // Conserver le correctif après document.open/document.write et pour les lecteurs créés tardivement.
  setInterval(restoreDirectFrames, 150);
})();
