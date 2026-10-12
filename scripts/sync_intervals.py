"""
Sincroniza actividades, bienestar diario (HRV, sueño, Body Battery) y peso /
composición corporal desde intervals.icu hacia Supabase.

Garmin -> intervals.icu (actividades y bienestar) y Feelfit -> Health
Connect -> Health Sync -> intervals.icu (peso) llegan por el mismo canal.

Variables de entorno requeridas (GitHub Secrets):
  INTERVALS_ATHLETE_ID
  INTERVALS_API_KEY
  SUPABASE_URL
  SUPABASE_SERVICE_KEY
"""

import os
import sys
import time
import requests
from datetime import date, timedelta

INTERVALS_ATHLETE_ID = os.environ["INTERVALS_ATHLETE_ID"]
INTERVALS_API_KEY = os.environ["INTERVALS_API_KEY"]
SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

LOOKBACK_DAYS = int(os.environ.get("LOOKBACK_DAYS", "30"))

MAX_RETRIES = 4
RETRY_BACKOFF_BASE = 5  # seconds: 5, 10, 20, 40...


def _request_with_retry(method, url, **kwargs):
    """Wraps requests.request to retry on transient network errors
    (DNS resolution failures, connection resets, timeouts), which happen
    occasionally on GitHub Actions runners and are not caused by bad
    config. Raises the last exception if all retries are exhausted."""
    last_exc = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return requests.request(method, url, **kwargs)
        except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as exc:
            last_exc = exc
            if attempt == MAX_RETRIES:
                break
            wait = RETRY_BACKOFF_BASE * (2 ** (attempt - 1))
            print(
                f"[retry] intento {attempt}/{MAX_RETRIES} fallido para {url}: {exc}. "
                f"Reintentando en {wait}s...",
                file=sys.stderr,
            )
            time.sleep(wait)
    raise last_exc


def fetch_activities():
    oldest = (date.today() - timedelta(days=LOOKBACK_DAYS)).isoformat()
    newest = date.today().isoformat()
    url = f"https://intervals.icu/api/v1/athlete/{INTERVALS_ATHLETE_ID}/activities"
    params = {"oldest": oldest, "newest": newest}
    resp = _request_with_retry(
        "GET", url, params=params, auth=("API_KEY", INTERVALS_API_KEY), timeout=30
    )
    resp.raise_for_status()
    return resp.json()


def fetch_wellness():
    oldest = (date.today() - timedelta(days=LOOKBACK_DAYS)).isoformat()
    newest = date.today().isoformat()
    url = f"https://intervals.icu/api/v1/athlete/{INTERVALS_ATHLETE_ID}/wellness"
    params = {"oldest": oldest, "newest": newest}
    resp = _request_with_retry(
        "GET", url, params=params, auth=("API_KEY", INTERVALS_API_KEY), timeout=30
    )
    resp.raise_for_status()
    return resp.json()


def upsert_supabase(table, rows, conflict_col):
    if not rows:
        print(f"[{table}] nada que sincronizar")
        return
    url = f"{SUPABASE_URL}/rest/v1/{table}"
    headers = {
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }
    resp = _request_with_retry(
        "POST", f"{url}?on_conflict={conflict_col}", headers=headers, json=rows, timeout=30
    )
    if not resp.ok:
        print(f"[{table}] ERROR {resp.status_code}: {resp.text}", file=sys.stderr)
        resp.raise_for_status()
    print(f"[{table}] {len(rows)} filas sincronizadas")


def build_activity_rows(activities, wellness_by_date):
    rows = []
    for a in activities:
        d = (a.get("start_date_local") or "")[:10]
        wellness = wellness_by_date.get(d, {})
        rows.append({
            "activity_id": str(a.get("id")),
            "date": d,
            "activity_type": a.get("type"),
            "name": a.get("name"),
            "duration_min": round((a.get("moving_time") or 0) / 60, 1),
            "distance_km": round((a.get("distance") or 0) / 1000, 2),
            "avg_hr": a.get("average_heartrate"),
            "max_hr": a.get("max_heartrate"),
            "hrv": wellness.get("hrv"),
            "sleep_score": wellness.get("sleepScore") or wellness.get("sleep_score"),
            "body_battery": wellness.get("bodyBattery") or wellness.get("body_battery"),
            "training_load": a.get("icu_training_load"),
            "calories": a.get("calories"),
        })
    return rows


def build_body_composition_rows(wellness):
    rows = []
    for w in wellness:
        d = w.get("id") or w.get("date")
        weight = w.get("weight")
        if not d or weight is None:
            continue
        rows.append({
            "date": d,
            "weight_kg": weight,
            "fat_pct": w.get("bodyFat"),
            "muscle_pct": None,
            "water_pct": None,
            "bone_mass_kg": None,
            "bmi": w.get("bmi"),
            "visceral_fat": None,
        })
    return rows


def main():
    activities = fetch_activities()
    wellness = fetch_wellness()
    wellness_by_date = {w.get("id") or w.get("date"): w for w in wellness}

    activity_rows = build_activity_rows(activities, wellness_by_date)
    upsert_supabase("training_metrics", activity_rows, conflict_col="activity_id")

    body_rows = build_body_composition_rows(wellness)
    upsert_supabase("body_composition", body_rows, conflict_col="date")


if __name__ == "__main__":
    exit_code = 0

    # 1) Tablas heredadas del panel original (se mantiene hasta el cambio a la nueva app)
    try:
        main()
    except Exception as exc:
        # Emitted as a GitHub Actions "error" workflow command so it shows
        # up as a check-run annotation (readable via the REST API), not
        # just in the raw log stream.
        print(f"::error::sync_intervals.py fallo: {type(exc).__name__}: {exc}", file=sys.stderr)
        exit_code = 1

    # 2) Modelo de datos de Adolfo Training (se omite si las migraciones no están aplicadas)
    try:
        import intervals_sync

        if intervals_sync.main() != 0:
            exit_code = 1
    except Exception as exc:  # noqa: BLE001
        print(f"::error::intervals_sync fallo: {type(exc).__name__}: {exc}", file=sys.stderr)
        exit_code = 1

    sys.exit(exit_code)
