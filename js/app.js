// Interfaz de Bóveda. Toda la lógica sensible vive en crypto.js / vault.js.
import * as vault from './vault.js';
import * as cloud from './sync.js';
import { generate, strength } from './gen.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MIN_MASTER = 10;
const HIDDEN_LOCK_MS = 60 * 1000;
const CLIPBOARD_MS = 30 * 1000;

const state = { cat: 'all', q: '', revealed: new Set(), user: null, syncing: false, syncPaused: false, lastSync: null, syncError: '', editing: null };
let idleTimer = null, hiddenTimer = null, hiddenAt = 0, syncDebounce = null, syncInterval = null, clipTimer = null, toastTimer = null, failedUnlocks = 0;

// ---------- utilidades ----------
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function setMeter(el, labelEl, pw) {
  const s = strength(pw);
  el.style.width = (s.score * 25) + '%';
  el.dataset.s = s.score;
  if (labelEl) labelEl.textContent = pw ? `Fuerza: ${s.label} (~${s.bits} bits)` : '';
}

async function copyText(text, what) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.className = 'sr-copy';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* sin portapapeles */ }
    ta.remove();
  }
  if (what === 'pw') {
    clearTimeout(clipTimer);
    clipTimer = setTimeout(() => { navigator.clipboard?.writeText('').catch(() => {}); }, CLIPBOARD_MS);
    toast('Contraseña copiada. Se borrará del portapapeles en 30 s');
  } else toast('Copiado');
}

function safeUrl(u) {
  if (!u) return '';
  const full = /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u;
  try { const x = new URL(full); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; }
}

const catName = (id) => (vault.liveCategories().find((c) => c.id === id) || vault.liveCategories().find((c) => c.id === 'general') || { name: 'General' }).name;
const catIcon = (id) => (vault.liveCategories().find((c) => c.id === id) || {}).icon || '🔑';

// ---------- bloqueo / desbloqueo ----------
function showLock(mode, msg) {
  $('app').hidden = true;
  $('lock').hidden = false;
  for (const f of ['form-setup', 'form-unlock', 'form-cloud']) $(f).hidden = true;
  $('form-' + mode).hidden = false;
  $('btn-have-cloud').hidden = !(mode === 'setup' && cloud.isConfigured());
  for (const i of document.querySelectorAll('#lock input[type=password]')) i.value = '';
  $('unlock-err').textContent = msg || '';
  setTimeout(() => ($(mode === 'setup' ? 'setup-pw' : mode === 'cloud' ? 'cloud-email' : 'unlock-pw')).focus(), 50);
}

function lockNow(reason) {
  if (!vault.isUnlocked()) return;
  vault.lock();
  clearTimeout(idleTimer); clearTimeout(hiddenTimer); clearTimeout(syncDebounce); clearInterval(syncInterval);
  if (clipTimer) { clearTimeout(clipTimer); clipTimer = null; try { navigator.clipboard.writeText('').catch(() => {}); } catch { /* sin portapapeles */ } }
  state.revealed.clear(); state.q = ''; state.cat = 'all'; state.editing = null;
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  $('list').replaceChildren(); $('cat-nav').replaceChildren(); $('cat-chips').replaceChildren();
  for (const id of ['e-pw', 'e-user', 'e-notes', 'e-site', 'e-url', 'e-icon', 'g-out']) { const el = $(id); if ('value' in el) el.value = ''; else el.textContent = ''; }
  $('search').value = ''; $('import-msg').textContent = ''; $('cat-list').replaceChildren();
  showLock('unlock', reason || '');
}

function resetIdle() {
  if (!vault.isUnlocked()) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => lockNow('Bloqueada por inactividad.'), vault.getAutolockMin() * 60 * 1000);
}
for (const ev of ['pointerdown', 'keydown', 'scroll', 'touchstart']) addEventListener(ev, resetIdle, { passive: true });

document.addEventListener('visibilitychange', () => {
  if (!vault.isUnlocked()) return;
  if (document.hidden) {
    hiddenAt = Date.now();
    clearTimeout(hiddenTimer);
    hiddenTimer = setTimeout(() => lockNow('Bloqueada al ocultar la app.'), HIDDEN_LOCK_MS);
  } else {
    clearTimeout(hiddenTimer);
    if (hiddenAt && Date.now() - hiddenAt >= HIDDEN_LOCK_MS) lockNow('Bloqueada al ocultar la app.');
    else { resetIdle(); scheduleSync(500); }
    hiddenAt = 0;
  }
});

async function enterApp() {
  failedUnlocks = 0;
  $('lock').hidden = true;
  $('app').hidden = false;
  $('set-autolock').value = String(vault.getAutolockMin());
  render();
  resetIdle();
  clearInterval(syncInterval);
  syncInterval = setInterval(() => scheduleSync(0), 60 * 1000);
  state.syncPaused = false;
  if (cloud.isConfigured()) {
    try { state.user = await cloud.getUser(); } catch { state.user = null; }
    renderSyncUI();
    scheduleSync(300);
  } else renderSyncUI();
}

// ---------- render ----------
function filtered() {
  const q = state.q.trim().toLowerCase();
  return vault.liveEntries()
    .filter((e) => state.cat === 'all' || e.category === state.cat || (state.cat === 'general' && !vault.liveCategories().some((c) => c.id === e.category)))
    .filter((e) => !q || [e.site_name, e.site_url, e.username, e.notes].some((v) => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => String(a.site_name).localeCompare(String(b.site_name), 'es', { sensitivity: 'base' }));
}

function render() {
  if (!vault.isUnlocked()) return;
  const entries = vault.liveEntries();
  const cats = vault.liveCategories();
  if (state.cat !== 'all' && !cats.some((c) => c.id === state.cat)) state.cat = 'all';
  const count = (id) => entries.filter((e) => e.category === id).length;

  $('cat-nav').innerHTML =
    `<button class="cat-btn ${state.cat === 'all' ? 'active' : ''}" data-cat="all">📚 Todas <span class="n">${entries.length}</span></button>` +
    cats.map((c) => `<button class="cat-btn ${state.cat === c.id ? 'active' : ''}" data-cat="${esc(c.id)}">${esc(c.icon || '📁')} ${esc(c.name)} <span class="n">${count(c.id)}</span></button>`).join('');
  $('cat-chips').innerHTML =
    `<button class="chip ${state.cat === 'all' ? 'active' : ''}" data-cat="all">Todas</button>` +
    cats.map((c) => `<button class="chip ${state.cat === c.id ? 'active' : ''}" data-cat="${esc(c.id)}">${esc(c.icon || '📁')} ${esc(c.name)}</button>`).join('');

  const list = filtered();
  $('list').innerHTML = list.map(cardHTML).join('');
  const empty = $('empty');
  empty.hidden = list.length > 0;
  empty.textContent = entries.length ? 'No hay resultados con ese filtro.' : 'Aún no hay contraseñas. Pulsa “＋ Nueva” para agregar la primera.';
}

function cardHTML(e) {
  const shown = state.revealed.has(e.id);
  const url = safeUrl(e.site_url);
  const host = url ? new URL(url).host : '';
  const letter = (e.site_name || '?').trim().charAt(0).toUpperCase();
  return `<article class="card" data-id="${esc(e.id)}">
    <div class="card-head">
      <div class="avatar">${esc(e.icon || letter)}</div>
      <div class="card-title"><b>${esc(e.site_name)}</b>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(host)}</a>` : `<span>${esc(e.site_url || '')}</span>`}</div>
      <span class="badge">${esc(catName(e.category))}</span>
    </div>
    ${e.username ? `<div class="kv"><span class="v">${esc(e.username)}</span><button class="btn btn-secondary btn-sm" data-act="copy-user" aria-label="Copiar usuario">Copiar</button></div>` : ''}
    <div class="kv"><span class="v mono">${shown ? esc(e.password) : '••••••••••••'}</span>
      <button class="btn btn-secondary btn-sm" data-act="toggle" aria-label="${shown ? 'Ocultar' : 'Mostrar'} contraseña">${shown ? '🙈' : '👁'}</button>
      <button class="btn btn-secondary btn-sm" data-act="copy-pw" aria-label="Copiar contraseña">Copiar</button></div>
    ${e.notes ? `<div class="card-notes">${esc(e.notes)}</div>` : ''}
    <div class="card-foot"><button class="btn btn-secondary btn-sm" data-act="edit">✏️ Editar</button></div>
  </article>`;
}

// ---------- entradas ----------
function openEntry(id) {
  const e = id ? vault.liveEntries().find((x) => x.id === id) : null;
  state.editing = e ? e.id : null;
  $('entry-title').textContent = e ? 'Editar contraseña' : 'Nueva contraseña';
  $('e-cat').innerHTML = vault.liveCategories().map((c) => `<option value="${esc(c.id)}">${esc(c.icon || '')} ${esc(c.name)}</option>`).join('');
  $('e-site').value = e?.site_name || '';
  $('e-icon').value = e?.icon || '';
  $('e-url').value = e?.site_url || '';
  $('e-user').value = e?.username || '';
  $('e-pw').value = e?.password || '';
  $('e-pw').type = 'password';
  $('e-cat').value = e?.category || (state.cat !== 'all' ? state.cat : 'general');
  $('e-notes').value = e?.notes || '';
  $('e-delete').hidden = !e;
  $('entry-err').textContent = '';
  $('gen-panel').hidden = true;
  setMeter($('e-meter'), $('e-meter-label'), $('e-pw').value);
  $('dlg-entry').showModal();
}

async function mutate(promise) {
  await promise;
  render();
  scheduleSync(3000);
}

$('form-entry').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const site = $('e-site').value.trim();
  if (!site) { $('entry-err').textContent = 'El sitio es obligatorio.'; return; }
  const entry = {
    site_name: site, icon: $('e-icon').value.trim(), site_url: $('e-url').value.trim(), username: $('e-user').value.trim(),
    password: $('e-pw').value, category: $('e-cat').value, notes: $('e-notes').value.trim(),
  };
  if (state.editing) entry.id = state.editing;
  await mutate(vault.upsertEntry(entry));
  $('dlg-entry').close();
  toast('Guardado');
});
$('e-delete').addEventListener('click', async () => {
  if (!state.editing || !confirm('¿Eliminar esta contraseña? Se borrará también en tus otros dispositivos.')) return;
  await mutate(vault.deleteEntry(state.editing));
  state.revealed.delete(state.editing);
  $('dlg-entry').close();
  toast('Eliminada');
});
$('e-toggle').addEventListener('click', () => { $('e-pw').type = $('e-pw').type === 'password' ? 'text' : 'password'; });
$('e-pw').addEventListener('input', () => setMeter($('e-meter'), $('e-meter-label'), $('e-pw').value));

// Generador
const genOpts = () => ({ length: +$('g-len').value, lower: $('g-lower').checked, upper: $('g-upper').checked, digits: $('g-digits').checked, symbols: $('g-symbols').checked });
function regen() {
  $('g-len-val').textContent = $('g-len').value;
  $('g-out').textContent = generate(genOpts()) || 'Elige al menos un tipo de carácter';
}
$('e-gen-toggle').addEventListener('click', () => { $('gen-panel').hidden = !$('gen-panel').hidden; if (!$('gen-panel').hidden) regen(); });
for (const id of ['g-len', 'g-lower', 'g-upper', 'g-digits', 'g-symbols', 'g-regen']) $(id).addEventListener('input', regen), $(id).addEventListener('click', id === 'g-regen' ? regen : () => {});
$('g-use').addEventListener('click', () => {
  const v = $('g-out').textContent;
  if (!v || v.startsWith('Elige')) return;
  $('e-pw').value = v; $('e-pw').type = 'text';
  setMeter($('e-meter'), $('e-meter-label'), v);
  $('gen-panel').hidden = true;
});

// Acciones de las tarjetas y navegación (delegación)
$('list').addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('.card').dataset.id;
  const e = vault.liveEntries().find((x) => x.id === id);
  if (!e) return;
  const act = btn.dataset.act;
  if (act === 'copy-user') copyText(e.username, 'user');
  else if (act === 'copy-pw') copyText(e.password, 'pw');
  else if (act === 'edit') openEntry(id);
  else if (act === 'toggle') {
    if (state.revealed.has(id)) state.revealed.delete(id);
    else { state.revealed.add(id); setTimeout(() => { state.revealed.delete(id); render(); }, 20000); }
    render();
  }
});
for (const id of ['cat-nav', 'cat-chips']) $(id).addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-cat]');
  if (b) { state.cat = b.dataset.cat; render(); }
});
$('search').addEventListener('input', (ev) => { state.q = ev.target.value; render(); });
$('btn-add').addEventListener('click', () => openEntry(null));
for (const id of ['btn-lock', 'btn-lock-m']) $(id).addEventListener('click', () => lockNow(''));
for (const id of ['btn-settings', 'btn-settings-m']) $(id).addEventListener('click', openSettings);
document.addEventListener('click', (ev) => { const c = ev.target.closest('[data-close]'); if (c) c.closest('dialog').close(); });

// ---------- contraseña maestra: crear / desbloquear ----------
$('setup-pw').addEventListener('input', () => setMeter($('setup-meter'), $('setup-meter-label'), $('setup-pw').value));
$('form-setup').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const a = $('setup-pw').value, b = $('setup-pw2').value, err = $('setup-err');
  err.textContent = '';
  if (a.length < MIN_MASTER) { err.textContent = `La contraseña maestra debe tener al menos ${MIN_MASTER} caracteres.`; return; }
  if (a !== b) { err.textContent = 'Las contraseñas no coinciden.'; return; }
  const btn = ev.submitter; btn.disabled = true; btn.textContent = 'Cifrando…';
  try { await vault.create(a); await enterApp(); }
  catch (e) { err.textContent = 'No se pudo crear la bóveda: ' + e.message; }
  finally { btn.disabled = false; btn.textContent = 'Crear bóveda'; }
});

$('form-unlock').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('unlock-btn'), err = $('unlock-err');
  err.textContent = ''; btn.disabled = true; btn.textContent = 'Descifrando…';
  try {
    if (failedUnlocks >= 3) await new Promise((r) => setTimeout(r, Math.min(failedUnlocks - 2, 10) * 1000)); // freno ante intentos repetidos
    await vault.unlock($('unlock-pw').value);
    $('unlock-pw').value = '';
    await enterApp();
  } catch (e) {
    failedUnlocks++;
    err.textContent = e.message === 'BAD_PASSWORD' ? 'Contraseña maestra incorrecta.' : 'No se pudo abrir la bóveda: ' + e.message;
    $('unlock-pw').select();
  } finally { btn.disabled = false; btn.textContent = 'Desbloquear'; }
});

// Traer la bóveda de la nube en un dispositivo nuevo
$('btn-have-cloud').addEventListener('click', () => showLock('cloud'));
$('btn-cloud-back').addEventListener('click', () => showLock('setup'));
$('form-cloud').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const err = $('cloud-err'); err.textContent = '';
  try {
    const user = await cloud.signIn($('cloud-email').value.trim(), $('cloud-pw').value);
    const remote = await cloud.pull(user.id);
    if (!remote) { err.textContent = 'Esa cuenta aún no tiene una bóveda en la nube. Créala primero en el otro dispositivo y sincroniza.'; return; }
    vault.adoptCloudBlob(remote.data, remote.updated_at);
    showLock('unlock', 'Bóveda descargada. Escribe la contraseña maestra para abrirla.');
  } catch (e) { err.textContent = e.message; }
});

// ---------- pedir contraseña maestra de otro bloque ----------
function askPassword(msg) {
  return new Promise((resolve) => {
    const dlg = $('dlg-ask'), pw = $('ask-pw');
    $('ask-msg').textContent = msg;
    pw.value = '';
    let done = false;
    const finish = (v) => { if (done) return; done = true; pw.value = ''; if (dlg.open) dlg.close(); resolve(v); };
    dlg.addEventListener('close', () => finish(null), { once: true }); // p. ej. si lockNow cierra el diálogo
    $('form-ask').onsubmit = (e) => { e.preventDefault(); finish(pw.value); };
    $('ask-cancel').onclick = () => finish(null);
    dlg.oncancel = (e) => { e.preventDefault(); finish(null); };
    dlg.showModal();
    pw.focus();
  });
}

// ---------- ajustes ----------
function openSettings() {
  renderSyncUI();
  renderCatList();
  $('set-autolock').value = String(vault.getAutolockMin());
  $('form-master').hidden = true;
  $('import-msg').textContent = '';
  $('acc-err').textContent = '';
  $('dlg-settings').showModal();
}

function renderCatList() {
  $('cat-list').innerHTML = vault.liveCategories().map((c) => `<div class="cat-row" data-id="${esc(c.id)}">
    <input class="input ico" value="${esc(c.icon || '')}" maxlength="4" data-f="icon" aria-label="Icono">
    <input class="input" value="${esc(c.name)}" maxlength="40" data-f="name" aria-label="Nombre">
    ${c.id === 'general' ? '' : '<button class="btn btn-danger btn-sm" data-del aria-label="Eliminar categoría">🗑</button>'}</div>`).join('');
}
$('cat-list').addEventListener('change', async (ev) => {
  const row = ev.target.closest('.cat-row'); if (!row) return;
  const c = vault.liveCategories().find((x) => x.id === row.dataset.id); if (!c) return;
  const name = row.querySelector('[data-f=name]').value.trim() || c.name;
  await mutate(vault.upsertCategory({ id: c.id, name, icon: row.querySelector('[data-f=icon]').value.trim() || '📁' }));
});
$('cat-list').addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-del]'); if (!b) return;
  const id = b.closest('.cat-row').dataset.id;
  if (!confirm('¿Eliminar la categoría? Sus contraseñas pasarán a “General”.')) return;
  await mutate(vault.deleteCategory(id));
  renderCatList();
});
$('form-cat').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const name = $('cat-name').value.trim(); if (!name) return;
  await mutate(vault.upsertCategory({ name, icon: $('cat-icon').value.trim() || '📁' }));
  $('cat-name').value = ''; $('cat-icon').value = '';
  renderCatList();
});

$('set-autolock').addEventListener('change', async (ev) => { await mutate(vault.setSettings({ autolock: +ev.target.value })); resetIdle(); toast('Guardado'); });

$('btn-change-master').addEventListener('click', () => { $('form-master').hidden = !$('form-master').hidden; });
$('m-new').addEventListener('input', () => setMeter($('m-meter'), null, $('m-new').value));
$('form-master').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const err = $('m-err'); err.textContent = '';
  const n = $('m-new').value;
  if (n.length < MIN_MASTER) { err.textContent = `Mínimo ${MIN_MASTER} caracteres.`; return; }
  if (n !== $('m-new2').value) { err.textContent = 'Las contraseñas nuevas no coinciden.'; return; }
  const btn = ev.submitter; btn.disabled = true; btn.textContent = 'Recifrando…';
  try {
    await vault.changeMaster($('m-old').value, n);
    for (const id of ['m-old', 'm-new', 'm-new2']) $(id).value = '';
    $('form-master').hidden = true;
    toast('Contraseña maestra cambiada');
    scheduleSync(500);
  } catch (e) { err.textContent = e.message === 'BAD_PASSWORD' ? 'La contraseña actual no es correcta.' : e.message; }
  finally { btn.disabled = false; btn.textContent = 'Recifrar con nueva contraseña'; }
});

// Respaldo
$('btn-export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(vault.exportBackup(), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `boveda-${new Date().toISOString().slice(0, 10)}.boveda.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  $('import-msg').textContent = 'Respaldo cifrado descargado. Guárdalo en un lugar seguro.';
});
for (const id of ['btn-import', 'btn-import-old']) $(id).addEventListener('click', () => $('file-import').click());
$('file-import').addEventListener('change', async (ev) => {
  const file = ev.target.files[0]; ev.target.value = '';
  if (!file) return;
  const msg = $('import-msg');
  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('El archivo es demasiado grande.');
    const obj = JSON.parse(await file.text());
    if (Array.isArray(obj) || Array.isArray(obj?.entries) || Array.isArray(obj?.passwords)) {
      const n = await vault.importLegacy(obj);
      msg.textContent = `Importadas ${n} contraseñas de la versión vieja.`;
    } else {
      const n = await vault.importBackup(obj, askPassword);
      msg.textContent = `Respaldo fusionado (${n >= 0 ? '+' : ''}${n} entradas).`;
    }
    render(); renderCatList(); scheduleSync(3000);
  } catch (e) {
    msg.textContent = e.message === 'CANCELLED' ? 'Importación cancelada.' : e.message === 'BAD_PASSWORD' ? 'Contraseña incorrecta: no se pudo abrir el respaldo.' : 'No se pudo importar: ' + e.message;
  }
});

// ---------- sincronización ----------
function renderSyncUI() {
  const on = cloud.isConfigured();
  $('sync-off').hidden = on;
  $('sync-out').hidden = !on || !!state.user;
  $('sync-in').hidden = !on || !state.user;
  if (state.user) $('acc-user').textContent = state.user.email || state.user.id;
  const pill = $('sync-pill');
  pill.hidden = !on;
  let txt = '';
  if (!on) txt = '';
  else if (!state.user) txt = '☁️ Sin sesión: la bóveda solo está en este dispositivo.';
  else if (state.syncing) txt = '☁️ Sincronizando…';
  else if (state.syncError) txt = '⚠️ ' + state.syncError;
  else if (state.lastSync) txt = '🟢 Sincronizado ' + state.lastSync.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  else txt = '☁️ Pendiente de sincronizar.';
  pill.textContent = txt;
  $('acc-status').textContent = txt;
}

function scheduleSync(delay = 3000) {
  clearTimeout(syncDebounce);
  syncDebounce = setTimeout(() => doSync(false), delay);
}

async function doSync(manual) {
  if (!cloud.isConfigured() || !state.user || !vault.isUnlocked() || state.syncing) return;
  if (state.syncPaused && !manual) return;
  state.syncing = true; state.syncError = ''; renderSyncUI();
  try {
    const r = await vault.syncNow(state.user.id, askPassword);
    state.lastSync = new Date(); state.syncPaused = false;
    if (r === 'fusionado') { render(); if (manual) toast('Cambios de la nube fusionados'); }
  } catch (e) {
    if (e.message === 'CANCELLED') { state.syncPaused = true; state.syncError = 'Sincronización en pausa (cancelaste la contraseña).'; }
    else if (e.message === 'BAD_PASSWORD') { state.syncPaused = true; state.syncError = 'No se pudo descifrar la bóveda de la nube con esa contraseña.'; }
    else state.syncError = e.message;
  } finally { state.syncing = false; renderSyncUI(); }
}

async function auth(kind) {
  const err = $('acc-err'); err.textContent = '';
  const email = $('acc-email').value.trim(), pw = $('acc-pw').value;
  if (!email || pw.length < 6) { err.textContent = 'Escribe tu correo y una contraseña de al menos 6 caracteres.'; return; }
  try {
    if (kind === 'up') {
      const { user, needsConfirmation } = await cloud.signUp(email, pw);
      if (needsConfirmation) { err.textContent = 'Cuenta creada. Confirma tu correo y luego pulsa “Iniciar sesión”.'; return; }
      state.user = user;
    } else state.user = await cloud.signIn(email, pw);
    $('acc-pw').value = '';
    renderSyncUI();
    doSync(true);
  } catch (e) { err.textContent = e.message; }
}
$('form-account').addEventListener('submit', (ev) => { ev.preventDefault(); auth('in'); });
$('acc-signup').addEventListener('click', () => auth('up'));
$('acc-sync').addEventListener('click', () => { state.syncPaused = false; doSync(true); });
$('acc-signout').addEventListener('click', async () => { await cloud.signOut(); state.user = null; state.lastSync = null; renderSyncUI(); toast('Sesión cerrada. Tus datos siguen en este dispositivo.'); });

// ---------- arranque ----------
function boot() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!crypto?.subtle) {
    document.body.textContent = 'Este navegador no soporta Web Crypto o la página no se abrió por HTTPS/localhost.';
    return;
  }
  showLock(vault.hasVault() ? 'unlock' : 'setup');
  if (cloud.isConfigured()) cloud.onAuthChange((u) => { state.user = u; renderSyncUI(); if (u && vault.isUnlocked()) scheduleSync(300); });
}
boot();
