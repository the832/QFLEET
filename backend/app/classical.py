"""Classical baselines: a legacy rule-based dispatcher and Google OR-Tools."""
from __future__ import annotations

import multiprocessing as mp
import threading
import time
from concurrent.futures import ProcessPoolExecutor
from types import SimpleNamespace

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

PRIO_RANK = {"critical": 0, "high": 1, "standard": 2}
DRIVER_RATE = 220.0  # ₹ per hour, same as the evaluator
LATE_INR = {"critical": 200.0, "high": 80.0, "standard": 40.0}  # ₹ per minute late


def legacy_dispatch(prob) -> tuple[list[list[int]], list[int], float]:
    """How a typical traditional fleet system works: first-come by priority,
    nearest available vehicle, stops appended in dispatch order (no re-sequencing)."""
    t0 = time.perf_counter()
    V = len(prob.vehicles)
    routes: list[list[int]] = [[] for _ in range(V)]
    load = [0.0] * V
    tail = [prob.veh_nodes[v] for v in range(V)]
    unassigned = []
    order_seq = sorted(range(len(prob.orders)),
                       key=lambda o: (PRIO_RANK[prob.orders[o]["priority"]],
                                      prob.orders[o]["deadline"], prob.orders[o]["id"]))
    for o in order_seq:
        q = prob.orders[o]["demand"]
        cands = [v for v in range(V) if load[v] + q <= prob.vehicles[v]["capacity"]]
        if not cands:
            unassigned.append(o)
            continue
        node = prob.order_nodes[o]
        v = min(cands, key=lambda c: prob.T[tail[c], node])
        routes[v].append(o)
        load[v] += q
        tail[v] = node
    return routes, unassigned, (time.perf_counter() - t0) * 1000


def ortools_vrp(prob, time_limit_s: float = 2.0) -> tuple[list[list[int]], list[int], float]:
    """Capacitated VRP with soft deadlines, guided local search."""
    t0 = time.perf_counter()
    V = len(prob.vehicles)
    n = len(prob.points)
    starts = [int(x) for x in prob.veh_nodes]
    ends = [0] * V
    manager = pywrapcp.RoutingIndexManager(n, V, starts, ends)
    routing = pywrapcp.RoutingModel(manager)
    node_to_order = {node: o for o, node in enumerate(prob.order_nodes)}
    service = [0] * n
    demand = [0] * n
    for o, node in enumerate(prob.order_nodes):
        service[node] = prob.orders[o]["service"]
        demand[node] = int(prob.orders[o]["demand"])
    Tm = prob.T

    # Pre-computed integer matrices keep the whole search in C++ (no Python callbacks,
    # so OR-Tools does not hold the GIL while other solvers run).
    t_mat = [[int(round((Tm[a, b] + service[a]) * 10)) for b in range(n)] for a in range(n)]
    Dm = prob.D
    # Arc cost = what the fleet actually pays, in paise: ₹/km of THIS vehicle type + driver time.
    # Same objective the quantum hybrid's refinement uses, so the benchmark is like for like.
    rates = sorted({float(v["cost_per_km"]) for v in prob.vehicles})
    c_mats = {r: [[int(round((Dm[a, b] * r + (Tm[a, b] + service[a]) / 60.0 * DRIVER_RATE) * 100))
                   for b in range(n)] for a in range(n)] for r in rates}
    if hasattr(routing, "RegisterTransitMatrix"):
        t_idx = routing.RegisterTransitMatrix(t_mat)
        c_idx = {r: routing.RegisterTransitMatrix(m) for r, m in c_mats.items()}
        d_idx = routing.RegisterUnaryTransitVector(demand)
    else:  # older OR-Tools
        t_idx = routing.RegisterTransitCallback(
            lambda i, j: t_mat[manager.IndexToNode(i)][manager.IndexToNode(j)])
        c_idx = {r: routing.RegisterTransitCallback(
            lambda i, j, m=m: m[manager.IndexToNode(i)][manager.IndexToNode(j)]) for r, m in c_mats.items()}
        d_idx = routing.RegisterUnaryTransitCallback(lambda i: demand[manager.IndexToNode(i)])
    for v in range(V):
        routing.SetArcCostEvaluatorOfVehicle(c_idx[float(prob.vehicles[v]["cost_per_km"])], v)
    routing.AddDimensionWithVehicleCapacity(
        d_idx, 0, [int(v["capacity"]) for v in prob.vehicles], True, "Load")
    horizon = 24 * 60 * 10
    routing.AddDimension(t_idx, 0, horizon, False, "Time")
    tdim = routing.GetDimensionOrDie("Time")
    for v in range(V):
        tdim.CumulVar(routing.Start(v)).SetRange(int(prob.vehicles[v]["start_time"] * 10),
                                                 int(prob.vehicles[v]["start_time"] * 10))
    for o, node in enumerate(prob.order_nodes):
        idx = manager.NodeToIndex(node)
        od = prob.orders[o]
        # time unit is 0.1 min, cost unit is paise: ₹X/min late = X*100/10 paise per unit
        tdim.SetCumulVarSoftUpperBound(idx, int(od["deadline"] * 10),
                                       int(LATE_INR[od["priority"]] * 10))
        routing.AddDisjunction([idx], 10_000_000)
    # vehicle start nodes that are not used as starts are never visited
    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.FromMilliseconds(int(time_limit_s * 1000))
    sol = routing.SolveWithParameters(params)
    routes: list[list[int]] = [[] for _ in range(V)]
    served = set()
    if sol:
        for v in range(V):
            i = routing.Start(v)
            while not routing.IsEnd(i):
                node = manager.IndexToNode(i)
                if node in node_to_order:
                    routes[v].append(node_to_order[node])
                    served.add(node_to_order[node])
                i = sol.Value(routing.NextVar(i))
    unassigned = [o for o in range(len(prob.orders)) if o not in served]
    return routes, unassigned, (time.perf_counter() - t0) * 1000


# OR-Tools' SWIG binding keeps the Python GIL for the whole search, which would freeze
# every other solver (and the web server) for the full time limit. It therefore runs in
# a dedicated worker process: truly parallel, and solve times stay honest.
_pool: ProcessPoolExecutor | None = None
_pool_lock = threading.Lock()


def _get_pool() -> ProcessPoolExecutor:
    global _pool
    with _pool_lock:
        if _pool is None:
            _pool = ProcessPoolExecutor(max_workers=2, mp_context=mp.get_context("spawn"))
        return _pool


def _ortools_job(payload: dict, time_limit_s: float):
    return ortools_vrp(SimpleNamespace(**payload), time_limit_s)


def warm_ortools_pool() -> None:
    try:
        _get_pool().submit(int, 0).result(timeout=60)
    except Exception:
        pass


def ortools_vrp_isolated(prob, time_limit_s: float = 2.0):
    """Run OR-Tools out-of-process; falls back to in-process if the pool is unavailable."""
    payload = {"vehicles": prob.vehicles, "orders": prob.orders, "points": prob.points,
               "veh_nodes": [int(x) for x in prob.veh_nodes],
               "order_nodes": [int(x) for x in prob.order_nodes], "T": prob.T, "D": prob.D}
    try:
        return _get_pool().submit(_ortools_job, payload, time_limit_s).result(timeout=time_limit_s + 30)
    except Exception:
        global _pool
        with _pool_lock:
            _pool = None
        return ortools_vrp(prob, time_limit_s)
