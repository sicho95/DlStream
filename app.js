const $ = (selector) => document.querySelector(selector);

const el = {
  launcher: $('#launcher'),
  embeddedView: $('#embeddedView'),
  platformFrame: $('#platformFrame'),
  openPlatformButton: $('#openPlatformButton'),
  currentUrl: $('#currentUrl'),
  settingsButton: $('#settingsButton'),
  embeddedSettingsButton: $('#embeddedSettingsButton'),
  downloadButton: $('#downloadButton'),
  settingsDialog: $('#settingsDialog'),
  settingsForm: $('#settingsForm'),
  closeSettingsButton: $('#closeSettingsButton'),
  platformUrlInput: $('#platformUrlInput'),
};

const DEFAULT_PLATFORM_URL = 'https://didvip.com/b6ig41m4d/home/didvip';
const DEFAULT_MODE = 'direct';
let currentMedia = null;

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

function getDisplayMode() {
  return localStorage.getItem('dlstream.displayMode') || DEFAULT_MODE;
}

function saveSettings(url, mode) {
  const normalized = normalizeUrl(url);
  if (!normalized) return false;
  localStorage.setItem('dlstream.platformUrl', normalized);
  localStorage.setItem('dlstream.displayMode', mode === 'embedded' ? 'embedded' : 'direct');
  return true;
}

function configuredOrigin() {
  try {
    return new URL(getPlatformUrl()).origin;
  } catch {
    return null;
  }
}

function renderLauncher() {
  el.launcher.hidden = false;
  el.embeddedView.hidden = true;
  el.currentUrl.textContent = getPlatformUrl();
}

function renderEmbedded() {
  el.launcher.hidden = true;
  el.embeddedView.hidden = false;
  el.platformFrame.src = getPlatformUrl();
}

function openPlatform() {
  const url = getPlatformUrl();
  if (getDisplayMode() === 'embedded') {
    renderEmbedded();
    return;
  }

  // Navigation réellement directe : aucune iframe, donc pas de blocage frame-ancestors/X-Frame-Options.
  window.location.assign(url);
}

function openSettings() {
  el.platformUrlInput.value = getPlatformUrl();
  const mode = getDisplayMode();
  const radio = document.querySelector(`input[name="displayMode"][value="${mode}"]`);
  if (radio) radio.checked = true;
  el.settingsDialog.showModal();
}

function startDownload() {
  if (!currentMedia?.downloadUrl) return;
  const url = normalizeUrl(currentMedia.downloadUrl);
  if (!url) return;
  window.open(url, '_blank', 'noopener');
}

el.openPlatformButton.addEventListener('click', openPlatform);
el.settingsButton.addEventListener('click', openSettings);
el.embeddedSettingsButton.addEventListener('click', openSettings);
el.closeSettingsButton.addEventListener('click', () => el.settingsDialog.close());
el.downloadButton.addEventListener('click', startDownload);

el.settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const mode = new FormData(el.settingsForm).get('displayMode') || DEFAULT_MODE;
  if (!saveSettings(el.platformUrlInput.value, mode)) return;
  el.settingsDialog.close();
  currentMedia = null;
  el.downloadButton.hidden = true;
  if (mode === 'embedded') renderEmbedded();
  else renderLauncher();
});

window.addEventListener('message', (event) => {
  if (getDisplayMode() !== 'embedded') return;
  const origin = configuredOrigin();
  if (!origin || event.origin !== origin) return;
  if (event.source !== el.platformFrame.contentWindow) return;
  if (!['DLSTREAM_MEDIA', 'SICHOSTREAM_MEDIA'].includes(event.data?.type)) return;

  const media = event.data?.media || {};
  currentMedia = {
    title: String(media.title || 'Vidéo').slice(0, 200),
    downloadUrl: normalizeUrl(media.downloadUrl),
    filename: String(media.filename || 'video.mp4').slice(0, 180),
  };
  el.downloadButton.hidden = !currentMedia.downloadUrl;
});

renderLauncher();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
