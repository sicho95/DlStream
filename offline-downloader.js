(() => {
  const cfg = window.__DLSTREAM__;
  if (!cfg?.appEntry || cfg.isNested) return;

  // Conserver une API minimale pour les anciens appels éventuels.
  window.DlStreamOffline = Object.freeze({
    async analyze(media = {}) {
      return {
        feasible: false,
        type: media.type || media.mediaType || 'unknown',
        reason: 'Téléchargement géré par a-Shell.',
      };
    },
  });

  if (!document.querySelector('script[data-dlstream-candidate-observer]')) {
    const script = document.createElement('script');
    script.src = new URL(`./candidate-observer.js?v=${cfg.build || '22'}`, cfg.appEntry).href;
    script.dataset.dlstreamCandidateObserver = '1';
    document.head.appendChild(script);
  }
})();
