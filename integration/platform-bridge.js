/**
 * SichoStream bridge — aucun framework, aucune dépendance.
 *
 * À inclure sur la page vidéo de TA plateforme.
 * La plateforme doit connaître les URL qu'elle a elle-même générées pour le média.
 */
(function () {
  const PWA_ORIGIN = 'https://sicho95.github.io';

  window.SichoStream = {
    exposeMedia(media) {
      if (!window.parent || window.parent === window) return;
      window.parent.postMessage({
        type: 'SICHOSTREAM_MEDIA',
        media: {
          title: media.title || document.title || 'Vidéo',
          streamUrl: media.streamUrl || null,
          downloadUrl: media.downloadUrl || null,
          filename: media.filename || 'video.mp4',
          poster: media.poster || null
        }
      }, PWA_ORIGIN);
    }
  };
})();
