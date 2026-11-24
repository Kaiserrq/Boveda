// Cifrado de extremo a extremo con Web Crypto.
// Contraseña maestra → PBKDF2-SHA256 (600000 iter, salt 16 B) → AES-256-GCM (clave NO extraíble).
// Todo el contenido se cifra como un solo bloque con IV aleatorio de 12 B nuevo en cada guardado.
export const ITERATIONS = 600000;
export const FORMAT_VERSION = 1;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64(bytes) {
  let s = '';
  const u = new Uint8Array(bytes);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
export const unb64 = (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0));

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

/** Deriva la clave AES-GCM (no extraíble) a partir de la contraseña maestra. */
export async function deriveKey(password, salt, iter = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** Cifra un objeto JSON. Devuelve { v, salt, iter, iv, ct } en base64. */
export async function encryptJSON(key, salt, iter, obj) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { v: FORMAT_VERSION, salt: b64(salt), iter, iv: b64(iv), ct: b64(ct) };
}

/** Descifra un bloque. Lanza error si la clave es incorrecta o el bloque fue alterado. */
export async function decryptJSON(key, blob) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(blob.iv) }, key, unb64(blob.ct));
  return JSON.parse(dec.decode(pt));
}

function unb64Len(s) { try { return atob(s).length; } catch { return -1; } }

export function isBlob(b) {
  return !!b && typeof b === 'object' && b.v === FORMAT_VERSION && ['salt', 'iv', 'ct'].every((k) => typeof b[k] === 'string') && Number.isInteger(b.iter) && b.iter >= 300000 && b.iter <= 5000000 && unb64Len(b.salt) === 16 && unb64Len(b.iv) === 12;
}

/** Extrae solo los campos del bloque cifrado (descarta cualquier otra cosa). */
export const cleanBlob = (b) => ({ v: b.v, salt: b.salt, iter: b.iter, iv: b.iv, ct: b.ct });
