-- =====================================================================
-- Adolfo Training · WOD importados (Entrega 1)
--
-- Migración ADITIVA e idempotente:
--   * Crea la tabla `workouts`: el WOD previsto (prescripción) tal como se
--     importó, validado. Importar un WOD NO crea ninguna actividad.
--   * Añade a `strength_sets` columnas opcionales para enlazar una serie
--     con el ejercicio del WOD y marcarla como pendiente. Las filas
--     existentes quedan como estaban (status = 'realizado', sin enlace).
--   * No borra ni modifica datos existentes.
-- =====================================================================

create table if not exists public.workouts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Clave generada en el navegador para cada intento de importación:
  -- un doble clic o un reintento no crea duplicados.
  client_ref         text not null check (char_length(client_ref) between 8 and 80),
  -- Vínculo opcional y explícito (nunca automático por fecha)
  activity_id        uuid references public.activities (id) on delete set null,
  planned_session_id uuid references public.planned_sessions (id) on delete set null,
  format             text not null default 'adolfo-wod',
  format_version     smallint not null default 1,
  title              text check (title is null or char_length(title) <= 200),
  wod_date           date,
  modality           text check (modality in ('individual', 'parejas')),
  -- WOD completo validado (formato adolfo-wod v1), incluidas ambigüedades y datos no reconocidos
  spec               jsonb not null,
  -- Texto original pegado, como referencia
  source_text        text check (source_text is null or char_length(source_text) <= 150000),
  -- Al «sustituir» un WOD el anterior no se borra: queda archivado
  superseded_at      timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, client_ref)
);

create index if not exists workouts_user_activity_idx on public.workouts (user_id, activity_id);
create index if not exists workouts_planned_idx on public.workouts (planned_session_id);

-- El vínculo solo puede apuntar a actividades o sesiones del mismo usuario
create or replace function public.workouts_check_owner()
returns trigger
language plpgsql
as $$
begin
  if new.activity_id is not null and not exists (
    select 1 from public.activities a where a.id = new.activity_id and a.user_id = new.user_id
  ) then
    raise exception 'La actividad vinculada no pertenece al usuario';
  end if;
  if new.planned_session_id is not null and not exists (
    select 1 from public.planned_sessions p where p.id = new.planned_session_id and p.user_id = new.user_id
  ) then
    raise exception 'La sesión planificada vinculada no pertenece al usuario';
  end if;
  return new;
end;
$$;

drop trigger if exists workouts_check_owner on public.workouts;
create trigger workouts_check_owner
  before insert or update of activity_id, planned_session_id, user_id on public.workouts
  for each row execute function public.workouts_check_owner();

drop trigger if exists set_updated_at on public.workouts;
create trigger set_updated_at before update on public.workouts
  for each row execute function public.set_updated_at();

alter table public.workouts enable row level security;
drop policy if exists "propietario" on public.workouts;
create policy "propietario" on public.workouts
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Series: enlace con el WOD y estado
-- ---------------------------------------------------------------------
alter table public.strength_sets add column if not exists status text not null default 'realizado';
alter table public.strength_sets add column if not exists workout_id uuid references public.workouts (id) on delete set null;
alter table public.strength_sets add column if not exists block_ref text;
alter table public.strength_sets add column if not exists item_ref text;
-- Nombre tal como llegó en la importación, si luego se corrige la asociación del ejercicio
alter table public.strength_sets add column if not exists exercise_original text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'strength_sets_status_check') then
    alter table public.strength_sets
      add constraint strength_sets_status_check check (status in ('realizado', 'pendiente'));
  end if;
end;
$$;

create index if not exists strength_sets_workout_idx on public.strength_sets (workout_id);
