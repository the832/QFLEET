"""Quantum-vs-thermal scaling experiment on real sub-routes of the current city.

For growing route sizes m, random subsets of the scenario's orders are turned
into sequencing QUBOs. The *raw* annealer output (no classical polish) of
Simulated Quantum Annealing and thermal Simulated Annealing (D-Wave neal) is
compared against the best known tour (exact for m <= 8, multi-start local
search beyond), with an identical sweep budget.
"""
from __future__ import annotations

import itertools
import time

import numpy as np

from .qubo import RouteCtx, build_route_qubo, decode_route, polish_route, route_objective
from .sqa import sa_solve, sqa_solve


def _reference(ctx: RouteCtx, rng) -> float:
    m = ctx.m
    if m <= 8:
        return min(route_objective(list(p), ctx) for p in itertools.permutations(range(m)))
    best = None
    for _ in range(8):
        start = list(rng.permutation(m))
        _, c = polish_route(start, ctx, max_iter=200)
        best = c if best is None else min(best, c)
    return float(best)


def run_scaling(prob, sizes=(5, 7, 9, 11, 13), trials: int = 3, seed: int = 4) -> dict:
    t0 = time.perf_counter()
    rng = np.random.default_rng(seed)
    N = len(prob.orders)
    rows = []
    for m in sizes:
        if m > N:
            break
        sq, sa, sqv, sav, sqt, sat = [], [], 0, 0, 0.0, 0.0
        for t in range(trials):
            members = list(rng.choice(N, size=m, replace=False))
            ctx = RouteCtx(
                stop_nodes=[prob.order_nodes[o] for o in members],
                prios=[prob.orders[o]["priority"] for o in members],
                deadlines=[10_000.0] * m,  # pure sequencing benchmark
                services=[prob.orders[o]["service"] for o in members],
                start_node=0, end_node=0, start_time=0.0, T=prob.T, L=0.0)
            Q, _, _ = build_route_qubo(ctx, pen=1.0)  # strict penalty: every sample must be checkable
            ref = _reference(ctx, rng)
            sweeps = 3000
            r1 = sqa_solve(Q, sweeps=sweeps, reads=8, seed=seed + 31 * t + m)
            r2 = sa_solve(Q, sweeps=sweeps, reads=8, seed=seed + 31 * t + m)
            o1, v1 = decode_route(r1["x"], ctx)
            o2, v2 = decode_route(r2["x"], ctx)
            sq.append(route_objective(o1, ctx) / ref)
            sa.append(route_objective(o2, ctx) / ref)
            sqv += v1
            sav += v2
            sqt += r1["ms"]
            sat += r2["ms"]
        rows.append({
            "stops": m, "qubits": m * m,
            "sqa_gap_pct": 100 * (float(np.mean(sq)) - 1),
            "sa_gap_pct": 100 * (float(np.mean(sa)) - 1),
            "sqa_valid_pct": 100 * sqv / trials,
            "sa_valid_pct": 100 * sav / trials,
            "sqa_ms": sqt / trials, "sa_ms": sat / trials,
            "exact_reference": m <= 8,
        })
    return {"rows": rows, "trials": trials, "ms": (time.perf_counter() - t0) * 1000}
