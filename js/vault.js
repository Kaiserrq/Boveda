// Bóveda: datos en memoria (solo mientras está desbloqueada), cifrado/almacenamiento local,
// fusión entre dispositivos y sincronización del bloque cifrado.
// A localStorage y a Supabase SOLO llega el bloque cifrado { v, salt, iter, iv, ct }.
import { ITERATIONS, deriveKey, encryptJSON, decryptJSON, randomBytes, b64, unb64, isBlob, cleanBlob } from './crypto.js';
import * as cloud from './sync.js';

const BLOB_KEY = 'boveda.blob';
const META_KEY = 'boveda.meta'; // { updated_at, synced_at, dirty }: fechas y una bandera, nada secreto
const EPOCH = '2020-01-01T00:00:00.000Z';

export const DEFAULT_CATEGORIES = [
  { id: 'general', name: 'General', icon: '🔑' },
  { id: 'social', name: 'Redes sociales', icon: '👥' },
  { id: 'trabajo', name: 'Trabajo', icon: '💼' },
  { id: 'banco', name: 'Banco', icon: '💳' },
  { id: 'apps', name: 'Otras apps', icon: '📱' },
];

let session = null; // { key, salt: Uint8Array, iter }
let data = null;    // { entries, categories, settings }
let queue = Promise.resolve();
const run = (fn) => (queue = queue.then(fn, fn));

const now = () => new Date().toISOString();
const ts = (s) => { const t = Date.parse(s); return Number.isNaN(t) ? 0 : t; };
const newData = () => ({
  v: 1,
  entries: [],
  categories: DEFAULT_CATEGORIES.map((c) => ({ ...c, updated_at: EPOCH })),
  settings: { autolock: 5, updated_at: EPOCH },
});

// ---------- almacenamiento local (solo cifrado) ----------
function readBlob() {
  try { const b = JSON.parse(localStorage.getItem(BLOB_KEY)); return isBlob(b) ? b : null; } catch { return null; }
}
function readMeta() {
  try { return { updated_at: null, synced_at: null, dirty: false, ...JSON.parse(localStorage.getItem(META_KEY) || '{}') }; } catch { return { updated_at: null, synced_at: null, dirty: false }; }
}
const writeMeta = (patch) => localStorage.setItem(META_KEY, JSON.stringify({ ...readMeta(), ...patch }));

export const hasVault = () => !!readBlob();
export const isUnlocked = () => !!session && !!data;
export const getData = () => data;
export const getMeta = readMeta;
export const getAutolockMin = () => data?.settings?.autolock ?? 5;

/** Guarda en este dispositivo el bloque cifrado que vino de la nube (primer uso en un dispositivo nuevo). */
export function adoptCloudBlob(blob, updatedAt) {
  if (!isBlob(blob)) throw new Error('El bloque de la nube no es válido.');
  localStorage.setItem(BLOB_KEY, JSON.stringify(cleanBlob(blob)));
  writeMeta({ updated_at: updatedAt, synced_at: updatedAt, dirty: false });
}

async function persist(markDirty = true) {
  const blob = await encryptJSON(session.key, session.salt, session.iter, data); // IV nuevo en cada guardado
  localStorage.setItem(BLOB_KEY, JSON.stringify(blob));
  writeMeta(markDirty ? { updated_at: now(), dirty: true } : {});
  return blob;
}

// ---------- ciclo de vida ----------
export async function create(password) {
  const salt = randomBytes(16);
  session = { key: await deriveKey(password, salt, ITERATIONS), salt, iter: ITERATIONS };
  data = newData();
  await persist();
}

export async function unlock(password) {
  const blob = readBlob();
  if (!blob) throw new Error('NO_VAULT');
  const salt = unb64(blob.salt);
  const key = await deriveKey(password, salt, blob.iter);
  let d;
  try { d = await decryptJSON(key, blob); } catch { throw new Error('BAD_PASSWORD'); }
  session = { key, salt, iter: blob.iter };
  data = normalize(d);
  if (blob.iter !== ITERATIONS) { // bloque antiguo con menos iteraciones: se recifra con 600000
    const salt2 = randomBytes(16);
    session = { key: await deriveKey(password, salt2, ITERATIONS), salt: salt2, iter: ITERATIONS };
    await run(() => persist(true));
  }
}

export function lock() {
  session = null;
  data = null;
}

function normalize(d) {
  const out = { ...newData(), ...d };
  out.entries = Array.isArray(d.entries) ? d.entries.filter((x) => x && typeof x.id === 'string') : [];
  out.categories = Array.isArray(d.categories) && d.categories.some((x) => x && typeof x.id === 'string') ? d.categories.filter((x) => x && typeof x.id === 'string') : newData().categories;
  out.settings = { ...newData().settings, ...(d.settings || {}) };
  return out;
}

// ---------- operaciones (todas guardan cifrado) ----------
const uuid = () => crypto.randomUUID();
const commit = () => run(() => persist(true));

export function upsertEntry(e) {
  const t = now();
  const i = data.entries.findIndex((x) => x.id === e.id);
  if (i >= 0) data.entries[i] = { ...data.entries[i], ...e, updated_at: t, deleted: false };
  else data.entries.push({ icon: '', category: 'general', notes: '', site_url: '', ...e, id: e.id || uuid(), created_at: t, updated_at: t });
  return commit();
}

export function deleteEntry(id) {
  const i = data.entries.findIndex((x) => x.id === id);
  if (i < 0) return;
  // Tombstone: se conserva solo el id y las fechas, sin ningún dato sensible.
  data.entries[i] = { id, deleted: true, created_at: data.entries[i].created_at, updated_at: now() };
  return commit();
}

export function upsertCategory(c) {
  const t = now();
  const i = data.categories.findIndex((x) => x.id === c.id);
  if (i >= 0) data.categories[i] = { ...data.categories[i], ...c, updated_at: t, deleted: false };
  else data.categories.push({ icon: '📁', ...c, id: c.id || uuid(), updated_at: t });
  return commit();
}

export function deleteCategory(id) {
  if (id === 'general') return;
  const t = now();
  data.entries.forEach((e) => { if (!e.deleted && e.category === id) { e.category = 'general'; e.updated_at = t; } });
  const i = data.categories.findIndex((x) => x.id === id);
  if (i >= 0) data.categories[i] = { id, deleted: true, updated_at: t };
  return commit();
}

export function setSettings(patch) {
  data.settings = { ...data.settings, ...patch, updated_at: now() };
  return commit();
}

/** Entradas y categorías visibles (sin tombstones). */
export const liveEntries = () => data.entries.filter((e) => !e.deleted);
export const liveCategories = () => data.categories.filter((c) => !c.deleted);

// ---------- fusión por id (gana el updated_at mayor) ----------
function mergeList(a, b) {
  const map = new Map();
  for (const x of [...a, ...b]) {
    if (!x || typeof x.id !== 'string') continue;
    const cur = map.get(x.id);
    if (!cur || ts(x.updated_at) > ts(cur.updated_at)) map.set(x.id, x);
  }
  return [...map.values()];
}
export function mergeData(local, remote) {
  const l = normalize(local), r = normalize(remote);
  return {
    v: 1,
    entries: mergeList(l.entries, r.entries),
    categories: mergeList(l.categories, r.categories),
    settings: ts(r.settings.updated_at) > ts(l.settings.updated_at) ? r.settings : l.settings,
  };
}

// ---------- contraseña maestra ----------
export async function verifyPassword(password) {
  const blob = readBlob();
  if (!blob) return false;
  try { await decryptJSON(await deriveKey(password, unb64(blob.salt), blob.iter), blob); return true; } catch { return false; }
}

/** Recifra todo con un salt nuevo. */
export async function changeMaster(oldPw, newPw) {
  if (!(await verifyPassword(oldPw))) throw new Error('BAD_PASSWORD');
  const salt = randomBytes(16);
  const next = { key: await deriveKey(newPw, salt, ITERATIONS), salt, iter: ITERATIONS };
  const prev = session;
  await run(async () => {
    session = next;
    try { await persist(true); } catch (e) { session = prev; throw e; }
  });
}

// ---------- respaldo ----------
export function exportBackup() {
  const blob = readBlob();
  return { app: 'boveda', exported_at: now(), ...blob };
}

/** Descifra un bloque ajeno (respaldo o nube). Si usa otra clave, pide la contraseña con askPassword(msg). */
async function decryptForeign(blob, askPassword) {
  if (!isBlob(blob)) throw new Error('El archivo no es un respaldo válido de Bóveda.');
  if (b64(session.salt) === blob.salt && session.iter === blob.iter) {
    try { return { d: await decryptJSON(session.key, blob), key: session.key, salt: session.salt, iter: blob.iter }; } catch { /* sigue: pedir contraseña */ }
  }
  let msg = 'Este bloque está cifrado con otra contraseña maestra. Escríbela para continuar.';
  for (let i = 0; i < 3; i++) {
    const pw = await askPassword(msg);
    if (pw == null) throw new Error('CANCELLED');
    const salt = unb64(blob.salt);
    const key = await deriveKey(pw, salt, blob.iter);
    try { return { d: await decryptJSON(key, blob), key, salt, iter: blob.iter }; } catch { msg = 'Contraseña incorrecta. Inténtalo de nuevo.'; }
  }
  throw new Error('BAD_PASSWORD');
}

export async function importBackup(obj, askPassword) {
  const { d } = await decryptForeign(obj, askPassword);
  const before = liveEntries().length;
  data = mergeData(data, d);
  await commit();
  return liveEntries().length - before;
}

/** Importa el JSON de la versión vieja (array de entradas). Devuelve cuántas se agregaron. */
export async function importLegacy(list) {
  const arr = Array.isArray(list) ? list : Array.isArray(list?.entries) ? list.entries : Array.isArray(list?.passwords) ? list.passwords : null;
  if (!arr) throw new Error('El archivo no tiene un array de entradas.');
  const str = (v) => (v == null ? '' : String(v));
  const catId = (raw) => {
    const name = str(raw).trim();
    if (!name) return 'general';
    const found = liveCategories().find((c) => c.id === name.toLowerCase() || c.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    const id = uuid();
    data.categories.push({ id, name, icon: '📁', updated_at: now() });
    return id;
  };
  const key = (e) => [e.site_name, e.username, e.password].map((x) => str(x).toLowerCase()).join('\u0000');
  const seen = new Set(liveEntries().map(key));
  let added = 0;
  for (const o of arr) {
    if (!o || typeof o !== 'object' || !(o.site_name || o.password)) continue;
    const e = {
      id: uuid(),
      site_name: str(o.site_name), site_url: str(o.site_url), username: str(o.username), password: str(o.password),
      icon: str(o.icon), category: catId(o.category), notes: str(o.notes),
      created_at: ts(o.created_at) ? new Date(ts(o.created_at)).toISOString() : now(),
      updated_at: now(),
    };
    if (seen.has(key(e))) continue;
    seen.add(key(e));
    data.entries.push(e);
    added++;
  }
  await commit();
  return added;
}

// ---------- sincronización ----------
export const syncEnabled = () => cloud.isConfigured();

/**
 * Sincroniza con la nube (last-write-wins por updated_at del bloque). Si la nube es más nueva,
 * descarga, descifra y fusiona por id antes de subir. Devuelve 'ok' | 'subido' | 'fusionado'.
 */
export function syncNow(userId, askPassword) {
  return run(async () => {
    if (!isUnlocked()) throw new Error('La bóveda está bloqueada.');
    for (let attempt = 0; attempt < 3; attempt++) {
      const remote = await cloud.pull(userId);
      const meta = readMeta();
      if (!remote) {
        const t = await cloud.push(userId, await persist(false), null);
        if (t == null) continue;
        writeMeta({ synced_at: t, dirty: false });
        return 'subido';
      }
      const remoteNewer = remote.updated_at !== meta.synced_at; // igualdad: ambos vienen del reloj del servidor
      if (remoteNewer && isBlob(remote.data) && remote.data.ct === readBlob()?.ct && !meta.dirty) {
        writeMeta({ synced_at: remote.updated_at });
        return 'ok';
      }
      if (remoteNewer && isBlob(remote.data) && remote.data.ct !== readBlob()?.ct) {
        const r = await decryptForeign(remote.data, askPassword);
        data = mergeData(data, r.d);
        session = { key: r.key, salt: r.salt, iter: r.iter }; // si cambiaron la maestra en otro dispositivo, la adoptamos
        const t = await cloud.push(userId, await persist(false), remote.updated_at);
        if (t == null) continue;
        writeMeta({ synced_at: t, dirty: false });
        return 'fusionado';
      }
      if (meta.dirty || remoteNewer) {
        const t = await cloud.push(userId, readBlob(), remote.updated_at);
        if (t == null) continue;
        writeMeta({ synced_at: t, dirty: false });
        return 'subido';
      }
      return 'ok';
    }
    throw new Error('La nube cambió mientras sincronizaba. Inténtalo de nuevo.');
  });
}
