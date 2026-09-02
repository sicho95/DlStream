(() => {
  if (window.__DLSTREAM_ROUTE_SYNC__) return;
  window.__DLSTREAM_ROUTE_SYNC__ = true;

  function sync() {
    const target = window.__DLSTREAM__?.targetUrl;
    if (!target || !window.DlStreamVirtualLocation?.sync) return;
    try {
      const current = window.DlStreamVirtualLocation.current?.();
      if (!current || current.href !== new URL(target).href) {
        window.DlStreamVirtualLocation.sync(target);
      }
    } catch (_) {}
  }

  setInterval(sync, 100);
  setTimeout(sync, 0);
})();
