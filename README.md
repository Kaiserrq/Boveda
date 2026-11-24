# Bóveda 🔐

Gestor de contraseñas personal para **una pareja que comparte una sola cuenta**, con sincronización opcional entre celular y PC y **cifrado de extremo a extremo** en el navegador.

Es una **PWA** estática (HTML, CSS y JS vanilla, sin build): funciona como página web y como app instalable, incluso sin internet. Mismo patrón que la app hermana *Finanza*.

## Funciones

- Crear contraseña maestra (mín. 10 caracteres) y desbloquear en cada apertura
- Bloqueo automático tras 5 min de inactividad (configurable) y al ocultar la app más de 1 min
- Listar, buscar y filtrar por categoría; crear, editar y borrar; categorías editables
- Mostrar/ocultar y copiar contraseña (el portapapeles se limpia a los 30 s si el navegador lo permite)
- Generador de contraseñas (`crypto.getRandomValues`) e indicador de fuerza
- Respaldo **cifrado** (.json) exportable e importable
- Importar desde la versión vieja del gestor (JSON, ver abajo)
- Cambiar la contraseña maestra (se recifra todo con un salt nuevo)
- Sincronización opcional con Supabase → [docs/SINCRONIZACION.md](docs/SINCRONIZACION.md)

## Privacidad y modelo de seguridad

1. La contraseña maestra pasa por **PBKDF2-SHA256** (600 000 iteraciones, salt aleatorio de 16 bytes) y produce una clave **AES-256-GCM no extraíble** (Web Crypto).
2. Toda la bóveda (entradas, categorías y ajustes) se serializa a JSON y se cifra **como un solo bloque** con un IV aleatorio de 12 bytes **nuevo en cada guardado**. Se guarda `{v, salt, iter, iv, ct}` en base64.
3. A `localStorage` y a Supabase **solo llega ese bloque cifrado**. Nunca texto plano, nunca la contraseña maestra ni la clave. La clave vive solo en memoria y se descarta al bloquear.
4. Supabase ve únicamente un blob opaco y la fecha de modificación. Quien tenga acceso a tu base de datos no puede leer tus contraseñas sin la maestra.

Límites honestos:

- **Si olvidas la contraseña maestra, no hay recuperación.** Nadie puede descifrar los datos. Guarda un respaldo cifrado y anota la maestra en un lugar seguro.
- La seguridad depende de la fortaleza de la maestra: PBKDF2 frena, pero no impide, un ataque de fuerza bruta contra una clave débil si alguien consigue el bloque cifrado. Usa una frase larga.
- No protege contra un dispositivo con malware, extensiones maliciosas o alguien mirando tu pantalla mientras está desbloqueada.
- El código se descarga del sitio donde lo publiques (GitHub Pages): si ese sitio fuera comprometido, el código podría alterarse. Por eso la CSP restringe los orígenes y el repositorio debe ser solo tuyo.
- Los metadatos (cuándo cambió el bloque y su tamaño aproximado) son visibles para Supabase.
- Las entradas borradas dejan una "lápida" (`deleted: true`, sin datos sensibles) para que el borrado se propague entre dispositivos.
- El limpiado del portapapeles a los 30 s depende de que el navegador lo permita.

## Sincronización entre dispositivos

Los dos usan la **misma cuenta** de Supabase (correo + contraseña) y la **misma contraseña maestra**. Se sincroniza el bloque cifrado con *last-write-wins* por `updated_at`; antes de sobrescribir la nube, si esta es más nueva, se descarga, se descifra y se **fusiona por id de entrada** (gana el `updated_at` mayor; los borrados usan tombstones). Si cambias la maestra en un dispositivo, el otro te la pedirá una vez para adoptar la nueva.

## Importar desde la versión vieja (`passwords.db`)

El gestor anterior guarda todo en SQLite. Para generar el JSON (necesitas `sqlite3`):

```bash
sqlite3 -json passwords.db "SELECT site_name, site_url, username, password, icon, category, notes, created_at, updated_at FROM passwords;" > passwords.json
```

(Si la tabla se llama distinto, mira `.tables` dentro de `sqlite3 passwords.db`.) Luego, en Bóveda: **Ajustes → Respaldo → Importar de la versión vieja (JSON)**. Se omiten duplicados (mismo sitio, usuario y contraseña) y las categorías nuevas se crean solas. Después **borra `passwords.json`**: contiene todo en texto plano.

## Probar en tu computador

Los service workers necesitan un servidor (no basta con abrir el archivo):

```bash
python -m http.server 8080
```

Abre http://localhost:8080. Sin Supabase configurado funciona igual, solo en este dispositivo.

## Publicar en GitHub Pages

1. Crea un repositorio (por ejemplo `Boveda`) y sube estos archivos.
2. **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**.
3. En un minuto estará en `https://TU-USUARIO.github.io/Boveda/` (todas las rutas son relativas).

Al publicar cambios, sube `CACHE_VERSION` en `sw.js` para que las apps instaladas se actualicen.

## Instalar como app

- **Android (Chrome):** menú ⋮ → *Instalar app*.
- **iPhone (Safari):** Compartir → *Agregar a pantalla de inicio*.
- **Windows/Mac (Chrome o Edge):** ícono de instalar en la barra de direcciones.

## Estructura

```
index.html            Interfaz y CSP
css/style.css         Diseño (tema oscuro del gestor anterior)
js/app.js             UI, bloqueo automático, ajustes
js/vault.js           Datos en memoria, guardado cifrado, fusión y sincronización
js/crypto.js          PBKDF2 + AES-GCM (Web Crypto)
js/gen.js             Generador y fuerza de contraseñas
js/sync.js            Supabase (cuenta + bloque cifrado)
js/vendor/supabase.js supabase-js 2.45.4 incluido localmente (sin CDN)
js/config.js          SUPABASE_URL y SUPABASE_ANON_KEY (vacíos por defecto)
supabase/schema.sql   Tabla boveda_data con RLS
sw.js, manifest.webmanifest, icons/
docs/SINCRONIZACION.md
```
