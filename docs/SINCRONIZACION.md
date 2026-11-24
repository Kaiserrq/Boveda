# ☁️ Manual: activar la sincronización (celular ↔ PC)

La app usa **Supabase** (plan **gratuito**, de sobra para uso personal). Lo que se sube es **solo el bloque cifrado** de tu bóveda: Supabase nunca ve tus contraseñas.

```
GitHub Pages  →  la app (el código, público)
Supabase      →  tu bóveda CIFRADA (privada, protegida con tu cuenta y, además, con tu contraseña maestra)
```

### ¿Cómo funciona?
- La app **funciona sin internet**: todo se guarda primero (cifrado) en el dispositivo.
- Con conexión, sube tus cambios y baja los del otro dispositivo: al abrir/desbloquear, unos segundos después de cada cambio y cada minuto mientras está abierta. Solo sincroniza con la bóveda **desbloqueada**.
- Antes de sobrescribir la nube se compara la fecha: si la nube es más nueva, se descarga, se descifra y se **fusiona por entrada** (gana la edición más reciente de cada una; los borrados también se propagan). No se pierde nada si editaron distintas cosas en cada dispositivo.

> ⚠️ Hay **dos contraseñas distintas**: la de la **cuenta** de Supabase (correo + contraseña, para entrar a la nube) y la **contraseña maestra** (descifra la bóveda; nunca sale del dispositivo). Los dos usan la misma cuenta y la misma maestra.

---

## Paso 1: Crear el proyecto en Supabase (5 min)

1. Entra a **https://supabase.com** → **Start your project** e inicia sesión.
2. **New project**: *Name* `boveda`, genera y guarda la *Database Password*, elige la región más cercana, plan **Free** → **Create new project** (1–2 min). Crea un proyecto **nuevo**, no reutilices el de otras apps.

## Paso 2: Crear la tabla (1 min)

> Si ya habías ejecutado una versión anterior del script, vuelve a ejecutar el `schema.sql` completo: añade un trigger que fija `updated_at` con el reloj del servidor.

1. **SQL Editor → New query**.
2. Copia **todo** [`supabase/schema.sql`](../supabase/schema.sql), pégalo y pulsa **Run** (*Success. No rows returned*).

Crea la tabla `boveda_data` y las reglas **RLS**: cada usuario solo lee y escribe su propia fila.

## Paso 3: Configurar el inicio de sesión (2 min)

1. **Authentication → URL Configuration**:
   - **Site URL:** `https://TU-USUARIO.github.io/Boveda/`
   - **Redirect URLs:** esa misma dirección y `http://localhost:8080`.
2. *(Opcional)* **Authentication → Sign In / Providers → Email**: desactiva **Confirm email** para no tener que confirmar el correo.

## Paso 4: Conectar la app (1 min)

1. En Supabase: **Project Settings → API** (o **API Keys**).
2. Copia **Project URL** (`https://abcdxyz.supabase.co`) y la **anon / publishable key**.
3. Pégalas en [`js/config.js`](../js/config.js):

```js
export const SUPABASE_URL = 'https://abcdxyz.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

4. Sube `CACHE_VERSION` en [`sw.js`](../sw.js) (`boveda-v1` → `boveda-v2`) y publica los cambios.

> 🔐 La anon key es pública por diseño; tus datos los protegen RLS **y** el cifrado. ⛔ **Nunca** pongas la *service_role / secret key*.

## Paso 5: Usarla

1. **En el primer dispositivo:** crea la contraseña maestra → **Ajustes → Sincronización** → correo y contraseña de cuenta → **Crear cuenta** (confirma el correo si hace falta y pulsa **Iniciar sesión**). Se sube la bóveda cifrada.
2. **En el segundo dispositivo:** abre la app y, en la pantalla de crear contraseña, pulsa **“Ya tengo una bóveda en la nube”** → inicia sesión con la misma cuenta → escribe la **misma contraseña maestra**. (Si ya tienes datos locales en ese dispositivo, usa mejor **Ajustes → Sincronización → Iniciar sesión**; te pedirá la maestra de la nube si es distinta.)

---

## Preguntas frecuentes

**Cambié la contraseña maestra en un dispositivo, ¿y el otro?** → Al sincronizar te pedirá la contraseña maestra nueva una sola vez y la adoptará.

**Olvidé la contraseña maestra** → No hay recuperación. Si tienes un respaldo cifrado, sigue necesitando la maestra con la que se hizo.

**Dice "Falta crear la tabla"** → Repite el paso 2.

**Dice "Debes confirmar tu correo"** → Revisa bandeja y spam, o desactiva *Confirm email* (paso 3.2).

**Mi proyecto aparece "Paused"** → El plan gratuito pausa proyectos tras ~1 semana sin uso. Pulsa **Restore project**. Mientras, la app sigue funcionando con los datos del dispositivo.

**¿Qué veo en Supabase?** → **Table Editor → boveda_data**: una fila con `data` = `{v, salt, iter, iv, ct}` ilegible sin la maestra.

**¿Cómo desactivo la sincronización?** → Ajustes → **Cerrar sesión**. Los datos se quedan cifrados en el dispositivo.
