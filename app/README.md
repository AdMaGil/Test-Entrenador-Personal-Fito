# Adolfo Training

Aplicación web personal de entrenamiento, salud y evolución física (Vite + React + TypeScript, Supabase).

## Arquitectura

| Pieza | Dónde | Notas |
|---|---|---|
| Web (SPA) | `app/` → GitHub Pages | Solo usa la URL y la clave anónima de Supabase (públicas por diseño). |
| Base de datos y fotos | Supabase | Todas las tablas personales con `user_id` + RLS; bucket privado `progress-photos` con URLs firmadas. |
| Sincronización | `scripts/intervals_sync.py` en GitHub Actions (cada 6 h) | La clave de Intervals.icu y la `service_role` viven solo en secretos de GitHub. |
| IA (opcional) | `supabase/functions/coach` | Desactivada. No recibe fotografías. |

## Puesta en marcha (una vez)

1. **Migraciones**: añade el secreto `SUPABASE_DB_URL` (Supabase › Connect › *Session pooler*) y ejecuta el workflow **«aplicar migraciones (manual)»** escribiendo `aplicar`. Son idempotentes y no borran datos. Retiran la lectura pública de las tablas antiguas `training_metrics` y `body_composition`.
2. **Auth**: en Supabase › Authentication › URL Configuration pon como *Site URL* la dirección de GitHub Pages. Cuando hayas creado tu cuenta, desactiva los registros nuevos (*Allow new users to sign up*).
3. **Publicar**: ejecuta **«publicar en GitHub Pages (manual)»** escribiendo `publicar`. Sustituye al panel anterior.
4. En la app: *Ajustes › Conexiones › Activar sincronización*. La siguiente ejecución de la sincronización hará la carga inicial (último año o la fecha que elijas).

## Desarrollo

```bash
cd app
cp .env.example .env.local   # URL y clave anónima
npm install
npm run dev                  # o: entra con «datos de demostración» sin configurar nada
npm test && npm run typecheck && npm run build
```

Pruebas de base de datos (migraciones + RLS sobre PostgreSQL embebido): `cd supabase/tests && npm install && npm test`.
Pruebas de la sincronización: `python -m unittest scripts/test_intervals_sync.py`.

## Reglas de datos

- Ausente = «Sin datos», nunca cero. Origen visible: medido, estimado, registrado manualmente o demostración.
- El peso solo existe los días con medición real; la media de 7 días necesita ≥3 mediciones.
- Categoría original (`source_type`) y normalizada (`category_auto`); la corrección del usuario (`category_override`) nunca la pisa la sincronización. e-MTB y MTB no se mezclan: los tipos ambiguos quedan «pendientes de revisar».
- HRV y FC en reposo se comparan solo con tu propio histórico (≥7 registros). Sin puntuaciones de recuperación inventadas.
- Los datos de demostración viven en memoria y nunca se escriben en la base de datos.
