// ============================================================
//  Configuración de la sincronización en la nube (Supabase)
//  Guía paso a paso: docs/SINCRONIZACION.md
// ============================================================
// Pega aquí los datos de TU proyecto de Supabase (Project Settings → API).
// Si los dejas vacíos, la app funciona igual pero solo en este dispositivo.
//
// ¿Es seguro publicarlos en GitHub? Sí: la "anon key" / "publishable key" es
// pública por diseño. Además, lo que se sube a Supabase ya va CIFRADO desde
// tu navegador, y las reglas RLS de supabase/schema.sql limitan cada fila a su dueño.
// NUNCA pongas aquí la "service_role key" / "secret key".

export const SUPABASE_URL = 'https://ttrwvbrbseevwhnauzex.supabase.co';      // ej: 'https://abcdefghijk.supabase.co'
export const SUPABASE_ANON_KEY = 'sb_publishable_ePMXZnh4Khiq4JsO9_SAwA_IOh1gizp'; // ej: 'eyJhbGciOi...' o 'sb_publishable_...'
