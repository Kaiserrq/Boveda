// Utilidades de interfaz (puras, sin acceso a datos sensibles).
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const icon = (name, cls = '') => `<svg class="${('i ' + cls).trim()}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

export function safeUrl(u) {
  if (!u) return '';
  const full = /^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u;
  try { const x = new URL(full); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch { return ''; }
}

/** Índice 0-7 estable derivado del nombre (para el color del monograma). */
export function hueIdx(name) {
  let h = 2166136261;
  for (const ch of String(name || '?').toLowerCase()) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h % 8;
}

export const initial = (name) => (String(name || '?').trim().charAt(0) || '?').toUpperCase();

/** "hace 3 min", "hace 2 h", "hace 5 d" o fecha corta. */
export function ago(iso) {
  const t = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'hace un momento';
  if (s < 3600) return `hace ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  if (s < 86400 * 30) { const d = Math.round(s / 86400); return d === 1 ? 'hace 1 día' : `hace ${d} días`; }
  return 'el ' + new Date(t).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Contraseña con dígitos y símbolos resaltados (para mostrarla revelada). */
export function pwHTML(pw) {
  let out = '';
  for (const ch of String(pw ?? '')) {
    const c = esc(ch);
    if (/\d/.test(ch)) out += `<span class="pd">${c}</span>`;
    else if (/[^A-Za-z]/.test(ch)) out += `<span class="ps">${c}</span>`;
    else out += c;
  }
  return out;
}

const CAT_ICONS = { general: 'key', social: 'users', trabajo: 'briefcase', banco: 'card', apps: 'phone' };
export const catIconName = (id) => CAT_ICONS[id] || 'folder';
