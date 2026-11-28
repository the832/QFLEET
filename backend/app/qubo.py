"""QUBO formulations for the two quantum stages of the fleet optimiser.

Stage 1 - Capacitated fleet allocation (generalised assignment problem)
    binary x[o, v]  = order o served by vehicle v
    (only for each order's 3 cheapest candidate vehicles: pruned decomposition)
    E =  sum_{o,v} c(o,v) x[o,v]                                  insertion cost to seed
       + A * sum_o (1 - sum_v x[o,v])^2                           one vehicle per order
       + C * sum_v ((sum_o q_o x[o,v] - fill * cap_v) / cap_v)^2  capacity-aware loading
    followed by an exact capacity repair on the decoded sample.

Stage 2 - Route sequencing per vehicle (binary x[i, p] = stop i at position p)
    E =  A * [sum_i (1 - sum_p x[i,p])^2 + sum_p (1 - sum_i x[i,p])^2]
       + sum_p sum_{i!=j} t(i,j) x[i,p] x[j,p+1] + start / return legs
       + sum_{i,p} w_i * max(0, eta(p) - deadline_i) x[i,p]       deadline-aware urgency
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

PEN = 1.0  # tuned: keeps samples feasible on spread-out routes while staying resolvable
URGENCY = {"critical": 3.0, "high": 1.5, "standard": 0.0}
LATE_W = {"critical": 4.0, "high": 2.0, "standard": 1.0}


class QuboBuilder:
    def __init__(self, n: int):
        self.Q = np.zeros((n, n))
        self.const = 0.0

    def lin(self, i, v):
        self.Q[i, i] += v

    def quad(self, i, j, v):
        if i == j:
            self.Q[i, i] += v
        elif i < j:
            self.Q[i, j] += v
        else:
            self.Q[j, i] += v

    def one_hot(self, idxs, weight):
        """weight * (1 - sum x)^2 = weight * (1 - sum x + 2 sum_{a<b} x_a x_b)."""
        self.const += weight
        for a, i in enumerate(idxs):
            self.lin(i, -weight)
            for j in idxs[a + 1:]:
                self.quad(i, j, 2 * weight)

    def square(self, terms, target, weight):
        """weight * (sum_k a_k x_k - target)^2 for terms = [(idx, a_k)]."""
        self.const += weight * target * target
        for a, (i, ai) in enumerate(terms):
            self.lin(i, weight * (ai * ai - 2 * target * ai))
            for j, aj in terms[a + 1:]:
                self.quad(i, j, 2 * weight * ai * aj)


# ----------------------------------------------------------------- stage 1
def allocation_costs(order_nodes, seeds, veh_nodes, T, start_w=0.3):
    N, V = len(order_nodes), len(seeds)
    c = np.zeros((N, V))
    for v in range(V):
        for o, node in enumerate(order_nodes):
            c[o, v] = 0.5 * (T[seeds[v], node] + T[node, seeds[v]]) + start_w * T[veh_nodes[v], node]
    return c


def build_allocation_qubo(order_nodes, demands, seeds, veh_nodes, caps, T, n_cand=3):
    """Candidate-pruned capacitated assignment QUBO.

    Each order only gets qubits for its `n_cand` cheapest vehicles (seed
    proximity), which keeps the landscape well conditioned for annealing.
    """
    N, V = len(order_nodes), len(seeds)
    c = allocation_costs(order_nodes, seeds, veh_nodes, T)
    k = min(n_cand, V)
    cand = [list(np.argsort(c[o])[:k]) for o in range(N)]
    var = []                     # var index -> (order, vehicle)
    var_of = {}
    for o in range(N):
        for v in cand[o]:
            var_of[(o, int(v))] = len(var)
            var.append((o, int(v)))
    qb = QuboBuilder(len(var))

    total = float(sum(demands))
    fill = min(1.0, total / float(sum(caps)))
    targets = [cap * fill for cap in caps]
    spread = float(np.mean([c[o, cand[o][-1]] - c[o, cand[o][0]] for o in range(N)])) or 1.0
    q_mean = float(np.mean(demands))
    A = 2.0 * float(max(c[o, cand[o][-1]] for o in range(N))) + 1.0
    C = [0.6 * spread * (cap / q_mean) ** 2 for cap in caps]

    for (o, v), i in var_of.items():
        qb.lin(i, c[o, v])
    for o in range(N):
        qb.one_hot([var_of[(o, int(v))] for v in cand[o]], A)
    for v in range(V):
        members = [(var_of[(o, v)], demands[o] / caps[v]) for o in range(N) if (o, v) in var_of]
        if members:
            qb.square(members, targets[v] / caps[v], C[v])
    meta = {"A": A, "C": float(np.mean(C)), "N": N, "V": V, "var": var,
            "n_assign": len(var), "n_slack": 0, "cost": c, "candidates": k}
    return qb.Q, qb.const, meta


def decode_allocation(x, N, V, demands, caps, cost, var=None):
    """Bits -> vehicle per order, then repair one-hot / capacity violations."""
    X = np.zeros((N, V), dtype=int)
    if var is None:
        X[:] = np.asarray(x)[: N * V].reshape(N, V)
    else:
        for i, (o, v) in enumerate(var):
            X[o, v] = int(x[i])
    assign = [-1] * N
    raw_violations = 0
    for o in range(N):
        ones = np.flatnonzero(X[o])
        if len(ones) == 1:
            assign[o] = int(ones[0])
        else:
            raw_violations += 1
    load = [0.0] * V
    for o, v in enumerate(assign):
        if v >= 0:
            load[v] += demands[o]
    cap_violations = sum(1 for v in range(V) if load[v] > caps[v] + 1e-9)
    repairs = 0
    for v in range(V):
        while load[v] > caps[v] + 1e-9:
            members = [o for o in range(N) if assign[o] == v]
            if not members:
                break
            # evict the order that is cheapest to serve elsewhere
            o = min(members, key=lambda m: min(
                [cost[m, w] for w in range(V) if w != v] or [1e9]) - cost[m, v])
            assign[o] = -1
            load[v] -= demands[o]
            repairs += 1
    unassigned = []
    for o in sorted(range(N), key=lambda m: -demands[m]):
        if assign[o] != -1:
            continue
        cands = [v for v in range(V) if load[v] + demands[o] <= caps[v] + 1e-9]
        if not cands:
            unassigned.append(o)
            continue
        v = min(cands, key=lambda w: cost[o, w])
        assign[o] = v
        load[v] += demands[o]
        repairs += 1
    return assign, unassigned, raw_violations + cap_violations, repairs


# ----------------------------------------------------------------- stage 2
@dataclass
class RouteCtx:
    stop_nodes: list
    prios: list
    deadlines: list
    services: list
    start_node: int
    end_node: int
    start_time: float
    T: np.ndarray
    L: float = 0.0

    @property
    def m(self):
        return len(self.stop_nodes)


def route_objective(order, ctx: RouteCtx) -> float:
    """Exact objective: travel minutes + weighted lateness + mild urgency."""
    if not order:
        return 0.0
    T = ctx.T
    t = ctx.start_time
    node = ctx.start_node
    cost = 0.0
    for p, i in enumerate(order):
        nxt = ctx.stop_nodes[i]
        leg = T[node, nxt]
        cost += leg
        t += leg
        cost += LATE_W[ctx.prios[i]] * max(0.0, t - ctx.deadlines[i])
        cost += ctx.L * URGENCY[ctx.prios[i]] * p
        t += ctx.services[i]
        node = nxt
    cost += T[node, ctx.end_node]
    return float(cost)


def build_route_qubo(ctx: RouteCtx, pen: float | None = None):
    m = ctx.m
    idx = lambda i, p: i * m + p
    qb = QuboBuilder(m * m)
    T = ctx.T
    nodes = [ctx.start_node] + list(ctx.stop_nodes) + [ctx.end_node]
    sub = T[np.ix_(nodes, nodes)]
    inner = T[np.ix_(ctx.stop_nodes, ctx.stop_nodes)]
    avg_leg = float(inner[inner > 0].mean()) if (inner > 0).any() else 1.0
    first = float(np.mean([T[ctx.start_node, s] for s in ctx.stop_nodes]))
    avg_srv = float(np.mean(ctx.services))
    eta = [ctx.start_time + first + p * (avg_leg + avg_srv) for p in range(m)]

    late = np.zeros((m, m))
    for i in range(m):
        for p in range(m):
            late[i, p] = LATE_W[ctx.prios[i]] * max(0.0, eta[p] - ctx.deadlines[i]) \
                + ctx.L * URGENCY[ctx.prios[i]] * p
    A = (PEN if pen is None else pen) * float(sub.max()) + float(late.max(initial=0.0))

    for i in range(m):
        qb.one_hot([idx(i, p) for p in range(m)], A)
    for p in range(m):
        qb.one_hot([idx(i, p) for i in range(m)], A)
    for p in range(m - 1):
        for i in range(m):
            for j in range(m):
                if i != j:
                    qb.quad(idx(i, p), idx(j, p + 1), T[ctx.stop_nodes[i], ctx.stop_nodes[j]])
    for i in range(m):
        qb.lin(idx(i, 0), T[ctx.start_node, ctx.stop_nodes[i]])
        qb.lin(idx(i, m - 1), T[ctx.stop_nodes[i], ctx.end_node])
        for p in range(m):
            qb.lin(idx(i, p), late[i, p])
    return qb.Q, qb.const, {"A": A, "m": m, "eta": eta}


def decode_route(x, ctx: RouteCtx):
    m = ctx.m
    X = np.asarray(x).reshape(m, m)
    valid = bool((X.sum(axis=0) == 1).all() and (X.sum(axis=1) == 1).all())
    if valid:
        return [int(np.flatnonzero(X[:, p])[0]) for p in range(m)], True
    order, used = [], set()
    for p in range(m):
        cands = [int(i) for i in np.flatnonzero(X[:, p]) if int(i) not in used]
        if len(cands) == 1:
            order.append(cands[0])
            used.add(cands[0])
    for i in range(m):
        if i in used:
            continue
        best = None
        for pos in range(len(order) + 1):
            trial = order[:pos] + [i] + order[pos:]
            cst = route_objective(trial, ctx)
            if best is None or cst < best[0]:
                best = (cst, trial)
        order = best[1]
        used.add(i)
    return order, False


def polish_route(order, ctx: RouteCtx, max_iter=60):
    """Classical 2-opt + relocate local search (hybrid post-processing)."""
    best = list(order)
    best_c = route_objective(best, ctx)
    m = len(best)
    for _ in range(max_iter):
        improved = False
        for i in range(m - 1):
            for j in range(i + 1, m):
                cand = best[:i] + best[i:j + 1][::-1] + best[j + 1:]
                cst = route_objective(cand, ctx)
                if cst < best_c - 1e-9:
                    best, best_c, improved = cand, cst, True
        for i in range(m):
            for j in range(m):
                if i == j:
                    continue
                cand = best[:i] + best[i + 1:]
                cand.insert(j, best[i])
                cst = route_objective(cand, ctx)
                if cst < best_c - 1e-9:
                    best, best_c, improved = cand, cst, True
        if not improved:
            break
    return best, best_c
