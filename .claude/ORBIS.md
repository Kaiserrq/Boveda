# Bóveda (ORBIS)

Gestor de contraseñas de una pareja con UNA cuenta compartida. PWA estática (HTML/CSS/JS vanilla, sin build) para GitHub Pages. Hermana de `Desktop/Finanza` (mismo patrón); rediseño v4 "caja fuerte de casa" (latón sobre tinta/papel).

## Compilar / probar
- No hay build. `python -m http.server 8080` y abrir http://localhost:8080 (SW requiere localhost/HTTPS).
- Al publicar: subir `CACHE_VERSION` en `sw.js`.

## Estructura
- `index.html` (UI + CSP meta), `css/style.css`
- `js/crypto.js` PBKDF2-SHA256 600k + AES-256-GCM (clave no extraíble), formato `{v,salt,iter,iv,ct}` base64
- `js/vault.js` estado en memoria, guardado cifrado en localStorage (`boveda.blob`, `boveda.meta`), fusión por id, respaldo, import legacy, `syncNow`
- `js/sync.js` Supabase (solo si hay config), librería local en `js/vendor/supabase.js` (esm.sh bundle 2.45.4, sin imports remotos); tabla `boveda_data`; push condicional por `updated_at`
- `js/gen.js` generador + fuerza; `js/app.js` UI, autobloqueo, ajustes; `js/ui/dial.js` (puerta con dial SVG), `js/ui/util.js` (iconos sprite, hash->monograma, pwHTML); `js/theme.js` (externo en <head>, data-theme + meta theme-color); `fonts/*.woff2` autoalojadas (Bricolage Grotesque, Manrope, JetBrains Mono)
- `js/config.js` SUPABASE_URL/KEY VACÍOS (el usuario crea proyecto nuevo); `supabase/schema.sql`; `docs/SINCRONIZACION.md`

## Decisiones
- Una sola bloque cifrado con IV nuevo por guardado; a localStorage/Supabase solo el bloque. Clave solo en memoria.
- Datos: `{entries, categories, settings}`; borrados = tombstones `deleted:true` (sin datos). Categorías por id (las por defecto tienen id fijo y updated_at epoch).
- `updated_at` lo pone un trigger del servidor; "nube cambió" = `remote.updated_at !== meta.synced_at` (igualdad, sin relojes de cliente). Bloques con iter < 600000 se recifran al desbloquear. askPassword resuelve null si el diálogo se cierra (lockNow).
- Sync: pull -> si la nube cambió, descifra (pide maestra si el salt difiere) y fusiona (gana updated_at mayor) -> push con `eq(updated_at)` (reintenta si hubo conflicto). Cambiar maestra = nuevo salt; otro dispositivo la adopta al sincronizar.
- Autobloqueo: 5 min inactividad (ajustable 1-30), oculta >1 min. Portapapeles se limpia a 30 s.
- CSP sin CDN (script/connect solo 'self' y supabase.co), sin inline (style-src 'self'; no usar atributos style en HTML). Sin fuentes externas (solo fonts/).
- SW: solo mismo origen; nunca cachea Supabase/CDN.

## Diseño (v4)
- Tokens en `:root` (oscuro) y `:root[data-theme=light]`; `--brass-t` es el latón para texto/botones (AA en claro). Tema: Sistema/Claro/Oscuro en `localStorage['boveda.theme']`.
- Iconos: sprite `<symbol id="i-*">` en index.html, trazo 1.75; sin emojis (el campo `icon` de categorías/entradas ya no se usa en UI; categorías por id -> icono).
- Escritorio >=900px: sidebar | lista | detalle; móvil: chips, FAB, tabbar, detalle y diálogos como hojas inferiores (swipe/Esc). Diálogos `.sheet-dlg`.
- Dial: cada tecla gira ±27° (alterna), error = shake, éxito = giro + puerta (rotateY) 600 ms; reduced-motion solo fade.
- Revisar: débiles (score<=1) y repetidas, calculado en memoria en `analyze()`. Eliminar = confirmación en línea en el detalle. Toast de copiar con anillo 30 s.
- Probar tras cambiar CSS/JS: el SW cachea; borrar caches o usar `fetch(url,{cache:'reload'})`.

## Verificado (Playwright local, sin Supabase)
Crear maestra, CRUD, generador, búsqueda/filtro, bloqueo, clave errónea falla, recarga mantiene datos, localStorage solo cifrado, import legacy, export/import cifrado, cambio de maestra.

## Pendientes
- Probar sincronización real con un proyecto Supabase (no se pudo sin credenciales).
- Falta probar en celular instalado (PWA) y autobloqueo por tiempo real.
- Iconos PNG/SVG de la app siguen en violeta (no recoloreados al latón).
- Sin commit aún; subir a GitHub Pages.
