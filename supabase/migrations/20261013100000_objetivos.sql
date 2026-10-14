-- =====================================================================
-- Objetivos del panel «Hoy» (aditiva e idempotente)
--   * fecha objetivo del peso
--   * meta diaria de calorías activas (kcal de actividades)
--   * sesiones por semana y horas de sueño
-- Todas opcionales: vacías = sin meta (la app no inventa valores).
-- El coach selecciona columnas concretas de profiles: no le afecta.
-- =====================================================================
alter table public.profiles add column if not exists weight_goal_date   date;
alter table public.profiles add column if not exists active_kcal_goal   integer;
alter table public.profiles add column if not exists sessions_week_goal smallint;
alter table public.profiles add column if not exists sleep_goal_h       numeric;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_active_kcal_goal_check') then
    alter table public.profiles add constraint profiles_active_kcal_goal_check
      check (active_kcal_goal is null or active_kcal_goal between 50 and 3000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_sessions_week_goal_check') then
    alter table public.profiles add constraint profiles_sessions_week_goal_check
      check (sessions_week_goal is null or sessions_week_goal between 1 and 14);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_sleep_goal_h_check') then
    alter table public.profiles add constraint profiles_sleep_goal_h_check
      check (sleep_goal_h is null or sleep_goal_h between 4 and 12);
  end if;
end $$;
