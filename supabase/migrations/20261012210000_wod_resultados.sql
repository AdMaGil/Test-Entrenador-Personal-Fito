-- =====================================================================
-- Adolfo Training · Resultados del WOD y cargas sin ambigüedad (Entrega 2)
--
-- Migración ADITIVA e idempotente. No modifica filas existentes:
--   * Las series antiguas quedan con load_mode = NULL («carga sin aclarar»):
--     no se reinterpreta si su peso era total o por mancuerna.
--   * Nueva tabla de resultados por bloque (equipo y contribución personal
--     por separado; nunca se reparte automáticamente).
--   * Función save_activity_session: guarda notas, series y resultados en
--     UNA transacción, con RLS del propio usuario (security invoker). Si algo
--     falla no queda nada a medias.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Series: interpretación de la carga y otras unidades
--   weight_kg            = carga externa TOTAL resuelta (o el valor original
--                          si load_mode es NULL: sin aclarar)
--   load_mode            = total | por_implemento | sin_carga | NULL (sin aclarar)
--   implements           = nº de implementos (2 mancuernas → 2)
--   load_per_implement_kg= peso de cada implemento
--   reps_scope           = total | por_lado
-- ---------------------------------------------------------------------
alter table public.strength_sets add column if not exists load_mode text;
alter table public.strength_sets add column if not exists implements smallint;
alter table public.strength_sets add column if not exists load_per_implement_kg numeric;
alter table public.strength_sets add column if not exists reps_scope text;
alter table public.strength_sets add column if not exists distance_m numeric;
alter table public.strength_sets add column if not exists calories numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'strength_sets_load_mode_check') then
    alter table public.strength_sets add constraint strength_sets_load_mode_check
      check (load_mode in ('total', 'por_implemento', 'sin_carga'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'strength_sets_implements_check') then
    alter table public.strength_sets add constraint strength_sets_implements_check
      check (implements between 1 and 20);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'strength_sets_load_per_implement_check') then
    alter table public.strength_sets add constraint strength_sets_load_per_implement_check
      check (load_per_implement_kg > 0 and load_per_implement_kg <= 500);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'strength_sets_reps_scope_check') then
    alter table public.strength_sets add constraint strength_sets_reps_scope_check
      check (reps_scope in ('total', 'por_lado'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'strength_sets_distance_check') then
    alter table public.strength_sets add constraint strength_sets_distance_check check (distance_m >= 0 and distance_m <= 100000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'strength_sets_calories_check') then
    alter table public.strength_sets add constraint strength_sets_calories_check check (calories >= 0 and calories <= 10000);
  end if;
  -- Coherencia: «por implemento» exige saber cuántos implementos hay
  if not exists (select 1 from pg_constraint where conname = 'strength_sets_per_implement_complete') then
    alter table public.strength_sets add constraint strength_sets_per_implement_complete
      check (load_mode is distinct from 'por_implemento' or implements is not null);
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Resultado por bloque del WOD
--   status NULL = pendiente; personal/team = {time_s, rounds, reps, calories, distance_m}
--   En parejas, `team` es el resultado del equipo y `personal` mi contribución;
--   un valor NULL en `personal` significa «desconocida».
-- ---------------------------------------------------------------------
create table if not exists public.workout_block_results (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  workout_id  uuid not null references public.workouts (id) on delete cascade,
  block_ref   text not null check (char_length(block_ref) between 1 and 40),
  status      text check (status in ('realizado', 'no_realizado')),
  personal    jsonb not null default '{}'::jsonb,
  team        jsonb not null default '{}'::jsonb,
  rpe         smallint check (rpe between 1 and 10),
  adaptations text check (adaptations is null or char_length(adaptations) <= 4000),
  notes       text check (notes is null or char_length(notes) <= 4000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (workout_id, block_ref)
);

create index if not exists workout_block_results_user_idx on public.workout_block_results (user_id);

create or replace function public.workout_block_results_check_owner()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from public.workouts w where w.id = new.workout_id and w.user_id = new.user_id) then
    raise exception 'El WOD no pertenece al usuario';
  end if;
  return new;
end;
$$;

drop trigger if exists workout_block_results_check_owner on public.workout_block_results;
create trigger workout_block_results_check_owner
  before insert or update of workout_id, user_id on public.workout_block_results
  for each row execute function public.workout_block_results_check_owner();

drop trigger if exists set_updated_at on public.workout_block_results;
create trigger set_updated_at before update on public.workout_block_results
  for each row execute function public.set_updated_at();

alter table public.workout_block_results enable row level security;
drop policy if exists "propietario" on public.workout_block_results;
create policy "propietario" on public.workout_block_results
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- Guardado atómico de la sesión de una actividad
--   p_feedback: objeto de activity_feedback o NULL para no tocarlo
--   p_sets:     lista completa de series de la actividad (sustituye a las actuales)
--   p_results:  resultados por bloque (upsert; los no enviados no se tocan)
-- No toca ninguna métrica del reloj de la actividad.
-- ---------------------------------------------------------------------
create or replace function public.save_activity_session(
  p_activity_id uuid,
  p_feedback jsonb,
  p_sets jsonb,
  p_results jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  -- Con RLS, solo se ve la actividad si es del usuario
  if not exists (select 1 from public.activities where id = p_activity_id) then
    raise exception 'Actividad no encontrada';
  end if;

  if p_feedback is not null then
    insert into public.activity_feedback as f (
      activity_id, rpe, sensations, notes, terrain_notes,
      ebike_battery_start_pct, ebike_battery_end_pct, ebike_assist_notes
    )
    select p_activity_id, x.rpe, x.sensations, x.notes, x.terrain_notes,
           x.ebike_battery_start_pct, x.ebike_battery_end_pct, x.ebike_assist_notes
    from jsonb_to_record(p_feedback) as x(
      rpe smallint, sensations text, notes text, terrain_notes text,
      ebike_battery_start_pct smallint, ebike_battery_end_pct smallint, ebike_assist_notes text
    )
    on conflict (activity_id) do update set
      rpe = excluded.rpe, sensations = excluded.sensations, notes = excluded.notes,
      terrain_notes = excluded.terrain_notes, ebike_battery_start_pct = excluded.ebike_battery_start_pct,
      ebike_battery_end_pct = excluded.ebike_battery_end_pct, ebike_assist_notes = excluded.ebike_assist_notes;
  end if;

  if p_sets is not null then
    delete from public.strength_sets where activity_id = p_activity_id;
    insert into public.strength_sets (
      activity_id, exercise, set_number, reps, weight_kg, duration_s, notes, status,
      workout_id, block_ref, item_ref, exercise_original,
      load_mode, implements, load_per_implement_kg, reps_scope, distance_m, calories
    )
    select p_activity_id, s.exercise, s.set_number, s.reps, s.weight_kg, s.duration_s, s.notes,
           coalesce(s.status, 'realizado'), s.workout_id, s.block_ref, s.item_ref, s.exercise_original,
           s.load_mode, s.implements, s.load_per_implement_kg, s.reps_scope, s.distance_m, s.calories
    from jsonb_to_recordset(p_sets) as s(
      exercise text, set_number smallint, reps smallint, weight_kg numeric, duration_s integer, notes text, status text,
      workout_id uuid, block_ref text, item_ref text, exercise_original text,
      load_mode text, implements smallint, load_per_implement_kg numeric, reps_scope text, distance_m numeric, calories numeric
    );
  end if;

  if p_results is not null then
    if exists (
      select 1 from jsonb_to_recordset(p_results) as r(workout_id uuid)
      where not exists (select 1 from public.workouts w where w.id = r.workout_id and w.activity_id = p_activity_id)
    ) then
      raise exception 'Un resultado no corresponde a un WOD de esta actividad';
    end if;
    insert into public.workout_block_results as t (workout_id, block_ref, status, personal, team, rpe, adaptations, notes)
    select r.workout_id, r.block_ref, r.status, coalesce(r.personal, '{}'::jsonb), coalesce(r.team, '{}'::jsonb),
           r.rpe, r.adaptations, r.notes
    from jsonb_to_recordset(p_results) as r(
      workout_id uuid, block_ref text, status text, personal jsonb, team jsonb, rpe smallint, adaptations text, notes text
    )
    on conflict (workout_id, block_ref) do update set
      status = excluded.status, personal = excluded.personal, team = excluded.team,
      rpe = excluded.rpe, adaptations = excluded.adaptations, notes = excluded.notes;
  end if;
end;
$$;

revoke all on function public.save_activity_session(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_activity_session(uuid, jsonb, jsonb, jsonb) to authenticated;
