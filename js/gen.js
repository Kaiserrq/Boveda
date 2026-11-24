// Generador de contraseñas (crypto.getRandomValues) e indicador de fuerza.
const SETS = {
  lower: 'abcdefghijkmnopqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  digits: '23456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?',
};

// Entero uniforme en [0, max) sin sesgo de módulo.
function randInt(max) {
  const lim = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  do { crypto.getRandomValues(buf); } while (buf[0] >= lim);
  return buf[0] % max;
}

export function generate({ length = 20, lower = true, upper = true, digits = true, symbols = true } = {}) {
  const opts = { lower, upper, digits, symbols };
  const active = Object.keys(SETS).filter((k) => opts[k]);
  if (!active.length) return '';
  const pool = active.map((k) => SETS[k]).join('');
  const out = active.map((k) => SETS[k][randInt(SETS[k].length)]); // al menos uno de cada tipo
  while (out.length < length) out.push(pool[randInt(pool.length)]);
  for (let i = out.length - 1; i > 0; i--) { const j = randInt(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.slice(0, Math.max(length, active.length)).join('');
}

/** Fuerza estimada: { bits, score 0-4, label }. Estimación simple; penaliza repeticiones y secuencias. */
export function strength(pw) {
  if (!pw) return { bits: 0, score: 0, label: '' };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^A-Za-z0-9]/.test(pw)) pool += 32;
  let bits = pw.length * Math.log2(Math.max(pool, 2));
  const uniq = new Set(pw).size;
  if (uniq < pw.length / 2) bits *= 0.6;
  if (/(.)\1{2,}/.test(pw)) bits *= 0.8;
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|asdf|zxcv)/i.test(pw)) bits *= 0.7;
  if (/^(password|contrase|123456|qwerty|admin|letmein)/i.test(pw)) bits = Math.min(bits, 20);
  const score = bits < 36 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  return { bits: Math.round(bits), score, label: ['', 'Débil', 'Regular', 'Buena', 'Excelente'][score] };
}
