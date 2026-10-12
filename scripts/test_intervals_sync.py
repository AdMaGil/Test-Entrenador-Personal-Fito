"""
Pruebas de la sincronización con Intervals.icu y Supabase simulados.

Ejecutar:  python -m unittest scripts/test_intervals_sync.py
"""
import json
import os
import sys
import unittest
from datetime import date
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.dirname(__file__))
import intervals_sync as s  # noqa: E402

USER = "00000000-0000-4000-8000-00000000000a"


class FakeResp:
    def __init__(self, status, payload=None, headers=None):
        self.status_code = status
        self._payload = payload
        self.headers = headers or {}
        self.text = json.dumps(payload) if payload is not None else ""

    @property
    def ok(self):
        return 200 <= self.status_code < 300

    def json(self):
        return self._payload

    def raise_for_status(self):
        if not self.ok:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeWorld:
    """Intervals.icu + PostgREST mínimos en memoria."""

    def __init__(self, activities, wellness, streams_status=200):
        self.activities = activities
        self.wellness = wellness
        self.streams_status = streams_status
        self.tables = {t: [] for t in ["data_connections", "sync_runs", "activities", "activity_streams",
                                        "wellness_daily", "body_measurements"]}
        self.calls = []
        self._id = 0
        self.rate_limit_once = False

    def next_id(self):
        self._id += 1
        return f"id-{self._id}"

    def __call__(self, method, url, **kw):
        self.calls.append((method, url))
        u = urlparse(url)
        params = {k: v for k, v in (kw.get("params") or {}).items()}
        if "intervals.icu" in u.netloc:
            if self.rate_limit_once:
                self.rate_limit_once = False
                return FakeResp(429, {}, {"Retry-After": "1"})
            if u.path.endswith("/activities"):
                return FakeResp(200, self.activities)
            if u.path.endswith("/wellness"):
                return FakeResp(200, self.wellness)
            if "/streams" in u.path:
                if self.streams_status != 200:
                    return FakeResp(self.streams_status, {})
                return FakeResp(200, [{"type": "time", "data": list(range(10))},
                                      {"type": "heartrate", "data": [120] * 10}])
            return FakeResp(404, {})
        table = u.path.split("/rest/v1/")[1]
        rows = self.tables[table]
        body = kw.get("json")
        if method == "GET":
            out = rows
            for k, v in params.items():
                if k in ("select", "order", "limit"):
                    continue
                if v.startswith("eq."):
                    out = [r for r in out if str(r.get(k)) == v[3:]]
                elif v.startswith("neq."):
                    out = [r for r in out if str(r.get(k)) != v[4:]]
                elif v.startswith("in.("):
                    vals = v[4:-1].split(",")
                    out = [r for r in out if r.get(k) in vals]
            return FakeResp(200, out)
        if method == "PATCH":
            for r in rows:
                if all(str(r.get(k)) == v[3:] for k, v in params.items()):
                    r.update(body)
            return FakeResp(204)
        if method == "POST":
            items = body if isinstance(body, list) else [body]
            conflict = params.get("on_conflict")
            result = []
            for item in items:
                existing = None
                if conflict:
                    keys = conflict.split(",")
                    existing = next((r for r in rows if all(r.get(k) == item.get(k) for k in keys)), None)
                if existing is not None:
                    existing.update(item)  # merge-duplicates: solo columnas enviadas
                    result.append(existing)
                else:
                    new = {"id": self.next_id(), **item}
                    rows.append(new)
                    result.append(new)
            return FakeResp(201, result)
        raise AssertionError(method)


def activity(i, typ="HighIntensityIntervalTraining"):
    return {"id": f"i{i}", "type": typ, "name": f"Sesión {i}", "start_date": "2026-10-05T17:00:00Z",
            "start_date_local": "2026-10-05T19:00:00", "elapsed_time": 3000, "moving_time": 2900,
            "average_heartrate": 130, "max_heartrate": 170, "icu_training_load": 40, "calories": 500,
            "icu_hr_zone_times": [600, 900, 800, 400, 200, 100, 0], "icu_hr_zones": [120, 135, 150, 160, 170, 180, 190],
            "stream_types": ["time", "heartrate"], "has_heartrate": True, "device_name": "Garmin fenix 8"}


class Pure(unittest.TestCase):
    def test_categories(self):
        self.assertEqual(s.normalize_category("HighIntensityIntervalTraining"), ("hiit", False))
        self.assertEqual(s.normalize_category("EMountainBikeRide"), ("emtb", False))
        self.assertEqual(s.normalize_category("MountainBikeRide"), ("mtb", False))
        # e-MTB y MTB nunca se mezclan automáticamente: lo ambiguo se marca para revisar
        self.assertEqual(s.normalize_category("Ride"), ("otro", True))
        self.assertEqual(s.normalize_category("EBikeRide"), ("emtb", True))
        self.assertEqual(s.normalize_category("Kayaking"), ("otro", True))

    def test_activity_never_writes_override(self):
        row = s.map_activity(activity(1), USER, "now")
        self.assertNotIn("category_override", row)
        self.assertEqual(row["source_type"], "HighIntensityIntervalTraining")
        self.assertEqual(row["hr_zone_times_s"][1], 900)
        self.assertNotIn("skyline_chart_bytes", row["raw"])

    def test_missing_values_stay_null(self):
        a = activity(1)
        del a["calories"]
        row = s.map_activity(a, USER, "now")
        self.assertIsNone(row["calories"])
        self.assertIsNone(row["distance_m"])

    def test_power_source(self):
        a = activity(1, "MountainBikeRide")
        a["icu_average_watts"] = 180
        a["device_watts"] = False
        self.assertEqual(s.map_activity(a, USER, "now")["rider_power_source"], "estimado")
        a["device_watts"] = True
        self.assertEqual(s.map_activity(a, USER, "now")["rider_power_source"], "medidor")

    def test_only_real_weights(self):
        self.assertIsNone(s.map_measurement({"id": "2026-10-10", "weight": None}, USER, "now"))
        m = s.map_measurement({"id": "2026-10-11", "weight": 80.1, "bodyFat": 14}, USER, "now")
        self.assertEqual(m["external_id"], "2026-10-11")
        self.assertEqual(m["weight_kg"], 80.1)

    def test_streams(self):
        out = s.convert_streams([{"type": "latlng", "data": [40.0, 40.1], "data2": [-3.0, -3.1]},
                                 {"type": "heartrate", "data": [100, 110]}])
        self.assertEqual(out["latlng"], [[40.0, -3.0], [40.1, -3.1]])
        long = s.convert_streams([{"type": "time", "data": list(range(5000))},
                                  {"type": "heartrate", "data": list(range(5000))}])
        self.assertEqual(len(long["time"]), s.MAX_STREAM_POINTS)
        self.assertEqual(long["time"], long["heartrate"])

    def test_window(self):
        today = date(2026, 10, 11)
        mode, oldest, _ = s.compute_window({"last_success_at": None, "sync_from": None}, today, None)
        self.assertEqual(mode, "inicial")
        self.assertEqual((today - oldest).days, s.INITIAL_DAYS)
        mode, oldest, _ = s.compute_window({"last_success_at": "2026-10-10T06:00:00+00:00"}, today, None)
        self.assertEqual(mode, "incremental")
        self.assertEqual(oldest, date(2026, 10, 3))


class EndToEnd(unittest.TestCase):
    def setUp(self):
        self.world = FakeWorld(
            activities=[activity(1), activity(2, "Ride")],
            wellness=[{"id": "2026-10-10", "weight": None, "hrv": 50, "ctl": 6, "atl": 14},
                      {"id": "2026-10-11", "weight": 80.1, "bodyFat": 14, "ctl": 6, "atl": 13}],
        )
        self.world.tables["data_connections"].append(
            {"id": "c1", "user_id": USER, "provider": "intervals", "status": "pendiente",
             "last_success_at": None, "sync_from": None, "created_at": "x"})
        self._orig = s.http
        s.http = lambda method, url, **kw: self.world(method, url, **kw)
        self.ivl = s.Intervals("0", "k")
        self.sb = s.Supabase("https://x.supabase.co", "svc")

    def tearDown(self):
        s.http = self._orig

    def run_sync(self):
        conn = self.world.tables["data_connections"][0]
        return s.sync_connection(self.ivl, self.sb, conn, None)

    def test_no_duplicates_and_override_survives(self):
        stats, status = self.run_sync()
        self.assertEqual(status, "parcial" if stats.warnings else "ok")
        acts = self.world.tables["activities"]
        self.assertEqual(len(acts), 2)
        ride = next(a for a in acts if a["external_id"] == "i2")
        self.assertTrue(ride["category_ambiguous"])
        ride["category_override"] = "mtb"  # corrección del usuario

        self.run_sync()
        self.assertEqual(len(self.world.tables["activities"]), 2, "no debe duplicar")
        ride = next(a for a in self.world.tables["activities"] if a["external_id"] == "i2")
        self.assertEqual(ride["category_override"], "mtb", "la corrección debe sobrevivir")
        self.assertEqual(len(self.world.tables["activity_streams"]), 2, "streams una sola vez")
        stream_calls = [c for c in self.world.calls if "/streams" in c[1]]
        self.assertEqual(len(stream_calls), 2, "no vuelve a pedir streams ya guardados")

    def test_weight_only_real_days_and_incremental(self):
        self.run_sync()
        meas = self.world.tables["body_measurements"]
        self.assertEqual(len(meas), 1)
        self.assertEqual(meas[0]["measured_on"], "2026-10-11")
        conn = self.world.tables["data_connections"][0]
        self.assertIsNotNone(conn["last_success_at"])
        stats, _ = self.run_sync()
        runs = self.world.tables["sync_runs"]
        self.assertEqual(runs[-1]["mode"], "incremental")

    def test_partial_access_is_reported(self):
        self.world.streams_status = 403
        stats, status = self.run_sync()
        self.assertEqual(status, "parcial")
        self.assertTrue(any("Garmin" in w for w in stats.warnings))
        self.assertEqual(self.world.tables["data_connections"][0]["status"], "parcial")

    def test_rate_limit_retry(self):
        sleeps = []
        s.http = lambda method, url, **kw: self._orig(method, url, sleep=sleeps.append, **kw)
        import requests
        orig_req = requests.request
        requests.request = lambda method, url, **kw: self.world(method, url, **kw)
        try:
            self.world.rate_limit_once = True
            r = s.Intervals("0", "k").get("/athlete/0/activities")
            self.assertEqual(r.status_code, 200)
            self.assertEqual(sleeps, [1.0])
        finally:
            requests.request = orig_req


if __name__ == "__main__":
    unittest.main()
