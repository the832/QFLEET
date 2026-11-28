"""Problem assembly, hybrid quantum pipeline, evaluation and trip animation."""
from __future__ import annotations

import itertools
import os
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from sklearn.cluster import KMeans

from . import geo
from .classical import legacy_dispatch, ortools_vrp_isolated
from .qubo import (RouteCtx, build_allocation_qubo, build_route_qubo, decode_allocation,
                   decode_route, polish_route, route_objective)
from .sqa import sa_solve, sqa_solve

DRIVER_RATE = 220.0  # INR per hour (driver + vehicle time cost)
LNS_BUDGET_S = 1.9  # hybrid wall-clock budget, matched to OR-Tools (2.0 s)
REPLAN_BUDGET_S = 0.8  # live re-plans after a disruption must stay under a second

SOLVERS = {
    "quantum": {"label": "Q-Hybrid · Simulated Quantum Annealing", "short": "Quantum SQA",
                "family": "quantum"},
    "sa": {"label": "Thermal Annealing · D-Wave neal (same QUBO)", "short": "Thermal SA",
           "family": "classical"},
    "ortools": {"label": "Google OR-Tools · Guided Local Search", "short": "OR-Tools",
                "family": "classical"},
    "greedy": {"label": "Legacy Dispatch · Rule-based", "short": "Legacy",
               "family": "baseline"},
}
if os.environ.get("DWAVE_API_TOKEN"):
    SOLVERS["leap"] = {"label": "D-Wave Leap · Hybrid Quantum Cloud", "short": "D-Wave Leap",
                       "family": "quantum"}


@dataclass
class Problem:
    scenario: dict
    vehicles: list[dict]
    orders: list[dict]
    points: list[tuple[float, float]]
    veh_nodes: list[int]
    order_nodes: list[int]
    D: np.ndarray
    T: np.ndarray
    source: str
    extra: dict = field(default_factory=dict)


def build_problem(scenario: dict) -> Problem:
    depot = scenario["depot"]
    vehicles = [v for v in scenario["vehicles"] if v.get("status", "active") == "active"]
    orders = [o for o in scenario["orders"] if o.get("status", "pending") != "delivered"]
    points = [(depot["lng"], depot["lat"])]
    veh_nodes = []
    for v in vehicles:
        s = v.get("start") or depot
        veh_nodes.append(len(points))
        points.append((s["lng"], s["lat"]))
    order_nodes = []
    for o in orders:
        order_nodes.append(len(points))
        points.append((o["lng"], o["lat"]))
    D, T, src = geo.base_matrices(points)
    T = geo.apply_traffic(points, T, scenario.get("traffic_zones") or [])
    return Problem(scenario, vehicles, orders, points, veh_nodes, order_nodes, D, T, src)


# ------------------------------------------------------------------ evaluation
def evaluate(prob: Problem, routes: list[list[int]], unassigned: list[int]) -> dict:
    out_routes = []
    tot = dict(distance=0.0, cost=0.0, co2=0.0, on_time=0, late=0, crit_total=0,
               crit_on_time=0, served=0, drive=0.0, late_min=0.0)
    makespan = 0.0
    turnarounds = []
    utils = []
    for v, seq in enumerate(routes):
        veh = prob.vehicles[v]
        t = float(veh.get("start_time", 0))
        node = prob.veh_nodes[v]
        dist = 0.0
        load = 0.0
        stops = []
        timeline = []
        for o in seq:
            od = prob.orders[o]
            nxt = prob.order_nodes[o]
            travel = float(prob.T[node, nxt])
            timeline.append({"kind": "drive", "start": t, "end": t + travel})
            t += travel
            dist += float(prob.D[node, nxt])
            arrival = t
            late = max(0.0, arrival - od["deadline"])
            timeline.append({"kind": "service", "start": t, "end": t + od["service"],
                             "order": od["id"], "priority": od["priority"]})
            t += od["service"]
            load += od["demand"]
            stops.append({"order_id": od["id"], "arrival": arrival, "depart": t,
                          "late_min": late, "lng": od["lng"], "lat": od["lat"],
                          "priority": od["priority"], "demand": od["demand"],
                          "customer": od["customer"], "deadline": od["deadline"]})
            tot["served"] += 1
            if late > 0.5:
                tot["late"] += 1
                tot["late_min"] += late
            else:
                tot["on_time"] += 1
            if od["priority"] == "critical":
                tot["crit_total"] += 1
                tot["crit_on_time"] += 1 if late <= 0.5 else 0
            node = nxt
        if seq:
            back = float(prob.T[node, 0])
            timeline.append({"kind": "return", "start": t, "end": t + back})
            t += back
            dist += float(prob.D[node, 0])
        duration = t - float(veh.get("start_time", 0))
        cost = dist * veh["cost_per_km"] + duration / 60.0 * DRIVER_RATE
        co2 = dist * veh["co2_per_km"]
        util = load / veh["capacity"] if veh["capacity"] else 0
        if seq:
            makespan = max(makespan, t)
            turnarounds.append(duration)
            utils.append(util)
        tot["distance"] += dist
        tot["cost"] += cost
        tot["co2"] += co2
        tot["drive"] += duration
        out_routes.append({
            "vehicle_id": veh["id"], "vehicle_label": veh["label"], "vehicle_type": veh["type"],
            "color": veh["color"], "capacity": veh["capacity"], "seq": seq,
            "stops": stops, "distance_km": dist, "duration_min": duration,
            "return_time": t if seq else float(veh.get("start_time", 0)),
            "start_time": float(veh.get("start_time", 0)),
            "load": load, "utilization": util, "cost": cost, "co2": co2,
            "timeline": timeline,
            "start": {"lng": prob.points[prob.veh_nodes[v]][0],
                      "lat": prob.points[prob.veh_nodes[v]][1]},
        })
    n_orders = len(prob.orders)
    metrics = {
        "distance_km": tot["distance"],
        "cost_inr": tot["cost"],
        "co2_kg": tot["co2"],
        "makespan_min": makespan,
        "avg_turnaround_min": float(np.mean(turnarounds)) if turnarounds else 0.0,
        "fleet_hours": tot["drive"] / 60.0,
        "on_time_pct": 100.0 * tot["on_time"] / max(1, tot["served"]),
        "critical_on_time_pct": 100.0 * tot["crit_on_time"] / max(1, tot["crit_total"]),
        "late_orders": tot["late"],
        "late_minutes": tot["late_min"],
        "served": tot["served"],
        "unserved": len(unassigned),
        "orders_total": n_orders,
        "vehicles_used": sum(1 for r in routes if r),
        "vehicles_total": len(routes),
        "avg_utilization_pct": 100.0 * float(np.mean(utils)) if utils else 0.0,
    }
    return {"routes": out_routes, "metrics": metrics,
            "unassigned": [prob.orders[o]["id"] for o in unassigned]}


def attach_trips(prob: Problem, ev: dict) -> None:
    """Road geometry + per-vertex timestamps for the animated TripsLayer."""
    paths = []
    for r in ev["routes"]:
        if not r["seq"]:
            paths.append([])
            continue
        p = [(r["start"]["lng"], r["start"]["lat"])]
        p += [(s["lng"], s["lat"]) for s in r["stops"]]
        p.append(prob.points[0])
        paths.append(p)
    geoms = geo.route_geometries(paths)
    for r, legs in zip(ev["routes"], geoms):
        if not legs:
            r["path"], r["timestamps"] = [], []
            continue
        dep_times = [r["start_time"]] + [s["depart"] for s in r["stops"]]
        arr_times = [s["arrival"] for s in r["stops"]] + [r["return_time"]]
        path, ts = [], []
        for k, leg in enumerate(legs):
            t0, t1 = dep_times[k], arr_times[k]
            seg = [geo.haversine_km(leg[i], leg[i + 1]) for i in range(len(leg) - 1)]
            total = sum(seg) or 1.0
            acc = 0.0
            for i, pt in enumerate(leg):
                if i > 0:
                    acc += seg[i - 1]
                path.append([round(pt[0], 6), round(pt[1], 6)])
                ts.append(round(t0 + (t1 - t0) * acc / total, 3))
        r["path"], r["timestamps"] = path, ts


# ------------------------------------------------------------------ quantum
def _sweeps_for(n: int) -> int:
    return int(np.clip(2_200_000 / max(n, 1), 500, 4000))


def _anneal(Q, method: str, seed: int, snapshots: int = 0) -> dict:
    n = Q.shape[0]
    if method == "sa":
        return sa_solve(Q, reads=8, sweeps=_sweeps_for(n), seed=seed)
    if method == "leap":
        try:
            return _leap_solve(Q)
        except Exception as exc:  # pragma: no cover - needs cloud token
            r = sqa_solve(Q, reads=8, sweeps=_sweeps_for(n), seed=seed, snapshots=snapshots)
            r["note"] = f"Leap unavailable ({exc.__class__.__name__}); used local SQA"
            return r
    return sqa_solve(Q, reads=8, sweeps=_sweeps_for(n), seed=seed, snapshots=snapshots)


def _leap_solve(Q):  # pragma: no cover - needs cloud token
    import dimod
    from dwave.system import LeapHybridSampler

    t0 = time.perf_counter()
    bqm = dimod.BinaryQuadraticModel.from_qubo(
        {(int(i), int(j)): float(Q[i, j]) for i, j in zip(*np.nonzero(np.triu(Q)))})
    ss = LeapHybridSampler().sample(bqm, time_limit=3)
    rec = ss.first
    n = Q.shape[0]
    x = np.array([rec.sample.get(i, 0) for i in range(n)], dtype=np.int8)
    return {"x": x, "energy": float(rec.energy), "n_vars": n,
            "ms": (time.perf_counter() - t0) * 1000, "read_energies": [float(rec.energy)]}


def _qubo_preview(Q: np.ndarray, size: int = 64) -> dict:
    n = Q.shape[0]
    S = np.triu(Q) + np.triu(Q, 1).T
    if n > size:
        edges = np.linspace(0, n, size + 1).astype(int)
        M = np.zeros((size, size))
        for a in range(size):
            for b in range(size):
                blk = S[edges[a]:edges[a + 1], edges[b]:edges[b + 1]]
                M[a, b] = blk[np.abs(blk).argmax() // blk.shape[1], np.abs(blk).argmax() % blk.shape[1]] if blk.size else 0
    else:
        M = S
    mx = float(np.abs(M).max()) or 1.0
    Mn = np.sign(M) * np.log1p(np.abs(M) / mx * 50) / np.log1p(50)
    return {"n": n, "size": int(M.shape[0]), "cells": np.round(Mn, 3).tolist(),
            "nnz": int(np.count_nonzero(np.triu(Q)))}


def _choose_vehicles(prob: Problem, K: int, total: float) -> list[int]:
    """Cheapest subset of K active vehicles that can carry the demand."""
    V = len(prob.vehicles)
    best, best_score = None, None
    combos = itertools.combinations(range(V), K)
    for n, combo in enumerate(combos):
        if n > 3000:
            break
        cap = sum(prob.vehicles[v]["capacity"] for v in combo)
        if cap < total:
            continue
        score = sum(prob.vehicles[v]["cost_per_km"] for v in combo) - 1e-4 * cap
        if best_score is None or score < best_score:
            best, best_score = list(combo), score
    if best is None:  # not enough capacity: take the largest vehicles
        best = sorted(range(V), key=lambda v: -prob.vehicles[v]["capacity"])[:K]
    return sorted(best)


def _seeds(prob: Problem, vsel: list[int], seed: int) -> list[int]:
    """Cluster-first seeds (k-means on geography) matched to vehicles by capacity."""
    K = len(vsel)
    N = len(prob.orders)
    pts = np.array([[o["lng"] * np.cos(np.radians(o["lat"])), o["lat"]] for o in prob.orders])
    if K >= N:
        labels = np.arange(N) % K
    else:
        labels = KMeans(n_clusters=K, n_init=6, random_state=seed).fit(pts).labels_
    clusters = []
    for k in range(K):
        mem = [o for o in range(N) if labels[o] == k]
        if not mem:
            mem = [k % N]
        dem = sum(prob.orders[o]["demand"] for o in mem)
        nodes = [prob.order_nodes[o] for o in mem]
        sub = prob.T[np.ix_(nodes, nodes)]
        medoid = nodes[int(np.argmin(sub.sum(axis=1) + sub.sum(axis=0)))]
        clusters.append((dem, medoid))
    clusters.sort(key=lambda c: -c[0])
    veh_by_cap = sorted(range(K), key=lambda i: -prob.vehicles[vsel[i]]["capacity"])
    seeds = [0] * K
    for (dem, medoid), i in zip(clusters, veh_by_cap):
        seeds[i] = medoid
    return seeds


def _route_ctx(prob: Problem, v: int, members: list[int]) -> RouteCtx:
    return RouteCtx(
        stop_nodes=[prob.order_nodes[o] for o in members],
        prios=[prob.orders[o]["priority"] for o in members],
        deadlines=[prob.orders[o]["deadline"] for o in members],
        services=[prob.orders[o]["service"] for o in members],
        start_node=prob.veh_nodes[v], end_node=0,
        start_time=float(prob.vehicles[v].get("start_time", 0)), T=prob.T, L=0.05 *
        float(prob.T[np.ix_([prob.order_nodes[o] for o in members],
                            [prob.order_nodes[o] for o in members])].mean() or 1.0))


def _seq_cost(prob: Problem, v: int, seq: list[int]) -> float:
    if not seq:
        return 0.0
    ctx = _route_ctx(prob, v, seq)
    return route_objective(list(range(len(seq))), ctx)


def _refine_routes(prob: Problem, routes: list[list[int]], max_pass: int = 8) -> list[list[int]]:
    """Classical inter-route relocate (hybrid refinement after quantum stages)."""
    V = len(routes)
    routes = [list(r) for r in routes]
    loads = [sum(prob.orders[o]["demand"] for o in r) for r in routes]
    costs = [_seq_cost(prob, v, routes[v]) for v in range(V)]
    for _ in range(max_pass):
        improved = False
        for a in range(V):
            i = 0
            while i < len(routes[a]):
                o = routes[a][i]
                q = prob.orders[o]["demand"]
                rem = routes[a][:i] + routes[a][i + 1:]
                rem_c = _seq_cost(prob, a, rem)
                best = None
                for b in range(V):
                    if b == a or loads[b] + q > prob.vehicles[b]["capacity"]:
                        continue
                    for pos in range(len(routes[b]) + 1):
                        cand = routes[b][:pos] + [o] + routes[b][pos:]
                        cb = _seq_cost(prob, b, cand)
                        delta = (rem_c - costs[a]) + (cb - costs[b])
                        if delta < -1e-6 and (best is None or delta < best[0]):
                            best = (delta, b, cand, cb)
                if best:
                    _, b, cand, cb = best
                    routes[a], routes[b] = rem, cand
                    costs[a], costs[b] = rem_c, cb
                    loads[a] -= q
                    loads[b] += q
                    improved = True
                else:
                    i += 1
        if not improved:
            break
    # re-sequence touched routes
    out = []
    for v, seq in enumerate(routes):
        if len(seq) > 2:
            ctx = _route_ctx(prob, v, seq)
            order, _ = polish_route(list(range(len(seq))), ctx)
            seq = [seq[i] for i in order]
        out.append(seq)
    return out


# ------------------------------------------------------------------ cost-aware hybrid refinement
# The annealer decides allocation and order on travel time; this classical pass then polishes the
# plan on the real objective the fleet pays: ₹/km of each vehicle + driver time + lateness.
LATE_INR = {"critical": 200.0, "high": 80.0, "standard": 40.0}  # ₹ per minute late


class _Costs:
    def __init__(self, prob: Problem):
        self.prob = prob
        self.T = prob.T.tolist()
        self.D = prob.D.tolist()
        self.node = [int(n) for n in prob.order_nodes]
        self.dem = [float(o["demand"]) for o in prob.orders]
        self.svc = [float(o["service"]) for o in prob.orders]
        self.dl = [float(o["deadline"]) for o in prob.orders]
        self.lw = [LATE_INR[o["priority"]] for o in prob.orders]
        self.vstart = [int(n) for n in prob.veh_nodes]
        self.vt0 = [float(v.get("start_time", 0)) for v in prob.vehicles]
        self.vkm = [float(v["cost_per_km"]) for v in prob.vehicles]
        self.cap = [float(v["capacity"]) for v in prob.vehicles]

    def route(self, v: int, seq: list[int]) -> float:
        if not seq:
            return 0.0
        T, D = self.T, self.D
        t = t0 = self.vt0[v]
        node = self.vstart[v]
        km = pen = 0.0
        for o in seq:
            nxt = self.node[o]
            t += T[node][nxt]
            km += D[node][nxt]
            late = t - self.dl[o]
            if late > 0:
                pen += self.lw[o] * late
            t += self.svc[o]
            node = nxt
        t += T[node][0]
        km += D[node][0]
        return km * self.vkm[v] + (t - t0) / 60.0 * DRIVER_RATE + pen

    def load(self, seq: list[int]) -> float:
        return sum(self.dem[o] for o in seq)


def _best_insert_slow(cc: _Costs, v: int, seq: list[int], o: int) -> tuple[float, list[int]]:
    best = None
    for pos in range(len(seq) + 1):
        cand = seq[:pos] + [o] + seq[pos:]
        c = cc.route(v, cand)
        if best is None or c < best[0]:
            best = (c, cand)
    return best


def _best_insert(cc: _Costs, v: int, seq: list[int], o: int) -> tuple[float, list[int]]:
    """Cheapest position for stop o in route v, in O(n) instead of O(n²).

    Inserting o delays every later stop by the same Δt. One forward pass gives each stop's arrival
    and the smallest deadline slack from each position onward; when that slack absorbs Δt, no
    later stop's lateness changes and the new cost is the old cost plus local terms (O(1))."""
    n = len(seq)
    if n == 0:
        return cc.route(v, [o]), [o]
    T, D, node, dl, lw, svc = cc.T, cc.D, cc.node, cc.dl, cc.lw, cc.svc
    vkm, rate = cc.vkm[v], DRIVER_RATE / 60.0
    t0 = cc.vt0[v]
    t = t0
    prev = cc.vstart[v]
    km = pen = 0.0
    arr = [0.0] * n
    dep = [0.0] * n
    for i, s in enumerate(seq):
        nx = node[s]
        t += T[prev][nx]
        km += D[prev][nx]
        arr[i] = t
        late = t - dl[s]
        if late > 0:
            pen += lw[s] * late
        t += svc[s]
        dep[i] = t
        prev = nx
    t_end = t + T[prev][0]
    km += D[prev][0]
    old = km * vkm + (t_end - t0) * rate + pen
    slack = [0.0] * (n + 1)
    slack[n] = float("inf")
    for i in range(n - 1, -1, -1):
        sl = dl[seq[i]] - arr[i]
        slack[i] = sl if sl < slack[i + 1] else slack[i + 1]
    no, dlo, lwo, svo = node[o], dl[o], lw[o], svc[o]
    best_c, best_pos = None, 0
    for pos in range(n + 1):
        if pos == 0:
            pn, pdep = cc.vstart[v], t0
        else:
            pn, pdep = node[seq[pos - 1]], dep[pos - 1]
        nn = node[seq[pos]] if pos < n else 0
        a_o = pdep + T[pn][no]
        dt = T[pn][no] + svo + T[no][nn] - T[pn][nn]
        c = old + (D[pn][no] + D[no][nn] - D[pn][nn]) * vkm + dt * rate
        if a_o > dlo:
            c += lwo * (a_o - dlo)
        if pos < n and slack[pos] < (dt if dt > 0 else 0.0):
            for i in range(pos, n):  # some later stop's lateness changes: exact suffix
                s = seq[i]
                ol = arr[i] - dl[s]
                nl = ol + dt
                c += lw[s] * ((nl if nl > 0 else 0.0) - (ol if ol > 0 else 0.0))
        if best_c is None or c < best_c:
            best_c, best_pos = c, pos
    return best_c, seq[:best_pos] + [o] + seq[best_pos:]


def _intra_opt(cc: _Costs, v: int, seq: list[int]) -> tuple[list[int], float]:
    """2-opt + or-opt on one route, on ₹ cost."""
    cur = cc.route(v, seq)
    improved = True
    while improved and len(seq) > 2:
        improved = False
        n = len(seq)
        for i in range(n - 1):
            for j in range(i + 1, n):
                cand = seq[:i] + seq[i:j + 1][::-1] + seq[j + 1:]
                c = cc.route(v, cand)
                if c < cur - 1e-6:
                    seq, cur, improved = cand, c, True
        for i in range(n):
            o = seq[i]
            rest = seq[:i] + seq[i + 1:]
            c, cand = _best_insert(cc, v, rest, o)
            if c < cur - 1e-6:
                seq, cur, improved = cand, c, True
    return seq, cur


def _refine_inr(prob: Problem, routes: list[list[int]], max_pass: int = 12) -> list[list[int]]:
    cc = _Costs(prob)
    V = len(routes)
    routes = [list(r) for r in routes]
    cost = [cc.route(v, routes[v]) for v in range(V)]
    load = [cc.load(r) for r in routes]

    def reassign_vehicles():
        # give each finished route to the vehicle that runs it cheapest (all start at the same
        # time from wherever they are), brute force for small fleets
        nonlocal routes, cost, load
        if V > 7:
            return False
        best_perm, best_c = None, sum(cost)
        for perm in itertools.permutations(range(V)):
            tot = 0.0
            for r, v in enumerate(perm):
                seq = routes[r]
                if seq and load[r] > cc.cap[v]:
                    tot = None
                    break
                tot += cc.route(v, seq)
                if tot >= best_c:
                    break
            if tot is not None and tot < best_c - 1e-6:
                best_perm, best_c = perm, tot
        if best_perm is None:
            return False
        new = [[] for _ in range(V)]
        for r, v in enumerate(best_perm):
            new[v] = routes[r]
        routes = new
        cost = [cc.route(v, routes[v]) for v in range(V)]
        load = [cc.load(r) for r in routes]
        return True

    for _ in range(max_pass):
        improved = False
        # relocate one stop to its cheapest position in another route
        for a in range(V):
            i = 0
            while i < len(routes[a]):
                o = routes[a][i]
                rem = routes[a][:i] + routes[a][i + 1:]
                rem_c = cc.route(a, rem)
                best = None
                for b in range(V):
                    if b == a or load[b] + cc.dem[o] > cc.cap[b]:
                        continue
                    cb, cand = _best_insert(cc, b, routes[b], o)
                    delta = (rem_c - cost[a]) + (cb - cost[b])
                    if delta < -1e-6 and (best is None or delta < best[0]):
                        best = (delta, b, cand, cb)
                if best:
                    _, b, cand, cb = best
                    routes[a], routes[b] = rem, cand
                    cost[a], cost[b] = rem_c, cb
                    load[a] -= cc.dem[o]
                    load[b] += cc.dem[o]
                    improved = True
                else:
                    i += 1
        # swap two stops between routes
        for a in range(V):
            for b in range(a + 1, V):
                done = False
                for i in range(len(routes[a])):
                    for j in range(len(routes[b])):
                        oa, ob = routes[a][i], routes[b][j]
                        la = load[a] - cc.dem[oa] + cc.dem[ob]
                        lb = load[b] - cc.dem[ob] + cc.dem[oa]
                        if la > cc.cap[a] or lb > cc.cap[b]:
                            continue
                        ra = routes[a][:i] + routes[a][i + 1:]
                        rb = routes[b][:j] + routes[b][j + 1:]
                        ca, na = _best_insert(cc, a, ra, ob)
                        cb, nb = _best_insert(cc, b, rb, oa)
                        if ca + cb < cost[a] + cost[b] - 1e-6:
                            routes[a], routes[b] = na, nb
                            cost[a], cost[b], load[a], load[b] = ca, cb, la, lb
                            improved = done = True
                            break
                    if done:
                        break
        # close a whole route when the others can absorb it more cheaply (saves a driver + stem)
        for a in sorted(range(V), key=lambda v: len(routes[v])):
            if not routes[a]:
                continue
            trial = [list(r) for r in routes]
            tload = list(load)
            tcost = list(cost)
            ok = True
            for o in sorted(routes[a], key=lambda o: -cc.dem[o]):
                best = None
                for b in range(V):
                    if b == a or not trial[b] or tload[b] + cc.dem[o] > cc.cap[b]:
                        continue
                    cb, cand = _best_insert(cc, b, trial[b], o)
                    if best is None or cb - tcost[b] < best[0]:
                        best = (cb - tcost[b], b, cand, cb)
                if best is None:
                    ok = False
                    break
                _, b, cand, cb = best
                trial[b], tcost[b] = cand, cb
                tload[b] += cc.dem[o]
            if ok:
                trial[a], tcost[a], tload[a] = [], 0.0, 0.0
                for b in range(V):
                    if trial[b]:
                        trial[b], tcost[b] = _intra_opt(cc, b, trial[b])
                if sum(tcost) < sum(cost) - 1e-6:
                    routes, cost, load = trial, tcost, tload
                    improved = True
        for v in range(V):
            if len(routes[v]) > 2:
                routes[v], c = _intra_opt(cc, v, routes[v])
                if c < cost[v] - 1e-6:
                    improved = True
                cost[v] = c
        if reassign_vehicles():
            improved = True
        if not improved:
            break
    return routes


LNS = {"accept": 0.04, "kmax": 12, "regret_p": 0.5, "route_p": 0.1, "starts": 1, "restarts": 3}


def _ruin_recreate(prob: Problem, routes: list[list[int]], budget_s: float = 1.2,
                   seed: int = 0) -> tuple[list[list[int]], int]:
    """Large-neighbourhood search seeded with the quantum plan: remove a cluster of nearby stops
    (or one whole route), re-insert them (cheapest or regret-2 insertion), accept with a cooling
    record-to-record threshold, keep the best. Same ₹ objective as the evaluator."""
    import random
    rng = random.Random(seed)
    cc = _Costs(prob)
    V = len(routes)
    N = len(prob.orders)
    if N < 3:
        return routes, 0
    T = cc.T
    near = [sorted(range(N), key=lambda j: T[cc.node[i]][cc.node[j]] + T[cc.node[j]][cc.node[i]])
            for i in range(N)]

    def total(rs):
        return sum(cc.route(v, rs[v]) for v in range(V))

    def options(rs, loads, costs, o):
        out = []
        for v in range(V):
            if loads[v] + cc.dem[o] > cc.cap[v]:
                continue
            c, cand = _best_insert(cc, v, rs[v], o)
            out.append((c - costs[v], v, cand, c))
        out.sort(key=lambda x: x[0])
        return out

    cur = [list(r) for r in routes]
    cur_c = total(cur)
    best, best_c = [list(r) for r in cur], cur_c
    t0 = time.perf_counter()
    it = last_gain = 0
    stall = 4000 + 150 * N  # small re-plans converge fast: stop once nothing improves for a while
    restarts = 0
    while time.perf_counter() - t0 < budget_s:
        if it - last_gain >= stall:
            # stuck in a local optimum: restart from the best plan with a big shake-up (≈40% of
            # stops removed), a few times at most so small re-plans still finish quickly
            if restarts >= LNS["restarts"]:
                break
            restarts += 1
            last_gain = it
            cur, cur_c = [list(r) for r in best], best_c
            big = True
        else:
            big = False
        it += 1
        frac = (time.perf_counter() - t0) / budget_s
        rs = [list(r) for r in cur]
        if big:
            removed = rng.sample(range(N), max(3, int(0.4 * N)))
            gone = set(removed)
            rs = [[o for o in r if o not in gone] for r in rs]
        elif rng.random() < LNS["route_p"]:  # drop a whole route and redistribute
            nonempty = [v for v in range(V) if rs[v]]
            v0 = rng.choice(nonempty)
            removed = rs[v0]
            rs[v0] = []
        else:  # radial ruin around a random stop
            k = rng.randint(3, min(LNS["kmax"], N))
            centre = rng.randrange(N)
            removed = list(near[centre][:k])
            gone = set(removed)
            rs = [[o for o in r if o not in gone] for r in rs]
        loads = [cc.load(r) for r in rs]
        costs = [cc.route(v, rs[v]) for v in range(V)]
        ok = True
        if rng.random() < LNS["regret_p"]:
            pending = list(removed)
            # insertion options per (stop, vehicle); only the vehicle that just changed is re-scored
            ins = {o: {} for o in pending}

            def score(o, v):
                if loads[v] + cc.dem[o] > cc.cap[v]:
                    return None
                c, cand = _best_insert(cc, v, rs[v], o)
                return (c - costs[v], cand, c)

            for o in pending:
                for v in range(V):
                    ins[o][v] = score(o, v)
            while pending:
                pick = None
                for o in pending:
                    opts = sorted((x[0], v, x[1], x[2]) for v, x in ins[o].items() if x is not None)
                    if not opts:
                        pick = None
                        break
                    regret = (opts[1][0] - opts[0][0]) if len(opts) > 1 else 1e9
                    if pick is None or regret > pick[0]:
                        pick = (regret, o, opts[0])
                if pick is None:
                    ok = False
                    break
                _, o, (_, v, cand, c) = pick
                rs[v], costs[v] = cand, c
                loads[v] += cc.dem[o]
                pending.remove(o)
                for o2 in pending:
                    ins[o2][v] = score(o2, v)
        else:
            rng.shuffle(removed)
            for o in removed:
                opts = options(rs, loads, costs, o)
                if not opts:
                    ok = False
                    break
                _, v, cand, c = opts[0]
                rs[v], costs[v] = cand, c
                loads[v] += cc.dem[o]
        if not ok:
            continue
        new_c = sum(costs)
        thresh = LNS["accept"] * (1 - frac)  # tolerant early, only improvements at the end
        if big or new_c < cur_c * (1 + thresh):
            cur, cur_c = rs, new_c
            if new_c < best_c - 1e-6:
                best, best_c = [list(r) for r in rs], new_c
                last_gain = it
    return _refine_inr(prob, best, max_pass=3), it


def _plan_for_k(prob: Problem, K: int, method: str, seed: int, snapshots: int):
    V = len(prob.vehicles)
    N = len(prob.orders)
    demands = [o["demand"] for o in prob.orders]
    total = float(sum(demands))
    vsel = _choose_vehicles(prob, K, total)
    seeds = _seeds(prob, vsel, seed)
    caps = [prob.vehicles[v]["capacity"] for v in vsel]
    vnodes = [prob.veh_nodes[v] for v in vsel]

    # ---- Stage 1: quantum capacitated allocation
    Q1, c1, meta1 = build_allocation_qubo(prob.order_nodes, demands, seeds, vnodes, caps, prob.T)
    r1 = _anneal(Q1, method, seed, snapshots=snapshots)
    assign_k, unassigned, viol, repairs = decode_allocation(
        r1["x"], N, K, demands, caps, meta1["cost"], meta1["var"])
    s1 = {
        "n_vars": int(Q1.shape[0]), "n_assign": meta1["n_assign"], "n_slack": meta1["n_slack"],
        "energy": r1["energy"] + c1, "ms": r1["ms"], "raw_violations": viol, "repairs": repairs,
        "read_energies": [e + c1 for e in r1.get("read_energies", [])],
        "penalties": {"A": round(float(meta1["A"]), 3), "C": round(float(meta1["C"]), 3)},
        "candidates_per_order": meta1["candidates"],
        "qubo": _qubo_preview(Q1), "orders": N, "vehicles": K,
        "vehicle_ids": [prob.vehicles[v]["id"] for v in vsel],
    }
    if "trace" in r1:
        s1["trace"] = {k: [round(val + (c1 if k.startswith("e_") else 0), 4) for val in vals]
                       for k, vals in r1["trace"].items()}
        snaps = r1.get("snapshots")
        if snaps is not None and len(snaps):
            s1["replicas"] = {"P": int(snaps.shape[1]), "n": int(min(snaps.shape[2], 180)),
                              "frames": snaps[:, :, :180].astype(int).tolist()}
        s1["sweeps"] = r1.get("sweeps")
        s1["trotter_slices"] = r1.get("replicas")
    if r1.get("note"):
        s1["note"] = r1["note"]

    # ---- Stage 2: quantum route sequencing per vehicle
    routes: list[list[int]] = [[] for _ in range(V)]
    stage2 = []
    for k, v in enumerate(vsel):
        members = [o for o in range(N) if assign_k[o] == k]
        m = len(members)
        if m == 0:
            continue
        ctx = _route_ctx(prob, v, members)
        if m <= 2:
            cands = [[0]] if m == 1 else [[0, 1], [1, 0]]
            order = min(cands, key=lambda c: route_objective(c, ctx))
            cst = route_objective(order, ctx)
            stage2.append({"vehicle_id": prob.vehicles[v]["id"], "stops": m, "n_vars": m * m,
                           "valid": True, "raw_cost": cst, "final_cost": cst, "ms": 0.0})
            routes[v] = [members[i] for i in order]
            continue
        Q2, c2, _ = build_route_qubo(ctx)
        r2 = _anneal(Q2, method, seed + v)
        order, valid = decode_route(r2["x"], ctx)
        raw_c = route_objective(order, ctx)
        pol, pol_c = polish_route(order, ctx)
        entry = {"vehicle_id": prob.vehicles[v]["id"], "stops": m, "n_vars": m * m,
                 "valid": valid, "raw_cost": raw_c, "final_cost": pol_c, "ms": r2["ms"],
                 "energy": r2["energy"] + c2}
        if "trace" in r2:
            entry["trace"] = {"gamma": [round(g, 5) for g in r2["trace"]["gamma"][::3]],
                              "e_min": [round(e + c2, 3) for e in r2["trace"]["e_min"][::3]]}
        stage2.append(entry)
        routes[v] = [members[i] for i in pol]
    before = sum(_seq_cost(prob, v, routes[v]) for v in range(V))
    cc = _Costs(prob)
    inr_before = sum(cc.route(v, routes[v]) for v in range(V))
    routes = _refine_routes(prob, routes)
    routes = _refine_inr(prob, routes)
    s1["inr_quantum"] = inr_before
    s1["inr_hybrid"] = sum(cc.route(v, routes[v]) for v in range(V))
    after = sum(_seq_cost(prob, v, routes[v]) for v in range(V))
    s1["refine_gain_pct"] = 100.0 * (before - after) / before if before else 0.0
    s1["quantum_cost"] = before
    s1["hybrid_cost"] = after
    return routes, list(unassigned), s1, stage2


LNS_WORKERS = 2  # extra parallel searches in worker processes (plus one in-process)
_lns_pool = None
_lns_lock = __import__("threading").Lock()


def _get_lns_pool():
    global _lns_pool
    import multiprocessing as mp
    from concurrent.futures import ProcessPoolExecutor
    with _lns_lock:
        if _lns_pool is None:
            try:
                _lns_pool = ProcessPoolExecutor(max_workers=LNS_WORKERS, mp_context=mp.get_context("spawn"))
            except Exception:
                return None
        return _lns_pool


def _lns_worker(prob: Problem, routes: list[list[int]], budget_s: float, seed: int):
    return _ruin_recreate(prob, routes, budget_s=budget_s, seed=seed)


def warm_lns_pool() -> None:
    pool = _get_lns_pool()
    if pool is None:
        return
    try:
        for f in [pool.submit(int, 0) for _ in range(LNS_WORKERS)]:
            f.result(timeout=60)
    except Exception:
        pass


def hybrid_quantum(prob: Problem, method: str = "quantum", seed: int = 11,
                   budget_s: float | None = None):
    t0 = time.perf_counter()
    V = len(prob.vehicles)
    demands = [o["demand"] for o in prob.orders]
    total = float(sum(demands))
    caps_sorted = sorted((v["capacity"] for v in prob.vehicles), reverse=True)
    kmin, acc = 0, 0.0
    for c in caps_sorted:
        kmin += 1
        acc += c
        if acc >= total / 0.93:
            break
    kmin = max(1, min(kmin, V))
    # two fleet sizes are enough: the classical refinement can still close a route afterwards
    ks = list(range(kmin, min(V, kmin + 1) + 1))

    def run(K):
        return K, _plan_for_k(prob, K, method, seed, snapshots=7)

    with ThreadPoolExecutor(max_workers=len(ks)) as ex:
        outs = list(ex.map(run, ks))
    candidates = []
    ranked = []
    cc = _Costs(prob)
    for K, (routes, unassigned, s1, s2) in outs:
        ev = evaluate(prob, routes, unassigned)
        mt = ev["metrics"]
        # rank on the same objective the refinement optimises: ₹ cost + ₹ lateness penalty
        score = sum(cc.route(v, routes[v]) for v in range(V)) + 5000.0 * mt["unserved"]
        candidates.append({"k": K, "distance_km": mt["distance_km"], "cost_inr": mt["cost_inr"],
                           "on_time_pct": mt["on_time_pct"], "unserved": mt["unserved"],
                           "score": score})
        ranked.append((score, K, routes, unassigned, s1, s2))
    ranked.sort(key=lambda x: x[0])
    _, K, routes, unassigned, s1, stage2 = ranked[0]
    # starting plans for the parallel searches: the best quantum plan, then the runner-up fleet
    # size (if it serves every order), so one weaker first pick cannot trap the result
    alt = [r[2] for r in ranked[1:] if not r[3]]
    lns_starts = [routes] + alt[:1]
    # classical large-neighbourhood search seeded with the quantum plans (time-boxed)
    seeded = sum(cc.route(v, routes[v]) for v in range(V))
    if budget_s is None:
        # vehicles already on the road (start later than the shift start) means a live re-plan
        replan = any(float(v.get("start_time", 0)) > 0.5 for v in prob.vehicles)
        budget_s = REPLAN_BUDGET_S if replan else LNS_BUDGET_S
    remaining = max(0.2, budget_s - (time.perf_counter() - t0))
    # independent searches from the same quantum plan run side by side on separate cores (worker
    # processes + this thread), same wall-clock budget; the cheapest result wins
    remaining = max(0.2, budget_s - (time.perf_counter() - t0))
    futs = []
    pool = _get_lns_pool()
    if pool is not None:
        try:
            futs = [pool.submit(_lns_worker, prob, lns_starts[(i + 1) % len(lns_starts)], remaining, seed + 1 + i)
                    for i in range(LNS_WORKERS)]
        except Exception:
            futs = []
    r0, n0 = _ruin_recreate(prob, routes, budget_s=remaining, seed=seed)
    results = [(sum(cc.route(v, r0[v]) for v in range(V)), r0)]
    lns_iters = n0
    for f in futs:
        try:
            r_i, n_i = f.result(timeout=remaining + 10)
            lns_iters += n_i
            results.append((sum(cc.route(v, r_i[v]) for v in range(V)), r_i))
        except Exception:
            pass
    final, routes = min(results, key=lambda x: x[0])
    tele: dict[str, Any] = {"method": method, "stage1": s1, "stage2": stage2,
                            "fleet_exploration": candidates, "chosen_k": K,
                            "lns": {"iterations": lns_iters, "seed_inr": seeded, "final_inr": final,
                                    "gain_pct": 100 * (seeded - final) / seeded if seeded else 0.0}}
    tele["total_qubits"] = s1["n_vars"] + sum(s["n_vars"] for s in stage2)
    raw = sum(s["raw_cost"] for s in stage2)
    fin = sum(s["final_cost"] for s in stage2)
    tele["raw_vs_polished"] = {"raw": raw, "polished": fin,
                               "polish_gain_pct": 100 * (raw - fin) / raw if raw else 0.0}
    tele["valid_routes_pct"] = 100.0 * sum(1 for s in stage2 if s["valid"]) / max(1, len(stage2))
    return routes, unassigned, (time.perf_counter() - t0) * 1000, tele


# ------------------------------------------------------------------ public api
def solve(scenario: dict, solver: str = "quantum", with_trips: bool = True,
          prob: Problem | None = None, seed: int = 11, budget_s: float | None = None) -> dict:
    prob = prob or build_problem(scenario)
    tele = None
    if not prob.orders or not prob.vehicles:
        routes, unassigned, ms = [[] for _ in prob.vehicles], list(range(len(prob.orders))), 0.0
    elif solver in ("quantum", "sa", "leap"):
        routes, unassigned, ms, tele = hybrid_quantum(prob, solver, seed, budget_s)
    elif solver == "ortools":
        routes, unassigned, ms = ortools_vrp_isolated(prob)
    else:
        routes, unassigned, ms = legacy_dispatch(prob)
    ev = evaluate(prob, routes, unassigned)
    if with_trips:
        attach_trips(prob, ev)
    meta = SOLVERS.get(solver, SOLVERS["greedy"])
    ev.update({"solver": solver, "solver_label": meta["label"], "solver_short": meta["short"],
               "family": meta["family"], "solve_ms": ms, "matrix_source": prob.source,
               "quantum": tele})
    return ev


def compare(scenario: dict, solvers: list[str] | None = None) -> dict:
    prob = build_problem(scenario)
    solvers = solvers or ["quantum", "ortools", "sa", "greedy"]
    # OR-Tools runs in its own process alongside; the Python solvers run one after
    # another so each reported solve time is measured without contention.
    results: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=1) as ex:
        fut = ex.submit(solve, scenario, "ortools", True, prob) if "ortools" in solvers else None
        for s in solvers:
            if s != "ortools":
                # benchmark: every solver gets the same time as OR-Tools, start of day or not
                results[s] = solve(scenario, s, with_trips=True, prob=prob, budget_s=LNS_BUDGET_S)
        if fut:
            results["ortools"] = fut.result()
    return {"results": {s: results[s] for s in solvers}, "matrix_source": prob.source}
