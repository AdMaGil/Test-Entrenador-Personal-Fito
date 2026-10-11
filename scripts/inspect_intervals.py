"""
Diagnóstico de esquema de la API de Intervals.icu para la cuenta propia.

IMPORTANTE: el repositorio es público y los logs de Actions también.
Este script SOLO imprime nombres de campos, recuentos de valores no nulos,
tipos de deporte y tipos de stream. Nunca imprime valores personales
(pesos, frecuencias cardiacas, nombres de actividades, coordenadas).
"""
import json
import os
import sys
from collections import Counter
from datetime import date, timedelta

import requests

BASE = "https://intervals.icu/api/v1"
ATHLETE = os.environ.get("INTERVALS_ATHLETE_ID") or "0"
KEY = os.environ["INTERVALS_API_KEY"]
AUTH = ("API_KEY", KEY)
HEADERS = {"User-Agent": "Mozilla/5.0 (adolfo-training schema inspector)"}


def notice(title, payload):
    msg = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    # Los comandos de workflow no admiten saltos de línea literales
    print(f"::notice title={title}::{msg}")


def get(path, **params):
    r = requests.get(f"{BASE}{path}", params=params, auth=AUTH, headers=HEADERS, timeout=30)
    return r


def non_null_counts(rows):
    c = Counter()
    for row in rows:
        for k, v in row.items():
            if v not in (None, "", [], {}):
                c[k] += 1
    return dict(sorted(c.items()))


def main():
    oldest = os.environ.get("OLDEST", "2024-01-01")
    newest = date.today().isoformat()

    r = get(f"/athlete/{ATHLETE}/activities", oldest=oldest, newest=newest)
    notice("activities_http", {"status": r.status_code,
                               "ratelimit_remaining": r.headers.get("X-RateLimit-Remaining")})
    if r.status_code != 200:
        notice("activities_error_body_prefix", {"body": r.text[:200]})
        sys.exit(1)
    acts = r.json()
    types = Counter(a.get("type") for a in acts)
    sources = Counter(a.get("source") for a in acts)
    devices = Counter(a.get("device_name") for a in acts)
    dates = sorted((a.get("start_date_local") or "")[:10] for a in acts if a.get("start_date_local"))
    notice("activities_summary", {"count": len(acts), "types": types, "sources": sources,
                                  "devices": devices,
                                  "date_min": dates[0] if dates else None,
                                  "date_max": dates[-1] if dates else None})
    counts = non_null_counts(acts)
    keys = list(counts.items())
    # Partimos en trozos para no exceder el tamaño de una anotación
    for i in range(0, len(keys), 60):
        notice(f"activity_fields_{i // 60}", dict(keys[i:i + 60]))
    underscore = sorted({k for a in acts for k in a.keys() if k.startswith("_")})
    notice("activity_underscore_keys", {"keys": underscore})

    # Detalle + streams de una actividad por tipo
    seen = set()
    for a in acts:
        t = a.get("type")
        if t in seen:
            continue
        seen.add(t)
        aid = a.get("id")
        d = get(f"/activity/{aid}")
        detail_keys = sorted(k for k, v in (d.json().items() if d.ok else []) if v not in (None, "", [], {}))
        extra = sorted(set(detail_keys) - set(counts.keys()))
        s = get(f"/activity/{aid}/streams.json")
        stream_info = {}
        if s.ok:
            try:
                for st in s.json():
                    stream_info[st.get("type")] = len(st.get("data") or [])
            except Exception as e:  # noqa: BLE001
                stream_info = {"parse_error": str(e)[:80]}
        notice(f"detail_{t}", {"detail_http": d.status_code, "extra_detail_keys": extra,
                               "streams_http": s.status_code, "streams": stream_info})

    w = get(f"/athlete/{ATHLETE}/wellness", oldest=oldest, newest=newest)
    notice("wellness_http", {"status": w.status_code})
    if w.ok:
        rows = w.json()
        notice("wellness_summary", {"days": len(rows),
                                    "first": rows[0].get("id") if rows else None,
                                    "last": rows[-1].get("id") if rows else None})
        wc = list(non_null_counts(rows).items())
        for i in range(0, len(wc), 60):
            notice(f"wellness_fields_{i // 60}", dict(wc[i:i + 60]))


if __name__ == "__main__":
    main()
