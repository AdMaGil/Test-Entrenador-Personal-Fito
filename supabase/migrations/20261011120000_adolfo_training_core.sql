-- =====================================================================
-- Adolfo Training · modelo de datos principal
--
-- Migración NO destructiva:
--   * No borra tablas ni filas existentes (training_metrics y
--     body_composition se conservan tal cual).
--   * Solo retira las políticas de "lectura pública" de esas tablas
--     heredadas, porque exponían datos de salud a cualquiera con la
--     clave anónima (que es pública en la web).
--
-- Todas las tablas personales tienen propietario (user_id) y RLS que
-- impide el acceso entre usuarios. La escritura de la sincronización se
-- hace con la service_role desde el servidor (GitHub Actions), que
-- ignora RLS por diseño.
-- =====================================================================

-- gen_random_uuid() es nativo desde PostgreSQL 13: no requiere extensiones.

-- ---------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Perfil y preferencias
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  user_id                 uuid primary key references auth.users (id) on delete cascade,
  display_name            text,
  timezone                text not null default 'Europe/Madrid',
  units                   jsonb not null default '{"weight":"kg","distance":"km","elevation":"m"}'::jsonb,
  theme                   text not null default 'dark' check (theme in ('dark', 'light', 'system')),
  goals                   text,
  weight_goal_kg          numeric check (weight_goal_kg is null or weight_goal_kg between 30 and 250),
  hr_max_bpm              integer check (hr_max_bpm is null or hr_max_bpm between 100 and 230),
  available_days          smallint[] not null default '{}',   -- 1 = lunes … 7 = domingo
  session_minutes_default integer check (session_minutes_default is null or session_minutes_default between 10 and 600),
  sport_priority          text[] not null default '{hiit,emtb,mtb,run}',
  equipment               text[] not null default '{}',
  limitations             text,
  preferences             text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- Crea el perfil vacío al registrarse (sin inventar datos personales)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Conexiones y sincronizaciones (sin secretos: las claves viven en el servidor)
-- ---------------------------------------------------------------------
create table if not exists public.data_connections (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users (id) on delete cascade,
  provider        text not null check (provider in ('intervals')),
  status          text not null default 'pendiente'
                  check (status in ('pendiente', 'activa', 'parcial', 'error', 'desactivada')),
  sync_from       date,
  last_sync_at    timestamptz,
  last_success_at timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (user_id, provider)
);

create table if not exists public.sync_runs (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references auth.users (id) on delete cascade,
  provider               text not null,
  mode                   text check (mode in ('inicial', 'incremental')),
  started_at             timestamptz not null default now(),
  finished_at            timestamptz,
  status                 text not null default 'en_curso'
                         check (status in ('en_curso', 'ok', 'parcial', 'error')),
  window_oldest          date,
  window_newest          date,
  activities_seen        integer not null default 0,
  activities_upserted    integer not null default 0,
  streams_fetched        integer not null default 0,
  wellness_upserted      integer not null default 0,
  measurements_upserted  integer not null default 0,
  warnings               jsonb not null default '[]'::jsonb,
  error                  text
);

-- ---------------------------------------------------------------------
-- Actividades
--   source_type      = tipo original del origen (p. ej. HighIntensityIntervalTraining)
--   category_auto    = categoría normalizada calculada en la sincronización
--   category_override= corrección manual; la sincronización NUNCA la escribe
--   category         = la que usa la app (corrección si existe)
-- ---------------------------------------------------------------------
create table if not exists public.activities (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source              text not null check (source in ('intervals', 'import', 'manual')),
  external_id         text not null,
  data_origin         text not null default 'medido' check (data_origin in ('medido', 'estimado', 'manual')),
  start_time          timestamptz,
  local_date          date not null,
  name                text,
  source_type         text,
  category_auto       text not null default 'otro' check (category_auto in ('hiit', 'emtb', 'mtb', 'run', 'otro')),
  category_ambiguous  boolean not null default false,
  category_override   text check (category_override in ('hiit', 'emtb', 'mtb', 'run', 'otro')),
  category            text generated always as (coalesce(category_override, category_auto)) stored,
  category_needs_review boolean generated always as (category_override is null and category_ambiguous) stored,
  duration_s          integer,
  moving_time_s       integer,
  distance_m          numeric,
  elevation_gain_m    numeric,
  avg_hr              numeric,
  max_hr              numeric,
  avg_speed_ms        numeric,
  max_speed_ms        numeric,
  avg_cadence         numeric,
  rider_avg_power_w   numeric,
  rider_power_source  text check (rider_power_source in ('medidor', 'estimado')),
  training_load       numeric,
  intensity           numeric,
  trimp               numeric,
  calories            numeric,
  hr_zone_times_s     integer[],
  hr_zone_bounds      integer[],
  device_name         text,
  has_gps             boolean,
  has_heartrate       boolean,
  stream_types        text[],
  api_restricted      boolean not null default false,
  raw                 jsonb,
  source_updated_at   timestamptz,
  last_synced_at      timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (user_id, source, external_id)
);

create index if not exists activities_user_date_idx on public.activities (user_id, local_date desc);

create table if not exists public.activity_streams (
  activity_id uuid primary key references public.activities (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  streams     jsonb not null,
  fetched_at  timestamptz not null default now()
);

create table if not exists public.activity_feedback (
  activity_id             uuid primary key references public.activities (id) on delete cascade,
  user_id                 uuid not null default auth.uid() references auth.users (id) on delete cascade,
  rpe                     smallint check (rpe between 1 and 10),
  sensations              text,
  notes                   text,
  terrain_notes           text,
  ebike_battery_start_pct smallint check (ebike_battery_start_pct between 0 and 100),
  ebike_battery_end_pct   smallint check (ebike_battery_end_pct between 0 and 100),
  ebike_assist_notes      text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Bienestar diario (tal como llega del origen; sin peso: va a body_measurements)
-- ---------------------------------------------------------------------
create table if not exists public.wellness_daily (
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source         text not null default 'intervals' check (source in ('intervals', 'manual')),
  date           date not null,
  resting_hr     numeric,
  hrv            numeric,
  sleep_secs     integer,
  sleep_score    numeric,
  sleep_quality  smallint,
  steps          integer,
  ctl            numeric,
  atl            numeric,
  ramp_rate      numeric,
  raw            jsonb,
  last_synced_at timestamptz,
  primary key (user_id, source, date)
);

-- Solo mediciones reales: nunca un peso arrastrado de días anteriores
create table if not exists public.body_measurements (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users (id) on delete cascade,
  source         text not null check (source in ('intervals', 'manual')),
  external_id    text,
  measured_on    date not null,
  measured_at    timestamptz,
  weight_kg      numeric check (weight_kg is null or weight_kg between 20 and 300),
  body_fat_pct   numeric check (body_fat_pct is null or body_fat_pct between 2 and 70),
  waist_cm       numeric check (waist_cm is null or waist_cm between 40 and 200),
  data_origin    text not null check (data_origin in ('medido', 'manual')),
  notes          text,
  last_synced_at timestamptz,
  created_at     timestamptz not null default now(),
  unique (user_id, source, external_id)
);

create index if not exists body_measurements_user_date_idx on public.body_measurements (user_id, measured_on desc);

-- ---------------------------------------------------------------------
-- Sensaciones diarias (registro rápido)
-- ---------------------------------------------------------------------
create table if not exists public.daily_checkins (
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date        date not null,
  energy      smallint check (energy between 1 and 5),
  fatigue     smallint check (fatigue between 1 and 5),
  soreness    text[] not null default '{}',
  sensations  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (user_id, date)
);

-- ---------------------------------------------------------------------
-- Planificación (se guarda solo en la app: no se envía a Intervals ni a Garmin)
--   status = propuesta   → sugerencia pendiente de revisar
--            planificada → aceptada en el calendario
-- ---------------------------------------------------------------------
create table if not exists public.planned_sessions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  date                  date not null,
  start_time            time,
  category              text not null check (category in ('hiit', 'emtb', 'mtb', 'run', 'otro', 'descanso')),
  title                 text not null,
  objective             text,
  warmup                text,
  main_block            text,
  cooldown              text,
  duration_min          integer check (duration_min is null or duration_min between 5 and 600),
  intensity             text check (intensity in ('suave', 'moderada', 'alta')),
  location              text check (location in ('casa', 'gimnasio', 'exterior', 'otro')),
  status                text not null default 'planificada'
                        check (status in ('propuesta', 'planificada', 'completada', 'omitida')),
  origin                text not null default 'manual' check (origin in ('manual', 'reglas', 'ia')),
  rationale             text,
  completed_activity_id uuid references public.activities (id) on delete set null,
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists planned_sessions_user_date_idx on public.planned_sessions (user_id, date);

-- Ejercicios, series, repeticiones y pesos
create table if not exists public.strength_sets (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users (id) on delete cascade,
  activity_id        uuid references public.activities (id) on delete cascade,
  planned_session_id uuid references public.planned_sessions (id) on delete cascade,
  exercise           text not null,
  set_number         smallint not null check (set_number between 1 and 100),
  reps               smallint check (reps between 0 and 1000),
  weight_kg          numeric check (weight_kg between 0 and 500),
  duration_s         integer check (duration_s between 0 and 36000),
  notes              text,
  created_at         timestamptz not null default now(),
  check (activity_id is not null or planned_session_id is not null)
);

create index if not exists strength_sets_activity_idx on public.strength_sets (activity_id);

-- ---------------------------------------------------------------------
-- Evolución física mediante fotografías (los archivos van al bucket privado)
-- ---------------------------------------------------------------------
create table if not exists public.photo_entries (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null default auth.uid() references auth.users (id) on delete cascade,
  taken_on              date not null,
  weight_kg             numeric check (weight_kg is null or weight_kg between 20 and 300),
  weight_measurement_id uuid references public.body_measurements (id) on delete set null,
  weight_is_manual      boolean not null default false,
  waist_cm              numeric check (waist_cm is null or waist_cm between 40 and 200),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists public.photo_files (
  id            uuid primary key default gen_random_uuid(),
  entry_id      uuid not null references public.photo_entries (id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  pose          text not null check (pose in ('frontal', 'perfil', 'espalda')),
  original_path text not null,
  display_path  text,
  mime          text,
  bytes         integer,
  width         integer,
  height        integer,
  framing       jsonb not null default '{"scale":1,"x":0,"y":0}'::jsonb,
  created_at    timestamptz not null default now(),
  unique (entry_id, pose)
);

-- ---------------------------------------------------------------------
-- Mi entrenador: conversación
-- ---------------------------------------------------------------------
create table if not exists public.coach_messages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  payload    jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Triggers updated_at
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'data_connections', 'activities', 'activity_feedback',
    'daily_checkins', 'planned_sessions', 'photo_entries'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS: cada usuario solo ve y modifica lo suyo
-- ---------------------------------------------------------------------
do $$
declare
  t text;
begin
  -- Lectura y escritura del propietario
  foreach t in array array[
    'profiles', 'data_connections', 'activities', 'activity_streams',
    'activity_feedback', 'wellness_daily', 'body_measurements', 'daily_checkins',
    'planned_sessions', 'strength_sets', 'photo_entries', 'photo_files', 'coach_messages'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "propietario" on public.%I', t);
    execute format(
      'create policy "propietario" on public.%I
         for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
  end loop;

  -- Historial de sincronización: solo lectura para el propietario
  alter table public.sync_runs enable row level security;
  drop policy if exists "propietario_lectura" on public.sync_runs;
  create policy "propietario_lectura" on public.sync_runs
    for select to authenticated
    using (user_id = (select auth.uid()));
end;
$$;

-- El estado de la conexión lo escribe solo el servidor: el usuario
-- puede activarla o desactivarla y elegir desde cuándo sincronizar.
revoke update on public.data_connections from authenticated;
grant update (status, sync_from) on public.data_connections to authenticated;

-- La categoría automática y los datos medidos de origen no se editan
-- desde la app; el usuario corrige mediante category_override.
revoke update on public.activities from authenticated;
grant update (category_override, name) on public.activities to authenticated;

-- ---------------------------------------------------------------------
-- Tablas heredadas: se conservan los datos, se retira la lectura pública
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('public.training_metrics') is not null then
    execute 'drop policy if exists "Lectura pública de training_metrics" on public.training_metrics';
    execute 'alter table public.training_metrics enable row level security';
  end if;
  if to_regclass('public.body_composition') is not null then
    execute 'drop policy if exists "Lectura pública de body_composition" on public.body_composition';
    execute 'alter table public.body_composition enable row level security';
  end if;
end;
$$;
