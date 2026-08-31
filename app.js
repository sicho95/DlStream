const $ = (selector) => document.querySelector(selector);

const el = {
  addressForm: $('#addressForm'),
  platformUrl: $('#platformUrl'),
  platformFrame: $('#platformFrame'),
  homeButton: $('#homeButton'),
  reloadButton: $('#reloadButton'),
  openSafariButton: $('#openSafariButton'),
  settingsButton: $('#settingsButton'),
  settingsDialog: $('#settingsDialog'),
  settingsPlatformUrl: $('#settingsPlatformUrl'),
  saveSettingsButton: $('#saveSettingsButton'),
  mediaTitle: $('#mediaTitle'),
  bridgeState: $('#bridgeState'),
  player: $('#player'),
  playButton: $('#playButton'),
  downloadButton: $('#downloadButton'),
  clearMediaButton: $('#clearMediaButton'),
  downloadHint: $('#downloadHint'),
  manualMediaForm: $('#manualMediaForm'),
  manualTitle: $('#manualTitle'),
  manualStreamUrl: $('#manualStreamUrl'),
  manualDownloadUrl: $('#manualDownloadUrl'),
};

const DEFAULT_PLATFORM_URL = 'https://didvip.com/';
let currentMedia = null;

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    try {
      return new URL(`https://${raw}`).toString();
    } catch {
      return null;
    }
  }
}

function getPlatformUrl() {
  return localStorage.getItem('sichostream.platformUrl') || DEFAULT_PLATFORM_URL;
}

function setPlatformUrl(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return false;
  localStorage.setItem('sichostream.platformUrl', normalized);
  el.platformUrl.value = normalized;
  el.settingsPlatformUrl.value = normalized;
  return true;
}

function navigatePlatform(value) {
  const normalized = normalizeUrl(value);
  if (!normalized) return;
  el.platformUrl.value = normalized;
  el.platformFrame.src = normalized;
}

function configuredOrigin() {
  try {
    return new URL(getPlatformUrl()).origin;
  } catch {
    return null;
  }
}

function cleanMedia(input = {}) {
  return {
    title: String(input.title || 'Vidéo').slice(0, 200),
    streamUrl: normalizeUrl(input.streamUrl),
    downloadUrl: normalizeUrl(input.downloadUrl),
    filename: String(input.filename || 'video.mp4').slice(0, 180),
    poster: normalizeUrl(input.poster),
    source: input.source || 'bridge',
  };
}

function updateMedia(input) {
  const media = input ? cleanMedia(input) : null;
  const hasMedia = Boolean(media?.streamUrl || media?.downloadUrl);
  currentMedia = hasMedia ? media : null;

  el.mediaTitle.textContent = media?.title || 'Aucun média transmis';
  el.bridgeState.textContent = media?.source === 'bridge' ? 'Plateforme connectée' : hasMedia ? 'Média manuel' : 'En attente';
  el.bridgeState.classList.toggle('active', hasMedia);
  el.playButton.disabled = !media?.streamUrl;
  el.downloadButton.disabled = !media?.downloadUrl;
  el.clearMediaButton.disabled = !hasMedia;

  if (media?.streamUrl) {
    el.player.src = media.streamUrl;
    if (media.poster) el.player.poster = media.poster;
    else el.player.removeAttribute('poster');
  } else {
    el.player.removeAttribute('src');
    el.player.removeAttribute('poster');
    el.player.load();
  }

  el.downloadHint.textContent = media?.downloadUrl
    ? 'Le bouton ouvre directement l’URL de téléchargement. Pour un gros fichier, le serveur doit répondre en pièce jointe HTTP afin qu’iOS l’enregistre sans charger le film en mémoire.'
    : 'Le téléchargement réel repose sur une URL renvoyant le fichier avec Content-Disposition: attachment.';
}

function startDownload() {
  if (!currentMedia?.downloadUrl) return;

  // Ne jamais fetcher un film complet en JavaScript : un fichier de plusieurs Go saturerait la mémoire.
  // Naviguer directement vers l’endpoint de téléchargement de la plateforme.
  const anchor = document.createElement('a');
  anchor.href = currentMedia.downloadUrl;
  anchor.target = '_blank';
  anchor.rel = 'noopener';
  anchor.click();
}

el.addressForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (setPlatformUrl(el.platformUrl.value)) navigatePlatform(getPlatformUrl());
});

el.homeButton.addEventListener('click', () => navigatePlatform(getPlatformUrl()));
el.reloadButton.addEventListener('click', () => {
  const src = el.platformFrame.src;
  if (src) el.platformFrame.src = src;
});
el.openSafariButton.addEventListener('click', () => {
  window.open(el.platformFrame.src || getPlatformUrl(), '_blank', 'noopener');
});

el.settingsButton.addEventListener('click', () => {
  el.settingsPlatformUrl.value = getPlatformUrl();
  el.settingsDialog.showModal();
});

el.saveSettingsButton.addEventListener('click', (event) => {
  event.preventDefault();
  if (!setPlatformUrl(el.settingsPlatformUrl.value)) return;
  navigatePlatform(getPlatformUrl());
  el.settingsDialog.close();
});

el.playButton.addEventListener('click', async () => {
  if (!currentMedia?.streamUrl) return;
  el.player.scrollIntoView({ behavior: 'smooth', block: 'center' });
  await el.player.play().catch(() => {});
});

el.downloadButton.addEventListener('click', startDownload);
el.clearMediaButton.addEventListener('click', () => updateMedia(null));

el.manualMediaForm.addEventListener('submit', (event) => {
  event.preventDefault();
  updateMedia({
    title: el.manualTitle.value.trim() || 'Ma vidéo',
    streamUrl: el.manualStreamUrl.value,
    downloadUrl: el.manualDownloadUrl.value,
    filename: `${(el.manualTitle.value.trim() || 'video').replace(/[^a-z0-9_-]+/gi, '-')}.mp4`,
    source: 'manual',
  });
});

window.addEventListener('message', (event) => {
  const origin = configuredOrigin();
  if (!origin || event.origin !== origin) return;
  if (event.source !== el.platformFrame.contentWindow) return;
  if (event.data?.type !== 'SICHOSTREAM_MEDIA' || !event.data.media) return;
  updateMedia({ ...event.data.media, source: 'bridge' });
});

const initialUrl = getPlatformUrl();
setPlatformUrl(initialUrl);
navigatePlatform(initialUrl);
updateMedia(null);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
