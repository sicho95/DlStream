(() => {
  const PLATFORM_KEY = 'dlstream.platforms.v1';
  let mountedRoot = null;

  function cfg() {
    return window.__DLSTREAM__ || {};
  }

  function normalize(value) {
    try {
      const url = new URL(String(value || '').trim());
      return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
    } catch {
      try {
        const url = new URL(`https://${String(value || '').trim()}`);
        return url.href;
      } catch {
        return null;
      }
    }
  }

  function hostOf(value) {
    try { return new URL(String(value)).hostname.toLowerCase(); }
    catch { return ''; }
  }

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; }
    catch { return fallback; }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function platforms() {
    const stored = readJson(PLATFORM_KEY, []);
    const values = Array.isArray(stored) ? stored.map(normalize).filter(Boolean) : [];
    const current = normalize(localStorage.getItem('dlstream.platformUrl') || cfg().rootUrl || cfg().targetUrl);
    if (current) values.unshift(current);
    const unique = [...new Set(values)];
    if (unique.length !== stored.length || unique.some((value, index) => value !== stored[index])) writeJson(PLATFORM_KEY, unique);
    return unique;
  }

  function setPlatforms(values) {
    writeJson(PLATFORM_KEY, [...new Set(values.map(normalize).filter(Boolean))]);
  }

  function trustedRoots() {
    const values = readJson('dlstream.trustedRoots', []);
    return [...new Set((Array.isArray(values) ? values : []).map((value) => hostOf(value) || String(value || '').toLowerCase()).filter(Boolean))];
  }

  function setTrustedRoots(values) {
    writeJson('dlstream.trustedRoots', [...new Set(values.map((value) => hostOf(value) || String(value || '').toLowerCase()).filter(Boolean))]);
  }

  function trustPlatform(url) {
    const host = hostOf(url);
    if (!host) return;
    const roots = trustedRoots();
    if (!roots.includes(host)) setTrustedRoots([...roots, host]);
  }

  function appUrl(target) {
    const base = new URL(cfg().appEntry || location.href);
    base.search = '';
    base.hash = '';
    base.searchParams.set('url', target);
    return base.href;
  }

  function openPlatform(url) {
    const target = normalize(url);
    if (!target) return;
    const list = platforms();
    if (!list.includes(target)) setPlatforms([...list, target]);
    trustPlatform(target);
    localStorage.setItem('dlstream.platformUrl', target);
    location.assign(appUrl(target));
  }

  function removePlatform(url) {
    const target = normalize(url);
    const remaining = platforms().filter((item) => item !== target);
    setPlatforms(remaining);

    const removedHost = hostOf(target);
    if (removedHost && !remaining.some((item) => hostOf(item) === removedHost)) {
      setTrustedRoots(trustedRoots().filter((root) => root !== removedHost));
    }

    const active = normalize(localStorage.getItem('dlstream.platformUrl'));
    if (active === target && remaining.length) openPlatform(remaining[0]);
    else render(mountedRoot);
  }

  function learnedMap() {
    const map = readJson('dlstream.learnedDomains', {});
    return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));
  }

  function render(root = mountedRoot) {
    if (!root) return;
    const box = root.querySelector('#platformManagerList');
    const aggregate = root.querySelector('#platformManagerDomains');
    if (!box || !aggregate) return;

    const list = platforms();
    const active = normalize(localStorage.getItem('dlstream.platformUrl') || cfg().rootUrl || cfg().targetUrl);
    box.textContent = '';

    for (const url of list) {
      const row = document.createElement('div');
      row.style.cssText = `display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px;align-items:center;margin-top:6px;padding:7px 8px;border-radius:10px;background:${url === active ? '#2b2b30' : '#18181b'};border:1px solid ${url === active ? '#f2f2f2' : '#34343a'}`;

      const label = document.createElement('div');
      label.style.cssText = 'min-width:0';
      label.innerHTML = `<div style="font-size:11px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(hostOf(url))}</div><div style="font-size:9px;color:#9999a2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(url)}</div>`;

      const open = document.createElement('button');
      open.type = 'button';
      open.textContent = url === active ? 'Active' : 'Ouvrir';
      open.disabled = url === active;
      open.style.cssText = 'min-height:30px;border:1px solid #44444a;border-radius:9px;background:#2b2b30;color:#fff;padding:5px 8px';
      open.onclick = () => openPlatform(url);

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.style.cssText = 'width:30px;height:30px;border:1px solid #44444a;border-radius:9px;background:#2b2b30;color:#fff';
      remove.onclick = () => removePlatform(url);

      row.append(label, open, remove);
      box.appendChild(row);
    }

    const map = learnedMap();
    const rootHosts = [...new Set(list.map(hostOf).filter(Boolean))];
    aggregate.textContent = '';
    let total = 0;
    for (const host of rootHosts) {
      const learned = [...new Set((Array.isArray(map[host]) ? map[host] : []).map(String))];
      total += learned.length;
      const group = document.createElement('div');
      group.style.cssText = 'margin-top:7px;padding:7px 8px;border-radius:9px;background:#18181b';
      const title = document.createElement('div');
      title.style.cssText = 'font-size:10px;font-weight:700';
      title.textContent = `${host} · ${learned.length}`;
      const names = document.createElement('div');
      names.style.cssText = 'font-size:9px;color:#9999a2;line-height:1.35;word-break:break-word;margin-top:3px';
      names.textContent = learned.length ? learned.join(' · ') : 'Aucun domaine appris pour le moment.';
      group.append(title, names);
      aggregate.appendChild(group);
    }
    const counter = root.querySelector('#platformManagerDomainCount');
    if (counter) counter.textContent = `${total} domaine${total > 1 ? 's' : ''} appris au total`;
  }

  function mount() {
    const currentCfg = cfg();
    if (currentCfg.isNested) return;
    const root = document.querySelector('#dlstream-controls')?.shadowRoot;
    if (!root) return;
    if (root === mountedRoot && root.querySelector('#platformManager')) return;
    mountedRoot = root;

    const oldInput = root.querySelector('#url');
    const oldLabel = oldInput?.closest('label');
    if (oldLabel) oldLabel.style.display = 'none';
    const oldSave = root.querySelector('#save');
    if (oldSave) oldSave.style.display = 'none';

    const section = document.createElement('div');
    section.id = 'platformManager';
    section.className = 'section';
    section.innerHTML = `
      <h3>Plateformes</h3>
      <div class="subtle">Ajouter plusieurs URL puis basculer entre elles. Chaque plateforme conserve son apprentissage de domaines.</div>
      <div id="platformManagerList"></div>
      <div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;margin-top:9px">
        <input id="platformManagerInput" type="url" inputmode="url" placeholder="https://plateforme.example/..." style="min-height:40px">
        <button id="platformManagerAdd" type="button" style="min-height:40px;border:1px solid #44444a;border-radius:10px;background:#fff;color:#000;padding:7px 10px;font-weight:700">Ajouter</button>
      </div>
      <div style="margin-top:12px"><h3 style="margin-bottom:2px">Domaines appris · toutes les plateformes</h3><div id="platformManagerDomainCount" class="subtle"></div><div id="platformManagerDomains"></div></div>`;

    const trustSection = root.querySelector('.section.trust');
    if (trustSection) trustSection.parentElement.insertBefore(section, trustSection);
    else root.querySelector('#sheet')?.appendChild(section);

    const add = root.querySelector('#platformManagerAdd');
    const input = root.querySelector('#platformManagerInput');
    add.onclick = () => {
      const target = normalize(input.value);
      if (!target) return;
      const list = platforms();
      if (!list.includes(target)) setPlatforms([...list, target]);
      trustPlatform(target);
      input.value = '';
      render(root);
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        add.click();
      }
    });

    render(root);
    window.addEventListener('dlstream-domains-updated', () => render(root));
    window.addEventListener('storage', () => render(root));
  }

  setInterval(mount, 250);
})();
