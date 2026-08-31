/**
 * DlStream bridge — aucun framework, aucune dépendance.
 *
 * À inclure sur la page vidéo de TA plateforme.
 * La plateforme doit connaître l'URL de téléchargement qu'elle expose elle-même pour le média.
 */
(function () {
  const PWA_ORIGIN = 'https://sicho95.github.io';

  window.DlStream = {
    exposeMedia(media) {
      if (!window.parent || window.parent === window) return;

      window.parent.postMessage({
        type: 'DLSTREAM_MEDIA',
        media: {
          title: media.title || document.title || 'Vidéo',
          downloadUrl: media.downloadUrl || null,
          filename: media.filename || 'video.mp4'
        }
      }, PWA_ORIGIN);
    }
  };

  // Compatibilité temporaire avec le premier nom du POC.
  window.SichoStream = window.DlStream;
})();
