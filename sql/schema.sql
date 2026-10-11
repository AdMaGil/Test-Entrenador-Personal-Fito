-- ============================================================
-- Esquema Supabase: entrenador personal (Garmin + Feelfit)
-- ============================================================

create extension if not exists "uuid-ossp";

create table if not exists training_metrics (
  id                uuid primary key default uuid_generate_v4(),
  activity_id       text unique,
  date              date not null,
  activity_type     text,
  name              text,
  duration_min      numeric,
  distance_km       numeric,
  avg_hr            numeric,
  max_hr            numeric,
  hrv               numeric,
  sleep_score       numeric,
  body_battery      numeric,
  training_load     numeric,
  calories          numeric,
  created_at        timestamptz default now()
);

create index if not exists idx_training_metrics_date on training_metrics (date desc);

create table if not exists body_composition (
  id                uuid primary key default uuid_generate_v4(),
  date              date not null unique,
  weight_kg         numeric,
  fat_pct           numeric,
  muscle_pct        numeric,
  water_pct         numeric,
  bone_mass_kg      numeric,
  bmi               numeric,
  visceral_fat      numeric,
  created_at        timestamptz default now()
);

create index if not exists idx_body_composition_date on body_composition (date desc);

alter table training_metrics enable row level security;
alter table body_composition enable row level security;

create policy "Lectura pública de training_metrics"
  on training_metrics for select
  using (true);

create policy "Lectura pública de body_composition"
  on body_composition for select
  using (true);
