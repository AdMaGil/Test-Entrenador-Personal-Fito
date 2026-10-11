"""
Sincronización Intervals.icu → Supabase para «Adolfo Training».

Se ejecuta en el servidor (GitHub Actions). La clave de Intervals.icu y la
service_role de Supabase llegan por variables de entorno y nunca se escriben
en logs. Como el repositorio es público, los logs solo muestran recuentos.

Comportamiento:
  * Sincronización inicial (sin éxito previo) o incremental (desde el último
    éxito menos un margen, para recoger ediciones recientes).
  * Upsert por (user_id, source, external_id): nunca duplica actividades.
  * Guarda el tipo original (source_type) y una categoría normalizada
    (category_auto). Nunca escribe category_override, así que las
    correcciones manuales sobreviven a la siguiente sincronización.
  * El peso solo se registra los días en que hay una medición real.
  * Respeta los límites de la API (429 + Retry-After) y registra avisos de
    acceso parcial (p. ej. si Intervals.icu deja de servir datos de Garmin).
"""
from __future__ import annotations

import os
import sys
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

import requests

INTERVALS_BASE = "https://intervals.icu/api/v1"
USER_AGENT = "Mozilla/5.0 (adolfo-training sync)"

# tipo de Intervals.icu → (categoría normalizada, ¿ambiguo?)
CATEGORY_MAP: dict[str, tuple[str, bool]] = {
    "HighIntensityIntervalTraining": ("hiit", False),
    "Crossfit": ("hiit", False),
    "WeightTraining": ("hiit", True),
    "Workout": ("hiit", True),
    "EMountainBikeRide": ("emtb", False),
    "EBikeRide": ("emtb", True),          # eléctrica, pero no necesariamente de montaña
    "MountainBikeRide": ("mtb", False),
    "Run": ("run", False),
    "TrailRun": ("run", False),
    "VirtualRun": ("run", False),
    "Ride": ("otro", True),               # podría ser MTB o e-MTB: lo decide el usuario
    "GravelRide": ("otro", True),
    "VirtualRide": ("otro", True),
}

STREAM_TYPES = "time,heartrate,altitude,latlng,velocity_smooth,cadence,watts,distance"
MAX_STREAM_POINTS = 1500
MAX_STREAMS_PER_RUN = int(os.environ.get("MAX_STREAMS_PER_RUN", "60"))
INITIAL_DAYS = int(os.environ.get("INITIAL_SYNC_DAYS", "365"))
INCREMENTAL_MARGIN_DAYS = 7

RESTRICTION_HINT = (
    "Intervals.icu no ha devuelto todos los datos esperados. Puede deberse a la "
    "restricción del acceso por API a datos de Garmin anunciada el 9 de octubre de 2026. "
    "Puedes importar archivos FIT/GPX/TCX desde la app."
)


# ---------------------------------------------------------------------------
# Transformaciones puras (probadas en tests)
# ---------------------------------------------------------------------------
def normalize_category(source_type: str | None) -> tuple[str, bool]:
    if not source_type:
        return "otro", True
    return CATEGORY_MAP.get(source_type, ("otro", True))


def _num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _int(v: Any) -> int | None:
    n = _num(v)
    return int(round(n)) if n is not None else None


def map_activity(a: dict, user_id: str, now_iso: str) -> dict:
    source_type = a.get("type")
    category, ambiguous = normalize_category(source_type)
    stream_types = a.get("stream_types") or []

    watts = _num(a.get("icu_average_watts")) or _num(a.get("average_watts"))
    if watts is None:
        power_source = None
    elif a.get("device_watts") is True:
        power_source = "medidor"
    else:
        power_source = "estimado"

    key_metrics = [a.get("elapsed_time"), a.get("moving_time"), a.get("start_date_local")]
    restricted = all(v in (None, "", 0) for v in key_metrics[:2]) or any(
        k.startswith("_") for k in a.keys()
    )

    raw = {k: v for k, v in a.items() if k not in ("skyline_chart_bytes", "icu_training_load_data")}

    return {
        "user_id": user_id,
        "source": "intervals",
        "external_id": str(a.get("id")),
        "data_origin": "medido",
        "start_time": a.get("start_date"),
        "local_date": (a.get("start_date_local") or "")[:10] or None,
        "name": a.get("name"),
        "source_type": source_type,
        "category_auto": category,
        "category_ambiguous": ambiguous,
        "duration_s": _int(a.get("elapsed_time")),
        "moving_time_s": _int(a.get("moving_time")),
        "distance_m": _num(a.get("distance")),
        "elevation_gain_m": _num(a.get("total_elevation_gain")),
        "avg_hr": _num(a.get("average_heartrate")),
        "max_hr": _num(a.get("max_heartrate")),
        "avg_speed_ms": _num(a.get("average_speed")),
        "max_speed_ms": _num(a.get("max_speed")),
        "avg_cadence": _num(a.get("average_cadence")),
        "rider_avg_power_w": watts,
        "rider_power_source": power_source,
        "training_load": _num(a.get("icu_training_load")),
        "intensity": _num(a.get("icu_intensity")),
        "trimp": _num(a.get("trimp")),
        "calories": _num(a.get("calories")),
        "hr_zone_times_s": [_int(x) or 0 for x in a.get("icu_hr_zone_times") or []] or None,
        "hr_zone_bounds": [_int(x) or 0 for x in a.get("icu_hr_zones") or []] or None,
        "device_name": a.get("device_name"),
        "has_gps": "latlng" in stream_types,
        "has_heartrate": bool(a.get("has_heartrate")),
        "stream_types": stream_types or None,
        "api_restricted": restricted,
        "raw": raw,
        "source_updated_at": a.get("icu_sync_date"),
        "last_synced_at": now_iso,
    }


def map_wellness(w: dict, user_id: str, now_iso: str) -> dict:
    return {
        "user_id": user_id,
        "source": "intervals",
        "date": w.get("id"),
        "resting_hr": _num(w.get("restingHR")),
        "hrv": _num(w.get("hrv")),
        "sleep_secs": _int(w.get("sleepSecs")),
        "sleep_score": _num(w.get("sleepScore")),
        "sleep_quality": _int(w.get("sleepQuality")),
        "steps": _int(w.get("steps")),
        "ctl": _num(w.get("ctl")),
        "atl": _num(w.get("atl")),
        "ramp_rate": _num(w.get("rampRate")),
        "raw": w,
        "last_synced_at": now_iso,
    }


def map_measurement(w: dict, user_id: str, now_iso: str) -> dict | None:
    """Solo devuelve fila si ese día hay un peso medido de verdad."""
    weight = _num(w.get("weight"))
    if weight is None:
        return None
    day = w.get("id")
    return {
        "user_id": user_id,
        "source": "intervals",
        "external_id": day,
        "measured_on": day,
        "weight_kg": weight,
        "body_fat_pct": _num(w.get("bodyFat")),
        "data_origin": "medido",
        "last_synced_at": now_iso,
    }


def downsample(values: list, max_points: int = MAX_STREAM_POINTS) -> list:
    if len(values) <= max_points:
        return values
    step = len(values) / max_points
    return [values[int(i * step)] for i in range(max_points)]


def convert_streams(stream_list: list[dict]) -> dict:
    """Lista de streams de Intervals.icu → {tipo: datos}, con latlng emparejado."""
    out: dict[str, list] = {}
    for s in stream_list or []:
        t = s.get("type")
        data = s.get("data") or []
        if not t or not data:
            continue
        if t == "latlng":
            lng = s.get("data2") or []
            if lng and len(lng) == len(data):
                data = [[la, lo] for la, lo in zip(data, lng)]
            elif data and isinstance(data[0], (list, tuple)):
                data = [list(p) for p in data]
            else:
                continue
        out[t] = data
    # Todos los streams comparten índice: se reducen con el mismo paso
    if out:
        n = max(len(v) for v in out.values())
        if n > MAX_STREAM_POINTS:
            step = n / MAX_STREAM_POINTS
            idx = [int(i * step) for i in range(MAX_STREAM_POINTS)]
            out = {k: [v[i] for i in idx if i < len(v)] for k, v in out.items()}
    return out


def compute_window(connection: dict, today: date, forced_days: int | None) -> tuple[str, date, date]:
    newest = today + timedelta(days=1)
    if forced_days:
        return "inicial", today - timedelta(days=forced_days), newest
    last_ok = connection.get("last_success_at")
    if not last_ok:
        sync_from = connection.get("sync_from")
        oldest = date.fromisoformat(sync_from) if sync_from else today - timedelta(days=INITIAL_DAYS)
        return "inicial", oldest, newest
    last_day = datetime.fromisoformat(last_ok.replace("Z", "+00:00")).date()
    return "incremental", last_day - timedelta(days=INCREMENTAL_MARGIN_DAYS), newest


# ---------------------------------------------------------------------------
# Clientes HTTP con reintentos y límites
# ---------------------------------------------------------------------------
class RateLimited(Exception):
    pass


def http(method: str, url: str, *, retries: int = 4, sleep: Callable[[float], None] = time.sleep, **kw) -> requests.Response:
    last_exc: Exception | None = None
    timeout = kw.pop("timeout", 30)
    for attempt in range(1, retries + 1):
        try:
            resp = requests.request(method, url, timeout=timeout, **kw)
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as exc:
            last_exc = exc
            sleep(5 * 2 ** (attempt - 1))
            continue
        if resp.status_code == 429:
            wait = float(resp.headers.get("Retry-After") or 30)
            if attempt == retries or wait > 300:
                raise RateLimited(f"Límite de la API alcanzado (Retry-After={wait}s)")
            sleep(wait)
            continue
        if resp.status_code >= 500 and attempt < retries:
            sleep(5 * 2 ** (attempt - 1))
            continue
        return resp
    raise last_exc or RuntimeError("Fallo de red sin respuesta")


@dataclass
class Intervals:
    athlete_id: str
    api_key: str

    def get(self, path: str, **params) -> requests.Response:
        return http("GET", f"{INTERVALS_BASE}{path}", params=params,
                    auth=("API_KEY", self.api_key), headers={"User-Agent": USER_AGENT})


@dataclass
class Supabase:
    url: str
    service_key: str

    @property
    def headers(self) -> dict:
        return {"apikey": self.service_key, "Authorization": f"Bearer {self.service_key}",
                "Content-Type": "application/json"}

    def get(self, table: str, params: dict) -> requests.Response:
        return http("GET", f"{self.url}/rest/v1/{table}", params=params, headers=self.headers)

    def insert(self, table: str, row: dict) -> dict:
        r = http("POST", f"{self.url}/rest/v1/{table}", json=row,
                 headers={**self.headers, "Prefer": "return=representation"})
        r.raise_for_status()
        return r.json()[0]

    def patch(self, table: str, match: dict, values: dict) -> None:
        params = {k: f"eq.{v}" for k, v in match.items()}
        r = http("PATCH", f"{self.url}/rest/v1/{table}", params=params, json=values,
                 headers={**self.headers, "Prefer": "return=minimal"})
        r.raise_for_status()

    def upsert(self, table: str, rows: list[dict], on_conflict: str, returning: str | None = None) -> list[dict]:
        if not rows:
            return []
        prefer = "resolution=merge-duplicates," + ("return=representation" if returning else "return=minimal")
        params = {"on_conflict": on_conflict}
        if returning:
            params["select"] = returning
        out: list[dict] = []
        for i in range(0, len(rows), 200):
            r = http("POST", f"{self.url}/rest/v1/{table}", params=params, json=rows[i:i + 200],
                     headers={**self.headers, "Prefer": prefer})
            if not r.ok:
                raise RuntimeError(f"Error {r.status_code} al guardar en {table}: {r.text[:300]}")
            if returning:
                out.extend(r.json())
        return out


@dataclass
class RunStats:
    activities_seen: int = 0
    activities_upserted: int = 0
    streams_fetched: int = 0
    wellness_upserted: int = 0
    measurements_upserted: int = 0
    warnings: list[str] = field(default_factory=list)


def schema_ready(sb: Supabase) -> bool:
    r = sb.get("data_connections", {"select": "id", "limit": "1"})
    if r.status_code in (404,) or (r.status_code >= 400 and "data_connections" in r.text):
        return False
    r.raise_for_status()
    return True


def sync_connection(ivl: Intervals, sb: Supabase, conn: dict, forced_days: int | None) -> tuple[RunStats, str]:
    user_id = conn["user_id"]
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    mode, oldest, newest = compute_window(conn, now.date(), forced_days)
    stats = RunStats()

    run = sb.insert("sync_runs", {
        "user_id": user_id, "provider": "intervals", "mode": mode,
        "window_oldest": oldest.isoformat(), "window_newest": newest.isoformat(),
    })
    status = "ok"
    error_text = None
    try:
        # --- Actividades -------------------------------------------------
        r = ivl.get(f"/athlete/{ivl.athlete_id}/activities", oldest=oldest.isoformat(), newest=newest.isoformat())
        if r.status_code in (401, 403):
            raise RuntimeError(f"Intervals.icu rechazó el acceso a actividades (HTTP {r.status_code}).")
        r.raise_for_status()
        acts = [a for a in r.json() if a.get("id") and a.get("start_date_local")]
        stats.activities_seen = len(acts)
        rows = [map_activity(a, user_id, now_iso) for a in acts]
        if any(row["api_restricted"] for row in rows):
            stats.warnings.append(RESTRICTION_HINT)
        saved = sb.upsert("activities", rows, "user_id,source,external_id", returning="id,external_id,stream_types")
        stats.activities_upserted = len(saved)

        # --- Streams solo para las que aún no tienen -------------------
        ids = [s["id"] for s in saved if s.get("stream_types")]
        have: set[str] = set()
        for i in range(0, len(ids), 100):
            chunk = ids[i:i + 100]
            got = sb.get("activity_streams", {"select": "activity_id", "activity_id": f"in.({','.join(chunk)})"})
            got.raise_for_status()
            have.update(x["activity_id"] for x in got.json())
        pending = [s for s in saved if s.get("stream_types") and s["id"] not in have][:MAX_STREAMS_PER_RUN]
        stream_failures = 0
        for s in pending:
            sr = ivl.get(f"/activity/{s['external_id']}/streams.json", types=STREAM_TYPES)
            if not sr.ok:
                stream_failures += 1
                continue
            streams = convert_streams(sr.json())
            if not streams:
                continue
            sb.upsert("activity_streams", [{"activity_id": s["id"], "user_id": user_id,
                                            "streams": streams, "fetched_at": now_iso}], "activity_id")
            stats.streams_fetched += 1
        if stream_failures:
            stats.warnings.append(f"{stream_failures} actividades sin series temporales disponibles. {RESTRICTION_HINT}")

        # --- Bienestar y mediciones reales -----------------------------
        w = ivl.get(f"/athlete/{ivl.athlete_id}/wellness", oldest=oldest.isoformat(), newest=newest.isoformat())
        if w.ok:
            wellness = [x for x in w.json() if x.get("id")]
            sb.upsert("wellness_daily", [map_wellness(x, user_id, now_iso) for x in wellness], "user_id,source,date")
            stats.wellness_upserted = len(wellness)
            meas = [m for m in (map_measurement(x, user_id, now_iso) for x in wellness) if m]
            sb.upsert("body_measurements", meas, "user_id,source,external_id")
            stats.measurements_upserted = len(meas)
        else:
            stats.warnings.append(f"No se pudo leer el bienestar diario (HTTP {w.status_code}).")

        if stats.warnings:
            status = "parcial"
    except RateLimited as exc:
        status, error_text = "parcial", str(exc)
    except Exception as exc:  # noqa: BLE001
        status, error_text = "error", str(exc)[:500]

    finished = datetime.now(timezone.utc).isoformat()
    sb.patch("sync_runs", {"id": run["id"]}, {
        "finished_at": finished, "status": status, "error": error_text,
        "activities_seen": stats.activities_seen, "activities_upserted": stats.activities_upserted,
        "streams_fetched": stats.streams_fetched, "wellness_upserted": stats.wellness_upserted,
        "measurements_upserted": stats.measurements_upserted, "warnings": stats.warnings,
    })
    conn_update = {"last_sync_at": finished, "last_error": error_text,
                   "status": {"ok": "activa", "parcial": "parcial", "error": "error"}[status]}
    if status in ("ok", "parcial") and error_text is None:
        conn_update["last_success_at"] = finished
    sb.patch("data_connections", {"id": conn["id"]}, conn_update)

    # Solo recuentos en el log: el repositorio es público
    print(f"[adolfo-training] modo={mode} estado={status} actividades={stats.activities_upserted} "
          f"streams={stats.streams_fetched} bienestar={stats.wellness_upserted} "
          f"pesajes={stats.measurements_upserted} avisos={len(stats.warnings)}")
    if status == "error":
        print(f"::error::Sincronización Adolfo Training con error: {error_text}")
    elif stats.warnings:
        print("::warning::Sincronización parcial: " + " | ".join(stats.warnings)[:900])
    return stats, status


def main() -> int:
    ivl = Intervals(os.environ.get("INTERVALS_ATHLETE_ID") or "0", os.environ["INTERVALS_API_KEY"])
    sb = Supabase(os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SERVICE_KEY"])
    forced = os.environ.get("FORCE_LOOKBACK_DAYS")
    forced_days = int(forced) if forced and forced.strip().isdigit() and int(forced) > 0 else None

    if not schema_ready(sb):
        print("::notice::Las tablas de Adolfo Training aún no existen (migraciones sin aplicar). Se omite.")
        return 0
    r = sb.get("data_connections", {"provider": "eq.intervals", "status": "neq.desactivada",
                                    "select": "*", "order": "created_at.asc"})
    r.raise_for_status()
    conns = r.json()
    if not conns:
        print("::notice::No hay ninguna cuenta con la sincronización de Intervals.icu activada en la app.")
        return 0
    if len(conns) > 1:
        print("::warning::Hay varias cuentas conectadas; la clave de Intervals.icu es personal y solo se sincroniza la primera.")
    _, status = sync_connection(ivl, sb, conns[0], forced_days)
    return 1 if status == "error" else 0


if __name__ == "__main__":
    sys.exit(main())
