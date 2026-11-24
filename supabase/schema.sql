-- =============================================================
--  Bóveda: tabla para sincronizar la bóveda CIFRADA entre dispositivos
--  Cópialo completo en Supabase → SQL Editor → New query → Run
-- =============================================================

-- Una fila por usuario. La columna "data" contiene SOLO el bloque cifrado
-- ({v, salt, iter, iv, ct} en base64); Supabase nunca ve tus contraseñas.
create table if not exists public.boveda_data (
  user_id    uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  data       jsonb       not null,
  updated_at timestamptz not null default now()
);

-- El servidor fija updated_at (no se confía en el reloj de los dispositivos).
create or replace function public.boveda_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists boveda_data_updated_at on public.boveda_data;
create trigger boveda_data_updated_at
  before insert or update on public.boveda_data
  for each row execute function public.boveda_set_updated_at();

-- Seguridad (RLS): cada usuario solo puede leer y modificar SU propia fila.
alter table public.boveda_data enable row level security;

drop policy if exists "Ver mi boveda"        on public.boveda_data;
drop policy if exists "Crear mi boveda"      on public.boveda_data;
drop policy if exists "Actualizar mi boveda" on public.boveda_data;
drop policy if exists "Borrar mi boveda"     on public.boveda_data;

create policy "Ver mi boveda" on public.boveda_data
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Crear mi boveda" on public.boveda_data
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "Actualizar mi boveda" on public.boveda_data
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "Borrar mi boveda" on public.boveda_data
  for delete to authenticated using ((select auth.uid()) = user_id);
