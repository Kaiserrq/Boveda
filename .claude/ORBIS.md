# Bóveda (ORBIS)

Gestor de contraseñas de una pareja con UNA cuenta compartida. PWA estática (HTML/CSS/JS vanilla, sin build) para GitHub Pages. Hermana de `Desktop/Finanza` (mismo patrón); diseño tomado de `Desktop/gestor_contrase-as` (tema oscuro violeta).

## Compilar / probar
- No hay build. `python -m http.server 8080` y abrir http://localhost:8080 (SW requiere localhost/HTTPS).
- Al publicar: subir `CACHE_VERSION` en `sw.js`.

## Estructura
- `index.html` (UI + CSP meta), `css/style.css`
- `js/crypto.js` PBKDF2-SHA256 600k + AES-256-GCM (clave no extraíble), formato `{v,salt,iter,iv,ct}` base64
- `js/vault.js` estado en memoria, guardado cifrado en localStorage (`boveda.blob`, `boveda.meta`), fusión por id, respaldo, import legacy, `syncNow`
- `js/sync.js` Supabase (solo si hay config), librería local en `js/vendor/supabase.js` (esm.sh bundle 2.45.4, sin imports remotos); tabla `boveda_data`; push condicional por `updated_at`
- `js/gen.js` generador + fuerza; `js/app.js` UI, autobloqueo, ajustes
- `js/config.js` SUPABASE_URL/KEY VACÍOS (el usuario crea proyecto nuevo); `supabase/schema.sql`; `docs/SINCRONIZACION.md`

## Decisiones
- Una sola bloque cifrado con IV nuevo por guardado; a localStorage/Supabase solo el bloque. Clave solo en memoria.
- Datos: `{entries, categories, settings}`; borrados = tombstones `deleted:true` (sin datos). Categorías por id (las por defecto tienen id fijo y updated_at epoch).
- `updated_at` lo pone un trigger del servidor; "nube cambió" = `remote.updated_at !== meta.synced_at` (igualdad, sin relojes de cliente). Bloques con iter < 600000 se recifran al desbloquear. askPassword resuelve null si el diálogo se cierra (lockNow).
- Sync: pull -> si la nube cambió, descifra (pide maestra si el salt difiere) y fusiona (gana updated_at mayor) -> push con `eq(updated_at)` (reintenta si hubo conflicto). Cambiar maestra = nuevo salt; otro dispositivo la adopta al sincronizar.
- Autobloqueo: 5 min inactividad (ajustable 1-30), oculta >1 min. Portapapeles se limpia a 30 s.
- CSP sin CDN (script/connect solo 'self' y supabase.co), sin inline (style-src 'self'; no usar atributos style en HTML). Sin fuentes externas.
- SW: solo mismo origen; nunca cachea Supabase/CDN.

## Verificado (Playwright local, sin Supabase)
Crear maestra, CRUD, generador, búsqueda/filtro, bloqueo, clave errónea falla, recarga mantiene datos, localStorage solo cifrado, import legacy, export/import cifrado, cambio de maestra.

## Pendientes
- Probar sincronización real con un proyecto Supabase (no se pudo sin credenciales).
- Falta probar en celular instalado (PWA) y autobloqueo por tiempo real.
- Sin commit aún; subir a GitHub Pages.
