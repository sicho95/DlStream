const $ = (selector) => document.querySelector(selector);

const el = {
  platformFrame: $('#platformFrame'),
  menuButton: $('#menuButton'),
  downloadButton: $('#downloadButton'),
  toastDownloadButton: $('#toastDownloadButton'),
  mediaToast: $('#mediaToast'),
  mediaTitle: $('#mediaTitle'),
  settingsDialog: $('#settingsDialog'),
  settingsPlatformUrl: $('#settingsPlatformUrl'),
  saveSettingsButton: $('#saveSettingsButton'),
  reloadButton: $('#reloadButton'),
  openDirectButton: $('#openDirectButton'),
  manualTitle: $('#manualTitle'),
  manualDownloadUrl: $('#manualDownloadUrl'),
  manualDownloadButton: $('#manualDownloadButton'),
};

const DEFAULT_PLATFORM_URL = 'https://didvip.com/b6ig41m4d/home/didvip';
let currentMedia = null;
let toastTimer = null;

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    try {
      return new URL(`https://${raw}`).toString();
    } catch {
      return null;
    }
  }
}

function getPlatformUrl() {
  return localStorage.getItem('dlstream.platformUrl') || DEFAULT_PLATFORM_URL;
}

function savePlatformUrl(value) {
  const url = normalizeUrl(value);
  if (!url) return null;
  localStorage.setItem('dlstream.platformUrl', url);
  return url;
}

function platformOrigin() {
  try {
    return new URL(getPlatformUrl()).origin;
  } catch {
    return null;
  }
}

function loadPlatform(value = getPlatformUrl()) {
  const url = normalizeUrl(value);
  if (!url) return;
  el.platformFrame.src = url;
}

function openPlatformDirectly() {
  const url = normalizeUrl(el.settingsPlatformUrl.value) || getPlatformUrl();
  const saved = savePlatformUrl(url);
  if (!saved) return;

  // Navigation de premier niveau : utile lorsque le domaine distant refuse l'intégration en iframe.
  window.location.href = saved;
}

function clearToastLater() {
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    el.mediaToast.hidden = true;
  }, 3500);
}

function setCurrentMedia(input = null) {
  const downloadUrl = normalizeUrl(input?.downloadUrl);
  currentMedia = downloadUrl
    ? {
        title: String(input?.title || 'Vidéo').slice(0, 180),
        downloadUrl,
        filename: String(input?.filename || 'video.mp4').slice(0, 180),
      }
    : null;

  const available = Boolean(currentMedia?.downloadUrl);
  el.downloadButton.hidden = !available;
  el.mediaToast.hidden = !available;

  if (available) {
    el.mediaTitle.textContent = currentMedia.title;
    clearToastLater();
  }
}

function startDownload() {
  if (!currentMedia?.downloadUrl) return;

  // Ne pas fetcher le fichier en JavaScript : Safari/iOS doit gérer le gros téléchargement nativement.
  const anchor = document.createElement('a');
  anchor.href = currentMedia.downloadUrl;
  anchor.target = '_blank';
  anchor.rel = 'noopener';
  anchor.download = currentMedia.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

el.menuButton.addEventListener('click', () => {
  el.settingsPlatformUrl.value = getPlatformUrl();
  el.settingsDialog.showModal();
});

el.saveSettingsButton.addEventListener('click', (event) => {
  event.preventDefault();
  const url = savePlatformUrl(el.settingsPlatformUrl.value);
  if (!url) return;
  loadPlatform(url);
  el.settingsDialog.close();
});

el.reloadButton.addEventListener('click', () => {
  const src = el.platformFrame.src || getPlatformUrl();
  el.platformFrame.src = src;
  el.settingsDialog.close();
});

el.openDirectButton.addEventListener('click', openPlatformDirectly);

el.downloadButton.addEventListener('click', startDownload);
el.toastDownloadButton.addEventListener('click', startDownload);

el.manualDownloadButton.addEventListener('click', () => {
  setCurrentMedia({
    title: el.manualTitle.value.trim() || 'Ma vidéo',
    downloadUrl: el.manualDownloadUrl.value,
    filename: `${(el.manualTitle.value.trim() || 'video').replace(/[^a-z0-9_-]+/gi, '-')}.mp4`,
  });
});

window.addEventListener('message', (event) => {
  const origin = platformOrigin();
  if (!origin || event.origin !== origin) return;
  if (event.source !== el.platformFrame.contentWindow) return;
  if (event.data?.type !== 'SICHOSTREAM_MEDIA' || !event.data.media) return;

  setCurrentMedia(event.data.media);
});

loadPlatform(getPlatformUrl());
setCurrentMedia(null);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
