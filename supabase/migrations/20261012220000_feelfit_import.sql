-- =====================================================================
-- Adolfo Training · Importación del export de Feelfit
--
-- Migración ADITIVA e idempotente:
--   * Nuevo origen 'feelfit' para body_measurements (los existentes no cambian).
--   * Columnas opcionales de composición corporal. Son ESTIMACIONES de la
--     báscula por bioimpedancia; solo el peso es una medida directa.
--   * Un 0 o un dato ausente se guarda como NULL (los CHECK impiden ceros).
--   * Reimportar el mismo export no duplica: external_id = 'feelfit:<fecha y hora>'
--     y la restricción única (user_id, source, external_id) ya existente.
-- =====================================================================

alter table public.body_measurements drop constraint if exists body_measurements_source_check;
alter table public.body_measurements
  add constraint body_measurements_source_check check (source in ('intervals', 'manual', 'feelfit'));

alter table public.body_measurements add column if not exists bmi numeric;
alter table public.body_measurements add column if not exists muscle_mass_kg numeric;
alter table public.body_measurements add column if not exists skeletal_muscle_pct numeric;
alter table public.body_measurements add column if not exists fat_free_mass_kg numeric;
alter table public.body_measurements add column if not exists subcutaneous_fat_pct numeric;
alter table public.body_measurements add column if not exists visceral_fat numeric;
alter table public.body_measurements add column if not exists body_water_pct numeric;
alter table public.body_measurements add column if not exists bone_mass_kg numeric;
alter table public.body_measurements add column if not exists protein_pct numeric;
alter table public.body_measurements add column if not exists bmr_kcal integer;
alter table public.body_measurements add column if not exists metabolic_age smallint;

do $$
declare
  c record;
begin
  for c in select * from (values
    ('body_measurements_bmi_check',                  'bmi > 0 and bmi <= 80'),
    ('body_measurements_muscle_mass_check',          'muscle_mass_kg > 0 and muscle_mass_kg <= 200'),
    ('body_measurements_skeletal_muscle_pct_check',  'skeletal_muscle_pct > 0 and skeletal_muscle_pct <= 100'),
    ('body_measurements_fat_free_mass_check',        'fat_free_mass_kg > 0 and fat_free_mass_kg <= 250'),
    ('body_measurements_subcutaneous_fat_pct_check', 'subcutaneous_fat_pct > 0 and subcutaneous_fat_pct <= 100'),
    ('body_measurements_visceral_fat_check',         'visceral_fat > 0 and visceral_fat <= 60'),
    ('body_measurements_body_water_pct_check',       'body_water_pct > 0 and body_water_pct <= 100'),
    ('body_measurements_bone_mass_check',            'bone_mass_kg > 0 and bone_mass_kg <= 20'),
    ('body_measurements_protein_pct_check',          'protein_pct > 0 and protein_pct <= 100'),
    ('body_measurements_bmr_check',                  'bmr_kcal > 0 and bmr_kcal <= 6000'),
    ('body_measurements_metabolic_age_check',        'metabolic_age > 0 and metabolic_age <= 120')
  ) as t(name, expr)
  loop
    if not exists (select 1 from pg_constraint where conname = c.name) then
      execute format('alter table public.body_measurements add constraint %I check (%s)', c.name, c.expr);
    end if;
  end loop;
end;
$$;
