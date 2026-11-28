"""Run the QAOA delivery-sequencing circuit on an IBM quantum computer.

The angles are optimised on the exact simulator (run_qaoa); the very same circuit is then measured
on hardware, and the measured bitstrings are scored: how often the chip returns a valid route, and how
often the optimal one, compared with the noiseless simulator and with random guessing.

Modes
  ibm   a real IBM Quantum processor through Qiskit Runtime (needs IBM_QUANTUM_TOKEN in backend/.env;
        IBM_QUANTUM_INSTANCE optional). Jobs wait in IBM's queue, so this is asynchronous: submit, then poll.
  fake  IBM's noisy snapshot of a real device (FakeTorino, 133 qubits) run locally with Qiskit Aer.
        Same transpilation and noise characteristics, no account and no queue.
"""
from __future__ import annotations

import os
import threading
import time
import uuid

import numpy as np

from . import db as _db  # noqa: F401  (loads backend/.env)
from .qaoa import _build_circuit, run_qaoa

TOKEN = os.environ.get("IBM_QUANTUM_TOKEN", "").strip()
INSTANCE = os.environ.get("IBM_QUANTUM_INSTANCE", "").strip() or None
SHOTS = 2048

_jobs: dict[str, dict] = {}
_lock = threading.Lock()
_service = None


def status() -> dict:
    return {"ibm_enabled": bool(TOKEN), "fake_backend": "fake_torino"}


def _get_service():
    global _service
    if _service is None:
        from qiskit_ibm_runtime import QiskitRuntimeService
        _service = QiskitRuntimeService(channel="ibm_quantum_platform", token=TOKEN, instance=INSTANCE)
    return _service


def _circuit(prob, route, n_stops: int, layers: int):
    ideal_res, it = run_qaoa(prob, route, n_stops, layers, _internals=True)
    qc = _build_circuit(it["h"], it["J"], it["sigma"], it["gammas"], it["betas"], it["n"])
    qc.measure_all()
    return qc, ideal_res, it


def _score(counts: dict[str, int], it: dict) -> dict:
    total = sum(counts.values()) or 1
    by_state: dict[int, int] = {}
    for bits, c in counts.items():
        z = int(bits.replace(" ", ""), 2)  # Qiskit bitstrings are little-endian: rightmost bit = qubit 0
        by_state[z] = by_state.get(z, 0) + c
    valid = it["valid"]
    p_valid = sum(c for z, c in by_state.items() if z in valid) / total
    p_opt = by_state.get(it["opt_state"], 0) / total
    n = it["n"]
    top = sorted(by_state.items(), key=lambda kv: -kv[1])[:10]
    ideal = it["ideal"]
    return {
        "shots": total,
        "p_valid": p_valid, "p_optimal": p_opt,
        "ideal_p_valid": float(sum(ideal[z] for z in valid)), "ideal_p_optimal": float(ideal[it["opt_state"]]),
        "random_p_valid": len(valid) / 2 ** n, "random_p_optimal": 1 / 2 ** n,
        "amplification": p_opt * 2 ** n,
        "top": [{"state": z, "bits": format(z, f"0{n}b")[::-1], "count": c, "prob": c / total,
                 "ideal_prob": float(ideal[z]), "valid": z in valid, "optimal": z == it["opt_state"],
                 "tour": valid.get(z), "minutes": it["minutes"].get(z)} for z, c in top],
    }


def _isa(qc, backend):
    from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager
    isa = generate_preset_pass_manager(backend=backend, optimization_level=3, seed_transpiler=7).run(qc)
    ops = isa.count_ops()
    twoq = sum(v for k, v in ops.items() if k in ("cx", "cz", "ecr"))
    return isa, {"depth": int(isa.depth()), "two_qubit_gates": int(twoq), "gates": int(sum(ops.values()))}


def submit(prob, route: dict, n_stops: int, layers: int, mode: str) -> dict:
    if mode == "ibm" and not TOKEN:
        raise ValueError("Add IBM_QUANTUM_TOKEN to backend/.env to use real IBM hardware")
    qc, ideal_res, it = _circuit(prob, route, n_stops, layers)
    jid = uuid.uuid4().hex[:10]
    job = {"id": jid, "mode": mode, "status": "PREPARING", "created": time.time(), "n_qubits": it["n"],
           "layers": layers, "stops": ideal_res["stops"], "optimal_tour": ideal_res["optimal_tour"], "_it": it}
    with _lock:
        _jobs[jid] = job

    def work():
        try:
            from qiskit_ibm_runtime import SamplerV2 as Sampler
            if mode == "fake":
                from qiskit_ibm_runtime.fake_provider import FakeTorino
                backend = FakeTorino()
            else:
                backend = _get_service().least_busy(operational=True, simulator=False, min_num_qubits=it["n"])
            isa, stats = _isa(qc, backend)
            job.update(backend=backend.name, circuit=stats, status="QUEUED" if mode == "ibm" else "RUNNING")
            sampler = Sampler(mode=backend)
            if mode == "ibm":  # light, cheap error suppression
                sampler.options.dynamical_decoupling.enable = True
                sampler.options.twirling.enable_gates = True
            rj = sampler.run([isa], shots=SHOTS)
            job["ibm_job_id"] = rj.job_id() if mode == "ibm" else None
            if mode == "ibm":
                while True:
                    st = str(rj.status())
                    job["status"] = {"INITIALIZING": "QUEUED"}.get(st, st)
                    if st in ("DONE", "ERROR", "CANCELLED"):
                        break
                    time.sleep(5)
                if st != "DONE":
                    raise RuntimeError(f"IBM job ended as {st}")
            res = rj.result()[0].data.meas.get_counts()
            job.update(result=_score(res, it), status="DONE", finished=time.time())
        except Exception as exc:  # noqa: BLE001 - reported to the browser
            job.update(status="ERROR", error=str(exc)[:400], finished=time.time())

    threading.Thread(target=work, daemon=True, name=f"qpu-{jid}").start()
    return public(job)


def public(job: dict) -> dict:
    return {k: v for k, v in job.items() if not k.startswith("_")}


def get(jid: str) -> dict:
    job = _jobs.get(jid)
    if not job:
        raise KeyError(jid)
    return public(job)
