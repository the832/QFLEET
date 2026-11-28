"""Gate-model QAOA on a small route-sequencing sub-problem.

Builds the QAOA circuit with Qiskit (cost layer of RZ / RZZ gates and an RX
mixer), optimises the angles on an exact statevector simulator (numpy fast
path, cross-checked against qiskit.quantum_info.Statevector) and reports how
strongly the circuit amplifies the optimal delivery sequence.
"""
from __future__ import annotations

import itertools
import time

import numpy as np
from scipy.optimize import minimize

from .qubo import RouteCtx, build_route_qubo, route_objective


def _cost_vector(Q: np.ndarray, n: int) -> np.ndarray:
    z = np.arange(2 ** n, dtype=np.int64)
    X = ((z[:, None] >> np.arange(n)) & 1).astype(np.float64)
    Qu = np.triu(Q)
    return np.einsum("si,ij,sj->s", X, Qu, X)


def _ising(Q: np.ndarray):
    """Coefficients of Z_i and Z_iZ_j with x = (1 - z) / 2."""
    n = Q.shape[0]
    Qu = np.triu(Q)
    h = np.zeros(n)
    J = {}
    for i in range(n):
        h[i] -= Qu[i, i] / 2
        for j in range(i + 1, n):
            if Qu[i, j] != 0:
                h[i] -= Qu[i, j] / 4
                h[j] -= Qu[i, j] / 4
                J[(i, j)] = Qu[i, j] / 4
    return h, J


def _simulate(cost_n: np.ndarray, n: int, gammas, betas) -> np.ndarray:
    psi = np.full(2 ** n, 1 / np.sqrt(2 ** n), dtype=np.complex128)
    for g, b in zip(gammas, betas):
        psi *= np.exp(-1j * g * cost_n)
        c, s = np.cos(b), -1j * np.sin(b)
        for q in range(n):
            v = psi.reshape(-1, 2, 2 ** q)
            a0 = v[:, 0, :].copy()
            a1 = v[:, 1, :]
            v[:, 0, :] = c * a0 + s * a1
            v[:, 1, :] = s * a0 + c * a1
    return psi


def _build_circuit(h, J, sigma, gammas, betas, n):
    from qiskit import QuantumCircuit

    qc = QuantumCircuit(n)
    qc.h(range(n))
    for g, b in zip(gammas, betas):
        for (i, j), w in J.items():
            qc.rzz(2 * g * w / sigma, i, j)
        for i in range(n):
            if h[i] != 0:
                qc.rz(2 * g * h[i] / sigma, i)
        qc.rx(2 * b, range(n))
    return qc


def run_qaoa(prob, route: dict, n_stops: int = 3, layers: int = 6, seed: int = 5, _internals: bool = False):
    t0 = time.perf_counter()
    rng = np.random.default_rng(seed)
    order_index = {o["id"]: i for i, o in enumerate(prob.orders)}
    vid = route["vehicle_id"]
    v = next(i for i, veh in enumerate(prob.vehicles) if veh["id"] == vid)
    seq_ids = [s["order_id"] for s in route["stops"]][:n_stops]
    members = [order_index[i] for i in seq_ids]
    m = len(members)
    if m < 2:
        raise ValueError("Route needs at least 2 stops for a QAOA demo")
    ctx = RouteCtx(
        stop_nodes=[prob.order_nodes[o] for o in members],
        prios=[prob.orders[o]["priority"] for o in members],
        deadlines=[prob.orders[o]["deadline"] for o in members],
        services=[prob.orders[o]["service"] for o in members],
        start_node=prob.veh_nodes[v], end_node=0,
        start_time=float(prob.vehicles[v].get("start_time", 0)), T=prob.T, L=0.0)
    Q, const, meta = build_route_qubo(ctx, pen=1.2)
    n = m * m
    cost = _cost_vector(Q, n) + const
    mu, sigma = float(cost.mean()), float(cost.std()) or 1.0
    cost_n = (cost - mu) / sigma

    # brute-force reference over all permutations
    perms = list(itertools.permutations(range(m)))
    tour_cost = {p: route_objective(list(p), ctx) for p in perms}
    opt_perm = min(tour_cost, key=tour_cost.get)

    def state_of(perm):
        z = 0
        for p, i in enumerate(perm):
            z |= 1 << (i * m + p)
        return z

    valid_states = {state_of(p): p for p in perms}
    opt_state = state_of(opt_perm)

    alpha = 0.15
    trace: list[float] = []

    def objective(params):
        g, b = params[:layers], params[layers:]
        probs = np.abs(_simulate(cost_n, n, g, b)) ** 2
        idx = np.argsort(cost_n)
        cum = np.cumsum(probs[idx])
        k = np.searchsorted(cum, alpha) + 1
        cvar = float((probs[idx][:k] * cost_n[idx][:k]).sum() / max(cum[k - 1], 1e-12))
        trace.append(float((probs * cost_n).sum()))
        return cvar

    best = None
    restarts, maxiter = (12, 250) if n <= 9 else (3, 120)
    inits = [np.concatenate([np.linspace(0.2, 1.2, layers), np.linspace(0.6, 0.1, layers)])]
    inits += [np.concatenate([rng.uniform(0, 2.0, layers), rng.uniform(0, 0.8, layers)])
              for _ in range(restarts - 1)]
    best_trace = []
    for x0 in inits:
        trace = []
        res = minimize(objective, x0, method="COBYLA", options={"maxiter": maxiter, "rhobeg": 0.3})
        if best is None or res.fun < best.fun:
            best, best_trace = res, list(trace)
    gammas, betas = best.x[:layers], best.x[layers:]
    psi = _simulate(cost_n, n, gammas, betas)
    probs = np.abs(psi) ** 2

    p_valid = float(sum(probs[s] for s in valid_states))
    p_opt = float(probs[opt_state])
    top = np.argsort(probs)[::-1][:14]
    stop_ids = seq_ids

    def describe(z):
        z = int(z)
        bits = [(z >> q) & 1 for q in range(n)]
        perm = valid_states.get(z)
        return {
            "state": z,
            "bits": bits,
            "prob": float(probs[z]),
            "energy": float(cost[z]),
            "valid": perm is not None,
            "optimal": z == opt_state,
            "tour": [stop_ids[i] for i in perm] if perm else None,
            "minutes": tour_cost[perm] if perm else None,
        }

    h, J = _ising(Q)
    qc = _build_circuit(h, J, sigma, gammas, betas, n)
    qiskit_info = {}
    try:
        from qiskit import transpile
        from qiskit.quantum_info import Statevector

        sv = Statevector(qc).probabilities()
        qiskit_info["max_prob_diff"] = float(np.abs(sv - probs).max())
        tq = transpile(qc, basis_gates=["rz", "sx", "x", "cx"], optimization_level=1)
        ops = tq.count_ops()
        qiskit_info.update({"depth": int(tq.depth()), "cx": int(ops.get("cx", 0)),
                            "gates": int(sum(ops.values())),
                            "logical_depth": int(qc.depth())})
    except Exception as exc:  # pragma: no cover
        qiskit_info["error"] = str(exc)

    sampled = rng.choice(2 ** n, size=1024, p=probs / probs.sum())
    shots_opt = int((sampled == opt_state).sum())
    shots_valid = int(sum(1 for s in sampled if int(s) in valid_states))

    out = {
        "vehicle_id": vid,
        "stops": [{"order_id": prob.orders[o]["id"], "customer": prob.orders[o]["customer"],
                   "priority": prob.orders[o]["priority"]} for o in members],
        "n_qubits": n, "layers": layers, "hilbert_dim": 2 ** n,
        "gammas": [float(g) for g in gammas], "betas": [float(b) for b in betas],
        "trace": best_trace,
        "p_valid": p_valid, "p_optimal": p_opt,
        "random_p_optimal": 1 / 2 ** n,
        "random_p_valid": len(perms) / 2 ** n,
        "restarts": len(inits),
        "amplification": p_opt * 2 ** n,
        "optimal_tour": [stop_ids[i] for i in opt_perm],
        "optimal_minutes": tour_cost[opt_perm],
        "top_states": [describe(z) for z in top],
        "shots": {"total": 1024, "optimal": shots_opt, "valid": shots_valid},
        "circuit": {
            "rzz": [[int(i), int(j), float(2 * gammas[0] * w / sigma)] for (i, j), w in J.items()],
            "rz": [[int(i), float(2 * gammas[0] * h[i] / sigma)] for i in range(n) if h[i] != 0],
            "rx": float(2 * betas[0]),
        },
        "qiskit": qiskit_info,
        "ms": (time.perf_counter() - t0) * 1000,
    }
    if _internals:
        # what a hardware run needs to rebuild the same circuit and score its measurements
        return out, {"h": h, "J": J, "sigma": sigma, "gammas": gammas, "betas": betas, "n": n,
                     "valid": {int(z): [stop_ids[i] for i in p] for z, p in valid_states.items()},
                     "minutes": {int(z): tour_cost[p] for z, p in valid_states.items()},
                     "opt_state": int(opt_state), "ideal": probs, "stop_ids": stop_ids}
    return out
