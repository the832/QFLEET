"""Simulated Quantum Annealing (path-integral Monte Carlo, Suzuki-Trotter).

The transverse-field Ising Hamiltonian
    H(t) = -Gamma(t) * sum_i sigma^x_i + H_problem(sigma^z)
is mapped to P coupled classical replicas ("Trotter slices"). As Gamma is
annealed to ~0 the inter-replica ferromagnetic coupling J_perp grows, the
replicas collapse onto a single classical state and quantum tunnelling between
valleys of the energy landscape is emulated. Compiled with numba.
"""
from __future__ import annotations

import math
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
from numba import njit


def qubo_to_ising(Q: np.ndarray):
    """x^T Q x (Q upper-triangular incl. diagonal)  ->  h, J (symmetric), offset.

    E(s) = h.s + 0.5 * s.J.s + offset  with  x = (1 + s) / 2.
    """
    Q = np.triu(Q)
    diag = np.diag(Q).copy()
    U = Q - np.diag(diag)
    S = U + U.T
    h = diag / 2.0 + S.sum(axis=1) / 4.0
    J = S / 4.0
    offset = diag.sum() / 2.0 + U.sum() / 4.0
    return h, J, offset


def qubo_energy(Q: np.ndarray, x: np.ndarray) -> float:
    Q = np.triu(Q)
    return float(x @ Q @ x)


@njit(cache=True, nogil=True)
def _sqa_kernel(h, J, P, sweeps, gamma0, gamma1, pt, seed, n_record, n_snap):
    np.random.seed(seed)
    n = h.shape[0]
    s = np.empty((P, n))
    for k in range(P):
        for i in range(n):
            s[k, i] = 1.0 if np.random.random() < 0.5 else -1.0
    f = np.empty((P, n))
    for k in range(P):
        for i in range(n):
            acc = h[i]
            for j in range(n):
                acc += J[i, j] * s[k, j]
            f[k, i] = acc

    rec_g = np.zeros(n_record)
    rec_min = np.zeros(n_record)
    rec_mean = np.zeros(n_record)
    rec_jperp = np.zeros(n_record)
    snaps = np.zeros((n_snap, P, n), dtype=np.int8)
    rec_every = max(1, sweeps // n_record)
    snap_every = max(1, sweeps // max(1, n_snap - 1))

    best_e = 1e300
    best_s = s[0].copy()
    ri = 0
    si = 0
    beta_p = 1.0 / pt  # beta / P  with  pt = P * T
    for sw in range(sweeps):
        frac = sw / max(1, sweeps - 1)
        # exponential decay of the transverse field
        gamma = gamma0 * (gamma1 / gamma0) ** frac
        th = math.tanh(gamma * beta_p)
        if th < 1e-300:
            th = 1e-300
        jperp = -0.5 * math.log(th)
        for k in range(P):
            kp = (k + 1) % P
            km = (k - 1 + P) % P
            for i in range(n):
                si_ = s[k, i]
                d_ep = -2.0 * si_ * f[k, i]
                d_coup = 2.0 * si_ * (s[km, i] + s[kp, i])
                la = -beta_p * d_ep - jperp * d_coup
                if la >= 0.0 or np.random.random() < math.exp(la):
                    s[k, i] = -si_
                    ds = -2.0 * si_
                    for j in range(n):
                        f[k, j] += J[j, i] * ds
        # bookkeeping
        if sw % rec_every == 0 or sw == sweeps - 1:
            emin = 1e300
            esum = 0.0
            for k in range(P):
                e = 0.0
                for i in range(n):
                    e += s[k, i] * (h[i] + 0.5 * (f[k, i] - h[i]))
                esum += e
                if e < emin:
                    emin = e
                if e < best_e:
                    best_e = e
                    best_s[:] = s[k]
            if ri < n_record:
                rec_g[ri] = gamma
                rec_min[ri] = emin
                rec_mean[ri] = esum / P
                rec_jperp[ri] = jperp
                ri += 1
        if n_snap > 0 and (sw % snap_every == 0 or sw == sweeps - 1) and si < n_snap:
            for k in range(P):
                for i in range(n):
                    snaps[si, k, i] = 1 if s[k, i] > 0 else -1
            si += 1
    # final check of every replica
    for k in range(P):
        e = 0.0
        for i in range(n):
            e += s[k, i] * (h[i] + 0.5 * (f[k, i] - h[i]))
        if e < best_e:
            best_e = e
            best_s[:] = s[k]
    return best_s, best_e, rec_g[:ri], rec_min[:ri], rec_mean[:ri], rec_jperp[:ri], snaps[:si]


def sqa_solve(Q: np.ndarray, *, replicas: int = 16, sweeps: int = 800, reads: int = 6,
              gamma0: float = 3.0, gamma1: float = 1e-3, pt: float = 0.03,
              seed: int = 1, record: int = 120, snapshots: int = 0) -> dict:
    """Minimise x^T Q x with SQA. Returns best bit-vector, energy and telemetry."""
    n = Q.shape[0]
    t0 = time.perf_counter()
    h, J, off = qubo_to_ising(Q)
    scale = max(np.abs(h).max(initial=0), np.abs(J).max(initial=0), 1e-12)
    hn, Jn = h / scale, J / scale

    def run(r):
        return _sqa_kernel(hn, Jn, replicas, sweeps, gamma0, gamma1, pt,
                           seed * 7919 + r, record if r == 0 else 2,
                           snapshots if r == 0 else 0)

    with ThreadPoolExecutor(max_workers=min(reads, 8)) as ex:
        outs = list(ex.map(run, range(reads)))
    energies = []
    best = None
    for o in outs:
        x = ((o[0] + 1) / 2).astype(np.int8)
        e = qubo_energy(Q, x.astype(float))
        energies.append(e)
        if best is None or e < best[1]:
            best = (x, e)
    o0 = outs[0]
    ms = (time.perf_counter() - t0) * 1000
    return {
        "x": best[0],
        "energy": best[1],
        "read_energies": energies,
        "n_vars": n,
        "replicas": replicas,
        "sweeps": sweeps,
        "reads": reads,
        "ms": ms,
        "trace": {
            "gamma": (o0[2]).tolist(),
            "e_min": (o0[3] * scale + off).tolist(),
            "e_mean": (o0[4] * scale + off).tolist(),
            "j_perp": o0[5].tolist(),
        },
        "snapshots": o0[6],
    }


def sa_solve(Q: np.ndarray, *, reads: int = 6, sweeps: int = 800, seed: int = 1) -> dict:
    """Classical thermal simulated annealing on the *same* QUBO (D-Wave neal)."""
    from dwave.samplers import SimulatedAnnealingSampler

    t0 = time.perf_counter()
    n = Q.shape[0]
    Qu = np.triu(Q)
    lin = {i: float(Qu[i, i]) for i in range(n)}
    iu, ju = np.nonzero(np.triu(Qu, 1))
    quad = {(int(i), int(j)): float(Qu[i, j]) for i, j in zip(iu, ju)}
    ss = SimulatedAnnealingSampler().sample_qubo({**{(i, i): v for i, v in lin.items()}, **quad},
                                                 num_reads=reads, num_sweeps=sweeps, seed=seed)
    rec = ss.first
    x = np.array([rec.sample[i] for i in range(n)], dtype=np.int8)
    return {"x": x, "energy": float(rec.energy), "n_vars": n, "reads": reads,
            "sweeps": sweeps, "ms": (time.perf_counter() - t0) * 1000,
            "read_energies": [float(e) for e in ss.record.energy]}
