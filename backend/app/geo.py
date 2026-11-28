"""Distance / travel-time matrices and road geometry.

Uses the public OSRM road network when reachable and falls back to a
haversine x detour-factor model, so the app never breaks offline.
"""
from __future__ import annotations

import math
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from typing import Any

import httpx
import numpy as np

OSRM = "https://router.project-osrm.org"
TIMEOUT = 6.0
CONGESTION = 1.75          # Indian urban traffic vs OSRM free-flow durations
DETOUR = 1.35              # straight line -> road distance factor (fallback)
FALLBACK_KMPH = 22.0       # average urban delivery speed (fallback)

_matrix_cache: "OrderedDict[tuple, tuple]" = OrderedDict()
_geom_cache: "OrderedDict[tuple, list]" = OrderedDict()


def _cache_put(cache: OrderedDict, key, value, limit=256):
    cache[key] = value
    cache.move_to_end(key)
    while len(cache) > limit:
        cache.popitem(last=False)


def haversine_km(a, b) -> float:
    lng1, lat1 = map(math.radians, a)
    lng2, lat2 = map(math.radians, b)
    dlat, dlng = lat2 - lat1, lng2 - lng1
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def _key(points):
    return tuple((round(p[0], 5), round(p[1], 5)) for p in points)


def base_matrices(points: list[tuple[float, float]]) -> tuple[np.ndarray, np.ndarray, str]:
    """Return (distance_km, time_min, source) for the given (lng, lat) points."""
    key = _key(points)
    if key in _matrix_cache:
        d, t, src = _matrix_cache[key]
        return d.copy(), t.copy(), src
    n = len(points)
    src = "haversine"
    d = t = None
    if n <= 100:
        try:
            coords = ";".join(f"{p[0]:.6f},{p[1]:.6f}" for p in points)
            r = httpx.get(f"{OSRM}/table/v1/driving/{coords}",
                          params={"annotations": "duration,distance"}, timeout=TIMEOUT)
            js = r.json()
            if js.get("code") == "Ok":
                dist = np.array(js["distances"], dtype=float) / 1000.0
                dur = np.array(js["durations"], dtype=float) / 60.0 * CONGESTION
                if np.isfinite(dist).all() and np.isfinite(dur).all():
                    d, t, src = dist, dur, "osrm"
        except Exception:
            pass
    if d is None:
        d = np.zeros((n, n))
        for i in range(n):
            for j in range(n):
                if i != j:
                    d[i, j] = haversine_km(points[i], points[j]) * DETOUR
        t = d / FALLBACK_KMPH * 60.0
    np.fill_diagonal(d, 0.0)
    np.fill_diagonal(t, 0.0)
    _cache_put(_matrix_cache, key, (d, t, src), limit=64)
    return d.copy(), t.copy(), src


def apply_traffic(points, t: np.ndarray, zones: list[dict[str, Any]]) -> np.ndarray:
    """Multiply travel time of edges touching / crossing a traffic zone."""
    if not zones:
        return t
    t = t.copy()
    n = len(points)
    for z in zones:
        c = (z["lng"], z["lat"])
        r = float(z.get("radius_km", 2.0))
        f = float(z.get("factor", 2.5))
        inside = np.array([haversine_km(p, c) <= r for p in points])
        for i in range(n):
            for j in range(n):
                if i == j:
                    continue
                hit = inside[i] or inside[j]
                if not hit:
                    mid = ((points[i][0] + points[j][0]) / 2, (points[i][1] + points[j][1]) / 2)
                    hit = haversine_km(mid, c) <= r
                if hit:
                    t[i, j] *= f
    return t


def _route_geometry(path: list[tuple[float, float]]) -> list[list[list[float]]]:
    """Per-leg polylines for a path of waypoints (each leg = list of [lng, lat])."""
    key = _key(path)
    if key in _geom_cache:
        return _geom_cache[key]
    legs = None
    try:
        coords = ";".join(f"{p[0]:.6f},{p[1]:.6f}" for p in path)
        r = httpx.get(f"{OSRM}/route/v1/driving/{coords}",
                      params={"overview": "false", "steps": "true", "geometries": "geojson"},
                      timeout=TIMEOUT)
        js = r.json()
        if js.get("code") == "Ok":
            legs = []
            for li, leg in enumerate(js["routes"][0]["legs"]):
                pts: list[list[float]] = []
                for st in leg["steps"]:
                    for c in st["geometry"]["coordinates"]:
                        if not pts or pts[-1] != c:
                            pts.append(c)
                # Anchor the leg exactly on our stop coordinates.
                pts = [list(path[li])] + pts + [list(path[li + 1])]
                legs.append(pts)
    except Exception:
        legs = None
    if legs is None:
        legs = [[list(path[i]), list(path[i + 1])] for i in range(len(path) - 1)]
    else:
        _cache_put(_geom_cache, key, legs)
    return legs


def route_geometries(paths: list[list[tuple[float, float]]]) -> list[list[list[list[float]]]]:
    with ThreadPoolExecutor(max_workers=6) as ex:
        return list(ex.map(lambda p: _route_geometry(p) if len(p) > 1 else [], paths))


def leg_length_km(pts: list[list[float]]) -> float:
    return sum(haversine_km(pts[i], pts[i + 1]) for i in range(len(pts) - 1))
