// Prueba de migraciones y RLS sobre PostgreSQL embebido (PGlite).
//
// Simula lo imprescindible de Supabase (roles, auth.uid(), storage) y
// comprueba que:
//   * las migraciones se aplican sobre el esquema heredado sin perder datos
//   * se pueden volver a aplicar (idempotentes)
//   * un usuario no puede leer ni escribir datos de otro
//   * la sincronización no pisa la corrección manual de categoría
//   * no hay duplicados por ID externo
//   * el almacenamiento de fotos solo admite la carpeta del propietario
//
// Uso:  cd supabase/tests && npm install && node run_migrations_test.mjs
import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const migrationsDir = join(root, "supabase", "migrations");

const db = new PGlite({ extensions: { uuid_ossp } });

let passed = 0;
let failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ✔", msg); }
  else { failed++; console.log("  ✘", msg); }
}
async function expectError(fn, msg) {
  try { await fn(); ok(false, msg + " (no dio error)"); }
  catch { ok(true, msg); }
}

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

async function as(user, fn) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
  try { return await fn(); }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}

// --- Entorno mínimo tipo Supabase ---------------------------------------
await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;

  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(),
    bucket_id text references storage.buckets(id), name text, owner uuid);
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  alter table storage.objects enable row level security;
  grant usage on schema storage to authenticated, anon;
  grant all on storage.objects to authenticated;
  grant execute on function storage.foldername(text) to authenticated;

  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`);

// --- Esquema heredado + datos existentes --------------------------------
console.log("Esquema heredado");
await db.exec(readFileSync(join(root, "sql", "schema.sql"), "utf8"));
await db.exec(`
  grant all on public.training_metrics, public.body_composition to anon, authenticated;
  insert into training_metrics (activity_id, date, activity_type) values ('legacy-1', '2026-10-01', 'HIIT');
  insert into body_composition (date, weight_kg) values ('2026-10-11', 80.1);
`);
await db.exec(`set role anon;`);
let legacy = await db.query(`select count(*)::int as n from training_metrics`);
await db.exec(`reset role;`);
ok(legacy.rows[0].n === 1, "antes de migrar, la clave anónima podía leer datos de salud (problema que se corrige)");

// --- Migraciones (dos veces para comprobar idempotencia) -----------------
const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
for (const pass of [1, 2]) {
  console.log(`Aplicando migraciones (pasada ${pass})`);
  for (const f of files) {
    try {
      await db.exec(readFileSync(join(migrationsDir, f), "utf8"));
      ok(true, `${f}`);
    } catch (e) {
      ok(false, `${f}: ${e.message}`);
    }
  }
}

// --- Datos heredados conservados y ya no públicos ------------------------
console.log("Tablas heredadas");
const keep = await db.query(`select (select count(*) from training_metrics)::int as t, (select count(*) from body_composition)::int as b`);
ok(keep.rows[0].t === 1 && keep.rows[0].b === 1, "los datos heredados se conservan");
await db.exec(`set role anon;`);
legacy = await db.query(`select count(*)::int as n from training_metrics`);
await db.exec(`reset role;`);
ok(legacy.rows[0].n === 0, "la clave anónima ya no puede leer las tablas heredadas");

// --- Usuarios y perfiles -------------------------------------------------
console.log("Usuarios y perfiles");
await db.exec(`insert into auth.users (id, email) values ('${A}', 'a@test'), ('${B}', 'b@test');`);
const prof = await db.query(`select count(*)::int as n from profiles`);
ok(prof.rows[0].n === 2, "se crea un perfil vacío por usuario");
const pa = await db.query(`select hr_max_bpm, weight_goal_kg, timezone from profiles where user_id = '${A}'`);
ok(pa.rows[0].hr_max_bpm === null && pa.rows[0].weight_goal_kg === null, "el perfil no inventa FC máxima ni peso objetivo");
ok(pa.rows[0].timezone === "Europe/Madrid", "zona horaria por defecto Europe/Madrid");

// --- Aislamiento entre usuarios -----------------------------------------
console.log("RLS de actividades");
await as(A, () => db.exec(`
  insert into activities (source, external_id, local_date, source_type, category_auto)
  values ('import', 'imp-1', '2026-10-05', 'Ride', 'otro');
  insert into planned_sessions (date, category, title) values ('2026-10-12', 'hiit', 'Rack');
  insert into daily_checkins (date, energy, fatigue) values ('2026-10-11', 4, 2);
`));
const aSees = await as(A, () => db.query(`select count(*)::int as n from activities`));
const bSees = await as(B, () => db.query(`select count(*)::int as n from activities`));
ok(aSees.rows[0].n === 1, "A ve su actividad");
ok(bSees.rows[0].n === 0, "B no ve la actividad de A");
const bPlans = await as(B, () => db.query(`select count(*)::int as n from planned_sessions`));
ok(bPlans.rows[0].n === 0, "B no ve la planificación de A");
await expectError(
  () => as(B, () => db.exec(`insert into activities (user_id, source, external_id, local_date) values ('${A}', 'import', 'x', '2026-10-01')`)),
  "B no puede crear filas a nombre de A",
);
const bUpd = await as(B, () => db.query(`update planned_sessions set title = 'hack' returning id`));
ok(bUpd.rows.length === 0, "B no puede modificar la planificación de A");

// --- Sincronización vs. corrección manual --------------------------------
console.log("Categorías y duplicados");
await db.exec(`
  insert into activities (user_id, source, external_id, local_date, source_type, category_auto, category_ambiguous, training_load)
  values ('${A}', 'intervals', 'i100', '2026-10-10', 'EBikeRide', 'emtb', true, 40);
`);
let row = (await db.query(`select category, category_needs_review from activities where external_id = 'i100'`)).rows[0];
ok(row.category === "emtb" && row.category_needs_review === true, "tipo ambiguo queda pendiente de revisar");
await as(A, () => db.exec(`update activities set category_override = 'mtb' where external_id = 'i100'`));
// La siguiente sincronización vuelve a escribir los campos de origen (upsert)
await db.exec(`
  insert into activities (user_id, source, external_id, local_date, source_type, category_auto, category_ambiguous, training_load)
  values ('${A}', 'intervals', 'i100', '2026-10-10', 'EBikeRide', 'emtb', true, 42)
  on conflict (user_id, source, external_id) do update set
    source_type = excluded.source_type, category_auto = excluded.category_auto,
    category_ambiguous = excluded.category_ambiguous, training_load = excluded.training_load;
`);
row = (await db.query(`select category, category_override, category_needs_review, training_load from activities where external_id = 'i100'`)).rows[0];
ok(row.category === "mtb" && row.category_override === "mtb", "la sincronización conserva la corrección manual (MTB)");
ok(row.category_needs_review === false, "una actividad corregida deja de estar pendiente");
ok(Number(row.training_load) === 42, "los datos medidos sí se actualizan");
const dup = await db.query(`select count(*)::int as n from activities where external_id = 'i100'`);
ok(dup.rows[0].n === 1, "sin duplicados por ID externo");
await expectError(
  () => as(A, () => db.exec(`update activities set training_load = 999 where external_id = 'i100'`)),
  "el usuario no puede alterar datos medidos del origen",
);
await expectError(
  () => as(A, () => db.exec(`update activities set category_auto = 'hiit' where external_id = 'i100'`)),
  "el usuario no puede alterar la categoría automática",
);

// --- Conexiones y sincronizaciones --------------------------------------
console.log("Conexiones");
await as(A, () => db.exec(`insert into data_connections (provider, status) values ('intervals', 'pendiente')`));
await as(A, () => db.exec(`update data_connections set status = 'desactivada'`));
ok(true, "el usuario puede activar/desactivar su conexión");
await expectError(
  () => as(A, () => db.exec(`update data_connections set last_error = 'x'`)),
  "el usuario no puede falsear el estado de sincronización",
);
await expectError(
  () => as(A, () => db.exec(`insert into sync_runs (user_id, provider) values ('${A}', 'intervals')`)),
  "el usuario no puede insertar ejecuciones de sincronización",
);

// --- Fotos ---------------------------------------------------------------
console.log("Almacenamiento de fotos");
const bucket = (await db.query(`select public from storage.buckets where id = 'progress-photos'`)).rows[0];
ok(bucket && bucket.public === false, "el bucket de fotos es privado");
await as(A, () => db.exec(`insert into storage.objects (bucket_id, name) values ('progress-photos', '${A}/e1/frontal-original.jpg')`));
ok(true, "A sube a su carpeta");
await expectError(
  () => as(A, () => db.exec(`insert into storage.objects (bucket_id, name) values ('progress-photos', '${B}/e1/frontal-original.jpg')`)),
  "A no puede subir a la carpeta de B",
);
const bObj = await as(B, () => db.query(`select count(*)::int as n from storage.objects`));
ok(bObj.rows[0].n === 0, "B no ve las fotos de A");
const bDel = await as(B, () => db.query(`delete from storage.objects returning id`));
ok(bDel.rows.length === 0, "B no puede borrar las fotos de A");

const entry = await as(A, () => db.query(`insert into photo_entries (taken_on) values ('2026-10-11') returning id`));
const eid = entry.rows[0].id;
await as(A, () => db.exec(`insert into photo_files (entry_id, pose, original_path) values ('${eid}', 'frontal', '${A}/${eid}/frontal-original.jpg')`));
await as(A, () => db.exec(`delete from photo_entries where id = '${eid}'`));
const orphan = await db.query(`select count(*)::int as n from photo_files where entry_id = '${eid}'`);
ok(orphan.rows[0].n === 0, "borrar un registro elimina sus filas de archivos");

// --- WOD importados (Entrega 1) ------------------------------------------
console.log("WOD importados");
const actA = (await as(A, () => db.query(`select id from activities limit 1`))).rows[0].id;
const actB = (await as(B, () => db.query(`
  insert into activities (source, external_id, local_date, category_auto) values ('import', 'imp-b', '2026-10-06', 'hiit') returning id`))).rows[0].id;
const spec = JSON.stringify({ formato: "adolfo-wod", version: 1, bloques: [{ id: "b1", tipo: "amrap", ejercicios: [] }] });
const w1 = await as(A, () => db.query(
  `insert into workouts (client_ref, activity_id, spec, title) values ('ref-aaaa-0001', '${actA}', '${spec}', 'HYROX') returning id`));
ok(w1.rows.length === 1, "A guarda un WOD vinculado a su actividad");
const dupW = await as(A, () => db.query(
  `insert into workouts (client_ref, spec) values ('ref-aaaa-0001', '${spec}') on conflict (user_id, client_ref) do nothing returning id`));
ok(dupW.rows.length === 0, "repetir la misma importación (doble clic o reintento) no crea un duplicado");
const bW = await as(B, () => db.query(`select count(*)::int as n from workouts`));
ok(bW.rows[0].n === 0, "B no ve los WOD de A");
await expectError(
  () => as(B, () => db.exec(`insert into workouts (client_ref, activity_id, spec) values ('ref-bbbb-0001', '${actA}', '${spec}')`)),
  "B no puede vincular un WOD a una actividad de A",
);
await expectError(
  () => as(A, () => db.exec(`update workouts set activity_id = '${actB}' where id = '${w1.rows[0].id}'`)),
  "A no puede vincular su WOD a una actividad de B",
);
const unlinked = await as(A, () => db.query(`insert into workouts (client_ref, spec) values ('ref-aaaa-0002', '${spec}') returning activity_id, planned_session_id`));
ok(unlinked.rows[0].activity_id === null && unlinked.rows[0].planned_session_id === null, "un WOD puede guardarse sin vincular (no se crea ninguna actividad)");

console.log("Series: estado y enlace");
await as(A, () => db.exec(`insert into strength_sets (activity_id, exercise, set_number, reps, weight_kg) values ('${actA}', 'Sentadilla', 1, 5, 80)`));
const st = (await as(A, () => db.query(`select status, workout_id, weight_kg from strength_sets where exercise = 'Sentadilla'`))).rows[0];
ok(st.status === "realizado" && st.workout_id === null && Number(st.weight_kg) === 80, "las series existentes quedan como realizadas, sin enlace y con su peso original");
await expectError(
  () => as(A, () => db.exec(`insert into strength_sets (activity_id, exercise, set_number, status) values ('${actA}', 'X', 1, 'inventado')`)),
  "el estado de una serie solo admite realizado o pendiente",
);
await as(A, () => db.exec(`insert into strength_sets (activity_id, exercise, set_number, reps, status, workout_id, block_ref, item_ref) values ('${actA}', 'Devil press', 1, 15, 'pendiente', '${w1.rows[0].id}', 'b1', 'e4')`));
ok(true, "una serie puede enlazarse con el ejercicio de su WOD y quedar pendiente");

console.log("Reaplicar migraciones con datos");
for (const f of files) await db.exec(readFileSync(join(migrationsDir, f), "utf8"));
const after = (await db.query(`select count(*)::int as n, sum(weight_kg)::numeric as kg from strength_sets`)).rows[0];
ok(after.n === 2 && Number(after.kg) === 80, "volver a aplicar las migraciones no altera las series guardadas");
const wAfter = (await db.query(`select count(*)::int as n from workouts`)).rows[0];
ok(wAfter.n === 2, "volver a aplicar las migraciones no altera los WOD guardados");

console.log("Borrado de una actividad importada");
await as(A, () => db.exec(`delete from activities where id = '${actA}'`));
const orphanW = (await db.query(`select activity_id from workouts where id = '${w1.rows[0].id}'`)).rows[0];
ok(orphanW && orphanW.activity_id === null, "si se borra la actividad, el WOD se conserva sin vínculo");

console.log(`\n${passed} correctas, ${failed} fallidas`);
process.exit(failed ? 1 : 0);
