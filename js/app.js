// Interfaz de Bóveda. Toda la lógica sensible vive en crypto.js / vault.js.
import * as vault from './vault.js';
import * as cloud from './sync.js';
import { generate, strength } from './gen.js';
import { createDoor } from './ui/dial.js';
import { esc, icon, safeUrl, hueIdx, initial, ago, pwHTML, catIconName } from './ui/util.js';

const $ = (id) => document.getElementById(id);
const MIN_MASTER = 10;
const HIDDEN_LOCK_MS = 60 * 1000;
const CLIPBOARD_MS = 30 * 1000;
const mobileMQ = window.matchMedia('(max-width: 899px)');

const state = { cat: 'all', view: 'list', q: '', revealed: new Set(), user: null, syncing: false, syncPaused: false, lastSync: null, syncError: '', editing: null, sel: null, confirmDel: false, genAuto: false };
let idleTimer = null, hiddenTimer = null, hiddenAt = 0, syncDebounce = null, syncInterval = null, pillTimer = null, clipTimer = null, toastTimer = null, toastTick = null, openTimer = null, failedUnlocks = 0;
const door = createDoor($('door'));

// ---------- avisos ----------
function hideToast() { clearTimeout(toastTimer); clearInterval(toastTick); $('toast').classList.remove('show'); }
function toast(msg, secs = 0) {
  const t = $('toast');
  clearTimeout(toastTimer); clearInterval(toastTick);
  const txt = document.createElement('span');
  const lead = secs ? '<svg class="ring" viewBox="0 0 24 24" aria-hidden="true"><circle class="ring-bg" cx="12" cy="12" r="9"/><circle class="ring-fg" cx="12" cy="12" r="9"/></svg>' : icon('check', 'ok');
  t.innerHTML = lead;
  t.appendChild(txt);
  t.insertAdjacentHTML('beforeend', `<button class="icon-btn" type="button" aria-label="Cerrar aviso">${icon('x')}</button>`);
  t.querySelector('button').addEventListener('click', hideToast);
  if (secs) {
    t.querySelector('.ring-fg').style.animationDuration = secs + 's';
    let left = secs;
    txt.textContent = msg(left);
    toastTick = setInterval(() => { left--; if (left > 0) txt.textContent = msg(left); }, 1000);
  } else txt.textContent = msg;
  t.classList.add('show');
  toastTimer = setTimeout(hideToast, (secs || 2.6) * 1000);
}

function setMeter(el, labelEl, pw) {
  const s = strength(pw);
  el.dataset.s = s.score;
  if (labelEl) labelEl.textContent = pw ? `Fuerza: ${s.label.toLowerCase()} · ~${s.bits} bits` : '';
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
    toast((n) => `Contraseña copiada · se borra en ${n} s`, CLIPBOARD_MS / 1000);
  } else toast('Usuario copiado');
}

const cats = () => vault.liveCategories();
const catName = (id) => (cats().find((c) => c.id === id) || cats().find((c) => c.id === 'general') || { name: 'General' }).name;
const catIco = (id) => catIconName(cats().some((c) => c.id === id) ? id : 'general');

// ---------- bloqueo / desbloqueo ----------
function showLock(mode, msg) {
  clearTimeout(openTimer);
  const lock = $('lock');
  lock.classList.remove('opening');
  door.clear();
  $('app').hidden = true;
  lock.hidden = false;
  for (const f of ['form-setup', 'form-unlock', 'form-cloud']) $(f).hidden = true;
  $('form-' + mode).hidden = false;
  $('btn-have-cloud').hidden = !(mode === 'setup' && cloud.isConfigured());
  for (const i of document.querySelectorAll('#lock input[type=password]')) { i.value = ''; i.classList.remove('invalid'); }
  const err = $('unlock-err');
  err.textContent = msg || '';
  err.classList.toggle('info', !!msg);
  setMeter($('setup-meter'), $('setup-meter-label'), '');
  setTimeout(() => ($(mode === 'setup' ? 'setup-pw' : mode === 'cloud' ? 'cloud-email' : 'unlock-pw')).focus({ preventScroll: true }), 50);
}

function lockNow(reason) {
  if (!vault.isUnlocked()) return;
  vault.lock();
  clearTimeout(idleTimer); clearTimeout(hiddenTimer); clearTimeout(syncDebounce); clearInterval(syncInterval); clearInterval(pillTimer);
  if (clipTimer) { clearTimeout(clipTimer); clipTimer = null; try { navigator.clipboard.writeText('').catch(() => {}); } catch { /* sin portapapeles */ } }
  hideToast(); $('toast').replaceChildren();
  state.revealed.clear(); state.q = ''; state.cat = 'all'; state.view = 'list'; state.editing = null; state.sel = null; state.confirmDel = false;
  for (const d of document.querySelectorAll('dialog[open]')) d.close();
  closeSheet();
  for (const id of ['list', 'cat-nav', 'cat-chips', 'detail-body', 'cat-list', 'e-cat-chips', 'empty']) $(id).replaceChildren();
  $('empty').hidden = true;
  for (const id of ['e-pw', 'e-user', 'e-notes', 'e-site', 'e-url', 'm-old', 'm-new', 'm-new2', 'acc-pw', 'ask-pw']) $(id).value = '';
  for (const id of ['g-out', 's-out']) { $(id).textContent = ''; delete $(id).dataset.v; }
  $('e-pw').type = 'password';
  $('search').value = ''; $('import-msg').textContent = '';
  showLock('unlock', reason || '');
}

function resetIdle() {
  if (!vault.isUnlocked()) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => lockNow('Bloqueada por inactividad. Escribe tu contraseña para volver a entrar.'), vault.getAutolockMin() * 60 * 1000);
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
  const lock = $('lock');
  for (const i of lock.querySelectorAll('input[type=password]')) i.value = '';
  $('app').hidden = false;
  $('set-autolock').value = String(vault.getAutolockMin());
  render();
  resetIdle();
  // La puerta se abre y deja ver la app
  $('app').classList.remove('reveal'); void $('app').offsetWidth; $('app').classList.add('reveal');
  door.open();
  lock.classList.add('opening');
  clearTimeout(openTimer);
  openTimer = setTimeout(() => { lock.hidden = true; lock.classList.remove('opening'); door.clear(); }, 700);
  clearInterval(syncInterval); clearInterval(pillTimer);
  syncInterval = setInterval(() => scheduleSync(0), 60 * 1000);
  pillTimer = setInterval(renderSyncUI, 30 * 1000);
  state.syncPaused = false;
  renderSyncUI();
  if (cloud.isConfigured()) {
    try { state.user = await cloud.getUser(); } catch { state.user = null; }
    renderSyncUI();
    scheduleSync(300);
  }
}

// ---------- análisis "Revisar" (solo en memoria, nunca se guarda) ----------
function analyze() {
  const weak = new Set(), groups = new Map();
  for (const e of vault.liveEntries()) {
    if (!e.password) continue;
    if (strength(e.password).score <= 1) weak.add(e.id);
    if (!groups.has(e.password)) groups.set(e.password, []);
    groups.get(e.password).push(e);
  }
  const rep = [...groups.values()].filter((g) => g.length > 1);
  const repIds = new Set(rep.flat().map((e) => e.id));
  return { weak, rep, repIds, count: new Set([...weak, ...repIds]).size };
}

// ---------- render ----------
const byName = (a, b) => String(a.site_name).localeCompare(String(b.site_name), 'es', { sensitivity: 'base' });
const matches = (e, q) => !q || [e.site_name, e.site_url, e.username, e.notes].some((v) => String(v || '').toLowerCase().includes(q));

function filtered() {
  const q = state.q.trim().toLowerCase();
  return vault.liveEntries()
    .filter((e) => state.cat === 'all' || e.category === state.cat || (state.cat === 'general' && !cats().some((c) => c.id === e.category)))
    .filter((e) => matches(e, q))
    .sort(byName);
}

function navHTML(a) {
  const entries = vault.liveEntries();
  const count = (id) => entries.filter((e) => e.category === id).length;
  const rev = state.view === 'review';
  const btn = (cat, ic, name, n) => `<button class="nav-btn ${!rev && state.cat === cat ? 'active' : ''}" type="button" data-cat="${esc(cat)}">${icon(ic)}<span>${esc(name)}</span><span class="n">${n}</span></button>`;
  return btn('all', 'grid', 'Todas', entries.length) + cats().map((c) => btn(c.id, catIco(c.id), c.name, count(c.id))).join('') +
    '<div class="nav-sep"></div>' +
    `<button class="nav-btn review ${rev ? 'active' : ''}" type="button" data-view="review">${icon('shield')}<span>Revisar</span><span class="n">${a.count || ''}</span></button>`;
}
function chipsHTML(a) {
  const rev = state.view === 'review';
  const chip = (cat, ic, name) => `<button class="chip ${!rev && state.cat === cat ? 'active' : ''}" type="button" data-cat="${esc(cat)}">${icon(ic)}${esc(name)}</button>`;
  return chip('all', 'grid', 'Todas') + cats().map((c) => chip(c.id, catIco(c.id), c.name)).join('') +
    `<button class="chip review ${rev ? 'active' : ''}" type="button" data-view="review">${icon('shield')}Revisar${a.count ? ` <span class="n">${a.count}</span>` : ''}</button>`;
}

function itemHTML(e, tag) {
  const url = safeUrl(e.site_url);
  const sub = e.username || (url ? new URL(url).host : '') || catName(e.category);
  return `<div class="item ${state.sel === e.id ? 'sel' : ''}" role="option" tabindex="-1" aria-selected="${state.sel === e.id}" data-id="${esc(e.id)}">
    <span class="mg mg-${hueIdx(e.site_name)}" aria-hidden="true">${esc(initial(e.site_name))}</span>
    <span class="item-txt"><b>${esc(e.site_name)}</b><small>${esc(sub)}</small></span>
    ${tag || ''}
    <span class="item-act">${e.username ? `<button class="act act-user" type="button" data-act="copy-user" aria-label="Copiar usuario de ${esc(e.site_name)}">${icon('user')}</button>` : ''}<button class="act" type="button" data-act="copy-pw" aria-label="Copiar contraseña de ${esc(e.site_name)}">${icon('copy')}</button></span>
  </div>`;
}

function reviewHTML(a) {
  const q = state.q.trim().toLowerCase();
  const weak = vault.liveEntries().filter((e) => a.weak.has(e.id) && matches(e, q)).sort(byName);
  const rep = a.rep.map((g) => g.filter((e) => matches(e, q)).sort(byName)).filter((g) => g.length).sort((x, y) => y.length - x.length);
  if (!weak.length && !rep.length) return '';
  let html = '<p class="sec-p">Estas cuentas conviene cambiarlas. El análisis se hace solo en este dispositivo y no se guarda.</p>';
  if (weak.length) html += `<h2 class="sec-h">Contraseñas débiles <small>${weak.length}</small></h2>` + weak.map((e) => itemHTML(e, '<span class="tag bad">Débil</span>')).join('');
  if (rep.length) {
    html += `<h2 class="sec-h">Repetidas en varios sitios <small>${rep.length} ${rep.length === 1 ? 'grupo' : 'grupos'}</small></h2>`;
    html += rep.map((g, i) => `<p class="sec-p">Grupo ${i + 1}: la misma contraseña en ${g.length} sitios</p>` + g.map((e) => itemHTML(e, '<span class="tag">Repetida</span>')).join('')).join('');
  }
  return html;
}

function emptyHTML(kind) {
  const open = '<button class="btn btn-primary" type="button" data-empty="add">' + icon('plus') + '<span>Agregar cuenta</span></button>';
  if (kind === 'first') return `<div class="empty-ico">${icon('key')}</div><h2>Agrega tu primera cuenta</h2><p>Guarda sitio, usuario y contraseña. Todo se cifra en este dispositivo antes de guardarse.</p>${open}`;
  if (kind === 'review') return `<div class="empty-ico">${icon('shield')}</div><h2>Todo en orden</h2><p>No hay contraseñas débiles ni repetidas en tu bóveda.</p>`;
  return `<div class="empty-ico">${icon('search')}</div><h2>Sin resultados</h2><p>No encontramos cuentas con ese filtro. Prueba con otro nombre o quita la búsqueda.</p><button class="btn btn-ghost" type="button" data-empty="clear">Quitar filtros</button>`;
}

function render() {
  if (!vault.isUnlocked()) return;
  const cs = cats();
  if (state.cat !== 'all' && !cs.some((c) => c.id === state.cat)) state.cat = 'all';
  const focusId = document.activeElement?.closest?.('.item')?.dataset.id;
  const a = analyze();
  const total = vault.liveEntries().length;
  $('cat-nav').innerHTML = navHTML(a);
  $('cat-chips').innerHTML = chipsHTML(a);

  let html, any;
  if (state.view === 'review') { html = reviewHTML(a); any = !!html; }
  else { const list = filtered(); html = list.map((e) => itemHTML(e)).join(''); any = list.length > 0; }
  $('list').innerHTML = html;
  const empty = $('empty');
  empty.hidden = any;
  if (!any) empty.innerHTML = emptyHTML(!total ? 'first' : state.view === 'review' && !state.q ? 'review' : 'none');
  const rows = [...$('list').querySelectorAll('.item')];
  const keep = focusId && rows.find((r) => r.dataset.id === focusId);
  (keep || $('list').querySelector('.item.sel') || rows[0])?.setAttribute('tabindex', '0');
  if (keep) keep.focus({ preventScroll: true });
  if (state.sel && !vault.liveEntries().some((e) => e.id === state.sel)) closeDetail();
  else renderDetail();
}

// ---------- detalle ----------
const entryById = (id) => vault.liveEntries().find((x) => x.id === id);

function renderDetail() {
  const body = $('detail-body');
  const e = state.sel && entryById(state.sel);
  if (!e) {
    body.innerHTML = `<div class="detail-empty"><div class="empty-ico">${icon('key')}</div>Elige una cuenta para ver sus datos.</div>`;
    return;
  }
  const url = safeUrl(e.site_url);
  const s = strength(e.password || '');
  const shown = state.revealed.has(e.id);
  const same = e.password ? vault.liveEntries().filter((x) => x.id !== e.id && x.password === e.password).length : 0;
  const created = e.created_at ? ` · creada ${ago(e.created_at)}` : '';
  const btn = (act, ic, label) => `<button class="act" type="button" data-act="${act}" aria-label="${label}">${icon(ic)}</button>`;
  body.innerHTML = `
    <div class="d-head"><span class="mg mg-${hueIdx(e.site_name)} big" aria-hidden="true">${esc(initial(e.site_name))}</span>
      <div><h2>${esc(e.site_name)}</h2>${url ? `<a class="d-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir sitio${icon('external')}</a>` : (e.site_url ? `<span class="muted">${esc(e.site_url)}</span>` : '')}</div></div>
    ${e.username ? `<div class="fl">Usuario</div><div class="fld"><span class="val">${esc(e.username)}</span>${btn('copy-user', 'copy', 'Copiar usuario')}</div>` : ''}
    <div class="fl">Contraseña</div>
    <div class="fld"><span class="val mono">${e.password ? (shown ? pwHTML(e.password) : '••••••••••••') : '<span class="muted">Sin contraseña</span>'}</span>
      ${e.password ? btn('toggle', shown ? 'eye-off' : 'eye', shown ? 'Ocultar contraseña' : 'Mostrar contraseña') + btn('copy-pw', 'copy', 'Copiar contraseña') : ''}</div>
    ${e.password ? `<div class="d-str"><div class="meter" data-s="${s.score}"><i></i><i></i><i></i><i></i></div><small>Fuerza: ${esc(s.label.toLowerCase())}</small></div>` : ''}
    ${s.score <= 1 && e.password ? `<div class="d-warn">${icon('alert')}<span>Esta contraseña es débil. Genera una nueva desde Editar.</span></div>` : ''}
    ${same ? `<div class="d-warn">${icon('alert')}<span>La misma contraseña está en ${same} ${same === 1 ? 'sitio más' : 'sitios más'}. Usa una distinta en cada cuenta.</span></div>` : ''}
    ${e.notes ? `<div class="fl">Notas</div><div class="d-notes">${esc(e.notes)}</div>` : ''}
    <div class="d-meta"><span class="d-cat">${icon(catIco(e.category))}${esc(catName(e.category))}</span><span>Editado ${esc(ago(e.updated_at))}${esc(created)}</span></div>
    ${state.confirmDel
      ? `<div class="d-confirm"><p>¿Eliminar esta cuenta? Se borrará también en tus otros dispositivos.</p><div class="row"><button class="btn btn-ghost grow" type="button" data-act="cancel-del">Cancelar</button><button class="btn btn-danger solid grow" type="button" data-act="confirm-del">Eliminar</button></div></div>`
      : `<div class="d-actions"><button class="btn btn-ghost" type="button" data-act="edit">${icon('edit')}<span>Editar</span></button><button class="btn btn-danger" type="button" data-act="ask-del">${icon('trash')}<span>Eliminar</span></button></div>`}`;
}

function openSheet() {
  if (!mobileMQ.matches) return;
  $('detail').classList.add('open');
  $('backdrop').hidden = false;
  $('detail-close').focus({ preventScroll: true });
}
function closeSheet() { $('detail').classList.remove('open'); $('detail').style.transform = ''; $('backdrop').hidden = true; }

function markSel() {
  for (const r of $('list').querySelectorAll('.item')) { const on = r.dataset.id === state.sel; r.classList.toggle('sel', on); r.setAttribute('aria-selected', on); }
}
function selectEntry(id) {
  state.sel = id; state.confirmDel = false;
  markSel(); renderDetail(); openSheet();
}
function closeDetail() {
  const prev = state.sel;
  state.sel = null; state.confirmDel = false;
  closeSheet(); markSel(); renderDetail();
  if (prev) $('list').querySelector(`.item[data-id="${CSS.escape(prev)}"]`)?.focus({ preventScroll: true });
}

$('detail-body').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-act]');
  const e = state.sel && entryById(state.sel);
  if (!btn || !e) return;
  const act = btn.dataset.act;
  if (act === 'copy-user') copyText(e.username, 'user');
  else if (act === 'copy-pw') copyText(e.password, 'pw');
  else if (act === 'edit') openEntry(e.id);
  else if (act === 'ask-del') { state.confirmDel = true; renderDetail(); }
  else if (act === 'cancel-del') { state.confirmDel = false; renderDetail(); }
  else if (act === 'confirm-del') {
    const id = e.id;
    state.revealed.delete(id);
    state.sel = null; state.confirmDel = false; closeSheet();
    await mutate(vault.deleteEntry(id));
    toast('Cuenta eliminada');
  } else if (act === 'toggle') {
    const id = e.id;
    if (state.revealed.has(id)) state.revealed.delete(id);
    else { state.revealed.add(id); setTimeout(() => { state.revealed.delete(id); if (state.sel === id) renderDetail(); }, 20000); }
    renderDetail();
  }
});
$('detail-close').addEventListener('click', closeDetail);
$('backdrop').addEventListener('click', closeDetail);

// ---------- formulario de cuenta ----------
function renderCatChips(sel) {
  $('e-cat').value = sel;
  $('e-cat-chips').innerHTML = cats().map((c) => `<button class="cchip" type="button" role="radio" aria-checked="${c.id === sel}" data-id="${esc(c.id)}">${icon(catIconName(c.id))}${esc(c.name)}</button>`).join('');
}
$('e-cat-chips').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-id]'); if (!b) return;
  renderCatChips(b.dataset.id);
  $('e-cat-chips').querySelector(`[data-id="${CSS.escape(b.dataset.id)}"]`).focus();
});

function setPwToggle(show) {
  $('e-pw').type = show ? 'text' : 'password';
  $('e-toggle').innerHTML = icon(show ? 'eye-off' : 'eye');
  $('e-toggle').setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
}
function setGenPanel(open) {
  $('gen-panel').hidden = !open;
  $('e-gen-toggle').setAttribute('aria-expanded', String(open));
  if (open) formGen.regen();
}

function openEntry(id) {
  const e = id ? entryById(id) : null;
  state.editing = e ? e.id : null;
  $('entry-title').textContent = e ? 'Editar cuenta' : 'Nueva cuenta';
  renderCatChips(e?.category && cats().some((c) => c.id === e.category) ? e.category : (state.view === 'list' && state.cat !== 'all' ? state.cat : 'general'));
  $('e-site').value = e?.site_name || '';
  $('e-url').value = e?.site_url || '';
  $('e-user').value = e?.username || '';
  $('e-pw').value = e?.password || '';
  setPwToggle(false);
  $('e-notes').value = e?.notes || '';
  $('entry-err').textContent = '';
  state.genAuto = !e;
  setGenPanel(!e);
  if (!e) { $('e-pw').value = formGen.value(); setPwToggle(true); }
  setMeter($('e-meter'), $('e-meter-label'), $('e-pw').value);
  $('dlg-entry').showModal();
  $('e-site').focus();
}

async function mutate(promise) {
  await promise;
  render();
  renderSyncUI();
  scheduleSync(3000);
}

$('form-entry').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const site = $('e-site').value.trim();
  if (!site) { $('entry-err').textContent = 'Escribe el nombre del sitio o app para poder guardarla.'; $('e-site').focus(); return; }
  const entry = {
    site_name: site, site_url: $('e-url').value.trim(), username: $('e-user').value.trim(),
    password: $('e-pw').value, category: $('e-cat').value || 'general', notes: $('e-notes').value.trim(),
  };
  const isNew = !state.editing;
  entry.id = state.editing || crypto.randomUUID();
  if (isNew) { state.cat = 'all'; state.view = 'list'; state.q = ''; $('search').value = ''; }
  await mutate(vault.upsertEntry(entry));
  $('dlg-entry').close();
  if (isNew) selectEntry(entry.id);
  toast(isNew ? 'Cuenta guardada' : 'Cambios guardados');
});
$('e-toggle').addEventListener('click', () => setPwToggle($('e-pw').type === 'password'));
$('e-pw').addEventListener('input', () => { state.genAuto = false; setMeter($('e-meter'), $('e-meter-label'), $('e-pw').value); });
$('e-gen-toggle').addEventListener('click', () => setGenPanel($('gen-panel').hidden));

// Generador (formulario y hoja independiente comparten lógica)
function makeGen(p, onGen) {
  const g = (s) => $(p + s);
  const opts = () => ({ length: +g('len').value, lower: g('lower').checked, upper: g('upper').checked, digits: g('digits').checked, symbols: g('symbols').checked });
  function regen() {
    g('len-val').textContent = g('len').value;
    const v = generate(opts());
    g('out').dataset.v = v;
    if (v) g('out').innerHTML = pwHTML(v); else g('out').textContent = 'Elige al menos un tipo de carácter.';
    setMeter(g('meter'), g('meter-label'), v);
    onGen?.(v);
  }
  for (const s of ['len', 'lower', 'upper', 'digits', 'symbols']) g(s).addEventListener('input', regen);
  g('regen').addEventListener('click', regen);
  return { regen, value: () => { if (!g('out').dataset.v) regen(); return g('out').dataset.v || ''; } };
}
const formGen = makeGen('g-', (v) => {
  if (state.genAuto && v) { $('e-pw').value = v; setMeter($('e-meter'), $('e-meter-label'), v); }
});
$('g-use').addEventListener('click', () => {
  const v = formGen.value();
  if (!v) return;
  $('e-pw').value = v; setPwToggle(true); state.genAuto = false;
  setMeter($('e-meter'), $('e-meter-label'), v);
  toast('Contraseña aplicada al formulario');
});
const sheetGen = makeGen('s-');
function openGenerator() { sheetGen.regen(); $('dlg-gen').showModal(); }
$('s-copy').addEventListener('click', () => { const v = sheetGen.value(); if (v) copyText(v, 'pw'); });

// ---------- lista: clics y teclado ----------
$('list').addEventListener('click', (ev) => {
  const row = ev.target.closest('.item'); if (!row) return;
  const e = entryById(row.dataset.id); if (!e) return;
  const act = ev.target.closest('[data-act]')?.dataset.act;
  if (act === 'copy-user') copyText(e.username, 'user');
  else if (act === 'copy-pw') copyText(e.password, 'pw');
  else selectEntry(e.id);
});
$('list').addEventListener('keydown', (ev) => {
  const rows = [...$('list').querySelectorAll('.item')];
  const cur = ev.target.closest?.('.item');
  const i = rows.indexOf(cur);
  const go = (n) => { if (!rows[n]) return; for (const r of rows) r.tabIndex = -1; rows[n].tabIndex = 0; rows[n].focus(); ev.preventDefault(); };
  if (ev.key === 'ArrowDown') go(i < 0 ? 0 : Math.min(i + 1, rows.length - 1));
  else if (ev.key === 'ArrowUp') go(i < 0 ? 0 : Math.max(i - 1, 0));
  else if (ev.key === 'Home') go(0);
  else if (ev.key === 'End') go(rows.length - 1);
  else if (cur && ev.key === 'Enter' && ev.target === cur) { selectEntry(cur.dataset.id); ev.preventDefault(); }
  else if (cur && (ev.key === 'c' || ev.key === 'C') && !ev.ctrlKey && !ev.metaKey) { const e = entryById(cur.dataset.id); if (e?.password) copyText(e.password, 'pw'); }
});
$('empty').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-empty]'); if (!b) return;
  if (b.dataset.empty === 'add') openEntry(null);
  else { state.q = ''; $('search').value = ''; state.cat = 'all'; state.view = 'list'; render(); }
});
for (const id of ['cat-nav', 'cat-chips']) $(id).addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-cat],[data-view]');
  if (!b) return;
  if (b.dataset.view) state.view = b.dataset.view; else { state.view = 'list'; state.cat = b.dataset.cat; }
  if (mobileMQ.matches) closeSheet();
  render();
});
$('search').addEventListener('input', (ev) => { state.q = ev.target.value; render(); });
$('search').addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') { if ($('search').value) { $('search').value = ''; state.q = ''; render(); } else $('search').blur(); ev.stopPropagation(); }
  else if (ev.key === 'ArrowDown') { const r = $('list').querySelector('.item'); if (r) { r.focus(); ev.preventDefault(); } }
});
$('btn-add').addEventListener('click', () => openEntry(null));
$('fab').addEventListener('click', () => openEntry(null));
for (const id of ['btn-lock', 'tab-lock']) $(id).addEventListener('click', () => lockNow(''));
for (const id of ['btn-settings', 'tab-settings']) $(id).addEventListener('click', openSettings);
for (const id of ['btn-gen', 'tab-gen']) $(id).addEventListener('click', openGenerator);
$('tab-home').addEventListener('click', () => { state.view = 'list'; state.cat = 'all'; closeSheet(); render(); scrollTo({ top: 0 }); });
document.addEventListener('click', (ev) => { const c = ev.target.closest('[data-close]'); if (c) c.closest('dialog').close(); });
document.addEventListener('keydown', (ev) => {
  if (!vault.isUnlocked()) return;
  const tag = document.activeElement?.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  if (ev.key === '/' && !typing && !document.querySelector('dialog[open]') && !ev.ctrlKey && !ev.metaKey) { ev.preventDefault(); $('search').focus(); }
  else if (ev.key === 'Escape' && state.sel && !document.querySelector('dialog[open]')) closeDetail();
});

// Hojas inferiores: cerrar deslizando hacia abajo
function enableSwipe(sheet, grip, onClose) {
  let y0 = 0, dy = 0, on = false;
  grip.addEventListener('pointerdown', (e) => { if (!mobileMQ.matches) return; on = true; y0 = e.clientY; dy = 0; grip.setPointerCapture(e.pointerId); sheet.classList.add('dragging'); });
  grip.addEventListener('pointermove', (e) => { if (!on) return; dy = Math.max(0, e.clientY - y0); sheet.style.transform = `translateY(${dy}px)`; });
  const end = () => { if (!on) return; on = false; sheet.classList.remove('dragging'); const close = dy > 90; sheet.style.transform = ''; if (close) onClose(); };
  grip.addEventListener('pointerup', end); grip.addEventListener('pointercancel', end);
}
enableSwipe($('detail'), $('detail').querySelector('[data-grip]'), closeDetail);
for (const d of document.querySelectorAll('dialog.sheet-dlg')) { const g = d.querySelector('[data-grip]'); if (g) enableSwipe(d, g, () => d.close()); }

// ---------- contraseña maestra: crear / desbloquear ----------
for (const id of ['setup-pw', 'setup-pw2', 'unlock-pw']) $(id).addEventListener('input', () => { door.turn(); $(id).classList.remove('invalid'); });
$('setup-pw').addEventListener('input', () => setMeter($('setup-meter'), $('setup-meter-label'), $('setup-pw').value));
$('form-setup').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const a = $('setup-pw').value, b = $('setup-pw2').value, err = $('setup-err');
  err.textContent = '';
  if (a.length < MIN_MASTER) { err.textContent = `La contraseña maestra necesita al menos ${MIN_MASTER} caracteres. Agrega ${MIN_MASTER - a.length} más.`; door.shake(); return; }
  if (a !== b) { err.textContent = 'Las dos contraseñas no coinciden. Escríbelas de nuevo.'; $('setup-pw2').classList.add('invalid'); door.shake(); return; }
  const btn = ev.submitter; btn.disabled = true; btn.textContent = 'Cifrando…';
  try { await vault.create(a); await enterApp(); }
  catch (e) { err.textContent = 'No se pudo crear la bóveda: ' + e.message + '. Inténtalo otra vez.'; door.shake(); }
  finally { btn.disabled = false; btn.textContent = 'Crear bóveda'; }
});

$('form-unlock').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('unlock-btn'), err = $('unlock-err');
  err.textContent = ''; err.classList.remove('info'); btn.disabled = true; btn.textContent = 'Descifrando…';
  try {
    if (failedUnlocks >= 3) await new Promise((r) => setTimeout(r, Math.min(failedUnlocks - 2, 10) * 1000)); // freno ante intentos repetidos
    await vault.unlock($('unlock-pw').value);
    $('unlock-pw').value = '';
    await enterApp();
  } catch (e) {
    failedUnlocks++;
    err.textContent = e.message === 'BAD_PASSWORD' ? 'Contraseña maestra incorrecta. Revisa mayúsculas y vuelve a intentarlo.' : 'No se pudo abrir la bóveda: ' + e.message + '. Recarga la página e inténtalo de nuevo.';
    $('unlock-pw').classList.add('invalid');
    door.shake();
    $('unlock-pw').select();
  } finally { btn.disabled = false; btn.textContent = 'Abrir bóveda'; }
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
function renderThemeUI() {
  const p = window.bovedaTheme?.pref() || 'system', r = window.bovedaTheme?.resolved() || 'dark';
  for (const b of $('theme-seg').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.themeV === p));
  $('theme-label').textContent = r === 'dark' ? 'Modo claro' : 'Modo oscuro';
}
function setTheme(v) { window.bovedaTheme?.set(v); renderThemeUI(); }
$('theme-seg').addEventListener('click', (ev) => { const b = ev.target.closest('[data-theme-v]'); if (b) setTheme(b.dataset.themeV); });
$('btn-theme').addEventListener('click', () => setTheme(window.bovedaTheme.resolved() === 'dark' ? 'light' : 'dark'));
matchMedia('(prefers-color-scheme: light)').addEventListener('change', renderThemeUI);

function openSettings() {
  renderSyncUI();
  renderCatList();
  renderThemeUI();
  $('set-autolock').value = String(vault.getAutolockMin());
  $('form-master').hidden = true;
  $('import-msg').textContent = '';
  $('acc-err').textContent = '';
  $('dlg-settings').showModal();
}

function renderCatList() {
  $('cat-list').innerHTML = cats().map((c) => `<div class="cat-row" data-id="${esc(c.id)}">
    ${icon(catIconName(c.id))}
    <input class="input" value="${esc(c.name)}" maxlength="40" data-f="name" aria-label="Nombre de la categoría">
    ${c.id === 'general' ? '' : `<button class="icon-btn" type="button" data-del aria-label="Eliminar categoría ${esc(c.name)}">${icon('trash')}</button>`}</div>`).join('');
}
$('cat-list').addEventListener('change', async (ev) => {
  const row = ev.target.closest('.cat-row'); if (!row) return;
  const c = cats().find((x) => x.id === row.dataset.id); if (!c) return;
  const name = row.querySelector('[data-f=name]').value.trim() || c.name;
  await mutate(vault.upsertCategory({ id: c.id, name }));
});
$('cat-list').addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-del]'); if (!b) return;
  const id = b.closest('.cat-row').dataset.id;
  if (!confirm('¿Eliminar la categoría? Sus cuentas pasarán a “General”.')) return;
  await mutate(vault.deleteCategory(id));
  renderCatList();
});
$('form-cat').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const name = $('cat-name').value.trim(); if (!name) return;
  await mutate(vault.upsertCategory({ name, icon: '' }));
  $('cat-name').value = '';
  renderCatList();
});

$('set-autolock').addEventListener('change', async (ev) => { await mutate(vault.setSettings({ autolock: +ev.target.value })); resetIdle(); toast('Ajuste guardado'); });

$('btn-change-master').addEventListener('click', () => { $('form-master').hidden = !$('form-master').hidden; });
$('m-new').addEventListener('input', () => setMeter($('m-meter'), null, $('m-new').value));
$('form-master').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const err = $('m-err'); err.textContent = '';
  const n = $('m-new').value;
  if (n.length < MIN_MASTER) { err.textContent = `La nueva contraseña necesita al menos ${MIN_MASTER} caracteres.`; return; }
  if (n !== $('m-new2').value) { err.textContent = 'Las contraseñas nuevas no coinciden. Escríbelas de nuevo.'; return; }
  const btn = ev.submitter; btn.disabled = true; btn.textContent = 'Recifrando…';
  try {
    await vault.changeMaster($('m-old').value, n);
    for (const id of ['m-old', 'm-new', 'm-new2']) $(id).value = '';
    $('form-master').hidden = true;
    toast('Contraseña maestra cambiada');
    scheduleSync(500);
  } catch (e) { err.textContent = e.message === 'BAD_PASSWORD' ? 'La contraseña actual no es correcta. Revísala e inténtalo otra vez.' : e.message; }
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
    if (file.size > 20 * 1024 * 1024) throw new Error('El archivo es demasiado grande (máximo 20 MB).');
    const obj = JSON.parse(await file.text());
    if (Array.isArray(obj) || Array.isArray(obj?.entries) || Array.isArray(obj?.passwords)) {
      const n = await vault.importLegacy(obj);
      msg.textContent = `Se importaron ${n} cuentas de la versión vieja.`;
    } else {
      const n = await vault.importBackup(obj, askPassword);
      msg.textContent = `Respaldo fusionado (${n >= 0 ? '+' : ''}${n} cuentas).`;
    }
    render(); renderCatList(); renderSyncUI(); scheduleSync(3000);
  } catch (e) {
    msg.textContent = e.message === 'CANCELLED' ? 'Importación cancelada.' : e.message === 'BAD_PASSWORD' ? 'Contraseña incorrecta: no se pudo abrir el respaldo. Prueba con la que usabas al exportarlo.' : 'No se pudo importar: ' + e.message;
  }
});

// ---------- sincronización ----------
function syncInfo() {
  if (!cloud.isConfigured() || !state.user) return { k: 'local', ic: 'cloud-off', text: 'Solo en este dispositivo' };
  if (state.syncing) return { k: 'busy', ic: 'refresh', text: 'Sincronizando…', spin: true };
  if (!navigator.onLine) return { k: 'err', ic: 'cloud-off', text: 'Sin conexión' };
  if (state.syncError) return { k: 'err', ic: 'alert', text: 'No se pudo sincronizar', title: state.syncError };
  if (vault.getMeta().dirty) return { k: 'dirty', ic: 'cloud', text: 'Cambios sin subir' };
  if (state.lastSync) return { k: 'ok', ic: 'check', text: 'Sincronizado ' + ago(state.lastSync.getTime()) };
  return { k: 'dirty', ic: 'cloud', text: 'Pendiente de sincronizar' };
}

function renderSyncUI() {
  const on = cloud.isConfigured();
  $('sync-off').hidden = on;
  $('sync-out').hidden = !on || !!state.user;
  $('sync-in').hidden = !on || !state.user;
  if (state.user) $('acc-user').textContent = state.user.email || state.user.id;
  const s = syncInfo();
  const pill = $('sync-pill');
  pill.dataset.k = s.k;
  pill.classList.toggle('spin', !!s.spin);
  pill.innerHTML = `${icon(s.ic)}<span class="t">${esc(s.text)}</span>`;
  pill.title = s.title || s.text;
  pill.setAttribute('aria-label', (s.title || s.text) + (s.k === 'local' ? '. Abrir ajustes' : '. Sincronizar ahora'));
  $('acc-status').textContent = s.title || s.text;
}
$('sync-pill').addEventListener('click', () => {
  if (cloud.isConfigured() && state.user) { state.syncPaused = false; doSync(true); }
  else openSettings();
});
addEventListener('online', () => { renderSyncUI(); scheduleSync(500); });
addEventListener('offline', renderSyncUI);

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
    if (e.message === 'CANCELLED') { state.syncPaused = true; state.syncError = 'Sincronización en pausa: cancelaste la contraseña. Toca el estado para reintentar.'; }
    else if (e.message === 'BAD_PASSWORD') { state.syncPaused = true; state.syncError = 'No se pudo descifrar la bóveda de la nube con esa contraseña. Toca el estado para reintentar.'; }
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
  renderThemeUI();
  showLock(vault.hasVault() ? 'unlock' : 'setup');
  if (cloud.isConfigured()) cloud.onAuthChange((u) => { state.user = u; renderSyncUI(); if (u && vault.isUnlocked()) scheduleSync(300); });
}
boot();
